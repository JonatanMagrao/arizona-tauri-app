export const AUTH_MODES = Object.freeze({
  ACTIVATION: "activation",
  TOTP: "totp",
  ENROLLMENT: "enrollment",
});

export const DEFAULT_RATE_LIMIT_RETRY_SECONDS = 60;

const RATE_LIMIT_CODES = new Set([
  "rate_limited",
  "over_request_rate_limit",
  "over_mfa_requests_rate_limit",
]);

const RETRY_BLOCK_CODES = new Set([
  ...RATE_LIMIT_CODES,
  "device_cooldown",
]);

const INVALID_TOTP_CODES = new Set([
  "invalid_totp",
  "mfa_verification_failed",
  "mfa_challenge_expired",
  "challenge_expired",
]);

export function acquireSubmission(lockRef) {
  if (!lockRef || lockRef.current) return false;
  lockRef.current = true;
  return true;
}

export function releaseSubmission(lockRef) {
  if (lockRef) lockRef.current = false;
}

export function authRetryState(flow) {
  const code = String(flow?.code || "").trim().toLowerCase();
  const isRateLimited = RATE_LIMIT_CODES.has(code);
  const isRetryBlocked = RETRY_BLOCK_CODES.has(code);
  const suppliedSeconds = positiveSeconds(
    flow?.retryAfterSeconds ?? flow?.retry_after_seconds,
  );
  const retryAfterSeconds = suppliedSeconds
    || (isRateLimited ? DEFAULT_RATE_LIMIT_RETRY_SECONDS : 0);

  return {
    code,
    isRateLimited,
    isRetryBlocked,
    retryAfterSeconds,
  };
}

export function authFlowInstruction(state) {
  if (state === "totp_enrollment_required") {
    return "Este QR Code cria uma nova entrada. Escaneie-o antes de informar o código; não use uma entrada antiga.";
  }
  if (state === "totp_required") {
    return "Use o código atual da entrada Arizona App já cadastrada no seu autenticador.";
  }
  return "";
}

export function authFlowErrorMessage(flow, mode) {
  const code = String(flow?.code || "").trim().toLowerCase();
  if (RATE_LIMIT_CODES.has(code)) {
    return "Muitas tentativas. Aguarde o tempo indicado antes de tentar novamente.";
  }
  if (INVALID_TOTP_CODES.has(code)) {
    if (mode === AUTH_MODES.ENROLLMENT) {
      return "Código inválido ou expirado. Escaneie o QR Code acima e use o código da nova entrada; a entrada antiga não funciona nesta recuperação.";
    }
    return "Código inválido ou expirado. Use o código atual da entrada Arizona App já cadastrada.";
  }
  return String(flow?.message || "").trim() || "Não foi possível confirmar o acesso.";
}

export function shouldResetTotp(flow) {
  const code = String(flow?.code || "").trim().toLowerCase();
  return INVALID_TOTP_CODES.has(code) || RATE_LIMIT_CODES.has(code);
}

function positiveSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.ceil(seconds);
}
