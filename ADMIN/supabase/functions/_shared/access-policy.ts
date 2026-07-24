export const ACCESS_POLICY_SELECT = [
  "activation_code_ttl_minutes",
  "activation_attempt_limit",
  "activation_attempt_window_minutes",
  "activation_generation_limit",
  "activation_generation_window_minutes",
  "device_release_limit",
  "device_release_window_minutes",
  "device_switch_interval_days",
  "device_switch_cooldown_days",
  "device_switch_cooldown_minutes",
  "device_recovery_window_minutes",
].join(",");

export type AccessPolicy = {
  activationCodeTtlMinutes: number;
  activationAttemptLimit: number;
  activationAttemptWindowMinutes: number;
  activationGenerationLimit: number;
  activationGenerationWindowMinutes: number;
  deviceReleaseLimit: number;
  deviceReleaseWindowMinutes: number;
  deviceSwitchIntervalDays: number;
  deviceRecoveryWindowMinutes: number;
};

export const DEFAULT_ACCESS_POLICY: AccessPolicy = Object.freeze({
  activationCodeTtlMinutes: 15,
  activationAttemptLimit: 8,
  activationAttemptWindowMinutes: 60,
  activationGenerationLimit: 3,
  activationGenerationWindowMinutes: 60,
  deviceReleaseLimit: 10,
  deviceReleaseWindowMinutes: 60,
  deviceSwitchIntervalDays: 7,
  deviceRecoveryWindowMinutes: 15,
});

type PolicyRow = Record<string, unknown> | null | undefined;

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

export function accessPolicy(row: PolicyRow): AccessPolicy {
  return {
    activationCodeTtlMinutes: boundedInteger(
      row?.activation_code_ttl_minutes,
      DEFAULT_ACCESS_POLICY.activationCodeTtlMinutes,
      5,
      60,
    ),
    activationAttemptLimit: boundedInteger(
      row?.activation_attempt_limit,
      DEFAULT_ACCESS_POLICY.activationAttemptLimit,
      1,
      100,
    ),
    activationAttemptWindowMinutes: boundedInteger(
      row?.activation_attempt_window_minutes,
      DEFAULT_ACCESS_POLICY.activationAttemptWindowMinutes,
      1,
      1440,
    ),
    activationGenerationLimit: boundedInteger(
      row?.activation_generation_limit,
      DEFAULT_ACCESS_POLICY.activationGenerationLimit,
      1,
      50,
    ),
    activationGenerationWindowMinutes: boundedInteger(
      row?.activation_generation_window_minutes,
      DEFAULT_ACCESS_POLICY.activationGenerationWindowMinutes,
      1,
      1440,
    ),
    deviceReleaseLimit: boundedInteger(
      row?.device_release_limit,
      DEFAULT_ACCESS_POLICY.deviceReleaseLimit,
      1,
      100,
    ),
    deviceReleaseWindowMinutes: boundedInteger(
      row?.device_release_window_minutes,
      DEFAULT_ACCESS_POLICY.deviceReleaseWindowMinutes,
      1,
      1440,
    ),
    deviceSwitchIntervalDays: boundedInteger(
      row?.device_switch_interval_days,
      boundedInteger(
        row?.device_switch_cooldown_days,
        boundedInteger(
          Math.ceil(Number(row?.device_switch_cooldown_minutes || 0) / 1440),
          DEFAULT_ACCESS_POLICY.deviceSwitchIntervalDays,
          0,
          365,
        ),
        0,
        365,
      ),
      0,
      365,
    ),
    deviceRecoveryWindowMinutes: boundedInteger(
      row?.device_recovery_window_minutes,
      DEFAULT_ACCESS_POLICY.deviceRecoveryWindowMinutes,
      5,
      60,
    ),
  };
}

export function accessPolicyColumns(policy: AccessPolicy): Record<string, number> {
  return {
    activation_code_ttl_minutes: policy.activationCodeTtlMinutes,
    activation_attempt_limit: policy.activationAttemptLimit,
    activation_attempt_window_minutes: policy.activationAttemptWindowMinutes,
    activation_generation_limit: policy.activationGenerationLimit,
    activation_generation_window_minutes: policy.activationGenerationWindowMinutes,
    device_release_limit: policy.deviceReleaseLimit,
    device_release_window_minutes: policy.deviceReleaseWindowMinutes,
    device_switch_interval_days: policy.deviceSwitchIntervalDays,
    device_recovery_window_minutes: policy.deviceRecoveryWindowMinutes,
  };
}
