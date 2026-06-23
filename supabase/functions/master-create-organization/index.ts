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
import { resolveMaster } from "../_shared/actors.ts";

type CreateOrganizationBody = {
  name?: unknown;
  slug?: unknown;
  seatsAllowed?: unknown;
  adminEmail?: unknown;
};

function cleanString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().slice(0, 254) : "";
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  const methodError = requirePost(req);
  if (methodError) return methodError;

  try {
    requirePublishableKey(req);

    const body = await readJsonBody<CreateOrganizationBody>(req);
    const name = cleanString(body.name, 160);
    const slug = slugify(cleanString(body.slug, 100) || name);
    const seatsAllowed = Number(body.seatsAllowed);
    const adminEmail = cleanEmail(body.adminEmail);

    if (!name) return errorResponse("missing_name", "name is required.", 400);
    if (!slug) return errorResponse("missing_slug", "slug is required.", 400);
    if (!Number.isInteger(seatsAllowed) || seatsAllowed < 1) {
      return errorResponse("invalid_seats", "seatsAllowed must be at least 1.", 400);
    }
    if (!adminEmail || !adminEmail.includes("@")) {
      return errorResponse("invalid_admin_email", "A valid adminEmail is required.", 400);
    }

    const admin = createAdminClient();
    const user = await getAuthUser(req);
    const master = await resolveMaster(admin, user);
    if (!master) return errorResponse("forbidden", "Only a master can create organizations.", 403);

    const { data: organization, error: orgError } = await admin
      .schema("licensing")
      .from("organizations")
      .insert({
        name,
        slug,
        seats_allowed: seatsAllowed,
        status: "active",
        created_by_master_id: master.id,
      })
      .select("id,name,slug,seats_allowed,status")
      .single();

    if (orgError) {
      if (String(orgError.message).includes("duplicate key")) {
        return errorResponse("organization_already_exists", "Organization slug already exists.", 409);
      }
      throw orgError;
    }

    const { data: member, error: memberError } = await admin
      .schema("licensing")
      .from("members")
      .insert({
        organization_id: organization.id,
        email: adminEmail,
        role: "admin",
        status: "invited",
        added_by_master_id: master.id,
      })
      .select("id,email,role,status")
      .single();

    if (memberError) throw memberError;

    await admin
      .schema("licensing")
      .from("audit_log")
      .insert({
        organization_id: organization.id,
        actor_master_id: master.id,
        action: "organization.created",
        target_table: "organizations",
        target_id: organization.id,
        metadata: { name, slug, seatsAllowed, adminEmail },
      });

    return jsonResponse({ ok: true, organization, admin: member });
  } catch (error) {
    console.error(error);
    return errorResponse("internal_error", "Unable to create organization.", 500);
  }
});
