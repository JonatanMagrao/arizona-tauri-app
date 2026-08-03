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
import { licenseExpiryInstant } from "../_shared/auth-cycle.ts";
import {
  adminGoogleOAuthNotBefore,
  enforceRateLimit,
  hasOAuthSignIn,
  requireRecentGoogleOAuth,
} from "../_shared/security.ts";

type AddMemberBody = {
  organizationId?: unknown;
  name?: unknown;
  email?: unknown;
  role?: unknown;
};

function cleanString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().slice(0, 254) : "";
}

function emailDomain(value: string): string {
  const [, domain = ""] = value.split("@");
  return domain.trim().toLowerCase();
}

async function isActiveMasterEmail(admin: ReturnType<typeof createAdminClient>, email: string): Promise<boolean> {
  const { data, error } = await admin
    .schema("licensing")
    .from("master_accounts")
    .select("id")
    .eq("email", email)
    .eq("status", "active")
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
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
    const name = cleanString(body.name, 160);
    const email = cleanEmail(body.email);
    const requestedRole = body.role === "admin" ? "admin" : "user";

    if (!organizationId) return errorResponse("missing_organization_id", "organizationId is required.", 400);
    if (!name) return errorResponse("missing_name", "name is required.", 400);
    if (!email || !email.includes("@")) return errorResponse("invalid_email", "A valid email is required.", 400);

    const admin = createAdminClient();
    const user = await getAuthUser(req);
    const master = hasOAuthSignIn(req) ? await resolveMaster(admin, user) : null;
    const actor = master ?? await resolveMember(admin, user, organizationId);

    if (!actor || (actor.kind === "member" && actor.role !== "admin")) {
      return errorResponse("forbidden", "Only masters or organization admins can add members.", 403);
    }

    const role = actor.kind === "master" ? requestedRole : "user";

    const { data: org, error: orgError } = await admin
      .schema("licensing")
      .from("organizations")
      .select("id,status,seats_allowed,allowed_email_domain,license_expires_on,daily_auth_reset_hour")
      .eq("id", organizationId)
      .maybeSingle();

    if (orgError) throw orgError;
    if (!org || org.status !== "active") {
      return errorResponse("organization_not_active", "Organization is not active.", 403);
    }
    if (actor.kind === "master") {
      requireRecentGoogleOAuth(
        req,
        adminGoogleOAuthNotBefore(),
        user.providers,
      );
    }
    await enforceRateLimit(admin, "admin.add.actor", `${actor.kind}:${actor.id}`, 30, 3600);
    const licenseExpiresAt = licenseExpiryInstant(org.license_expires_on, org.daily_auth_reset_hour);
    if (licenseExpiresAt && licenseExpiresAt.getTime() < Date.now()) {
      return errorResponse("license_expired", "License has expired.", 403);
    }
    const activeMasterEmail = await isActiveMasterEmail(admin, email);
    if (activeMasterEmail && actor.kind !== "master") {
      return errorResponse(
        "protected_identity",
        "Only a master can add an account reserved for a master.",
        403,
      );
    }
    if (!activeMasterEmail && org.allowed_email_domain && emailDomain(email) !== org.allowed_email_domain) {
      return errorResponse("email_domain_not_allowed", "Email is outside the organization domain.", 400);
    }

    const { data: existingMember, error: existingMemberError } = await admin
      .schema("licensing")
      .from("members")
      .select("id,name,email,role,status")
      .eq("organization_id", organizationId)
      .eq("email", email)
      .maybeSingle();

    if (existingMemberError) throw existingMemberError;

    if (existingMember) {
      if (["invited", "active"].includes(existingMember.status)) {
        return errorResponse("member_already_exists", "Email is already registered.", 409);
      }

      const { data: restoredMember, error: restoreError } = await admin
        .schema("licensing")
        .from("members")
        .update({
          name,
          role,
          status: "invited",
          added_by_master_id: actor.kind === "master" ? actor.id : null,
          added_by_member_id: actor.kind === "member" ? actor.id : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingMember.id)
        .select("id,name,email,role,status")
        .single();

      if (restoreError) {
        if (String(restoreError.message).includes("seat_limit_exceeded")) {
          return errorResponse("seat_limit_exceeded", "No seats available.", 409);
        }
        if (String(restoreError.message).includes("email_domain_not_allowed")) {
          return errorResponse("email_domain_not_allowed", "Email is outside the organization domain.", 400);
        }
        throw restoreError;
      }

      await admin
        .schema("licensing")
        .from("audit_log")
        .insert({
          organization_id: organizationId,
          actor_master_id: actor.kind === "master" ? actor.id : null,
          actor_member_id: actor.kind === "member" ? actor.id : null,
          action: "member.restored",
          target_table: "members",
          target_id: restoredMember.id,
          metadata: {
            source: "tauri_admin_panel",
            reason: "add_existing_inactive_member",
            actor: {
              kind: actor.kind,
              id: actor.id,
              email: actor.email,
              role: actor.kind === "member" ? actor.role : "master",
            },
            target: {
              id: restoredMember.id,
              name: restoredMember.name,
              email: restoredMember.email,
              role: restoredMember.role,
              previousStatus: existingMember.status,
              status: restoredMember.status,
            },
          },
        });

      return jsonResponse({ ok: true, member: restoredMember, restored: true });
    }

    const insertPayload = {
      organization_id: organizationId,
      name,
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
      .select("id,name,email,role,status")
      .single();

    if (insertError) {
      if (String(insertError.message).includes("seat_limit_exceeded")) {
        return errorResponse("seat_limit_exceeded", "No seats available.", 409);
      }
      if (String(insertError.message).includes("email_domain_not_allowed")) {
        return errorResponse("email_domain_not_allowed", "Email is outside the organization domain.", 400);
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
        metadata: {
          source: "tauri_admin_panel",
          actor: {
            kind: actor.kind,
            id: actor.id,
            email: actor.email,
            role: actor.kind === "member" ? actor.role : "master",
          },
          target: {
            id: member.id,
            name,
            email,
            role,
            status: member.status,
          },
        },
      });

    return jsonResponse({ ok: true, member });
  } catch (error) {
    console.error(error);
    const message = String((error as { message?: unknown })?.message || error || "");
    if (message === "google_oauth_required" || message === "daily_google_oauth_required") {
      return errorResponse(
        "admin_google_oauth_required",
        "Sign in with Google to continue.",
        401,
      );
    }
    if (message === "rate_limited") {
      return errorResponse("rate_limited", "Try again later.", 429);
    }
    if (message === "invalid_user_token" || message === "missing_bearer_token") {
      return errorResponse("invalid_user_token", "Session is invalid.", 401);
    }
    if (message === "invalid_publishable_key") {
      return errorResponse("invalid_publishable_key", "Invalid publishable key.", 401);
    }
    return errorResponse("internal_error", "Unable to add member.", 500);
  }
});
