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
import {
  ACCESS_POLICY_SELECT,
  DEFAULT_ACCESS_POLICY,
  accessPolicy,
  accessPolicyColumns,
  type AccessPolicy,
} from "../_shared/access-policy.ts";
import {
  currentAuthDayStart,
  normalizeDailyAuthResetHour,
} from "../_shared/auth-cycle.ts";
import {
  enforceRateLimit,
  rateLimitResponse,
  requireRecentTotp,
} from "../_shared/security.ts";

type CreateOrganizationBody = {
  seatsAllowed?: unknown;
  licenseExpiresOn?: unknown;
  licenseIsIndefinite?: unknown;
  dailyAuthResetHour?: unknown;
  activationCodeTtlMinutes?: unknown;
  activationAttemptLimit?: unknown;
  activationAttemptWindowMinutes?: unknown;
  activationGenerationLimit?: unknown;
  activationGenerationWindowMinutes?: unknown;
  deviceReleaseLimit?: unknown;
  deviceReleaseWindowMinutes?: unknown;
  deviceSwitchIntervalDays?: unknown;
  deviceSwitchCooldownDays?: unknown;
  deviceSwitchCooldownMinutes?: unknown;
  deviceRecoveryWindowMinutes?: unknown;
  users?: unknown;
  managers?: unknown;
  adminName?: unknown;
  adminEmail?: unknown;
};

type LicenseUserInput = {
  name: string;
  email: string;
  role: "admin" | "user";
};

const ARIZONA_ORGANIZATION_NAME = "Arizona";
const ARIZONA_ORGANIZATION_SLUG = "arizona";
const ARIZONA_ALLOWED_EMAIL_DOMAIN = "arizona.global";

function cleanString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().slice(0, 254) : "";
}

function cleanDateInput(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : "";
}

function todayDateInput(): string {
  return new Date().toISOString().slice(0, 10);
}

function emailDomain(value: string): string {
  const [, domain = ""] = value.split("@");
  return domain.trim().toLowerCase();
}

function cleanLicenseUsers(body: CreateOrganizationBody): LicenseUserInput[] {
  const source = Array.isArray(body.users)
    ? body.users
    : Array.isArray(body.managers)
      ? body.managers
      : [{ name: body.adminName, email: body.adminEmail, isManager: true }];

  const users = source
    .map((item) => {
      const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const isManager = record.isManager === true || record.role === "admin";
      return {
        name: cleanString(record.name, 160),
        email: cleanEmail(record.email),
        role: isManager ? "admin" as const : "user" as const,
      };
    })
    .filter((user) => user.name || user.email);

  const seenEmails = new Set<string>();
  return users.filter((user) => {
    if (!user.email || seenEmails.has(user.email)) return false;
    seenEmails.add(user.email);
    return true;
  });
}

function parseAccessPolicy(body: CreateOrganizationBody): AccessPolicy | null {
  const values = {
    activation_code_ttl_minutes: Number(
      body.activationCodeTtlMinutes ?? DEFAULT_ACCESS_POLICY.activationCodeTtlMinutes,
    ),
    activation_attempt_limit: Number(
      body.activationAttemptLimit ?? DEFAULT_ACCESS_POLICY.activationAttemptLimit,
    ),
    activation_attempt_window_minutes: Number(
      body.activationAttemptWindowMinutes
        ?? DEFAULT_ACCESS_POLICY.activationAttemptWindowMinutes,
    ),
    activation_generation_limit: Number(
      body.activationGenerationLimit ?? DEFAULT_ACCESS_POLICY.activationGenerationLimit,
    ),
    activation_generation_window_minutes: Number(
      body.activationGenerationWindowMinutes
        ?? DEFAULT_ACCESS_POLICY.activationGenerationWindowMinutes,
    ),
    device_release_limit: Number(
      body.deviceReleaseLimit ?? DEFAULT_ACCESS_POLICY.deviceReleaseLimit,
    ),
    device_release_window_minutes: Number(
      body.deviceReleaseWindowMinutes ?? DEFAULT_ACCESS_POLICY.deviceReleaseWindowMinutes,
    ),
    device_switch_interval_days: Number(
      body.deviceSwitchIntervalDays
      ?? body.deviceSwitchCooldownDays
      ?? (
        body.deviceSwitchCooldownMinutes === undefined
          ? DEFAULT_ACCESS_POLICY.deviceSwitchIntervalDays
          : Math.ceil(Number(body.deviceSwitchCooldownMinutes) / 1440)
      ),
    ),
    device_recovery_window_minutes: Number(
      body.deviceRecoveryWindowMinutes ?? DEFAULT_ACCESS_POLICY.deviceRecoveryWindowMinutes,
    ),
  };
  const policy = accessPolicy(values);
  const normalized = accessPolicyColumns(policy);
  return Object.entries(values).every(([key, value]) => normalized[key] === value)
    ? policy
    : null;
}

function knownError(error: unknown): Response | null {
  const limited = rateLimitResponse(error);
  if (limited) return limited;
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : String(error || "");
  const normalized = message.toLowerCase();

  if (message === "invalid_publishable_key") {
    return errorResponse("invalid_publishable_key", "Invalid publishable key.", 401);
  }
  if (message === "missing_bearer_token" || message === "invalid_user_token") {
    return errorResponse("invalid_user_token", "Login session is invalid.", 401);
  }
  if (message === "mfa_required" || message === "daily_mfa_required") {
    return errorResponse("daily_mfa_required", "Confirm MFA to continue.", 401);
  }
  if (message.startsWith("missing_supabase_") || normalized.includes("invalid api key")) {
    return errorResponse("function_config_error", "Function configuration is incomplete.", 500);
  }
  if (code === "23505" || normalized.includes("duplicate key")) {
    return errorResponse("organization_already_exists", "Organization already exists.", 409);
  }
  if (normalized.includes("permission denied") || normalized.includes("row-level security")) {
    return errorResponse("function_permission_error", "Function cannot write licensing data.", 500);
  }
  if (normalized.includes("seat_limit_exceeded")) {
    return errorResponse("seat_limit_exceeded", "No seats available.", 409);
  }
  if (normalized.includes("email_domain_not_allowed")) {
    return errorResponse("email_domain_not_allowed", "User email must use the allowed organization domain.", 400);
  }

  return null;
}

function safeInternalMessage(error: unknown): string {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : String(error || "unknown_error");
  const normalized = message.replace(/\s+/g, " ").trim().slice(0, 240);
  return code ? `${code}: ${normalized}` : normalized;
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  const methodError = requirePost(req);
  if (methodError) return methodError;

  try {
    requirePublishableKey(req);

    const body = await readJsonBody<CreateOrganizationBody>(req);
    const name = ARIZONA_ORGANIZATION_NAME;
    const slug = ARIZONA_ORGANIZATION_SLUG;
    const seatsAllowed = Number(body.seatsAllowed);
    const allowedEmailDomain = ARIZONA_ALLOWED_EMAIL_DOMAIN;
    const licenseIsIndefinite = body.licenseIsIndefinite === true;
    const licenseExpiresOn = licenseIsIndefinite ? null : cleanDateInput(body.licenseExpiresOn);
    const dailyAuthResetHour = Number(body.dailyAuthResetHour ?? 4);
    const policy = parseAccessPolicy(body);
    const users = cleanLicenseUsers(body);

    if (!Number.isInteger(seatsAllowed) || seatsAllowed < 1) {
      return errorResponse("invalid_seats", "seatsAllowed must be at least 1.", 400);
    }
    if (!Number.isInteger(dailyAuthResetHour) || dailyAuthResetHour < 0 || dailyAuthResetHour > 23) {
      return errorResponse(
        "invalid_daily_auth_reset_hour",
        "dailyAuthResetHour must be an integer between 0 and 23.",
        400,
      );
    }
    if (!policy) {
      return errorResponse(
        "invalid_access_policy",
        "Access policy values are outside the allowed range.",
        400,
      );
    }
    if (users.length > seatsAllowed) {
      return errorResponse("too_many_users", "Users cannot exceed seats.", 409);
    }
    for (const licenseUser of users) {
      if (!licenseUser.name) return errorResponse("missing_user_name", "User name is required.", 400);
      if (!licenseUser.email || !licenseUser.email.includes("@")) {
        return errorResponse("invalid_user_email", "A valid user email is required.", 400);
      }
      if (emailDomain(licenseUser.email) !== allowedEmailDomain) {
        return errorResponse("email_domain_not_allowed", "User email must use the allowed organization domain.", 400);
      }
    }
    if (!licenseIsIndefinite && !licenseExpiresOn) {
      return errorResponse("invalid_license_expires_on", "licenseExpiresOn is required.", 400);
    }
    if (licenseExpiresOn && licenseExpiresOn < todayDateInput()) {
      return errorResponse("invalid_license_expires_on", "licenseExpiresOn cannot be in the past.", 400);
    }

    const admin = createAdminClient();
    const user = await getAuthUser(req);
    const master = await resolveMaster(admin, user);
    if (!master) return errorResponse("forbidden", "Only a master can create organizations.", 403);

    const { data: existingOrganization, error: existingOrganizationError } = await admin
      .schema("licensing")
      .from("organizations")
      .select(
        `id,name,seats_allowed,allowed_email_domain,license_expires_on,daily_auth_reset_hour,status,${ACCESS_POLICY_SELECT}`,
      )
      .eq("slug", slug)
      .maybeSingle();

    if (existingOrganizationError) throw existingOrganizationError;
    requireRecentTotp(
      req,
      currentAuthDayStart(
        new Date(),
        normalizeDailyAuthResetHour(existingOrganization?.daily_auth_reset_hour),
      ),
    );
    await enforceRateLimit(admin, "master.save.actor", master.id, 20, 3600);

    if (existingOrganization) {
      const { data: existingMembers, error: existingMembersError } = await admin
        .schema("licensing")
        .from("members")
        .select("email,role,status")
        .eq("organization_id", existingOrganization.id)
        .in("role", ["admin", "user"])
        .in("status", ["invited", "active"]);

      if (existingMembersError) throw existingMembersError;

      const { data: masterAccounts, error: masterAccountsError } = await admin
        .schema("licensing")
        .from("master_accounts")
        .select("email")
        .eq("status", "active");

      if (masterAccountsError) throw masterAccountsError;

      const activeMasterEmails = new Set((masterAccounts || []).map((account) => String(account.email).toLowerCase()));
      const occupiedSeatEmails = new Set<string>();
      (existingMembers || []).forEach((member) => {
        const email = String(member.email).toLowerCase();
        if (!activeMasterEmails.has(email)) occupiedSeatEmails.add(email);
      });
      users.forEach((licenseUser) => {
        if (!activeMasterEmails.has(licenseUser.email)) occupiedSeatEmails.add(licenseUser.email);
      });
      const projectedConsumedSeats = occupiedSeatEmails.size;

      if (seatsAllowed < projectedConsumedSeats) {
        return errorResponse("seats_below_existing_members", "Seats cannot be lower than active members.", 409);
      }
    }

    const { data: organization, error: orgError } = await admin
      .schema("licensing")
      .from("organizations")
      .upsert({
        name,
        slug,
        seats_allowed: seatsAllowed,
        allowed_email_domain: allowedEmailDomain,
        license_expires_on: licenseExpiresOn,
        daily_auth_reset_hour: dailyAuthResetHour,
        ...accessPolicyColumns(policy),
        status: "active",
        created_by_master_id: master.id,
      }, { onConflict: "slug" })
      .select(
        `id,name,slug,seats_allowed,allowed_email_domain,license_expires_on,daily_auth_reset_hour,status,${ACCESS_POLICY_SELECT}`,
      )
      .single();

    if (orgError) {
      const response = knownError(orgError);
      if (response) return response;
      throw orgError;
    }

    const savedUsers = [];
    const memberAuditRows: Record<string, unknown>[] = [];
    for (const licenseUser of users) {
      const { data: existingUser, error: existingUserError } = await admin
        .schema("licensing")
        .from("members")
        .select("id,name,email,role,status")
        .eq("organization_id", organization.id)
        .eq("email", licenseUser.email)
        .maybeSingle();

      if (existingUserError) throw existingUserError;
      const nextStatus = existingUser?.status === "revoked" ? "invited" : existingUser?.status || "invited";

      const userResult = existingUser
        ? await admin
          .schema("licensing")
          .from("members")
          .update({
            name: licenseUser.name,
            role: licenseUser.role,
            status: existingUser.status === "revoked" ? "invited" : existingUser.status,
            added_by_master_id: master.id,
          })
          .eq("id", existingUser.id)
          .select("id,name,email,role,status")
          .single()
        : await admin
          .schema("licensing")
          .from("members")
          .insert({
            organization_id: organization.id,
            name: licenseUser.name,
            email: licenseUser.email,
            role: licenseUser.role,
            status: "invited",
            added_by_master_id: master.id,
          })
          .select("id,name,email,role,status")
          .single();

      if (userResult.error) {
        const response = knownError(userResult.error);
        if (response) return response;
        throw userResult.error;
      }

      savedUsers.push(userResult.data);

      const target = {
        id: userResult.data.id,
        name: userResult.data.name,
        email: userResult.data.email,
        role: userResult.data.role,
        status: userResult.data.status,
      };
      const actorMetadata = {
        kind: "master",
        id: master.id,
        email: master.email,
        role: "master",
      };

      if (!existingUser) {
        memberAuditRows.push({
          organization_id: organization.id,
          actor_master_id: master.id,
          action: "member.added",
          target_table: "members",
          target_id: userResult.data.id,
          metadata: {
            source: "master_license_panel",
            actor: actorMetadata,
            target,
          },
        });
      } else if (existingUser.status === "revoked") {
        memberAuditRows.push({
          organization_id: organization.id,
          actor_master_id: master.id,
          action: "member.restored",
          target_table: "members",
          target_id: userResult.data.id,
          metadata: {
            source: "master_license_panel",
            reason: "license_user_present_after_previous_revocation",
            actor: actorMetadata,
            target: {
              ...target,
              previousStatus: existingUser.status,
            },
          },
        });
      } else if (
        existingUser.name !== licenseUser.name
        || existingUser.role !== licenseUser.role
        || existingUser.status !== nextStatus
      ) {
        memberAuditRows.push({
          organization_id: organization.id,
          actor_master_id: master.id,
          action: "member.updated",
          target_table: "members",
          target_id: userResult.data.id,
          metadata: {
            source: "master_license_panel",
            actor: actorMetadata,
            target,
            previous: {
              name: existingUser.name,
              email: existingUser.email,
              role: existingUser.role,
              status: existingUser.status,
            },
          },
        });
      }
    }

    const previousLicense = existingOrganization
      ? {
        id: existingOrganization.id,
        name: existingOrganization.name,
        seatsAllowed: Number(existingOrganization.seats_allowed || 0),
        allowedEmailDomain: existingOrganization.allowed_email_domain,
        licenseExpiresOn: existingOrganization.license_expires_on,
        dailyAuthResetHour: Number(existingOrganization.daily_auth_reset_hour ?? 4),
        accessPolicy: accessPolicy(existingOrganization),
        status: existingOrganization.status,
      }
      : null;
    const nextLicense = {
      id: organization.id,
      name: organization.name,
      seatsAllowed,
      allowedEmailDomain,
      licenseExpiresOn,
      dailyAuthResetHour,
      accessPolicy: policy,
      status: organization.status,
    };
    const auditRows: Record<string, unknown>[] = [
      {
        organization_id: organization.id,
        actor_master_id: master.id,
        action: existingOrganization ? "license.updated" : "license.created",
        target_table: "organizations",
        target_id: organization.id,
        metadata: {
          source: "master_license_panel",
          syncMode: "upsert_only",
          actor: {
            kind: "master",
            id: master.id,
            email: master.email,
            role: "master",
          },
          previous: previousLicense,
          target: nextLicense,
          requestedUsers: users,
          licenseIsIndefinite,
        },
      },
      ...memberAuditRows,
    ];

    if (existingOrganization && Number(existingOrganization.seats_allowed || 0) !== seatsAllowed) {
      auditRows.push({
        organization_id: organization.id,
        actor_master_id: master.id,
        action: "license.seats_changed",
        target_table: "organizations",
        target_id: organization.id,
        metadata: {
          source: "master_license_panel",
          actor: {
            kind: "master",
            id: master.id,
            email: master.email,
            role: "master",
          },
          previousSeatsAllowed: Number(existingOrganization.seats_allowed || 0),
          seatsAllowed,
        },
      });
    }

    await admin
      .schema("licensing")
      .from("audit_log")
      .insert(auditRows);

    const { data: consumedSeats, error: consumedSeatsError } = await admin
      .schema("licensing")
      .rpc("consumed_seats", { target_organization_id: organization.id });

    if (consumedSeatsError) throw consumedSeatsError;

    return jsonResponse({
      ok: true,
      organization,
      admin: savedUsers.find((licenseUser) => licenseUser.role === "admin") || null,
      admins: savedUsers.filter((licenseUser) => licenseUser.role === "admin"),
      users: savedUsers,
      consumedSeats: Number(consumedSeats || 0),
    });
  } catch (error) {
    console.error(error);
    const response = knownError(error);
    if (response) return response;
    console.error(safeInternalMessage(error));
    return errorResponse("internal_error", "Unable to save the license.", 500);
  }
});
