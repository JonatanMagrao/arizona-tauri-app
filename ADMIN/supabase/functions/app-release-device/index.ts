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
import { resolveMember } from "../_shared/actors.ts";
import {
  ACCESS_POLICY_SELECT,
  accessPolicy,
} from "../_shared/access-policy.ts";
import { deviceSwitchLock } from "../_shared/device-switch.ts";
import { clearDeviceBindGrant } from "../_shared/device-bind-grant.ts";
import {
  enforceRateLimit,
  rateLimitResponse,
} from "../_shared/security.ts";

type ReleaseDeviceBody = {
  source?: unknown;
  installId?: unknown;
};

function cleanSource(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 64) : "";
}

function cleanInstallId(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 128) : "";
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  const methodError = requirePost(req);
  if (methodError) return methodError;

  try {
    requirePublishableKey(req);

    const body = await readJsonBody<ReleaseDeviceBody>(req);
    const source = cleanSource(body.source) || "app_self_release";
    const requestedInstallId = cleanInstallId(body.installId);
    const admin = createAdminClient();
    const user = await getAuthUser(req);
    const member = await resolveMember(admin, user);

    if (!member) {
      return errorResponse("member_not_authorized", "This email is not authorized.", 403);
    }
    await enforceRateLimit(admin, "device.self_release.request", member.id, 30, 3600);

    const { data: organization, error: organizationError } = await admin
      .schema("licensing")
      .from("organizations")
      .select(ACCESS_POLICY_SELECT)
      .eq("id", member.organizationId)
      .maybeSingle();
    if (organizationError) throw organizationError;
    const policy = accessPolicy(organization);

    const { data: activeDevices, error: devicesError } = await admin
      .schema("licensing")
      .from("devices")
      .select("id,install_id,device_label,status,activated_at")
      .eq("organization_id", member.organizationId)
      .eq("member_id", member.id)
      .eq("status", "active");

    if (devicesError) throw devicesError;

    const activeDeviceIds = (activeDevices || []).map((device) => device.id);
    if (!activeDeviceIds.length) {
      return jsonResponse({ ok: true, released: false, devices: [] });
    }

    // The deployed v2.1.1 client posts only { source }, so an absent installId
    // has to keep working; this becomes a real control — a release can only be
    // asked for by the machine that holds the seat — once the fleet sends it.
    if (
      requestedInstallId
      && !(activeDevices || []).some((device) => device.install_id === requestedInstallId)
    ) {
      const { error: rejectedAuditError } = await admin
        .schema("licensing")
        .from("audit_log")
        .insert({
          organization_id: member.organizationId,
          actor_member_id: member.id,
          action: "device.self_release_rejected",
          target_table: "devices",
          target_id: activeDeviceIds[0],
          metadata: {
            source,
            reason: "install_id_mismatch",
            requestedInstallId,
          },
        });
      if (rejectedAuditError) console.error(rejectedAuditError);
      return errorResponse(
        "device_not_active",
        "This installation does not hold the active seat.",
        403,
      );
    }

    const switchLock = (activeDevices || [])
      .map((device) => deviceSwitchLock(
        device.activated_at,
        policy.deviceSwitchIntervalDays,
      ))
      .find(Boolean);
    if (switchLock) {
      return errorResponse(
        "device_switch_interval",
        "The active device has not completed the minimum interval between switches.",
        409,
        { ...switchLock },
      );
    }
    await enforceRateLimit(
      admin,
      "device.release.member",
      member.id,
      policy.deviceReleaseLimit,
      policy.deviceReleaseWindowMinutes * 60,
    );

    const now = new Date().toISOString();
    // Before the revocation, so a failure here leaves the seat untouched and
    // the call retryable instead of reporting an error for work already done.
    await clearDeviceBindGrant(admin, member.id, now);

    const { data: releasedDevices, error: releaseError } = await admin
      .schema("licensing")
      .from("devices")
      .update({
        status: "revoked",
        revoked_at: now,
        revoked_reason: "device_self_released",
        updated_at: now,
      })
      .in("id", activeDeviceIds)
      .select("id,install_id,device_label,status");

    if (releaseError) throw releaseError;

    const { error: sessionError } = await admin
      .schema("licensing")
      .from("license_sessions")
      .update({
        status: "revoked",
        revoked_at: now,
        revoked_reason: "device_self_released",
        updated_at: now,
      })
      .in("device_id", activeDeviceIds)
      .eq("status", "active");

    if (sessionError) throw sessionError;

    const { error: auditError } = await admin
      .schema("licensing")
      .from("audit_log")
      .insert({
        organization_id: member.organizationId,
        actor_member_id: member.id,
        action: "device.self_released",
        target_table: "devices",
        target_id: activeDeviceIds[0],
        metadata: {
          source,
          reason: "authenticated_self_release",
          member: {
            id: member.id,
            email: member.email,
            role: member.role,
          },
          devices: releasedDevices || [],
        },
      });

    if (auditError) console.error(auditError);

    return jsonResponse({
      ok: true,
      released: true,
      devices: releasedDevices || [],
    });
  } catch (error) {
    console.error(error);
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    const message = String((error as { message?: unknown })?.message || error || "");

    if (message === "invalid_publishable_key") {
      return errorResponse("invalid_publishable_key", "Invalid publishable key.", 401);
    }
    if (message === "invalid_user_token" || message === "missing_bearer_token") {
      return errorResponse("invalid_user_token", "The authenticated session is invalid.", 401);
    }
    if (message === "invalid_json_body") {
      return errorResponse("invalid_json_body", "Invalid JSON body.", 400);
    }

    return errorResponse("internal_error", "Unable to release the current device.", 500);
  }
});
