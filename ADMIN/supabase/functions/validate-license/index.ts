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
  currentAuthDayStart,
  nextAuthDayStart,
  normalizeDailyAuthResetHour,
  serverAuthDay,
} from "../_shared/auth-cycle.ts";
import {
  enforceRateLimit,
  requireRecentTotp,
} from "../_shared/security.ts";
import { signLicenseToken } from "../_shared/license-token.ts";

type ValidateLicenseBody = {
  installId?: unknown;
  appVersion?: unknown;
  deviceLabel?: unknown;
  deviceFingerprintHash?: unknown;
  clientLocalTime?: unknown;
  lastServerTimeSeen?: unknown;
  lastLocalTimeSeen?: unknown;
};

const MAX_CLOCK_BACKWARDS_SECONDS = 300;
const MAX_CLOCK_SKEW_SECONDS = 300;
const CLOCK_AUDIT_INTERVAL_MS = 60 * 60 * 1000;
const ARIZONA_ORGANIZATION_SLUG = "arizona";

function cleanString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function endOfLicenseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(`${value.slice(0, 10)}T23:59:59.999Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  const methodError = requirePost(req);
  if (methodError) return methodError;

  try {
    requirePublishableKey(req);
    const body = await readJsonBody<ValidateLicenseBody>(req);
    const installId = cleanString(body.installId, 128);
    if (!installId) return errorResponse("missing_install_id", "installId is required.", 400);

    const admin = createAdminClient();
    const user = await getAuthUser(req);
    let member = await resolveMember(admin, user);

    if (!member) {
      const master = await resolveMaster(admin, user);
      if (master) {
        const { data: arizonaOrganization, error: organizationLookupError } = await admin
          .schema("licensing")
          .from("organizations")
          .select("id,status")
          .eq("slug", ARIZONA_ORGANIZATION_SLUG)
          .maybeSingle();
        if (organizationLookupError) throw organizationLookupError;
        if (!arizonaOrganization || arizonaOrganization.status !== "active") {
          return errorResponse("organization_not_active", "Organization is not active.", 403);
        }

        const { error: upsertError } = await admin
          .schema("licensing")
          .from("members")
          .upsert({
            organization_id: arizonaOrganization.id,
            name: master.email,
            email: master.email,
            auth_user_id: user.id,
            role: "admin",
            status: "active",
            added_by_master_id: master.id,
            activated_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
          }, { onConflict: "organization_id,email" });
        if (upsertError) throw upsertError;
        member = await resolveMember(admin, user, arizonaOrganization.id);
      }
    }

    if (!member) return errorResponse("member_not_authorized", "Access denied.", 403);

    const { data: organization, error: organizationError } = await admin
      .schema("licensing")
      .from("organizations")
      .select(
        "id,name,status,seats_allowed,license_expires_on,daily_auth_reset_hour,receipt_ttl_seconds",
      )
      .eq("id", member.organizationId)
      .maybeSingle();
    if (organizationError) throw organizationError;
    if (!organization || organization.status !== "active") {
      return errorResponse("organization_not_active", "Organization is not active.", 403);
    }

    const now = new Date();
    const licenseExpiresAt = endOfLicenseDate(organization.license_expires_on);
    if (licenseExpiresAt && licenseExpiresAt.getTime() < now.getTime()) {
      return errorResponse("license_expired", "License has expired.", 403);
    }

    const resetHour = normalizeDailyAuthResetHour(organization.daily_auth_reset_hour);
    const authDay = serverAuthDay(now, resetHour);
    const mfaVerifiedAt = requireRecentTotp(req, currentAuthDayStart(now, resetHour));
    await enforceRateLimit(admin, "license.validate.member", member.id, 240, 3600);

    const { data: device, error: deviceError } = await admin
      .schema("licensing")
      .from("devices")
      .select("id,install_id,status,last_mfa_login_at")
      .eq("member_id", member.id)
      .eq("install_id", installId)
      .maybeSingle();
    if (deviceError) throw deviceError;

    if (!device) {
      const { data: activeDevice, error: activeDeviceError } = await admin
        .schema("licensing")
        .from("devices")
        .select("id,install_id")
        .eq("member_id", member.id)
        .eq("status", "active")
        .maybeSingle();
      if (activeDeviceError) throw activeDeviceError;
      if (activeDevice) {
        return errorResponse("device_limit_reached", "Another device is already active.", 409);
      }
      return errorResponse("device_not_registered", "Activate this device first.", 409);
    }
    if (device.status !== "active") {
      return errorResponse("device_revoked", "This device is not active.", 403);
    }

    const clientLocalTime = parseDate(body.clientLocalTime);
    const lastServerTimeSeen = parseDate(body.lastServerTimeSeen);
    const lastLocalTimeSeen = parseDate(body.lastLocalTimeSeen);
    let clockStatus: "ok" | "suspicious" = "ok";
    let clockSkewSeconds: number | null = null;

    if (clientLocalTime) {
      clockSkewSeconds = Math.round((clientLocalTime.getTime() - now.getTime()) / 1000);
    }
    if (clockSkewSeconds !== null && Math.abs(clockSkewSeconds) > MAX_CLOCK_SKEW_SECONDS) {
      clockStatus = "suspicious";
    }
    if (
      lastLocalTimeSeen
      && clientLocalTime
      && clientLocalTime.getTime() + MAX_CLOCK_BACKWARDS_SECONDS * 1000 < lastLocalTimeSeen.getTime()
    ) {
      clockStatus = "suspicious";
    }
    if (
      lastServerTimeSeen
      && clientLocalTime
      && clientLocalTime.getTime() + MAX_CLOCK_BACKWARDS_SECONDS * 1000 < lastServerTimeSeen.getTime()
    ) {
      clockStatus = "suspicious";
    }

    await admin
      .schema("licensing")
      .from("devices")
      .update({
        device_fingerprint_hash: cleanString(body.deviceFingerprintHash, 256) || null,
        device_label: cleanString(body.deviceLabel, 128) || null,
        app_version: cleanString(body.appVersion, 64) || null,
        last_seen_at: now.toISOString(),
        last_mfa_login_at: mfaVerifiedAt.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("id", device.id)
      .eq("status", "active");

    const { data: latestClockAudit } = await admin
      .schema("licensing")
      .from("clock_audits")
      .select("created_at")
      .eq("device_id", device.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const latestAuditAt = parseDate(latestClockAudit?.created_at)?.getTime() || 0;
    if (clockStatus === "suspicious" || now.getTime() - latestAuditAt >= CLOCK_AUDIT_INTERVAL_MS) {
      await admin
        .schema("licensing")
        .from("clock_audits")
        .insert({
          organization_id: member.organizationId,
          member_id: member.id,
          device_id: device.id,
          client_local_time: clientLocalTime?.toISOString() || null,
          last_server_time_seen: lastServerTimeSeen?.toISOString() || null,
          last_local_time_seen: lastLocalTimeSeen?.toISOString() || null,
          server_time: now.toISOString(),
          clock_skew_seconds: clockSkewSeconds,
          status: clockStatus,
        });
    }
    if (clockStatus === "suspicious") {
      return errorResponse("clock_suspicious", "Device clock needs online verification.", 403);
    }

    const receiptTtlSeconds = Math.min(
      3600,
      Math.max(300, Number(organization.receipt_ttl_seconds || 900)),
    );
    const sessionBoundary = nextAuthDayStart(now, resetHour);
    const receiptBoundary = new Date(now.getTime() + receiptTtlSeconds * 1000);
    const expiresAt = new Date(Math.min(
      sessionBoundary.getTime(),
      receiptBoundary.getTime(),
      licenseExpiresAt?.getTime() || Number.MAX_SAFE_INTEGER,
    ));

    await admin
      .schema("licensing")
      .from("license_sessions")
      .update({
        status: "expired",
        updated_at: now.toISOString(),
      })
      .eq("device_id", device.id)
      .eq("status", "active")
      .lt("expires_at", now.toISOString());

    const { data: existingSession, error: existingSessionError } = await admin
      .schema("licensing")
      .from("license_sessions")
      .select("id,token_id,issued_at,expires_at,server_time_at_issue")
      .eq("device_id", device.id)
      .eq("status", "active")
      .eq("auth_day", authDay)
      .order("issued_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingSessionError) throw existingSessionError;

    const sessionResult = existingSession
      ? await admin
        .schema("licensing")
        .from("license_sessions")
        .update({
          expires_at: expiresAt.toISOString(),
          last_validated_at: now.toISOString(),
          server_time_at_issue: now.toISOString(),
          updated_at: now.toISOString(),
        })
        .eq("id", existingSession.id)
        .eq("status", "active")
        .select("id,token_id,issued_at,expires_at,server_time_at_issue")
        .single()
      : await admin
        .schema("licensing")
        .from("license_sessions")
        .insert({
          organization_id: member.organizationId,
          member_id: member.id,
          device_id: device.id,
          issued_at: now.toISOString(),
          expires_at: expiresAt.toISOString(),
          server_time_at_issue: now.toISOString(),
          last_validated_at: now.toISOString(),
          auth_day: authDay,
          status: "active",
        })
        .select("id,token_id,issued_at,expires_at,server_time_at_issue")
        .single();
    if (sessionResult.error) throw sessionResult.error;
    const session = sessionResult.data;

    const token = await signLicenseToken({
      sessionId: session.id,
      tokenId: session.token_id,
      organizationId: member.organizationId,
      memberId: member.id,
      deviceId: device.id,
      role: member.role,
      email: member.email,
      issuedAt: session.issued_at,
      expiresAt: session.expires_at,
      serverTimeAtIssue: session.server_time_at_issue,
    });

    return jsonResponse({
      ok: true,
      status: "licensed",
      serverTime: now.toISOString(),
      authDay,
      mfaVerifiedAt: mfaVerifiedAt.toISOString(),
      expiresAt: session.expires_at,
      cepLicenseReceipt: token,
      organization: {
        id: organization.id,
        name: organization.name,
        seatsAllowed: organization.seats_allowed,
        licenseExpiresOn: organization.license_expires_on,
        dailyAuthResetHour: resetHour,
        receiptTtlSeconds,
      },
      member: {
        id: member.id,
        email: member.email,
        role: member.role,
      },
      device: {
        id: device.id,
        installId,
      },
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
    return errorResponse("internal_error", "Unable to validate license.", 500);
  }
});
