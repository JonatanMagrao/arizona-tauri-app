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
      ? body.metadata
      : {};

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
    return errorResponse("internal_error", "Unable to track event.", 500);
  }
});
