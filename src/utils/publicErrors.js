const MAX_PUBLIC_MESSAGE_LENGTH = 320;

const TECHNICAL_TERMS = /\b(?:supabase|backend|edge function|database|banco de dados|webview|ipc|jwt|jws|receipt|access[_ ]?token|refresh[_ ]?token|stack trace|errno|os error|serde|aerender|afterfx|avlayer|footage|source text|precomp|marker|layer|slider|jump|codec|quicktime|cep|zxp|json)\b/i;
const TRANSPORT_DETAILS = /\b(?:https?:\/\/|http\s*[1-5]\d{2}|econn[a-z]+|error|exception|command|failed to|unable to|unknown|invalid|missing|required|unauthorized|forbidden|not found|cannot|could not|permission denied|access denied|timed out|line \d+ column \d+)\b/i;
const LOCAL_PATH = /(?:^|[\s"'])(?:[a-z]:[\\/]|\\\\|\/(?:users|home|var|tmp)\/)/i;
const TECHNICAL_SHAPE = /(?:\b[a-z]+_[a-z0-9_]+\b|[{}[\]]|::|=>)/i;

const COMMON_CODE_MESSAGES = Object.freeze({
  network_error:
    "Não foi possível acessar o serviço agora. Verifique sua conexão com a internet e tente novamente.",
  invalid_server_response:
    "O serviço respondeu de uma forma inesperada. Tente novamente em alguns instantes.",
  request_failed:
    "Não foi possível concluir a comunicação com o serviço. Tente novamente.",
});

export function publicErrorCode(error) {
  const explicit = String(error?.code || error?.errorCode || "").trim().toLowerCase();
  if (explicit) return explicit;

  const match = rawErrorMessage(error).match(/^([a-z0-9_]+):\s*/i);
  return String(match?.[1] || "").toLowerCase();
}

export function publicErrorMessage(error, fallback, { codeMessages = {} } = {}) {
  const safeFallback = String(fallback || "Não foi possível concluir esta ação.").trim();
  const code = publicErrorCode(error);
  const mapped = codeMessages[code] || COMMON_CODE_MESSAGES[code];
  if (mapped) return mapped;

  const candidate = rawErrorMessage(error).replace(/^([a-z0-9_]+):\s*/i, "").trim();
  return isHumanFriendlyPublicMessage(candidate) ? candidate : safeFallback;
}

export function isHumanFriendlyPublicMessage(message) {
  const value = String(message || "").trim();
  if (!value || value.length > MAX_PUBLIC_MESSAGE_LENGTH || /[\r\n]/.test(value)) return false;
  if (
    TECHNICAL_TERMS.test(value)
    || TRANSPORT_DETAILS.test(value)
    || LOCAL_PATH.test(value)
    || TECHNICAL_SHAPE.test(value)
  ) {
    return false;
  }
  return true;
}

function rawErrorMessage(error) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof error.message === "string") {
    return error.message;
  }
  return "";
}
