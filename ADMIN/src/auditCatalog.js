export const AUDIT_SOURCE_LABELS = Object.freeze({
  admin_web_panel: "Painel administrativo",
  master_license_panel: "Painel administrativo",
  tauri_admin_panel: "Gestão no Arizona App",
  tauri_passwordless_login: "Arizona App",
  tauri_passwordless_activation: "Arizona App",
  tauri_device_activation: "Ativação no Arizona App",
  tauri_settings: "Configurações do Arizona App",
  nsis_uninstall: "Desinstalador do Arizona",
  app_self_release: "Arizona App",
});

const ORGANIZATION_STATUS_LABELS = Object.freeze({
  active: "Ativa",
  paused: "Pausada",
  blocked: "Bloqueada",
  deleted: "Excluída",
});

export function auditIdentityName(identity) {
  if (!identity) return "";
  if (identity.kind === "organization") return identity.name || "Arizona";
  if (identity.kind === "device") {
    return identity.name || identity.memberName || identity.email || "Computador";
  }
  return identity.name || identity.email || (
    identity.kind === "master" ? "Administrador principal" : "Usuário"
  );
}

export function auditRoleLabel(role, kind) {
  if (kind === "device") return "Computador";
  if (kind === "organization") return "Organização";
  if (role === "master" || kind === "master") return "Administrador principal";
  if (role === "admin") return "Gestor";
  if (role === "user") return "Usuário";
  return "";
}

export function auditSourceLabel(source, action = "") {
  const knownSource = Object.hasOwn(AUDIT_SOURCE_LABELS, source)
    ? AUDIT_SOURCE_LABELS[source]
    : "";
  if (knownSource) return knownSource;
  if (
    action === "device.fingerprint_mismatch"
    || action === "access.clock_suspicious"
  ) return "Validação no Arizona App";
  if (Object.hasOwn(AUDIT_ACTION_DEFINITIONS, action)) return "Processo do Arizona";
  return "Sistema";
}

function clockSkewDuration(value) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value === 0) return "";

  const seconds = Math.abs(value);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;

  if (days) return `${days}d ${String(hours).padStart(2, "0")}h`;
  if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}min`;
  if (minutes) return `${minutes}min ${String(remainder).padStart(2, "0")}s`;
  return `${remainder}s`;
}

function clockSuspiciousDescription(event) {
  const base = "O acesso foi recusado porque o relógio deste computador estava fora de sincronia.";
  const skew = event.context?.clockSkewSeconds;
  const duration = clockSkewDuration(skew);
  if (!duration) return base;

  const direction = skew > 0 ? "adiantado" : "atrasado";
  return `${base} O relógio local estava aproximadamente ${duration} ${direction} em relação ao servidor.`;
}

function fingerprintMismatchDescription(event) {
  return ({
    empty: "O aplicativo não enviou a identificação deste computador.",
    unbound: "Este computador precisa ser reativado para confirmar sua identidade.",
    missing: "A identificação esperada deste computador não foi encontrada.",
    mismatch: "A identificação deste computador não corresponde ao vínculo registrado.",
  })[event.context?.outcome] || "A identidade deste computador não pôde ser confirmada.";
}

function organizationStatusDescription(event) {
  const previous = ORGANIZATION_STATUS_LABELS[event.context?.previousStatus];
  const current = ORGANIZATION_STATUS_LABELS[event.context?.status];
  return previous && current && previous !== current
    ? `Status alterado de ${previous} para ${current}.`
    : "O status operacional da organização foi alterado.";
}

export const AUDIT_ACTION_DEFINITIONS = Object.freeze({
  "access.clock_suspicious": {
    category: "access",
    tone: "danger",
    icon: "shield",
    label: "Acesso recusado por relógio incorreto",
    description: clockSuspiciousDescription,
  },
  "device.activated": {
    category: "devices",
    tone: "success",
    icon: "device",
    label: "Computador ativado",
    description: (event) => `${auditIdentityName(event.target) || "Um computador"} foi vinculado à conta.`,
  },
  "device.released": {
    category: "devices",
    tone: "warning",
    icon: "device",
    label: "Computador liberado",
    description: (event) => `${auditIdentityName(event.target) || "Um computador"} foi liberado por um responsável.`,
  },
  "device.self_released": {
    category: "devices",
    tone: "neutral",
    icon: "device",
    label: "Computador liberado pelo usuário",
    description: () => "O próprio usuário liberou o computador associado à sua conta.",
  },
  "device.self_release_rejected": {
    category: "security",
    tone: "warning",
    icon: "shield",
    label: "Liberação de computador recusada",
    description: (event) => (
      event.context?.reason === "install_id_mismatch"
        ? "Outra instalação tentou liberar este computador e a solicitação foi recusada."
        : "A solicitação para liberar este computador foi recusada."
    ),
  },
  "device.fingerprint_mismatch": {
    category: "security",
    tone: "danger",
    icon: "shield",
    label: "Identidade do computador recusada",
    description: fingerprintMismatchDescription,
  },
  "activation_code.generated": {
    category: "access",
    tone: "primary",
    icon: "key",
    label: "Código gerado",
    description: (event) => (
      event.context?.purpose === "recovery"
        ? "Código de recuperação emitido para o usuário."
        : "Código de ativação emitido para o usuário."
    ),
  },
  "member.activation_code_consumed": {
    category: "access",
    tone: "success",
    icon: "key",
    label: "Ativação concluída",
    description: () => "O usuário confirmou o código e concluiu a ativação.",
  },
  "member.recovery_code_consumed": {
    category: "access",
    tone: "success",
    icon: "key",
    label: "Recuperação concluída",
    description: () => "O usuário confirmou o código e recuperou seu acesso.",
  },
  "member.added": {
    category: "members",
    tone: "success",
    icon: "user",
    label: "Usuário adicionado",
    description: () => "Uma nova pessoa foi incluída na licença.",
  },
  "member.restored": {
    category: "members",
    tone: "success",
    icon: "user",
    label: "Usuário restaurado",
    description: () => "Um cadastro anteriormente revogado foi restaurado.",
  },
  "member.updated": {
    category: "members",
    tone: "primary",
    icon: "user",
    label: "Usuário atualizado",
    description: (event) => {
      const previous = auditRoleLabel(event.context?.previousRole);
      const current = auditRoleLabel(event.context?.currentRole);
      return previous && current && previous !== current
        ? `Perfil alterado de ${previous} para ${current}.`
        : "Nome, perfil ou status do usuário foi atualizado.";
    },
  },
  "member.revoked": {
    category: "members",
    tone: "danger",
    icon: "user",
    label: "Usuário removido",
    description: () => "O acesso do usuário foi revogado.",
  },
  "member.totp_reset": {
    category: "security",
    tone: "warning",
    icon: "shield",
    label: "Autenticador redefinido",
    description: () => "O aplicativo autenticador e as sessões vinculadas foram redefinidos pelo administrador principal.",
  },
  "member.rate_limits_reset": {
    category: "security",
    tone: "warning",
    icon: "shield",
    label: "Limites reiniciados",
    description: (event) => {
      const count = Number(event.context?.deletedEvents || 0);
      return count > 0
        ? `${count} ${count === 1 ? "evento foi removido" : "eventos foram removidos"} dos contadores.`
        : "Os contadores individuais de acesso foram reiniciados.";
    },
  },
  "license.created": {
    category: "license",
    tone: "success",
    icon: "license",
    label: "Licença criada",
    description: () => "A licença da organização foi criada.",
  },
  "license.updated": {
    category: "license",
    tone: "primary",
    icon: "license",
    label: "Licença atualizada",
    description: () => "Configurações, validade ou políticas da licença foram atualizadas.",
  },
  "license.seats_changed": {
    category: "license",
    tone: "primary",
    icon: "license",
    label: "Vagas alteradas",
    description: (event) => {
      const previous = event.context?.previousSeatsAllowed;
      const current = event.context?.seatsAllowed;
      return Number.isFinite(Number(previous)) && Number.isFinite(Number(current))
        ? `Quantidade de vagas alterada de ${previous} para ${current}.`
        : "A capacidade de usuários da licença foi alterada.";
    },
  },
  "organization.status_changed": {
    category: "license",
    tone: "warning",
    icon: "license",
    label: "Status da organização alterado",
    description: organizationStatusDescription,
  },
});

export function safeAuditActionCode(value) {
  const code = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._:-]+/g, "_")
    .slice(0, 128);
  return code || "desconhecida";
}

export function auditActionInfo(action) {
  return (Object.hasOwn(AUDIT_ACTION_DEFINITIONS, action) && AUDIT_ACTION_DEFINITIONS[action]) || {
    category: "security",
    tone: "neutral",
    icon: "history",
    label: "Ação não catalogada",
    description: () => `Código: ${safeAuditActionCode(action)}.`,
  };
}
