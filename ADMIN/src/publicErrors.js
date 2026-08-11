const TECHNICAL_TERMS = /\b(?:supabase|backend|edge function|database|banco de dados|http|jwt|token|publishable|api|stack trace|errno|econn[a-z]+|seat|device|totp)\b/i;
const LOCAL_PATH = /(?:^|[\s"'])(?:[a-z]:[\\/]|\\\\|\/(?:users|home|var|tmp)\/)/i;
const TECHNICAL_SHAPE = /(?:\b[a-z]+_[a-z0-9_]+\b|[{}[\]]|::|=>)/i;

export function adminPublicErrorMessage(error) {
  const code = String(error?.code || "").trim().toLowerCase();
  const message = typeof error === "string"
    ? error.trim()
    : typeof error?.message === "string"
      ? error.message.trim()
      : "";
  const retryAfterSeconds = Number(error?.retryAfterSeconds || 0);

  const messages = {
    invalid_credentials: "E-mail ou senha inválidos.",
    email_not_confirmed: "Confirme seu e-mail antes de entrar.",
    forbidden: "Você não tem permissão para acessar este painel.",
    invalid_publishable_key:
      "O painel não conseguiu iniciar corretamente. Contate o suporte.",
    invalid_user_token: "Sua sessão expirou. Entre novamente com sua conta Google.",
    admin_google_oauth_required: "Entre novamente com sua conta Google.",
    admin_session_expired: "Sua sessão administrativa expirou. Entre novamente.",
    organization_not_active:
      "A licença está suspensa. Reative-a antes de tentar esta ação novamente.",
    organization_not_found: "Esta licença ainda não foi cadastrada.",
    invalid_status: "Escolha uma situação válida para a licença.",
    bad_code_verifier: "O acesso com Google expirou. Inicie a entrada novamente.",
    flow_state_not_found: "O acesso com Google expirou. Inicie a entrada novamente.",
    function_config_error:
      "O serviço de licenças não está disponível. Tente novamente mais tarde ou contate o suporte.",
    function_permission_error:
      "O serviço de licenças não conseguiu salvar a alteração. Contate o suporte.",
    seat_limit_exceeded: "Não há vagas disponíveis nesta licença.",
    seats_below_existing_members:
      "A quantidade de vagas não pode ser menor que o número de usuários cadastrados.",
    too_many_users: "A quantidade de usuários ultrapassa as vagas disponíveis.",
    organization_already_exists: "Esta licença já está cadastrada.",
    missing_user_name: "Informe o nome do usuário.",
    invalid_user_email: "Informe um e-mail de usuário válido.",
    missing_admin_name: "Informe o nome do usuário.",
    invalid_admin_email: "Informe um e-mail de usuário válido.",
    invalid_license_expires_on: "Informe uma data limite válida.",
    invalid_daily_auth_reset_hour: "Escolha um horário válido para a renovação diária.",
    invalid_access_policy: "Revise os limites e intervalos definidos para o acesso.",
    license_expired: "A licença expirou.",
    device_limit_reached:
      "Este usuário já está ativo em outro computador. Libere o computador atual antes de cadastrar outro.",
    device_not_active:
      "Este computador não está autorizado. Libere-o ou cadastre um novo computador.",
    member_not_found: "Usuário não encontrado.",
    protected_identity:
      "O administrador principal não pode ser alterado por esta ação.",
    invalid_allowed_email_domain: "Informe um domínio de e-mail válido.",
    admin_email_domain_not_allowed: "O e-mail do usuário precisa usar arizona.global.",
    email_domain_not_allowed: "O e-mail está fora do domínio permitido.",
  };

  if (code === "rate_limited") {
    return retryAfterSeconds > 0
      ? `Muitas tentativas. Tente novamente em ${formatPublicDuration(retryAfterSeconds)}.`
      : "Muitas tentativas. Aguarde antes de tentar novamente.";
  }
  if (code === "device_switch_interval") {
    return retryAfterSeconds > 0
      ? `Este computador poderá ser liberado em ${formatPublicDuration(retryAfterSeconds)}.`
      : "Este computador ainda não completou o intervalo mínimo entre trocas.";
  }
  if (messages[code]) return messages[code];

  const normalizedMessage = message.toLowerCase();
  if (normalizedMessage.includes("invalid login credentials")) {
    return "E-mail ou senha inválidos.";
  }
  if (normalizedMessage.includes("email not confirmed")) {
    return "Confirme seu e-mail antes de entrar.";
  }
  if (/failed to fetch|network(?: request)? failed|network error/i.test(message)) {
    return "Não foi possível acessar o serviço. Verifique sua conexão com a internet e tente novamente.";
  }

  const looksTechnical =
    !message ||
    message.length > 320 ||
    /[\r\n]/.test(message) ||
    /^\d{3}$/.test(code) ||
    TECHNICAL_TERMS.test(message) ||
    LOCAL_PATH.test(message) ||
    TECHNICAL_SHAPE.test(message) ||
    /\b(?:error|exception|command|unknown|internal server error|bad gateway|service unavailable|unauthorized|permission denied|access denied|not found|failed to|unable to|invalid|missing|required|cannot|could not)\b/i.test(message);

  return looksTechnical ? "Não foi possível concluir esta ação. Tente novamente." : message;
}

function formatPublicDuration(totalSeconds) {
  const seconds = Math.max(0, Math.ceil(Number(totalSeconds) || 0));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (days) return `${days}d ${Math.floor((seconds % 86400) / 3600)}h`;
  if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}min`;
  if (minutes) return `${minutes}min ${String(remainder).padStart(2, "0")}s`;
  return `${remainder}s`;
}
