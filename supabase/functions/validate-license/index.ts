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

const LICENSE_TTL_HOURS = 72;
const MAX_CLOCK_BACKWARDS_SECONDS = 300;

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
    if (!installId) {
      return errorResponse("missing_install_id", "installId is required.", 400);
    }

    const admin = createAdminClient();
    const user = await getAuthUser(req);
    const member = await resolveMember(admin, user);
    if (!member) {
      return errorResponse("member_not_authorized", "This email is not authorized.", 403);
    }

    const { data: organization, error: organizationError } = await admin
      .schema("licensing")
      .from("organizations")
      .select("id,name,status,seats_allowed")
      .eq("id", member.organizationId)
      .maybeSingle();

    if (organizationError) throw organizationError;
    if (!organization || organization.status !== "active") {
      return errorResponse("organization_not_active", "Organization is not active.", 403);
    }

    const now = new Date();
    const clientLocalTime = parseDate(body.clientLocalTime);
    const lastServerTimeSeen = parseDate(body.lastServerTimeSeen);
    const lastLocalTimeSeen = parseDate(body.lastLocalTimeSeen);
    let clockStatus: "ok" | "suspicious" = "ok";
    let clockSkewSeconds: number | null = null;

    if (clientLocalTime) {
      clockSkewSeconds = Math.round((clientLocalTime.getTime() - now.getTime()) / 1000);
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

    const devicePayload = {
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

    const { data: device, error: deviceError } = await admin
      .schema("licensing")
      .from("devices")
      .upsert(devicePayload, { onConflict: "member_id,install_id" })
      .select("id,status")
      .single();

    if (deviceError) throw deviceError;
    if (!device || device.status !== "active") {
      return errorResponse("device_not_active", "Device is not active.", 403);
    }

    const expiresAt = new Date(now.getTime() + LICENSE_TTL_HOURS * 60 * 60 * 1000);

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

    return jsonResponse({
      ok: true,
      status: "licensed",
      serverTime: now.toISOString(),
      expiresAt: session.expires_at,
      token,
      organization: {
        id: organization.id,
        name: organization.name,
        seatsAllowed: organization.seats_allowed,
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
