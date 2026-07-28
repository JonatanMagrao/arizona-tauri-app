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
  currentAuthDayStart,
  normalizeDailyAuthResetHour,
} from "../_shared/auth-cycle.ts";
import {
  rateLimitResponse,
  requireRecentGoogleOAuth,
} from "../_shared/security.ts";

type ListAuditLogBody = {
  organizationId?: unknown;
  page?: unknown;
  limit?: unknown;
};

type JsonRecord = Record<string, unknown>;

type MemberRow = {
  id: string;
  name: string | null;
  email: string;
  role: string;
  status: string;
};

type MasterRow = {
  id: string;
  email: string;
};

type DeviceRow = {
  id: string;
  member_id: string;
  device_label: string | null;
  status: string;
};

const ARIZONA_ORGANIZATION_SLUG = "arizona";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function optionalString(value: unknown, maxLength = 254): string | null {
  const cleaned = cleanString(value, maxLength);
  return cleaned || null;
}

function optionalNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function memberIdentity(member: MemberRow | undefined): JsonRecord | null {
  if (!member) return null;
  return {
    kind: "member",
    id: member.id,
    name: member.name || null,
    email: member.email,
    role: member.role,
    status: member.status,
  };
}

function masterIdentity(master: MasterRow | undefined): JsonRecord | null {
  if (!master) return null;
  return {
    kind: "master",
    id: master.id,
    name: null,
    email: master.email,
    role: "master",
    status: "active",
  };
}

function metadataIdentity(value: unknown, fallbackKind: string): JsonRecord | null {
  const record = recordValue(value);
  const email = optionalString(record.email);
  const name = optionalString(record.name, 160);
  const id = optionalString(record.id, 64);
  if (!email && !name && !id) return null;

  return {
    kind: optionalString(record.kind, 32) || fallbackKind,
    id,
    name,
    email,
    role: optionalString(record.role, 32),
    status: optionalString(record.status, 32),
  };
}

function auditContext(metadata: JsonRecord): JsonRecord {
  const previous = recordValue(metadata.previous);
  const target = recordValue(metadata.target);
  return {
    source: optionalString(metadata.source, 64),
    reason: optionalString(metadata.reason, 96),
    purpose: optionalString(metadata.purpose, 32),
    expiresAt: optionalString(metadata.expiresAt, 64),
    deletedEvents: optionalNumber(metadata.deletedEvents),
    previousSeatsAllowed: optionalNumber(metadata.previousSeatsAllowed),
    seatsAllowed: optionalNumber(metadata.seatsAllowed),
    previousRole: optionalString(previous.role, 32),
    currentRole: optionalString(target.role, 32),
    previousName: optionalString(previous.name, 160),
    currentName: optionalString(target.name, 160),
  };
}

function knownError(error: unknown): Response | null {
  const limited = rateLimitResponse(error);
  if (limited) return limited;

  const message = error instanceof Error ? error.message : String(error || "");
  const normalized = message.toLowerCase();
  if (message === "invalid_publishable_key") {
    return errorResponse("invalid_publishable_key", "Invalid publishable key.", 401);
  }
  if (message === "missing_bearer_token" || message === "invalid_user_token") {
    return errorResponse("invalid_user_token", "Login session is invalid.", 401);
  }
  if (message === "google_oauth_required" || message === "daily_google_oauth_required") {
    return errorResponse(
      "admin_google_oauth_required",
      "Sign in with Google to continue.",
      401,
    );
  }
  if (message === "invalid_json_body") {
    return errorResponse("invalid_json_body", "Request body is invalid.", 400);
  }
  if (message.startsWith("missing_supabase_") || normalized.includes("invalid api key")) {
    return errorResponse("function_config_error", "Function configuration is incomplete.", 500);
  }
  return null;
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  const methodError = requirePost(req);
  if (methodError) return methodError;

  try {
    requirePublishableKey(req);
    const body = await readJsonBody<ListAuditLogBody>(req);
    const organizationId = cleanString(body.organizationId, 64);
    if (!UUID_PATTERN.test(organizationId)) {
      return errorResponse(
        "invalid_organization_id",
        "organizationId must be a valid UUID.",
        400,
      );
    }

    const page = boundedInteger(body.page, 0, 0, 1000);
    const limit = boundedInteger(body.limit, 40, 10, 100);
    const rangeStart = page * limit;
    const rangeEnd = rangeStart + limit - 1;

    const admin = createAdminClient();
    const user = await getAuthUser(req);
    const master = await resolveMaster(admin, user);
    if (!master) {
      return errorResponse("forbidden", "Only a master can read the audit log.", 403);
    }

    const { data: organization, error: organizationError } = await admin
      .schema("licensing")
      .from("organizations")
      .select("id,status,daily_auth_reset_hour")
      .eq("id", organizationId)
      .eq("slug", ARIZONA_ORGANIZATION_SLUG)
      .maybeSingle();
    if (organizationError) throw organizationError;
    if (!organization || organization.status !== "active") {
      return errorResponse("organization_not_active", "Organization is not active.", 403);
    }

    requireRecentGoogleOAuth(
      req,
      currentAuthDayStart(
        new Date(),
        normalizeDailyAuthResetHour(organization.daily_auth_reset_hour),
      ),
      user.providers,
    );

    const { data: auditRows, error: auditError, count } = await admin
      .schema("licensing")
      .from("audit_log")
      .select(
        "id,actor_master_id,actor_member_id,action,target_table,target_id,metadata,created_at",
        { count: "exact" },
      )
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(rangeStart, rangeEnd);
    if (auditError) throw auditError;

    const rows = auditRows || [];
    const deviceIds = Array.from(new Set(
      rows
        .filter((row) => row.target_table === "devices")
        .map((row) => row.target_id)
        .filter(Boolean),
    ));

    const { data: devices, error: devicesError } = deviceIds.length
      ? await admin
        .schema("licensing")
        .from("devices")
        .select("id,member_id,device_label,status")
        .eq("organization_id", organizationId)
        .in("id", deviceIds)
      : { data: [], error: null };
    if (devicesError) throw devicesError;

    const { data: members, error: membersError } = await admin
      .schema("licensing")
      .from("members")
      .select("id,name,email,role,status")
      .eq("organization_id", organizationId);
    if (membersError) throw membersError;

    const masterIds = Array.from(new Set(
      rows.map((row) => row.actor_master_id).filter(Boolean),
    ));
    const { data: masters, error: mastersError } = masterIds.length
      ? await admin
        .schema("licensing")
        .from("master_accounts")
        .select("id,email")
        .in("id", masterIds)
      : { data: [], error: null };
    if (mastersError) throw mastersError;

    const memberById = new Map(
      ((members || []) as MemberRow[]).map((member) => [member.id, member]),
    );
    const masterById = new Map(
      ((masters || []) as MasterRow[]).map((account) => [account.id, account]),
    );
    const deviceById = new Map(
      ((devices || []) as DeviceRow[]).map((device) => [device.id, device]),
    );

    const events = rows.map((row) => {
      const metadata = recordValue(row.metadata);
      const actor = row.actor_master_id
        ? masterIdentity(masterById.get(row.actor_master_id))
        : row.actor_member_id
          ? memberIdentity(memberById.get(row.actor_member_id))
          : null;
      const fallbackActor = metadataIdentity(
        metadata.actor || metadata.member,
        row.actor_master_id ? "master" : "member",
      );

      let target: JsonRecord | null = null;
      if (row.target_table === "members" && row.target_id) {
        target = memberIdentity(memberById.get(row.target_id));
        if (!target) {
          target = metadataIdentity(
            metadata.target || metadata.member || {
              email: metadata.targetEmail,
              id: row.target_id,
            },
            "member",
          );
        }
      } else if (row.target_table === "devices" && row.target_id) {
        const device = deviceById.get(row.target_id);
        const owner = device ? memberById.get(device.member_id) : undefined;
        target = {
          kind: "device",
          id: row.target_id,
          name: device?.device_label || null,
          email: owner?.email || null,
          role: owner?.role || null,
          status: device?.status || null,
          memberName: owner?.name || null,
        };
      } else if (row.target_table === "organizations") {
        target = {
          kind: "organization",
          id: row.target_id,
          name: "Arizona",
          email: null,
          role: null,
          status: organization.status,
        };
      }

      return {
        id: row.id,
        action: row.action,
        createdAt: row.created_at,
        actor: actor || fallbackActor,
        target,
        context: auditContext(metadata),
      };
    });

    const total = Number(count || 0);
    return jsonResponse({
      ok: true,
      events,
      pagination: {
        page,
        limit,
        total,
        hasMore: rangeEnd + 1 < total,
        nextPage: rangeEnd + 1 < total ? page + 1 : null,
      },
    });
  } catch (error) {
    console.error(error);
    const response = knownError(error);
    if (response) return response;
    return errorResponse("internal_error", "Unable to read the audit log.", 500);
  }
});
