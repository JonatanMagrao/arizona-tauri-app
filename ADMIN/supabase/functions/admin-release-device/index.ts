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

type ReleaseDeviceBody = {
  organizationId?: unknown;
  memberId?: unknown;
  deviceId?: unknown;
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

    const body = await readJsonBody<ReleaseDeviceBody>(req);
    const organizationId = cleanString(body.organizationId, 64);
    const memberId = cleanString(body.memberId, 64);
    const deviceId = cleanString(body.deviceId, 64);

    if (!organizationId) return errorResponse("missing_organization_id", "organizationId is required.", 400);
    if (!memberId) return errorResponse("missing_member_id", "memberId is required.", 400);

    const admin = createAdminClient();
    const user = await getAuthUser(req);
    const master = await resolveMaster(admin, user);
    const actor = master ?? await resolveMember(admin, user, organizationId);

    if (!actor || (actor.kind === "member" && actor.role !== "admin")) {
      return errorResponse("forbidden", "Only masters or organization admins can release devices.", 403);
    }

    const { data: member, error: memberError } = await admin
      .schema("licensing")
      .from("members")
      .select("id,organization_id,email,role,status")
      .eq("id", memberId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (memberError) throw memberError;
    if (!member) return errorResponse("member_not_found", "Member was not found.", 404);

    if (actor.kind === "member" && member.role === "admin" && member.id !== actor.id) {
      return errorResponse("forbidden", "Organization admins cannot release manager devices.", 403);
    }

    let deviceQuery = admin
      .schema("licensing")
      .from("devices")
      .select("id,install_id,device_label,status")
      .eq("organization_id", organizationId)
      .eq("member_id", memberId)
      .eq("status", "active");

    if (deviceId) deviceQuery = deviceQuery.eq("id", deviceId);

    const { data: devices, error: devicesError } = await deviceQuery;
    if (devicesError) throw devicesError;

    const activeDeviceIds = (devices || []).map((device) => device.id);
    if (!activeDeviceIds.length) {
      return jsonResponse({ ok: true, released: false, devices: [] });
    }

    const { data: releasedDevices, error: releaseError } = await admin
      .schema("licensing")
      .from("devices")
      .update({
        status: "revoked",
        updated_at: new Date().toISOString(),
      })
      .in("id", activeDeviceIds)
      .select("id,install_id,device_label,status");

    if (releaseError) throw releaseError;

    const { error: sessionError } = await admin
      .schema("licensing")
      .from("license_sessions")
      .update({
        status: "revoked",
        revoked_at: new Date().toISOString(),
        revoked_reason: "device_released",
        updated_at: new Date().toISOString(),
      })
      .in("device_id", activeDeviceIds)
      .eq("status", "active");

    if (sessionError) throw sessionError;

    await admin
      .schema("licensing")
      .from("audit_log")
      .insert({
        organization_id: organizationId,
        actor_master_id: actor.kind === "master" ? actor.id : null,
        actor_member_id: actor.kind === "member" ? actor.id : null,
        action: "device.released",
        target_table: "devices",
        target_id: activeDeviceIds[0],
        metadata: {
          source: "tauri_admin_panel",
          reason: "admin_panel_release_device",
          actor: {
            kind: actor.kind,
            id: actor.id,
            email: actor.email,
            role: actor.kind === "member" ? actor.role : "master",
          },
          targetMember: {
            id: member.id,
            email: member.email,
            role: member.role,
            status: member.status,
          },
          devices: releasedDevices || [],
        },
      });

    return jsonResponse({ ok: true, released: true, devices: releasedDevices || [] });
  } catch (error) {
    console.error(error);
    return errorResponse("internal_error", "Unable to release device.", 500);
  }
});
