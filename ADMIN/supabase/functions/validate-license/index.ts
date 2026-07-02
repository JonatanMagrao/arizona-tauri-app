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
import { signAexBridgeToken, signLicenseToken } from "../_shared/license-token.ts";

type ValidateLicenseBody = {
  installId?: unknown;
  appVersion?: unknown;
  deviceLabel?: unknown;
  deviceFingerprintHash?: unknown;
  clientLocalTime?: unknown;
  lastServerTimeSeen?: unknown;
  lastLocalTimeSeen?: unknown;
  authMethod?: unknown;
};

const MAX_CLOCK_BACKWARDS_SECONDS = 300;
const MAX_CLOCK_SKEW_SECONDS = 300;
const AUTH_TIME_ZONE = "America/Sao_Paulo";
const ARIZONA_ORGANIZATION_SLUG = "arizona";
const AEX_BRIDGE_TOKEN_TTL_SECONDS = 10 * 60;

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

function zonedParts(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: AUTH_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(byType.year),
    month: Number(byType.month),
    day: Number(byType.day),
    hour: Number(byType.hour),
    minute: Number(byType.minute),
    second: Number(byType.second),
  };
}

function serverAuthDay(value: Date): string {
  const parts = zonedParts(value);
  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-");
}

function zonedMidnight(year: number, month: number, day: number): Date {
  let candidate = new Date(Date.UTC(year, month - 1, day, 3, 0, 0));
  for (let index = 0; index < 3; index += 1) {
    const parts = zonedParts(candidate);
    const observed = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const target = Date.UTC(year, month - 1, day, 0, 0, 0);
    candidate = new Date(candidate.getTime() + target - observed);
  }
  return candidate;
}

function nextAuthDayStart(value: Date): Date {
  const parts = zonedParts(value);
  const nextDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1, 0, 0, 0));
  return zonedMidnight(nextDate.getUTCFullYear(), nextDate.getUTCMonth() + 1, nextDate.getUTCDate());
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
    if (!installId) {
      return errorResponse("missing_install_id", "installId is required.", 400);
    }

    const admin = createAdminClient();
    const user = await getAuthUser(req);
    let member = await resolveMember(admin, user);

    if (!member) {
      const master = await resolveMaster(admin, user);
      if (master) {
        const { data: organization, error: organizationLookupError } = await admin
          .schema("licensing")
          .from("organizations")
          .select("id,status")
          .eq("slug", ARIZONA_ORGANIZATION_SLUG)
          .maybeSingle();

        if (organizationLookupError) throw organizationLookupError;
        if (!organization || organization.status !== "active") {
          return errorResponse("organization_not_active", "Organization is not active.", 403);
        }

        const { error: upsertMasterMemberError } = await admin
          .schema("licensing")
          .from("members")
          .upsert({
            organization_id: organization.id,
            name: master.email,
            email: master.email,
            auth_user_id: user.id,
            role: "admin",
            status: "active",
            added_by_master_id: master.id,
            activated_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
          }, { onConflict: "organization_id,email" });

        if (upsertMasterMemberError) throw upsertMasterMemberError;
        member = await resolveMember(admin, user, organization.id);
      }
    }

    if (!member) {
      return errorResponse("member_not_authorized", "This email is not authorized.", 403);
    }

    const { data: organization, error: organizationError } = await admin
      .schema("licensing")
      .from("organizations")
      .select("id,name,status,seats_allowed,license_expires_on")
      .eq("id", member.organizationId)
      .maybeSingle();

    if (organizationError) throw organizationError;
    if (!organization || organization.status !== "active") {
      return errorResponse("organization_not_active", "Organization is not active.", 403);
    }

    const now = new Date();
    const authDay = serverAuthDay(now);
    const authMethod = cleanString(body.authMethod, 24) === "resume" ? "resume" : "password";
    const licenseExpiresAt = endOfLicenseDate(organization.license_expires_on);
    if (licenseExpiresAt && licenseExpiresAt.getTime() < now.getTime()) {
      return errorResponse("license_expired", "License has expired.", 403);
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

    const { data: activeDevice, error: activeDeviceError } = await admin
      .schema("licensing")
      .from("devices")
      .select("id,install_id,device_label,last_seen_at")
      .eq("member_id", member.id)
      .eq("status", "active")
      .maybeSingle();

    if (activeDeviceError) throw activeDeviceError;
    if (activeDevice && activeDevice.install_id !== installId) {
      return errorResponse(
        "device_limit_reached",
        "This user already has an active device. Release it before using another machine.",
        409,
      );
    }

    const devicePayload: Record<string, string | null> = {
      organization_id: member.organizationId,
      member_id: member.id,
      install_id: installId,
      device_fingerprint_hash: cleanString(body.deviceFingerprintHash, 256) || null,
      device_label: cleanString(body.deviceLabel, 128) || null,
      app_version: cleanString(body.appVersion, 64) || null,
      status: "active",
      last_seen_at: now.toISOString(),
      updated_at: now.toISOString(),
    };

    if (authMethod === "password") {
      devicePayload.last_password_login_at = now.toISOString();
    }

    const { data: device, error: deviceError } = await admin
      .schema("licensing")
      .from("devices")
      .upsert(devicePayload, { onConflict: "member_id,install_id" })
      .select("id,status,last_password_login_at")
      .single();

    if (deviceError) throw deviceError;
    if (!device || device.status !== "active") {
      return errorResponse("device_not_active", "Device is not active.", 403);
    }

    const passwordLoginAt = parseDate(device.last_password_login_at);
    if (!passwordLoginAt) {
      return errorResponse("daily_login_required", "Password login is required.", 401);
    }

    if (serverAuthDay(passwordLoginAt) !== authDay) {
      return errorResponse("daily_login_required", "Password login is required.", 401);
    }

    const sessionExpiresAt = nextAuthDayStart(now);
    const expiresAt = licenseExpiresAt && licenseExpiresAt.getTime() < sessionExpiresAt.getTime()
      ? licenseExpiresAt
      : sessionExpiresAt;

    const { data: session, error: sessionError } = await admin
      .schema("licensing")
      .from("license_sessions")
      .insert({
        organization_id: member.organizationId,
        member_id: member.id,
        device_id: device.id,
        issued_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        server_time_at_issue: now.toISOString(),
        status: "active",
      })
      .select("id,token_id,issued_at,expires_at,server_time_at_issue")
      .single();

    if (sessionError) throw sessionError;

    await admin
      .schema("licensing")
      .from("clock_audits")
      .insert({
        organization_id: member.organizationId,
        member_id: member.id,
        device_id: device.id,
        license_session_id: session.id,
        client_local_time: clientLocalTime?.toISOString() || null,
        last_server_time_seen: lastServerTimeSeen?.toISOString() || null,
        last_local_time_seen: lastLocalTimeSeen?.toISOString() || null,
        server_time: now.toISOString(),
        clock_skew_seconds: clockSkewSeconds,
        status: clockStatus,
      });

    if (clockStatus === "suspicious") {
      return errorResponse("clock_suspicious", "Device clock needs online verification.", 403);
    }

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

    const bridgeTokenExpiresAt = new Date(Math.min(
      expiresAt.getTime(),
      now.getTime() + AEX_BRIDGE_TOKEN_TTL_SECONDS * 1000,
    ));
    const bridgeToken = await signAexBridgeToken({
      sessionId: session.id,
      tokenId: crypto.randomUUID(),
      organizationId: member.organizationId,
      memberId: member.id,
      deviceId: device.id,
      issuedAt: now.toISOString(),
      expiresAt: bridgeTokenExpiresAt.toISOString(),
    });

    return jsonResponse({
      ok: true,
      status: "licensed",
      serverTime: now.toISOString(),
      authDay,
      passwordLoginAt: passwordLoginAt.toISOString(),
      expiresAt: session.expires_at,
      token,
      bridgeToken,
      bridgeTokenExpiresAt: bridgeTokenExpiresAt.toISOString(),
      bridge: {
        token: bridgeToken,
        expiresAt: bridgeTokenExpiresAt.toISOString(),
      },
      organization: {
        id: organization.id,
        name: organization.name,
        seatsAllowed: organization.seats_allowed,
        licenseExpiresOn: organization.license_expires_on,
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
    return errorResponse("internal_error", "Unable to validate license.", 500);
  }
});
