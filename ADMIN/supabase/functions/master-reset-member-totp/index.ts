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
  getAuthUser,
  requirePublishableKey,
} from "../_shared/supabase.ts";
import { resolveMaster } from "../_shared/actors.ts";
import {
  adminGoogleOAuthNotBefore,
  enforceRateLimit,
  rateLimitResponse,
  requireRecentGoogleOAuth,
} from "../_shared/security.ts";
import { totpFactorIds } from "../_shared/mfa-recovery.ts";

type ResetMemberTotpBody = {
  organizationId?: unknown;
  memberId?: unknown;
};

function cleanString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  const methodError = requirePost(req);
  if (methodError) return methodError;

  try {
    requirePublishableKey(req);

    const body = await readJsonBody<ResetMemberTotpBody>(req);
    const organizationId = cleanString(body.organizationId, 64);
    const memberId = cleanString(body.memberId, 64);

    if (!organizationId) {
      return errorResponse("missing_organization_id", "organizationId is required.", 400);
    }
    if (!memberId) {
      return errorResponse("missing_member_id", "memberId is required.", 400);
    }

    const admin = createAdminClient();
    const user = await getAuthUser(req);
    const master = await resolveMaster(admin, user);
    if (!master) {
      return errorResponse("forbidden", "Only a master can reset member TOTP.", 403);
    }

    const { data: organization, error: organizationError } = await admin
      .schema("licensing")
      .from("organizations")
      .select("id,status,daily_auth_reset_hour")
      .eq("id", organizationId)
      .maybeSingle();
    if (organizationError) throw organizationError;
    if (!organization || organization.status !== "active") {
      return errorResponse("organization_not_active", "Organization is not active.", 403);
    }

    requireRecentGoogleOAuth(
      req,
      adminGoogleOAuthNotBefore(),
      user.providers,
    );
    await enforceRateLimit(admin, "master.reset_totp.actor", master.id, 12, 3600);
    await enforceRateLimit(admin, "master.reset_totp.member", memberId, 4, 3600);

    const { data: member, error: memberError } = await admin
      .schema("licensing")
      .from("members")
      .select("id,organization_id,email,role,status,auth_user_id")
      .eq("id", memberId)
      .eq("organization_id", organizationId)
      .in("status", ["invited", "active"])
      .maybeSingle();
    if (memberError) throw memberError;
    if (!member) return errorResponse("member_not_found", "Member was not found.", 404);

    if (!member.auth_user_id) {
      return jsonResponse({
        ok: true,
        reset: false,
        reason: "auth_identity_missing",
        factorsRemoved: 0,
      });
    }

    const { data: protectedMaster, error: protectedMasterError } = await admin
      .schema("licensing")
      .from("master_accounts")
      .select("id")
      .eq("auth_user_id", member.auth_user_id)
      .eq("status", "active")
      .maybeSingle();
    if (protectedMasterError) throw protectedMasterError;
    if (protectedMaster) {
      return errorResponse(
        "protected_identity",
        "A master TOTP cannot be reset through a member action.",
        403,
      );
    }

    const authAdmin = createAuthAdminClient();
    const { data: factorData, error: factorsError } =
      await authAdmin.auth.admin.mfa.listFactors({ userId: member.auth_user_id });
    if (factorsError) throw factorsError;

    const factorIds = totpFactorIds(
      factorData?.factors || [],
      factorData?.totp || [],
    );
    if (!factorIds.length) {
      return jsonResponse({
        ok: true,
        reset: false,
        reason: "totp_not_enrolled",
        factorsRemoved: 0,
      });
    }

    for (const factorId of factorIds) {
      const { error: deleteError } = await authAdmin.auth.admin.mfa.deleteFactor({
        userId: member.auth_user_id,
        id: factorId,
      });
      if (deleteError) throw deleteError;
    }

    const now = new Date().toISOString();
    const { data: revokedDevices, error: devicesError } = await admin
      .schema("licensing")
      .from("devices")
      .update({
        status: "revoked",
        revoked_at: now,
        revoked_reason: "totp_reset",
        updated_at: now,
      })
      .eq("member_id", member.id)
      .eq("status", "active")
      .select("id,install_id,device_label,status");
    if (devicesError) throw devicesError;

    const { error: sessionsError } = await admin
      .schema("licensing")
      .from("license_sessions")
      .update({
        status: "revoked",
        revoked_at: now,
        revoked_reason: "totp_reset",
        updated_at: now,
      })
      .eq("member_id", member.id)
      .eq("status", "active");
    if (sessionsError) throw sessionsError;

    const { data: revokedCodes, error: codesError } = await admin
      .schema("licensing")
      .from("activation_codes")
      .update({ revoked_at: now })
      .eq("member_id", member.id)
      .is("used_at", null)
      .is("revoked_at", null)
      .select("id,purpose");
    if (codesError) throw codesError;

    const { error: auditError } = await admin
      .schema("licensing")
      .from("audit_log")
      .insert({
        organization_id: organizationId,
        actor_master_id: master.id,
        action: "member.totp_reset",
        target_table: "members",
        target_id: member.id,
        metadata: {
          source: "admin_web_panel",
          reason: "master_reset_member_totp",
          actor: {
            kind: master.kind,
            id: master.id,
            email: master.email,
          },
          target: {
            id: member.id,
            email: member.email,
            role: member.role,
            status: member.status,
          },
          factorsRemoved: factorIds.length,
          revokedDevices: revokedDevices || [],
          revokedActivationCodes: revokedCodes || [],
        },
      });
    if (auditError) {
      console.error("master-reset-member-totp audit failed", auditError);
    }

    return jsonResponse({
      ok: true,
      reset: true,
      factorsRemoved: factorIds.length,
      revokedDevices: revokedDevices || [],
      revokedActivationCodes: revokedCodes || [],
    });
  } catch (error) {
    console.error(error);
    const limited = rateLimitResponse(error);
    if (limited) return limited;

    const message = String((error as { message?: unknown })?.message || error || "");
    const normalized = message.toLowerCase();
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
    if (message === "invalid_publishable_key") {
      return errorResponse("invalid_publishable_key", "Invalid publishable key.", 401);
    }
    if (
      message.startsWith("missing_supabase_")
      || normalized.includes("invalid api key")
      || normalized.includes("bad_jwt")
    ) {
      return errorResponse("function_config_error", "Function configuration is incomplete.", 500);
    }
    return errorResponse("internal_error", "Unable to reset member TOTP.", 500);
  }
});
