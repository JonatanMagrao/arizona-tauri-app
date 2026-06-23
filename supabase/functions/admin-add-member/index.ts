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

type AddMemberBody = {
  organizationId?: unknown;
  email?: unknown;
  role?: unknown;
};

function cleanEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().slice(0, 254) : "";
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  const methodError = requirePost(req);
  if (methodError) return methodError;

  try {
    requirePublishableKey(req);

    const body = await readJsonBody<AddMemberBody>(req);
    const organizationId = typeof body.organizationId === "string" ? body.organizationId.trim() : "";
    const email = cleanEmail(body.email);
    const role = body.role === "admin" ? "admin" : "user";

    if (!organizationId) return errorResponse("missing_organization_id", "organizationId is required.", 400);
    if (!email || !email.includes("@")) return errorResponse("invalid_email", "A valid email is required.", 400);

    const admin = createAdminClient();
    const user = await getAuthUser(req);
    const master = await resolveMaster(admin, user);
    const actor = master ?? await resolveMember(admin, user, organizationId);

    if (!actor || (actor.kind === "member" && actor.role !== "admin")) {
      return errorResponse("forbidden", "Only masters or organization admins can add members.", 403);
    }

    const { data: org, error: orgError } = await admin
      .schema("licensing")
      .from("organizations")
      .select("id,status,seats_allowed")
      .eq("id", organizationId)
      .maybeSingle();

    if (orgError) throw orgError;
    if (!org || org.status !== "active") {
      return errorResponse("organization_not_active", "Organization is not active.", 403);
    }

    const insertPayload = {
      organization_id: organizationId,
      email,
      role,
      status: "invited",
      added_by_master_id: actor.kind === "master" ? actor.id : null,
      added_by_member_id: actor.kind === "member" ? actor.id : null,
    };

    const { data: member, error: insertError } = await admin
      .schema("licensing")
      .from("members")
      .insert(insertPayload)
      .select("id,email,role,status")
      .single();

    if (insertError) {
      if (String(insertError.message).includes("seat_limit_exceeded")) {
        return errorResponse("seat_limit_exceeded", "No seats available.", 409);
      }
      if (String(insertError.message).includes("duplicate key")) {
        return errorResponse("member_already_exists", "Email is already registered.", 409);
      }
      throw insertError;
    }

    await admin
      .schema("licensing")
      .from("audit_log")
      .insert({
        organization_id: organizationId,
        actor_master_id: actor.kind === "master" ? actor.id : null,
        actor_member_id: actor.kind === "member" ? actor.id : null,
        action: "member.added",
        target_table: "members",
        target_id: member.id,
        metadata: { email, role },
      });

    return jsonResponse({ ok: true, member });
  } catch (error) {
    console.error(error);
    return errorResponse("internal_error", "Unable to add member.", 500);
  }
});
