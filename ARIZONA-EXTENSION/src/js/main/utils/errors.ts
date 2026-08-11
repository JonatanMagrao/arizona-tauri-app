export const getMessage = (caught: unknown) => {
  if (caught instanceof Error) return caught.message;
  if (typeof caught === "string") return caught;
  if (
    caught &&
    typeof caught === "object" &&
    "message" in caught &&
    typeof caught.message === "string"
  ) {
    return caught.message;
  }

  return "Erro inesperado.";
};

const TECHNICAL_TERMS = /\b(?:supabase|backend|edge function|database|banco de dados|webview|ipc|jwt|jws|receipt|access[_ ]?token|refresh[_ ]?token|stack trace|errno|os error|aerender|afterfx|avlayer|footage|source(?: text)?|precomp|marker|layer|slider|jump|codec|quicktime|cep|zxp|json|node|evalscript|extendscript|canvas|zip|path|processo do sistema)\b/i;
const TRANSPORT_DETAILS = /\b(?:https?:\/\/|http\s*[1-5]\d{2}|econn[a-z]+|error|exception|command|failed to|unable to|unknown|invalid|missing|required|unauthorized|forbidden|not found|cannot|could not|permission denied|access denied|timed out|line \d+ column \d+|encerrou com c[oó]digo)\b/i;
const LOCAL_PATH = /(?:^|[\s"'])(?:[a-z]:[\\/]|\\\\|\/(?:users|home|var|tmp)\/)/i;
const TECHNICAL_SHAPE = /(?:\b[a-z]+_[a-z0-9_]+\b|[{}[\]]|::|=>)/i;

export const getPublicErrorMessage = (
  caught: unknown,
  fallback = "Não foi possível concluir esta ação."
) => {
  const message = getMessage(caught).trim();
  if (
    !message ||
    message === "Erro inesperado." ||
    message.length > 320 ||
    /[\r\n]/.test(message) ||
    TECHNICAL_TERMS.test(message) ||
    TRANSPORT_DETAILS.test(message) ||
    LOCAL_PATH.test(message) ||
    TECHNICAL_SHAPE.test(message)
  ) {
    return fallback;
  }

  return message;
};
