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
  licenseExpiryInstant,
  nextAuthDayStart,
  normalizeDailyAuthResetHour,
  serverAuthDay,
} from "../_shared/auth-cycle.ts";
import {
  boundedClockSkewSeconds,
  shouldRecordClockAudit,
} from "../_shared/clock-audit.ts";
import {
  fingerprintDecision,
  fingerprintPrefix,
  normalizeFingerprint,
} from "../_shared/device-fingerprint.ts";
import { enforceRateLimit } from "../_shared/security.ts";
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
const ARIZONA_ORGANIZATION_SLUG = "arizona";

function cleanString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
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
    const resetHour = normalizeDailyAuthResetHour(organization.daily_auth_reset_hour);
    const licenseExpiresAt = licenseExpiryInstant(organization.license_expires_on, resetHour);
    if (licenseExpiresAt && licenseExpiresAt.getTime() < now.getTime()) {
      return errorResponse("license_expired", "License has expired.", 403);
    }

    const authDay = serverAuthDay(now, resetHour);
    await enforceRateLimit(admin, "license.validate.member", member.id, 240, 3600);

    const { data: device, error: deviceError } = await admin
      .schema("licensing")
      .from("devices")
      .select("id,install_id,status,device_fingerprint_hash")
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

    // Every supported client can identify its machine, so an empty fingerprint
    // is rejected no matter what is stored: it is what a retired v2.1.1 build
    // always sends, and also the single-field patch that would otherwise
    // disable the identity check per machine.
    const incomingFingerprint = normalizeFingerprint(body.deviceFingerprintHash);
    if (!incomingFingerprint) {
      await admin
        .schema("licensing")
        .from("audit_log")
        .insert({
          organization_id: member.organizationId,
          actor_member_id: member.id,
          action: "device.fingerprint_mismatch",
          target_table: "devices",
          target_id: device.id,
          metadata: {
            installId,
            outcome: "empty",
            storedFingerprintPrefix: fingerprintPrefix(
              normalizeFingerprint(device.device_fingerprint_hash),
            ),
            incomingFingerprintPrefix: "",
          },
        });
      return errorResponse("device_not_active", "Update the app to continue.", 403);
    }

    // A device with no stored fingerprint was bound before machine identity
    // existed, and its identity would be whatever the next caller claims.
    // Forcing it through one code-backed activation closes that permanently.
    if (!normalizeFingerprint(device.device_fingerprint_hash)) {
      await admin
        .schema("licensing")
        .from("audit_log")
        .insert({
          organization_id: member.organizationId,
          actor_member_id: member.id,
          action: "device.fingerprint_mismatch",
          target_table: "devices",
          target_id: device.id,
          metadata: {
            installId,
            outcome: "unbound",
            storedFingerprintPrefix: "",
            incomingFingerprintPrefix: fingerprintPrefix(incomingFingerprint),
          },
        });
      return errorResponse("device_not_active", "Reactivate this machine.", 403);
    }

    const fingerprint = fingerprintDecision(
      device.device_fingerprint_hash,
      incomingFingerprint,
    );
    if (fingerprint.outcome === "mismatch" || fingerprint.outcome === "missing") {
      await admin
        .schema("licensing")
        .from("audit_log")
        .insert({
          organization_id: member.organizationId,
          actor_member_id: member.id,
          action: "device.fingerprint_mismatch",
          target_table: "devices",
          target_id: device.id,
          metadata: {
            installId,
            outcome: fingerprint.outcome,
            storedFingerprintPrefix: fingerprintPrefix(fingerprint.stored),
            incomingFingerprintPrefix: fingerprint.outcome === "mismatch"
              ? fingerprintPrefix(fingerprint.incoming)
              : "",
          },
        });
      return errorResponse("device_not_active", "Device identity mismatch.", 403);
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
        // Hardware identity is written only by a code-backed activation. Storing
        // whatever the first caller happens to send would let a copied
        // credential claim the machine and lock the owner out of their own seat.
        device_label: cleanString(body.deviceLabel, 128) || null,
        app_version: cleanString(body.appVersion, 64) || null,
        last_seen_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("id", device.id)
      .eq("status", "active");

    const { data: latestClockAudit, error: latestClockAuditError } = await admin
      .schema("licensing")
      .from("clock_audits")
      .select("created_at,status")
      .eq("device_id", device.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestClockAuditError) {
      console.error("validate-license clock audit lookup failed", {
        code: latestClockAuditError.code,
      });
    }
    const latestAuditAt = parseDate(latestClockAudit?.created_at)?.getTime() ?? null;
    const latestAuditStatus = latestClockAudit?.status === "ok"
      || latestClockAudit?.status === "suspicious"
      ? latestClockAudit.status
      : null;
    if (shouldRecordClockAudit({
      currentStatus: clockStatus,
      latestStatus: latestAuditStatus,
      latestCreatedAtMillis: latestAuditAt,
      nowMillis: now.getTime(),
    })) {
      const { error: clockAuditError } = await admin
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
          // PostgreSQL integer is intentionally bounded so even a machine
          // reset to an extreme year still produces a useful audit row.
          clock_skew_seconds: boundedClockSkewSeconds(clockSkewSeconds),
          status: clockStatus,
        });
      // Observability must never become an availability dependency for login.
      // A failed write is visible in Function logs while the existing access
      // decision and response remain unchanged.
      if (clockAuditError) {
        console.error("validate-license clock audit insert failed", {
          code: clockAuditError.code,
        });
      }
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
      deviceFingerprintHash: incomingFingerprint,
    });

    return jsonResponse({
      ok: true,
      status: "licensed",
      serverTime: now.toISOString(),
      authDay,
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
    if (message === "rate_limited") {
      return errorResponse("rate_limited", "Try again later.", 429);
    }
    if (message === "invalid_user_token" || message === "missing_bearer_token") {
      return errorResponse("invalid_user_token", "Session is invalid.", 401);
    }
    return errorResponse("internal_error", "Unable to validate license.", 500);
  }
});
