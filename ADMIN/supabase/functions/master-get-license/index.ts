import {
  errorResponse,
  handleOptions,
  jsonResponse,
  requirePost,
} from "../_shared/http.ts";
import {
  createAdminClient,
  getAuthUser,
  requirePublishableKey,
} from "../_shared/supabase.ts";
import { resolveMaster } from "../_shared/actors.ts";
import { ACCESS_POLICY_SELECT } from "../_shared/access-policy.ts";
import {
  currentAuthDayStart,
  normalizeDailyAuthResetHour,
} from "../_shared/auth-cycle.ts";
import {
  enforceRateLimit,
  rateLimitResponse,
  requireRecentTotp,
} from "../_shared/security.ts";

const ARIZONA_ORGANIZATION_SLUG = "arizona";
const ARIZONA_ALLOWED_EMAIL_DOMAIN = "arizona.global";

function knownError(error: unknown): Response | null {
  const limited = rateLimitResponse(error);
  if (limited) return limited;
  const message = error instanceof Error ? error.message : String(error || "");
  const normalized = message.toLowerCase();

  if (message === "invalid_publishable_key") {
    return errorResponse("invalid_publishable_key", "Invalid publishable key.", 401);
  }
  if (message === "missing_bearer_token" || message === "invalid_user_token") {
    return errorResponse("invalid_user_token", "Login session is invalid.", 401);
  }
  if (message === "mfa_required" || message === "daily_mfa_required") {
    return errorResponse("daily_mfa_required", "Confirm MFA to continue.", 401);
  }
  if (message.startsWith("missing_supabase_") || normalized.includes("invalid api key")) {
    return errorResponse("function_config_error", "Function configuration is incomplete.", 500);
  }

  return null;
}

function emailDomain(value: string): string {
  const [, domain = ""] = value.split("@");
  return domain.trim().toLowerCase();
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  const methodError = requirePost(req);
  if (methodError) return methodError;

  try {
    requirePublishableKey(req);

    const admin = createAdminClient();
    const user = await getAuthUser(req);
    const master = await resolveMaster(admin, user);
    if (!master) return errorResponse("forbidden", "Only a master can read this license.", 403);

    const { data: organization, error: organizationError } = await admin
      .schema("licensing")
      .from("organizations")
      .select(
        `id,name,slug,seats_allowed,allowed_email_domain,license_expires_on,daily_auth_reset_hour,status,created_at,updated_at,${ACCESS_POLICY_SELECT}`,
      )
      .eq("slug", ARIZONA_ORGANIZATION_SLUG)
      .maybeSingle();

    if (organizationError) throw organizationError;
    requireRecentTotp(
      req,
      currentAuthDayStart(
        new Date(),
        normalizeDailyAuthResetHour(organization?.daily_auth_reset_hour),
      ),
    );
    await enforceRateLimit(admin, "master.get.actor", master.id, 120, 3600);
    if (!organization) {
      return jsonResponse({ ok: true, organization: null, admin: null, consumedSeats: 0 });
    }

    const { data: members, error: membersError } = await admin
      .schema("licensing")
      .from("members")
      .select("id,name,email,role,status,created_at")
      .eq("organization_id", organization.id)
      .in("role", ["admin", "user"])
      .in("status", ["invited", "active"])
      .order("created_at", { ascending: true });

    if (membersError) throw membersError;

    const { data: masterAccounts, error: masterAccountsError } = await admin
      .schema("licensing")
      .from("master_accounts")
      .select("email")
      .eq("status", "active");

    if (masterAccountsError) throw masterAccountsError;

    const activeMasterEmails = new Set((masterAccounts || []).map((account) => String(account.email).toLowerCase()));
    const users = (members || []).filter((member) => {
      const email = String(member.email).toLowerCase();
      return emailDomain(email) === ARIZONA_ALLOWED_EMAIL_DOMAIN && !activeMasterEmails.has(email);
    });
    const managers = users.filter((member) => member.role === "admin");
    const userIds = users.map((member) => member.id);

    const { data: devices, error: devicesError } = userIds.length
      ? await admin
        .schema("licensing")
        .from("devices")
        .select("id,member_id,install_id,device_label,app_version,first_seen_at,last_seen_at,status")
        .eq("organization_id", organization.id)
        .in("member_id", userIds)
        .eq("status", "active")
        .order("last_seen_at", { ascending: false })
      : { data: [], error: null };

    if (devicesError) throw devicesError;

    const deviceByMemberId = new Map((devices || []).map((device) => [device.member_id, {
      id: device.id,
      installId: device.install_id,
      label: device.device_label,
      appVersion: device.app_version,
      firstSeenAt: device.first_seen_at,
      lastSeenAt: device.last_seen_at,
      status: device.status,
    }]));
    const usersWithDevices = users.map((member) => ({
      ...member,
      activeDevice: deviceByMemberId.get(member.id) || null,
    }));

    const { data: consumedSeats, error: consumedSeatsError } = await admin
      .schema("licensing")
      .rpc("consumed_seats", { target_organization_id: organization.id });

    if (consumedSeatsError) throw consumedSeatsError;

    return jsonResponse({
      ok: true,
      organization,
      admin: managers[0] || null,
      admins: managers,
      users: usersWithDevices,
      consumedSeats: consumedSeats ?? 0,
    });
  } catch (error) {
    console.error(error);
    const response = knownError(error);
    if (response) return response;
    return errorResponse("internal_error", "Unable to read license.", 500);
  }
});
