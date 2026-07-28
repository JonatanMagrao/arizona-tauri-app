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
import { resolveMaster } from "../_shared/actors.ts";
import {
  currentAuthDayStart,
  normalizeDailyAuthResetHour,
} from "../_shared/auth-cycle.ts";
import {
  enforceRateLimit,
  rateLimitResponse,
  requireRecentTotp,
  sha256Hex,
} from "../_shared/security.ts";
import { memberRateLimitSubjects } from "../_shared/member-rate-limit-reset.ts";

type ResetMemberRateLimitsBody = {
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

    const body = await readJsonBody<ResetMemberRateLimitsBody>(req);
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
      return errorResponse(
        "forbidden",
        "Only a master can reset member rate limits.",
        403,
      );
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

    requireRecentTotp(
      req,
      currentAuthDayStart(
        new Date(),
        normalizeDailyAuthResetHour(organization.daily_auth_reset_hour),
      ),
    );
    await enforceRateLimit(
      admin,
      "master.reset_member_rate_limits.actor",
      master.id,
      120,
      3600,
    );

    const { data: member, error: memberError } = await admin
      .schema("licensing")
      .from("members")
      .select("id,email,role,status")
      .eq("id", memberId)
      .eq("organization_id", organizationId)
      .in("status", ["invited", "active"])
      .maybeSingle();
    if (memberError) throw memberError;
    if (!member) {
      return errorResponse("member_not_found", "Member was not found.", 404);
    }

    const subjectHashes = await Promise.all(
      memberRateLimitSubjects(member.id, member.email).map((subject) => sha256Hex(subject)),
    );
    const { count, error: resetError } = await admin
      .schema("licensing")
      .from("rate_limit_events")
      .delete({ count: "exact" })
      .in("subject_hash", subjectHashes);
    if (resetError) throw resetError;

    const deletedEvents = Number(count || 0);
    const { error: auditError } = await admin
      .schema("licensing")
      .from("audit_log")
      .insert({
        organization_id: organizationId,
        actor_master_id: master.id,
        action: "member.rate_limits_reset",
        target_table: "members",
        target_id: member.id,
        metadata: {
          source: "admin_web_panel",
          deletedEvents,
          target: {
            id: member.id,
            email: member.email,
            role: member.role,
            status: member.status,
          },
          preservedScopes: ["ip", "other_actors"],
        },
      });
    if (auditError) {
      console.error("master-reset-member-rate-limits audit failed", auditError);
    }

    return jsonResponse({
      ok: true,
      reset: true,
      deletedEvents,
      preservedScopes: ["ip", "other_actors"],
    });
  } catch (error) {
    console.error(error);
    const limited = rateLimitResponse(error);
    if (limited) return limited;

    const message = String((error as { message?: unknown })?.message || error || "");
    const normalized = message.toLowerCase();
    if (message === "mfa_required" || message === "daily_mfa_required") {
      return errorResponse("daily_mfa_required", "Confirm MFA to continue.", 401);
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
    return errorResponse("internal_error", "Unable to reset member rate limits.", 500);
  }
});
