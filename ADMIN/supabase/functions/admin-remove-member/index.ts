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
import { currentAuthDayStart, normalizeDailyAuthResetHour } from "../_shared/auth-cycle.ts";
import { enforceRateLimit, requireRecentTotp } from "../_shared/security.ts";

type RemoveMemberBody = {
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

    const body = await readJsonBody<RemoveMemberBody>(req);
    const organizationId = cleanString(body.organizationId, 64);
    const memberId = cleanString(body.memberId, 64);

    if (!organizationId) return errorResponse("missing_organization_id", "organizationId is required.", 400);
    if (!memberId) return errorResponse("missing_member_id", "memberId is required.", 400);

    const admin = createAdminClient();
    const user = await getAuthUser(req);
    const master = await resolveMaster(admin, user);
    const actor = master ?? await resolveMember(admin, user, organizationId);

    if (!actor || (actor.kind === "member" && actor.role !== "admin")) {
      return errorResponse("forbidden", "Only masters or organization admins can remove members.", 403);
    }

    const { data: organization, error: organizationError } = await admin
      .schema("licensing")
      .from("organizations")
      .select("status,daily_auth_reset_hour")
      .eq("id", organizationId)
      .maybeSingle();
    if (organizationError) throw organizationError;
    if (!organization || organization.status !== "active") {
      return errorResponse("organization_not_active", "Organization is not active.", 403);
    }
    requireRecentTotp(
      req,
      currentAuthDayStart(
        new Date(),
        normalizeDailyAuthResetHour(organization.daily_auth_reset_hour),
      ),
    );
    await enforceRateLimit(admin, "admin.remove.actor", `${actor.kind}:${actor.id}`, 20, 3600);

    if (actor.kind === "member" && actor.id === memberId) {
      return errorResponse("forbidden", "Organization admins cannot remove themselves.", 403);
    }

    const { data: member, error: memberError } = await admin
      .schema("licensing")
      .from("members")
      .select("id,organization_id,email,role,status")
      .eq("id", memberId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (memberError) throw memberError;
    if (!member) return errorResponse("member_not_found", "Member was not found.", 404);

    if (actor.kind === "member" && member.role === "admin") {
      return errorResponse("forbidden", "Organization admins cannot remove managers.", 403);
    }

    const now = new Date().toISOString();

    const { data: removedMember, error: removeError } = await admin
      .schema("licensing")
      .from("members")
      .update({
        status: "revoked",
        updated_at: now,
      })
      .eq("id", memberId)
      .select("id,email,role,status")
      .single();

    if (removeError) throw removeError;

    const { data: revokedDevices, error: devicesError } = await admin
      .schema("licensing")
      .from("devices")
      .update({
        status: "revoked",
        updated_at: now,
      })
      .eq("member_id", memberId)
      .eq("status", "active")
      .select("id,install_id,device_label,status");

    if (devicesError) throw devicesError;

    const { error: sessionsError } = await admin
      .schema("licensing")
      .from("license_sessions")
      .update({
        status: "revoked",
        revoked_at: now,
        revoked_reason: "member_removed",
        updated_at: now,
      })
      .eq("member_id", memberId)
      .eq("status", "active");

    if (sessionsError) throw sessionsError;

    await admin
      .schema("licensing")
      .from("audit_log")
      .insert({
        organization_id: organizationId,
        actor_master_id: actor.kind === "master" ? actor.id : null,
        actor_member_id: actor.kind === "member" ? actor.id : null,
        action: "member.revoked",
        target_table: "members",
        target_id: memberId,
        metadata: {
          source: "tauri_admin_panel",
          reason: "admin_panel_remove_member",
          actor: {
            kind: actor.kind,
            id: actor.id,
            email: actor.email,
            role: actor.kind === "member" ? actor.role : "master",
          },
          target: {
            id: member.id,
            email: member.email,
            role: member.role,
            previousStatus: member.status,
            status: removedMember.status,
          },
          revokedDevices: revokedDevices || [],
        },
      });

    return jsonResponse({
      ok: true,
      member: removedMember,
      revokedDevices: revokedDevices || [],
    });
  } catch (error) {
    console.error(error);
    const message = String((error as { message?: unknown })?.message || error || "");
    if (message === "mfa_required" || message === "daily_mfa_required") {
      return errorResponse("daily_mfa_required", "Confirm MFA to continue.", 401);
    }
    if (message === "rate_limited") {
      return errorResponse("rate_limited", "Try again later.", 429);
    }
    if (message === "invalid_user_token" || message === "missing_bearer_token") {
      return errorResponse("invalid_user_token", "Session is invalid.", 401);
    }
    if (message === "invalid_publishable_key") {
      return errorResponse("invalid_publishable_key", "Invalid publishable key.", 401);
    }
    return errorResponse("internal_error", "Unable to remove member.", 500);
  }
});
