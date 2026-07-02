import {
  errorResponse,
  handleOptions,
  jsonResponse,
  readJsonBody,
  requirePost,
} from "../_shared/http.ts";
import {
  createAdminClient,
  requirePublishableKey,
} from "../_shared/supabase.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

type SetPasswordBody = {
  email?: unknown;
  password?: unknown;
  checkOnly?: unknown;
};

type AuthUserRecord = {
  id?: string;
  email?: string;
};

function cleanEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().slice(0, 254) : "";
}

function cleanPassword(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function endOfLicenseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(`${value.slice(0, 10)}T23:59:59.999Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isUserAlreadyRegisteredError(error: unknown): boolean {
  const text = String((error as { message?: unknown })?.message || error || "").toLowerCase();
  return text.includes("already registered")
    || text.includes("already been registered")
    || text.includes("already exists");
}

async function findAuthUserByEmail(admin: AdminClient, email: string): Promise<AuthUserRecord | null> {
  const perPage = 1000;

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    const users = (data?.users || []) as AuthUserRecord[];
    const found = users.find((user) => cleanEmail(user.email) === email);
    if (found) return found;
    if (users.length < perPage) return null;
  }

  return null;
}

async function createOrRecoverAuthUser(admin: AdminClient, email: string, password: string): Promise<{
  authUserId: string;
  created: boolean;
}> {
  const { data: createdUser, error: createUserError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      source: "arizona-tauri-first-access",
    },
  });

  if (!createUserError) {
    const authUserId = createdUser.user?.id;
    if (!authUserId) throw new Error("missing_created_auth_user_id");
    return { authUserId, created: true };
  }

  if (!isUserAlreadyRegisteredError(createUserError)) {
    throw createUserError;
  }

  const existingUser = await findAuthUserByEmail(admin, email);
  if (!existingUser?.id) {
    throw createUserError;
  }

  const { error: updateUserError } = await admin.auth.admin.updateUserById(existingUser.id, {
    password,
    email_confirm: true,
    user_metadata: {
      source: "arizona-tauri-first-access-recovered",
    },
  });

  if (updateUserError) throw updateUserError;

  return { authUserId: existingUser.id, created: false };
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  const methodError = requirePost(req);
  if (methodError) return methodError;

  try {
    requirePublishableKey(req);

    const body = await readJsonBody<SetPasswordBody>(req);
    const email = cleanEmail(body.email);
    const password = cleanPassword(body.password);
    const checkOnly = body.checkOnly === true;

    if (!email || !email.includes("@")) {
      return errorResponse("invalid_email", "A valid email is required.", 400);
    }
    if (!checkOnly && password.length < 6) {
      return errorResponse("weak_password", "Password must have at least 6 characters.", 400);
    }

    const admin = createAdminClient();
    const { data: member, error: memberError } = await admin
      .schema("licensing")
      .from("members")
      .select("id,organization_id,email,auth_user_id,status")
      .eq("email", email)
      .in("status", ["invited", "active"])
      .limit(1)
      .maybeSingle();

    if (memberError) throw memberError;
    if (!member) {
      return errorResponse("member_not_authorized", "This email is not authorized.", 403);
    }
    const { data: organization, error: organizationError } = await admin
      .schema("licensing")
      .from("organizations")
      .select("id,status,license_expires_on")
      .eq("id", member.organization_id)
      .maybeSingle();

    if (organizationError) throw organizationError;
    if (!organization || organization.status !== "active") {
      return errorResponse("organization_not_active", "Organization is not active.", 403);
    }

    const licenseExpiresAt = endOfLicenseDate(organization.license_expires_on);
    if (licenseExpiresAt && licenseExpiresAt.getTime() < Date.now()) {
      return errorResponse("license_expired", "License has expired.", 403);
    }

    if (checkOnly) {
      return jsonResponse({
        ok: true,
        email: member.email,
        setupRequired: !member.auth_user_id,
        hasPassword: Boolean(member.auth_user_id),
        status: member.status,
      });
    }

    if (member.auth_user_id) {
      return errorResponse("password_already_set", "Password is already set.", 409);
    }

    const { authUserId, created } = await createOrRecoverAuthUser(admin, email, password);

    const now = new Date().toISOString();
    const { data: updatedMember, error: updateMemberError } = await admin
      .schema("licensing")
      .from("members")
      .update({
        auth_user_id: authUserId,
        status: "active",
        activated_at: now,
        last_seen_at: now,
      })
      .eq("id", member.id)
      .is("auth_user_id", null)
      .select("id,email,status")
      .maybeSingle();

    if (updateMemberError) throw updateMemberError;
    if (!updatedMember) {
      if (created) await admin.auth.admin.deleteUser(authUserId);
      return errorResponse("password_already_set", "Password is already set.", 409);
    }

    const { error: auditError } = await admin
      .schema("licensing")
      .from("audit_log")
      .insert({
        organization_id: member.organization_id,
        actor_member_id: updatedMember.id,
        action: "member.password_set",
        target_table: "members",
        target_id: updatedMember.id,
        metadata: { email, recoveredAuthUser: !created },
      });
    if (auditError) console.error(auditError);

    return jsonResponse({
      ok: true,
      member: {
        id: updatedMember.id,
        email: updatedMember.email,
        status: updatedMember.status,
      },
    });
  } catch (error) {
    console.error(error);
    const message = String((error as { message?: unknown })?.message || error || "");
    if (message === "invalid_publishable_key") {
      return errorResponse("invalid_publishable_key", "Invalid publishable key.", 401);
    }
    if (message === "invalid_json_body") {
      return errorResponse("invalid_json_body", "Invalid JSON body.", 400);
    }
    return errorResponse("internal_error", "Unable to set password.", 500);
  }
});
