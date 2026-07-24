import {
  errorResponse,
  handleOptions,
  jsonResponse,
  readJsonBody,
  requirePost,
} from "../_shared/http.ts";
import {
  createAdminClient,
  createAuthAdminClient,
  requirePublishableKey,
} from "../_shared/supabase.ts";
import {
  ACCESS_POLICY_SELECT,
  DEFAULT_ACCESS_POLICY,
  accessPolicy,
} from "../_shared/access-policy.ts";
import {
  enforceRateLimit,
  rateLimitResponse,
  requestIp,
  sha256Hex,
} from "../_shared/security.ts";
import { unverifiedMfaFactorIds } from "../_shared/mfa-recovery.ts";

type ActivateBody = {
  email?: unknown;
  code?: unknown;
};

type AuthUserRecord = {
  id?: string;
  email?: string;
};

function cleanEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().slice(0, 254) : "";
}

function cleanCode(value: unknown): string {
  return typeof value === "string"
    ? value.toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, "").slice(0, 12)
    : "";
}

async function findAuthUserByEmail(
  authAdmin: ReturnType<typeof createAuthAdminClient>,
  email: string,
): Promise<AuthUserRecord | null> {
  const perPage = 1000;
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await authAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = (data?.users || []) as AuthUserRecord[];
    const found = users.find((candidate) => cleanEmail(candidate.email) === email);
    if (found) return found;
    if (users.length < perPage) return null;
  }
  return null;
}

function randomBootstrapPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const value = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "A")
    .replaceAll("/", "z")
    .replaceAll("=", "");
  return `Az!9${value}`;
}

async function clearUnverifiedMfaFactors(
  authAdmin: ReturnType<typeof createAuthAdminClient>,
  userId: string,
): Promise<void> {
  const { data, error } = await authAdmin.auth.admin.mfa.listFactors({ userId });
  if (error) throw error;
  const factors = [
    ...(data?.factors || []),
    ...(data?.totp || []),
    ...(data?.phone || []),
  ];
  for (const factorId of unverifiedMfaFactorIds(factors)) {
    const { error: deleteError } = await authAdmin.auth.admin.mfa.deleteFactor({
      userId,
      id: factorId,
    });
    if (deleteError) throw deleteError;
  }
}

async function magicTokenHash(
  authAdmin: ReturnType<typeof createAuthAdminClient>,
  email: string,
): Promise<string> {
  const { data, error } = await authAdmin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error) throw error;
  const tokenHash = data?.properties?.hashed_token;
  if (!tokenHash) throw new Error("missing_activation_token_hash");
  return tokenHash;
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  const methodError = requirePost(req);
  if (methodError) return methodError;

  const genericError = () => errorResponse(
    "activation_invalid",
    "The activation code is invalid or expired.",
    400,
  );
  let claimedCodeId = "";
  let failureStage = "validate_request";

  try {
    requirePublishableKey(req);
    const body = await readJsonBody<ActivateBody>(req);
    const email = cleanEmail(body.email);
    const code = cleanCode(body.code);
    if (!email || !email.includes("@") || code.length !== 12) return genericError();

    const admin = createAdminClient();
    const authAdmin = createAuthAdminClient();
    failureStage = "rate_limit";
    const { data: policyMember, error: policyMemberError } = await admin
      .schema("licensing")
      .from("members")
      .select("organization_id")
      .eq("email", email)
      .in("status", ["invited", "active"])
      .limit(1)
      .maybeSingle();
    if (policyMemberError) throw policyMemberError;

    let attemptPolicy = DEFAULT_ACCESS_POLICY;
    if (policyMember?.organization_id) {
      const { data: policyOrganization, error: policyOrganizationError } = await admin
        .schema("licensing")
        .from("organizations")
        .select(ACCESS_POLICY_SELECT)
        .eq("id", policyMember.organization_id)
        .maybeSingle();
      if (policyOrganizationError) throw policyOrganizationError;
      attemptPolicy = accessPolicy(policyOrganization);
    }
    const attemptWindowSeconds = attemptPolicy.activationAttemptWindowMinutes * 60;
    await enforceRateLimit(
      admin,
      "activation.consume.email",
      email,
      attemptPolicy.activationAttemptLimit,
      attemptWindowSeconds,
    );
    await enforceRateLimit(
      admin,
      "activation.consume.ip",
      requestIp(req),
      30,
      attemptWindowSeconds,
    );

    failureStage = "consume_code";
    const codeHash = await sha256Hex(`arizona-activation:v1:${code}`);
    const { data: consumedRows, error: consumeError } = await admin
      .schema("licensing")
      .rpc("consume_activation_code", {
        target_code_hash: codeHash,
        target_email: email,
      });
    if (consumeError) throw consumeError;
    const consumed = Array.isArray(consumedRows) ? consumedRows[0] : consumedRows;
    if (!consumed || consumed.result !== "consumed") return genericError();
    claimedCodeId = String(consumed.code_id || "");

    failureStage = "load_member";
    const { data: member, error: memberError } = await admin
      .schema("licensing")
      .from("members")
      .select("id,organization_id,email,auth_user_id,status")
      .eq("id", consumed.member_id)
      .eq("organization_id", consumed.organization_id)
      .maybeSingle();
    if (memberError) throw memberError;
    if (!member || !["invited", "active"].includes(member.status) || cleanEmail(member.email) !== email) {
      throw new Error("activation_member_rejected");
    }

    failureStage = "load_organization";
    const { data: organization, error: organizationError } = await admin
      .schema("licensing")
      .from("organizations")
      .select(`id,status,license_expires_on,${ACCESS_POLICY_SELECT}`)
      .eq("id", member.organization_id)
      .maybeSingle();
    if (organizationError) throw organizationError;
    if (!organization || organization.status !== "active") {
      throw new Error("activation_organization_rejected");
    }
    if (
      organization.license_expires_on
      && new Date(`${organization.license_expires_on}T23:59:59.999Z`).getTime() < Date.now()
    ) {
      throw new Error("activation_organization_expired");
    }
    const organizationPolicy = accessPolicy(organization);

    failureStage = "load_auth_user";
    let authUser: AuthUserRecord | null = null;
    if (member.auth_user_id) {
      const { data: linkedAuth, error: linkedAuthError } =
        await authAdmin.auth.admin.getUserById(member.auth_user_id);
      if (linkedAuthError) throw linkedAuthError;
      if (
        !linkedAuth.user?.id
        || cleanEmail(linkedAuth.user.email) !== email
      ) {
        throw new Error("activation_auth_identity_rejected");
      }
      authUser = { id: linkedAuth.user.id, email: linkedAuth.user.email };
    } else {
      authUser = await findAuthUserByEmail(authAdmin, email);
    }

    if (!authUser?.id) {
      failureStage = "create_auth_user";
      const { data, error } = await authAdmin.auth.admin.createUser({
        email,
        password: randomBootstrapPassword(),
        email_confirm: true,
        user_metadata: { source: "arizona-activation-code" },
      });
      if (error || !data.user?.id) throw error || new Error("auth_user_creation_failed");
      authUser = { id: data.user.id, email };
    }

    failureStage = "validate_identity";
    const { data: masterIdentity, error: masterIdentityError } = await admin
      .schema("licensing")
      .from("master_accounts")
      .select("id")
      .eq("auth_user_id", authUser.id)
      .maybeSingle();
    if (masterIdentityError) throw masterIdentityError;
    if (masterIdentity && !consumed.created_by_master_id) {
      throw new Error("activation_master_identity_rejected");
    }

    failureStage = "link_member";
    const now = new Date().toISOString();
    const { data: linkedMember, error: linkError } = await admin
      .schema("licensing")
      .from("members")
      .update({
        auth_user_id: authUser.id,
        status: "active",
        activated_at: member.status === "invited" ? now : undefined,
        last_seen_at: now,
      })
      .eq("id", member.id)
      .or(`auth_user_id.is.null,auth_user_id.eq.${authUser.id}`)
      .select("id")
      .maybeSingle();
    if (linkError) throw linkError;
    if (!linkedMember) throw new Error("activation_member_link_rejected");

    if (consumed.purpose === "recovery") {
      failureStage = "clear_unverified_mfa";
      await clearUnverifiedMfaFactors(authAdmin, authUser.id);
      const recoveryExpiresAt = new Date(
        Date.now() + organizationPolicy.deviceRecoveryWindowMinutes * 60_000,
      ).toISOString();
      failureStage = "revoke_devices";
      const { error: deviceRecoveryError } = await admin
        .schema("licensing")
        .from("devices")
        .update({
          status: "revoked",
          revoked_at: now,
          revoked_reason: "account_recovery",
          updated_at: now,
        })
        .eq("member_id", member.id)
        .eq("status", "active");
      if (deviceRecoveryError) throw deviceRecoveryError;

      failureStage = "revoke_license_sessions";
      const { error: sessionRecoveryError } = await admin
        .schema("licensing")
        .from("license_sessions")
        .update({
          status: "revoked",
          revoked_at: now,
          revoked_reason: "account_recovery",
          updated_at: now,
        })
        .eq("member_id", member.id)
        .eq("status", "active");
      if (sessionRecoveryError) throw sessionRecoveryError;

      failureStage = "open_recovery_window";
      const { error: memberRecoveryError } = await admin
        .schema("licensing")
        .from("members")
        .update({
          device_recovery_mfa_not_before: now,
          device_recovery_expires_at: recoveryExpiresAt,
          updated_at: now,
        })
        .eq("id", member.id);
      if (memberRecoveryError) throw memberRecoveryError;
    }

    failureStage = "create_session_exchange";
    const tokenHash = await magicTokenHash(authAdmin, email);

    failureStage = "write_audit";
    await admin
      .schema("licensing")
      .from("audit_log")
      .insert({
        organization_id: member.organization_id,
        actor_member_id: member.id,
        action: consumed.purpose === "recovery"
          ? "member.recovery_code_consumed"
          : "member.activation_code_consumed",
        target_table: "members",
        target_id: member.id,
        metadata: {
          source: "tauri_passwordless_activation",
          activationCodeId: consumed.code_id,
          purpose: consumed.purpose,
        },
      });

    return jsonResponse({
      ok: true,
      tokenHash,
      tokenType: "magiclink",
      recovery: consumed.purpose === "recovery",
    });
  } catch (error) {
    const message = String((error as { message?: unknown })?.message || error || "");
    console.error("app-activate failed", { stage: failureStage, message });
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    if (message === "invalid_publishable_key") {
      return errorResponse("invalid_publishable_key", "Invalid publishable key.", 401);
    }
    if (claimedCodeId) {
      try {
        const rollbackAdmin = createAdminClient();
        const { error: rollbackError } = await rollbackAdmin
          .schema("licensing")
          .from("activation_codes")
          .update({
            used_at: null,
            last_attempt_at: null,
          })
          .eq("id", claimedCodeId);
        if (rollbackError) {
          console.error("app-activate code release failed", {
            stage: failureStage,
            message: rollbackError.message,
          });
        }
      } catch (rollbackError) {
        console.error("app-activate code release failed", {
          stage: failureStage,
          message: String(
            (rollbackError as { message?: unknown })?.message || rollbackError || "",
          ),
        });
      }
      return errorResponse(
        "activation_unavailable",
        "Activation could not be completed. Try the same code again.",
        503,
      );
    }
    return genericError();
  }
});
