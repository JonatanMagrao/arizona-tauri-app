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

type ReleaseDeviceBody = {
  source?: unknown;
};

function cleanSource(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 64) : "";
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
    const admin = createAdminClient();
    const user = await getAuthUser(req);
    const member = await resolveMember(admin, user);

    if (!member) {
      return errorResponse("member_not_authorized", "This email is not authorized.", 403);
    }

    const { data: activeDevices, error: devicesError } = await admin
      .schema("licensing")
      .from("devices")
      .select("id,install_id,device_label,status")
      .eq("organization_id", member.organizationId)
      .eq("member_id", member.id)
      .eq("status", "active");

    if (devicesError) throw devicesError;

    const activeDeviceIds = (activeDevices || []).map((device) => device.id);
    if (!activeDeviceIds.length) {
      return jsonResponse({ ok: true, released: false, devices: [] });
    }

    const now = new Date().toISOString();
    const { data: releasedDevices, error: releaseError } = await admin
      .schema("licensing")
      .from("devices")
      .update({
        status: "revoked",
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
