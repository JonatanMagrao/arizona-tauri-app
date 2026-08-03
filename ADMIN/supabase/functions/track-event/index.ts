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
import { licenseExpiryInstant } from "../_shared/auth-cycle.ts";
import { enforceRateLimit } from "../_shared/security.ts";

type TrackEventBody = {
  eventName?: unknown;
  installId?: unknown;
  appVersion?: unknown;
  success?: unknown;
  errorCode?: unknown;
  metadata?: unknown;
};

function cleanString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function sanitizeMetadata(value: unknown, depth = 0): unknown {
  if (depth > 3) return null;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeMetadata(item, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 40)
        .map(([key, item]) => [
          key.slice(0, 80),
          /(token|password|secret|receipt|authorization|activation.?code)/i.test(key)
            ? "[redacted]"
            : sanitizeMetadata(item, depth + 1),
        ]),
    );
  }
  if (typeof value === "string") return value.slice(0, 500);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  return null;
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  const methodError = requirePost(req);
  if (methodError) return methodError;

  try {
    requirePublishableKey(req);

    const body = await readJsonBody<TrackEventBody>(req);
    const eventName = cleanString(body.eventName, 96);
    if (!eventName) return errorResponse("missing_event_name", "eventName is required.", 400);

    const admin = createAdminClient();
    const user = await getAuthUser(req);
    const member = await resolveMember(admin, user);
    if (!member) {
      return errorResponse("member_not_authorized", "This email is not authorized.", 403);
    }

    // A suspended or expired licence must write nothing, telemetry included.
    const { data: organization, error: organizationError } = await admin
      .schema("licensing")
      .from("organizations")
      .select("status,license_expires_on,daily_auth_reset_hour")
      .eq("id", member.organizationId)
      .maybeSingle();
    if (organizationError) throw organizationError;
    if (!organization || organization.status !== "active") {
      return errorResponse("organization_not_active", "Organization is not active.", 403);
    }
    const licenseExpiresAt = licenseExpiryInstant(
      organization.license_expires_on,
      organization.daily_auth_reset_hour,
    );
    if (licenseExpiresAt && licenseExpiresAt.getTime() < Date.now()) {
      return errorResponse("license_expired", "License has expired.", 403);
    }

    await enforceRateLimit(admin, "event.track.member", member.id, 240, 3600);

    const installId = cleanString(body.installId, 128);
    let deviceId: string | null = null;

    if (installId) {
      const { data: device, error: deviceError } = await admin
        .schema("licensing")
        .from("devices")
        .select("id")
        .eq("member_id", member.id)
        .eq("install_id", installId)
        .eq("status", "active")
        .maybeSingle();
      if (deviceError) throw deviceError;
      deviceId = device?.id || null;
    }

    const metadata = body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
      ? sanitizeMetadata(body.metadata)
      : {};
    if (new TextEncoder().encode(JSON.stringify(metadata)).length > 8192) {
      return errorResponse("payload_too_large", "metadata is too large.", 413);
    }

    const { error: insertError } = await admin
      .schema("licensing")
      .from("app_events")
      .insert({
        organization_id: member.organizationId,
        member_id: member.id,
        device_id: deviceId,
        event_name: eventName,
        app_version: cleanString(body.appVersion, 64) || null,
        success: typeof body.success === "boolean" ? body.success : null,
        error_code: cleanString(body.errorCode, 80) || null,
        metadata,
      });

    if (insertError) throw insertError;

    return jsonResponse({ ok: true });
  } catch (error) {
    console.error(error);
    if (String((error as { message?: unknown })?.message || error || "") === "rate_limited") {
      return errorResponse("rate_limited", "Try again later.", 429);
    }
    const message = String((error as { message?: unknown })?.message || error || "");
    if (message === "invalid_user_token" || message === "missing_bearer_token") {
      return errorResponse("invalid_user_token", "Session is invalid.", 401);
    }
    if (message === "invalid_publishable_key") {
      return errorResponse("invalid_publishable_key", "Invalid publishable key.", 401);
    }
    return errorResponse("internal_error", "Unable to track event.", 500);
  }
});
