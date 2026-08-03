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
import { parseSwitchableOrganizationStatus } from "../_shared/organization-status.ts";
import {
  adminGoogleOAuthNotBefore,
  enforceRateLimit,
  rateLimitResponse,
  requireRecentGoogleOAuth,
} from "../_shared/security.ts";

type SetOrganizationStatusBody = {
  status?: unknown;
};

const ARIZONA_ORGANIZATION_SLUG = "arizona";

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

    const body = await readJsonBody<SetOrganizationStatusBody>(req);
    const status = parseSwitchableOrganizationStatus(body.status);
    if (!status) {
      return errorResponse("invalid_status", 'status must be "active" or "paused".', 400);
    }

    const admin = createAdminClient();
    const user = await getAuthUser(req);
    const master = await resolveMaster(admin, user);
    if (!master) {
      return errorResponse("forbidden", "Only a master can change the organization status.", 403);
    }

    requireRecentGoogleOAuth(
      req,
      adminGoogleOAuthNotBefore(),
      user.providers,
    );
    await enforceRateLimit(admin, "master.set_organization_status.actor", master.id, 60, 3600);

    const { data: organization, error: organizationError } = await admin
      .schema("licensing")
      .from("organizations")
      .select("id,status")
      .eq("slug", ARIZONA_ORGANIZATION_SLUG)
      .maybeSingle();
    if (organizationError) throw organizationError;
    if (!organization) {
      return errorResponse("organization_not_found", "Organization was not found.", 404);
    }

    if (organization.status === status) {
      return jsonResponse({ ok: true, status });
    }

    const now = new Date().toISOString();
    const { data: updatedOrganization, error: updateError } = await admin
      .schema("licensing")
      .from("organizations")
      .update({
        status,
        updated_at: now,
      })
      .eq("id", organization.id)
      .select("id,status")
      .single();
    if (updateError) throw updateError;

    await admin
      .schema("licensing")
      .from("audit_log")
      .insert({
        organization_id: organization.id,
        actor_master_id: master.id,
        action: "organization.status_changed",
        target_table: "organizations",
        target_id: organization.id,
        metadata: {
          source: "admin_web_panel",
          actor: {
            kind: "master",
            id: master.id,
            email: master.email,
            role: "master",
          },
          previousStatus: organization.status,
          status: updatedOrganization.status,
        },
      });

    return jsonResponse({ ok: true, status: updatedOrganization.status });
  } catch (error) {
    console.error(error);
    const response = knownError(error);
    if (response) return response;
    return errorResponse("internal_error", "Unable to change the organization status.", 500);
  }
});
