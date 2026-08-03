import {
  errorResponse,
  handleOptions,
  jsonResponse,
  readJsonBody,
  requirePost,
} from "../_shared/http.ts";
import {
  createAdminClient,
  getAuthUser,
  requirePublishableKey,
} from "../_shared/supabase.ts";
import { resolveMaster, resolveMember } from "../_shared/actors.ts";
import {
  ACCESS_POLICY_SELECT,
  accessPolicy,
} from "../_shared/access-policy.ts";
import {
  currentAuthDayStart,
  normalizeDailyAuthResetHour,
} from "../_shared/auth-cycle.ts";
import {
  adminGoogleOAuthNotBefore,
  enforceRateLimit,
  rateLimitResponse,
  requestIp,
  requireRecentMasterAuthentication,
  requireRecentTotp,
  sha256Hex,
} from "../_shared/security.ts";

type GenerateCodeBody = {
  organizationId?: unknown;
  memberId?: unknown;
};

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_LENGTH = 12;

function cleanString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function generateCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  const raw = [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
  return raw.match(/.{1,4}/g)?.join("-") || raw;
}

function codeMaterial(value: string): string {
  return `arizona-activation:v1:${value.replaceAll("-", "")}`;
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  const methodError = requirePost(req);
  if (methodError) return methodError;

  try {
    requirePublishableKey(req);
    const body = await readJsonBody<GenerateCodeBody>(req);
    const organizationId = cleanString(body.organizationId, 64);
    const memberId = cleanString(body.memberId, 64);
    if (!organizationId || !memberId) {
      return errorResponse("invalid_request", "Organization and member are required.", 400);
    }

    const admin = createAdminClient();
    const user = await getAuthUser(req);
    const master = await resolveMaster(admin, user);
    const actor = master ?? await resolveMember(admin, user, organizationId);
    if (!actor || (actor.kind === "member" && actor.role !== "admin")) {
      return errorResponse("forbidden", "Access denied.", 403);
    }

    const { data: organization, error: organizationError } = await admin
      .schema("licensing")
      .from("organizations")
      .select(`id,status,daily_auth_reset_hour,license_expires_on,${ACCESS_POLICY_SELECT}`)
      .eq("id", organizationId)
      .maybeSingle();
    if (organizationError) throw organizationError;
    if (!organization || organization.status !== "active") {
      return errorResponse("organization_not_active", "Organization is not active.", 403);
    }

    const resetHour = normalizeDailyAuthResetHour(organization.daily_auth_reset_hour);
    const policy = accessPolicy(organization);
    const authBoundary = currentAuthDayStart(new Date(), resetHour);
    if (actor.kind === "master") {
      requireRecentMasterAuthentication(
        req,
        authBoundary,
        user.providers,
        adminGoogleOAuthNotBefore(),
      );
    } else {
      requireRecentTotp(req, authBoundary);
    }

    const { data: target, error: targetError } = await admin
      .schema("licensing")
      .from("members")
      .select("id,organization_id,email,role,status,auth_user_id")
      .eq("id", memberId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!target || !["invited", "active"].includes(target.status)) {
      return errorResponse("member_not_found", "Member was not found.", 404);
    }
    if (actor.kind === "member" && (target.role === "admin" || target.id === actor.id)) {
      return errorResponse("forbidden", "Managers cannot issue codes for this account.", 403);
    }
    if (actor.kind === "member") {
      const { data: masterIdentity, error: masterIdentityError } = await admin
        .schema("licensing")
        .from("master_accounts")
        .select("id")
        .eq("email", target.email)
        .maybeSingle();
      if (masterIdentityError) throw masterIdentityError;
      if (masterIdentity) {
        return errorResponse(
          "protected_identity",
          "Managers cannot issue codes for a master identity.",
          403,
        );
      }
    }

    const generationWindowSeconds = policy.activationGenerationWindowMinutes * 60;
    await enforceRateLimit(
      admin,
      "activation.generate.target",
      target.id,
      policy.activationGenerationLimit,
      generationWindowSeconds,
    );
    await enforceRateLimit(
      admin,
      "activation.generate.actor",
      `${actor.kind}:${actor.id}`,
      10,
      generationWindowSeconds,
    );
    await enforceRateLimit(
      admin,
      "activation.generate.ip",
      requestIp(req),
      20,
      generationWindowSeconds,
    );

    const code = generateCode();
    const codeHash = await sha256Hex(codeMaterial(code));
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + policy.activationCodeTtlMinutes * 60_000,
    );
    const purpose = target.auth_user_id || target.status === "active" ? "recovery" : "activation";

    const { data: activation, error: insertError } = await admin
      .schema("licensing")
      .from("activation_codes")
      .insert({
        organization_id: organizationId,
        member_id: target.id,
        purpose,
        code_hash: codeHash,
        created_by_master_id: actor.kind === "master" ? actor.id : null,
        created_by_member_id: actor.kind === "member" ? actor.id : null,
        expires_at: expiresAt.toISOString(),
        metadata: {
          source: "tauri_admin_panel",
          targetRole: target.role,
        },
      })
      .select("id,expires_at,purpose")
      .single();
    if (insertError) throw insertError;

    await admin
      .schema("licensing")
      .from("audit_log")
      .insert({
        organization_id: organizationId,
        actor_master_id: actor.kind === "master" ? actor.id : null,
        actor_member_id: actor.kind === "member" ? actor.id : null,
        action: "activation_code.generated",
        target_table: "members",
        target_id: target.id,
        metadata: {
          source: "tauri_admin_panel",
          purpose,
          activationCodeId: activation.id,
          expiresAt: activation.expires_at,
          targetEmail: target.email,
        },
      });

    return jsonResponse({
      ok: true,
      activation: {
        id: activation.id,
        memberId: target.id,
        email: target.email,
        purpose,
        code,
        expiresAt: activation.expires_at,
      },
    });
  } catch (error) {
    console.error(error);
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    const message = String((error as { message?: unknown })?.message || error || "");
    if (message === "mfa_required" || message === "daily_mfa_required") {
      return errorResponse("daily_mfa_required", "Confirm MFA to continue.", 401);
    }
    if (message === "google_oauth_required" || message === "daily_google_oauth_required") {
      return errorResponse(
        "admin_google_oauth_required",
        "Sign in with Google to continue.",
        401,
      );
    }
    if (message === "invalid_user_token" || message === "missing_bearer_token") {
      return errorResponse("invalid_user_token", "Session is invalid.", 401);
    }
    return errorResponse("internal_error", "Unable to generate an activation code.", 500);
  }
});
