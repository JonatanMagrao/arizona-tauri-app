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
import {
  ACCESS_POLICY_SELECT,
  accessPolicy,
} from "../_shared/access-policy.ts";
import { licenseExpiryInstant } from "../_shared/auth-cycle.ts";
import { isAtOrAfterSecond } from "../_shared/auth-assurance.ts";
import { hasDeviceBindGrant } from "../_shared/device-bind-grant.ts";
import {
  fingerprintDecision,
  fingerprintPrefix,
  normalizeFingerprint,
} from "../_shared/device-fingerprint.ts";
import {
  enforceRateLimit,
  rateLimitResponse,
  requestIp,
  signedInAt,
} from "../_shared/security.ts";

type ActivateDeviceBody = {
  installId?: unknown;
  appVersion?: unknown;
  deviceLabel?: unknown;
  deviceFingerprintHash?: unknown;
};

function cleanString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  const methodError = requirePost(req);
  if (methodError) return methodError;

  try {
    requirePublishableKey(req);
    const body = await readJsonBody<ActivateDeviceBody>(req);
    const installId = cleanString(body.installId, 128);
    if (!installId) return errorResponse("missing_install_id", "installId is required.", 400);

    const admin = createAdminClient();
    const user = await getAuthUser(req);
    const member = await resolveMember(admin, user);
    if (!member) return errorResponse("member_not_authorized", "Access denied.", 403);

    const { data: grantState, error: grantStateError } = await admin
      .schema("licensing")
      .from("members")
      .select(
        "device_recovery_mfa_not_before,device_recovery_expires_at,device_bind_not_before,device_bind_expires_at",
      )
      .eq("id", member.id)
      .maybeSingle();
    if (grantStateError) throw grantStateError;

    const { data: organization, error: organizationError } = await admin
      .schema("licensing")
      .from("organizations")
      .select(`id,status,license_expires_on,daily_auth_reset_hour,${ACCESS_POLICY_SELECT}`)
      .eq("id", member.organizationId)
      .maybeSingle();
    if (organizationError) throw organizationError;
    if (!organization || organization.status !== "active") {
      return errorResponse("organization_not_active", "Organization is not active.", 403);
    }
    const licenseExpiresAt = licenseExpiryInstant(
      organization.license_expires_on,
      organization.daily_auth_reset_hour,
    );
    if (licenseExpiresAt && licenseExpiresAt.getTime() < Date.now()) {
      return errorResponse("license_expired", "License has expired.", 403);
    }

    // Metered before the gates so a rejected caller cannot hammer the endpoint,
    // and separately from the bind budget below, which only successful writes
    // spend — a rejected attempt must never exhaust the six tries the
    // legitimate remedy needs.
    const policy = accessPolicy(organization);
    const activationWindowSeconds = policy.activationAttemptWindowMinutes * 60;
    await enforceRateLimit(admin, "device.activate.ip", requestIp(req), 20, activationWindowSeconds);
    await enforceRateLimit(
      admin,
      "device.activate.member.attempt",
      member.id,
      60,
      activationWindowSeconds,
    );

    const nowDate = new Date();
    const recoveryNotBefore = parseDate(grantState?.device_recovery_mfa_not_before);
    const recoveryExpiresAt = parseDate(grantState?.device_recovery_expires_at);
    const hasRecoveryGrant = Boolean(
      recoveryNotBefore
      && recoveryExpiresAt
      && recoveryExpiresAt.getTime() > nowDate.getTime(),
    );
    const sessionSignedInAt = signedInAt(req);
    if (hasRecoveryGrant) {
      // The recovery activation code creates a fresh session; any session that
      // predates the recovery window cannot consume the grant.
      if (
        !sessionSignedInAt
        || !isAtOrAfterSecond(sessionSignedInAt, recoveryNotBefore!)
      ) {
        return errorResponse(
          "device_revoked",
          "This session predates the recovery window. Activate again with a new code.",
          403,
        );
      }
    }

    // Binding hardware always starts with an activation code, which is the only
    // thing that issues this grant. Nothing about the session itself is trusted:
    // a copied credential can mint fresh AMR claims, it cannot mint a grant.
    const canBindDevice = hasDeviceBindGrant(
      grantState?.device_bind_not_before,
      grantState?.device_bind_expires_at,
      sessionSignedInAt,
      nowDate,
    );

    const { data: sameInstall, error: sameInstallError } = await admin
      .schema("licensing")
      .from("devices")
      .select("id,status,revoked_at,revoked_reason,device_fingerprint_hash")
      .eq("member_id", member.id)
      .eq("install_id", installId)
      .maybeSingle();
    if (sameInstallError) throw sameInstallError;

    // A consumed activation code is the authority that brings a released
    // installation back, so the bind grant counts here just like recovery does.
    if (
      sameInstall
      && sameInstall.status !== "active"
      && !hasRecoveryGrant
      && !canBindDevice
    ) {
      return errorResponse(
        "device_revoked",
        "This installation was released and cannot reactivate itself.",
        403,
      );
    }

    const { data: activeDevice, error: activeDeviceError } = await admin
      .schema("licensing")
      .from("devices")
      .select("id,install_id")
      .eq("member_id", member.id)
      .eq("status", "active")
      .maybeSingle();
    if (activeDeviceError) throw activeDeviceError;
    if (activeDevice && activeDevice.install_id !== installId) {
      return errorResponse("device_limit_reached", "Another device is already active.", 409);
    }

    if (!sameInstall && !canBindDevice) {
      return errorResponse(
        "device_activation_expired",
        "This session did not come from an activation code. Activate again with a new code.",
        403,
      );
    }

    const incomingFingerprint = normalizeFingerprint(body.deviceFingerprintHash);
    // Binding writes hardware identity and validate-license refuses any device
    // that cannot present one, so consuming the grant for an unidentifiable
    // machine would burn the code for nothing. Checked before the grant is
    // spent and before any write, so the same code survives for a retry.
    if (canBindDevice && !incomingFingerprint) {
      return errorResponse(
        "device_identity_required",
        "This machine could not be identified.",
        403,
      );
    }
    const fingerprint = fingerprintDecision(
      sameInstall?.device_fingerprint_hash,
      incomingFingerprint,
    );
    if (
      (fingerprint.outcome === "mismatch" || fingerprint.outcome === "missing")
      && !canBindDevice
    ) {
      await admin
        .schema("licensing")
        .from("audit_log")
        .insert({
          organization_id: member.organizationId,
          actor_member_id: member.id,
          action: "device.fingerprint_mismatch",
          target_table: "devices",
          target_id: sameInstall!.id,
          metadata: {
            source: "tauri_device_activation",
            outcome: fingerprint.outcome,
            installId,
            storedPrefix: fingerprintPrefix(fingerprint.stored),
            incomingPrefix: fingerprint.outcome === "mismatch"
              ? fingerprintPrefix(fingerprint.incoming)
              : "",
          },
        });
      return errorResponse(
        "device_not_active",
        "Device identity mismatch.",
        403,
      );
    }

    await enforceRateLimit(admin, "device.activate.member", member.id, 6, activationWindowSeconds);

    const now = new Date().toISOString();
    // Only a consumed activation code may write hardware identity. Trusting
    // whatever the first caller sends would let a copied credential claim the
    // machine and lock the owner out. Binding always stores a non-empty value:
    // an unidentifiable machine was rejected above, before the grant was spent.
    const fingerprintColumn = canBindDevice
      ? { device_fingerprint_hash: incomingFingerprint }
      : {};
    const payload = {
      organization_id: member.organizationId,
      member_id: member.id,
      install_id: installId,
      ...fingerprintColumn,
      device_label: cleanString(body.deviceLabel, 128) || null,
      app_version: cleanString(body.appVersion, 64) || null,
      status: "active",
      revoked_at: null,
      revoked_reason: null,
      last_seen_at: now,
      updated_at: now,
      ...(!sameInstall || sameInstall.status !== "active" ? { activated_at: now } : {}),
    };

    // Spend the grant before the write, conditionally on the expiry that was
    // read: whoever clears it first owns the binding, so one code can authorize
    // exactly one. It is restored below if the write itself fails, otherwise a
    // transient error would cost the user a code.
    if (canBindDevice) {
      const { data: spentGrant, error: spendGrantError } = await admin
        .schema("licensing")
        .from("members")
        .update({
          device_bind_not_before: null,
          device_bind_expires_at: null,
          updated_at: now,
        })
        .eq("id", member.id)
        .eq("device_bind_expires_at", grantState!.device_bind_expires_at)
        .select("id")
        .maybeSingle();
      if (spendGrantError) throw spendGrantError;
      if (!spentGrant) {
        return errorResponse(
          "device_activation_expired",
          "This activation was already used to register a machine.",
          403,
        );
      }
    }

    const restoreBindGrant = async () => {
      if (!canBindDevice) return;
      const { error: restoreError } = await admin
        .schema("licensing")
        .from("members")
        .update({
          device_bind_not_before: grantState!.device_bind_not_before,
          device_bind_expires_at: grantState!.device_bind_expires_at,
          updated_at: new Date().toISOString(),
        })
        .eq("id", member.id)
        .is("device_bind_expires_at", null);
      if (restoreError) {
        // The user just lost an activation code to a failure that was not
        // theirs; without this line nothing distinguishes it from a code that
        // was legitimately spent.
        console.error("device bind grant restore failed", {
          memberId: member.id,
          installId,
          message: restoreError.message,
        });
      }
    };

    const deviceResult = sameInstall
      ? await admin
        .schema("licensing")
        .from("devices")
        .update(payload)
        .eq("id", sameInstall.id)
        .eq("status", sameInstall.status)
        .select("id,status")
        .maybeSingle()
      : await admin
        .schema("licensing")
        .from("devices")
        .insert(payload)
        .select("id,status")
        .single();
    if (deviceResult.error) {
      await restoreBindGrant();
      if (String(deviceResult.error.message).includes("devices_one_active_per_member_uidx")) {
        return errorResponse("device_limit_reached", "Another device is already active.", 409);
      }
      throw deviceResult.error;
    }
    if (!deviceResult.data) {
      // The guarded update matched nothing because the row moved underneath it.
      // Report the terminal state instead of failing as an internal error.
      const { data: currentDevice, error: currentDeviceError } = await admin
        .schema("licensing")
        .from("devices")
        .select("status")
        .eq("id", sameInstall!.id)
        .maybeSingle();
      if (currentDeviceError) throw currentDeviceError;
      if (!currentDevice || currentDevice.status !== "active") {
        // The seat was released while this call ran. Restoring the grant here
        // would hand the released installation its seat straight back, so it
        // stays spent: only a code consumed after the release may rebind.
        return errorResponse(
          "device_revoked",
          "This installation was released and cannot reactivate itself.",
          403,
        );
      }
      await restoreBindGrant();
      return errorResponse("device_limit_reached", "Another device is already active.", 409);
    }

    if (hasRecoveryGrant) {
      const { error: clearRecoveryError } = await admin
        .schema("licensing")
        .from("members")
        .update({
          device_recovery_mfa_not_before: null,
          device_recovery_expires_at: null,
          updated_at: now,
        })
        .eq("id", member.id)
        .eq("device_recovery_expires_at", grantState!.device_recovery_expires_at);
      if (clearRecoveryError) throw clearRecoveryError;
    }

    await admin
      .schema("licensing")
      .from("audit_log")
      .insert({
        organization_id: member.organizationId,
        actor_member_id: member.id,
        action: "device.activated",
        target_table: "devices",
        target_id: deviceResult.data.id,
        metadata: {
          source: "tauri_passwordless_login",
          installId,
        },
      });

    return jsonResponse({
      ok: true,
      device: {
        id: deviceResult.data.id,
        installId,
        status: deviceResult.data.status,
      },
    });
  } catch (error) {
    console.error(error);
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    const message = String((error as { message?: unknown })?.message || error || "");
    if (message === "invalid_user_token" || message === "missing_bearer_token") {
      return errorResponse("invalid_user_token", "Session is invalid.", 401);
    }
    return errorResponse("internal_error", "Unable to activate the device.", 500);
  }
});
