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
  adminGoogleOAuthNotBefore,
  enforceRateLimit,
  hasOAuthSignIn,
  requireRecentGoogleOAuth,
} from "../_shared/security.ts";

type ListMembersBody = {
  organizationId?: unknown;
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

    const body = await readJsonBody<ListMembersBody>(req);
    const organizationId = cleanString(body.organizationId, 64);
    if (!organizationId) return errorResponse("missing_organization_id", "organizationId is required.", 400);

    const admin = createAdminClient();
    const user = await getAuthUser(req);
    const master = hasOAuthSignIn(req) ? await resolveMaster(admin, user) : null;
    const actor = master ?? await resolveMember(admin, user, organizationId);

    if (!actor || (actor.kind === "member" && actor.role !== "admin")) {
      return errorResponse("forbidden", "Only masters or organization admins can list members.", 403);
    }

    const { data: organization, error: organizationError } = await admin
      .schema("licensing")
      .from("organizations")
      .select("id,name,seats_allowed,status,license_expires_on,daily_auth_reset_hour")
      .eq("id", organizationId)
      .maybeSingle();

    if (organizationError) throw organizationError;
    if (!organization || organization.status !== "active") {
      return errorResponse("organization_not_active", "Organization is not active.", 403);
    }
    if (actor.kind === "master") {
      requireRecentGoogleOAuth(
        req,
        adminGoogleOAuthNotBefore(),
        user.providers,
      );
    }
    await enforceRateLimit(admin, "admin.list.actor", `${actor.kind}:${actor.id}`, 360, 3600);

    const { data: members, error: membersError } = await admin
      .schema("licensing")
      .from("members")
      .select("id,name,email,role,status,auth_user_id,created_at")
      .eq("organization_id", organizationId)
      .in("role", ["admin", "user"])
      .in("status", ["invited", "active"])
      .order("created_at", { ascending: true });

    if (membersError) throw membersError;

    const memberIds = (members || []).map((member) => member.id);
    const { data: activeDevices, error: devicesError } = memberIds.length
      ? await admin
        .schema("licensing")
        .from("devices")
        .select("id,member_id")
        .eq("organization_id", organizationId)
        .in("member_id", memberIds)
        .eq("status", "active")
      : { data: [], error: null };

    if (devicesError) throw devicesError;

    const deviceMemberIds = new Set((activeDevices || []).map((device) => device.member_id));
    const users = (members || []).map((member) => ({
      id: member.id,
      name: member.name || "",
      email: member.email,
      role: member.role,
      status: member.status,
      hasAuthAccount: Boolean(member.auth_user_id),
      hasActiveDevice: deviceMemberIds.has(member.id),
    }));

    const { data: consumedSeats, error: consumedSeatsError } = await admin
      .schema("licensing")
      .rpc("consumed_seats", { target_organization_id: organizationId });

    if (consumedSeatsError) throw consumedSeatsError;

    const seatsAllowed = Number(organization.seats_allowed || 0);
    const consumed = Number(consumedSeats || 0);

    return jsonResponse({
      ok: true,
      actor,
      organization: {
        id: organization.id,
        name: organization.name,
        seatsAllowed,
        licenseExpiresOn: organization.license_expires_on,
      },
      currentMemberId: actor.kind === "member" ? actor.id : null,
      canManageManagers: actor.kind === "master",
      users,
      consumedSeats: consumed,
      availableSeats: Math.max(0, seatsAllowed - consumed),
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(error);
    const message = String((error as { message?: unknown })?.message || error || "");
    if (message === "google_oauth_required" || message === "daily_google_oauth_required") {
      return errorResponse(
        "admin_google_oauth_required",
        "Sign in with Google to continue.",
        401,
      );
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
    return errorResponse("internal_error", "Unable to list members.", 500);
  }
});
