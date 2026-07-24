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
import {
  currentAuthDayStart,
  normalizeDailyAuthResetHour,
} from "../_shared/auth-cycle.ts";
import {
  enforceRateLimit,
  rateLimitResponse,
  requestIp,
  requireRecentTotp,
} from "../_shared/security.ts";

type ActivateDeviceBody = {
  installId?: unknown;
  appVersion?: unknown;
  deviceLabel?: unknown;
  deviceFingerprintHash?: unknown;
};

function cleanString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  const methodError = requirePost(req);
  if (methodError) return methodError;

  try {
    requirePublishableKey(req);
    const body = await readJsonBody<ActivateDeviceBody>(req);
    const installId = cleanString(body.installId, 128);
    if (!installId) return errorResponse("missing_install_id", "installId is required.", 400);

    const admin = createAdminClient();
    const user = await getAuthUser(req);
    const member = await resolveMember(admin, user);
    if (!member) return errorResponse("member_not_authorized", "Access denied.", 403);

    const { data: recoveryState, error: recoveryStateError } = await admin
      .schema("licensing")
      .from("members")
      .select("device_recovery_mfa_not_before,device_recovery_expires_at")
      .eq("id", member.id)
      .maybeSingle();
    if (recoveryStateError) throw recoveryStateError;

    const { data: organization, error: organizationError } = await admin
      .schema("licensing")
      .from("organizations")
      .select(`id,status,license_expires_on,daily_auth_reset_hour,${ACCESS_POLICY_SELECT}`)
      .eq("id", member.organizationId)
      .maybeSingle();
    if (organizationError) throw organizationError;
    if (!organization || organization.status !== "active") {
      return errorResponse("organization_not_active", "Organization is not active.", 403);
    }
    if (
      organization.license_expires_on
      && new Date(`${organization.license_expires_on}T23:59:59.999Z`).getTime() < Date.now()
    ) {
      return errorResponse("license_expired", "License has expired.", 403);
    }

    const resetHour = normalizeDailyAuthResetHour(organization.daily_auth_reset_hour);
    const nowDate = new Date();
    const recoveryNotBefore = parseDate(recoveryState?.device_recovery_mfa_not_before);
    const recoveryExpiresAt = parseDate(recoveryState?.device_recovery_expires_at);
    const hasRecoveryGrant = Boolean(
      recoveryNotBefore
      && recoveryExpiresAt
      && recoveryExpiresAt.getTime() > nowDate.getTime(),
    );
    const dailyBoundary = currentAuthDayStart(nowDate, resetHour);
    const requiredMfaAt = hasRecoveryGrant && recoveryNotBefore!.getTime() > dailyBoundary.getTime()
      ? recoveryNotBefore!
      : dailyBoundary;
    const mfaVerifiedAt = requireRecentTotp(req, requiredMfaAt);

    const policy = accessPolicy(organization);
    const activationWindowSeconds = policy.activationAttemptWindowMinutes * 60;
    await enforceRateLimit(admin, "device.activate.member", member.id, 6, activationWindowSeconds);
    await enforceRateLimit(admin, "device.activate.ip", requestIp(req), 20, activationWindowSeconds);

    const { data: sameInstall, error: sameInstallError } = await admin
      .schema("licensing")
      .from("devices")
      .select("id,status,revoked_at,revoked_reason")
      .eq("member_id", member.id)
      .eq("install_id", installId)
      .maybeSingle();
    if (sameInstallError) throw sameInstallError;

    if (sameInstall && sameInstall.status !== "active" && !hasRecoveryGrant) {
      return errorResponse(
        "device_revoked",
        "This installation was released and cannot reactivate itself.",
        403,
      );
    }

    const { data: activeDevice, error: activeDeviceError } = await admin
      .schema("licensing")
      .from("devices")
      .select("id,install_id")
      .eq("member_id", member.id)
      .eq("status", "active")
      .maybeSingle();
    if (activeDeviceError) throw activeDeviceError;
    if (activeDevice && activeDevice.install_id !== installId) {
      return errorResponse("device_limit_reached", "Another device is already active.", 409);
    }

    const now = new Date().toISOString();
    const payload = {
      organization_id: member.organizationId,
      member_id: member.id,
      install_id: installId,
      device_fingerprint_hash: cleanString(body.deviceFingerprintHash, 256) || null,
      device_label: cleanString(body.deviceLabel, 128) || null,
      app_version: cleanString(body.appVersion, 64) || null,
      status: "active",
      revoked_at: null,
      revoked_reason: null,
      last_seen_at: now,
      last_mfa_login_at: mfaVerifiedAt.toISOString(),
      updated_at: now,
      ...(!sameInstall || sameInstall.status !== "active" ? { activated_at: now } : {}),
    };

    const deviceResult = sameInstall
      ? await admin
        .schema("licensing")
        .from("devices")
        .update(payload)
        .eq("id", sameInstall.id)
        .eq("status", sameInstall.status)
        .select("id,status")
        .single()
      : await admin
        .schema("licensing")
        .from("devices")
        .insert(payload)
        .select("id,status")
        .single();
    if (deviceResult.error) {
      if (String(deviceResult.error.message).includes("devices_one_active_per_member_uidx")) {
        return errorResponse("device_limit_reached", "Another device is already active.", 409);
      }
      throw deviceResult.error;
    }

    if (hasRecoveryGrant) {
      const { error: clearRecoveryError } = await admin
        .schema("licensing")
        .from("members")
        .update({
          device_recovery_mfa_not_before: null,
          device_recovery_expires_at: null,
          updated_at: now,
        })
        .eq("id", member.id)
        .eq("device_recovery_expires_at", recoveryState!.device_recovery_expires_at);
      if (clearRecoveryError) throw clearRecoveryError;
    }

    await admin
      .schema("licensing")
      .from("audit_log")
      .insert({
        organization_id: member.organizationId,
        actor_member_id: member.id,
        action: "device.activated",
        target_table: "devices",
        target_id: deviceResult.data.id,
        metadata: {
          source: "tauri_passwordless_login",
          installId,
        },
      });

    return jsonResponse({
      ok: true,
      device: {
        id: deviceResult.data.id,
        installId,
        status: deviceResult.data.status,
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
    if (message === "invalid_user_token" || message === "missing_bearer_token") {
      return errorResponse("invalid_user_token", "Session is invalid.", 401);
    }
    return errorResponse("internal_error", "Unable to activate the device.", 500);
  }
});
