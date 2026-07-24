import { commandNames, invokeCommand } from "./tauriCommands";

export async function listAdminMembers() {
  return invokeAdmin(commandNames.adminListMembers);
}

export async function addAdminMember(_auth, member) {
  return invokeAdmin(commandNames.adminAddMember, {
    name: member.name,
    email: member.email,
  });
}

export async function releaseAdminDevice(_auth, memberId) {
  return invokeAdmin(commandNames.adminReleaseDevice, { memberId });
}

export async function removeAdminMember(_auth, memberId) {
  return invokeAdmin(commandNames.adminRemoveMember, { memberId });
}

export async function generateActivationCode(_auth, memberId) {
  return invokeAdmin(commandNames.adminGenerateActivationCode, { memberId });
}

export async function releaseCurrentDevice() {
  return invokeAdmin(commandNames.releaseCurrentDevice);
}

export function adminErrorMessage(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || error || "");

  if (code === "forbidden") return "Acesso não autorizado.";
  if (code === "invalid_user_token") return "Sessão expirada. Entre novamente.";
  if (code === "daily_mfa_required") return "Confirme o autenticador para continuar.";
  if (code === "organization_not_active") return "Licença inativa.";
  if (code === "license_expired") return "Licença expirada.";
  if (code === "seat_limit_exceeded") return "Não há vagas disponíveis.";
  if (code === "member_already_exists") return "Este e-mail já está cadastrado.";
  if (code === "email_domain_not_allowed") return "E-mail fora do domínio permitido.";
  if (code === "protected_identity") return "Esta identidade só pode ser gerenciada pelo master.";
  if (code === "member_not_found") return "Usuário não encontrado.";
  if (code === "invalid_email") return "Informe um e-mail válido.";
  if (code === "missing_name") return "Informe o nome do usuário.";
  if (code === "rate_limited") return "Limite de tentativas atingido. Aguarde.";
  if (code === "device_switch_interval") {
    return message || "Esta máquina ainda não completou o intervalo mínimo entre trocas.";
  }
  if (code === "network_error" || message.includes("network_error")) {
    return "Não foi possível conectar ao Supabase.";
  }
  return message || "Operação não concluída.";
}

async function invokeAdmin(command, args = {}) {
  try {
    return await invokeCommand(command, args);
  } catch (error) {
    const text = String(error || "");
    const match = text.match(/^([a-z0-9_]+):\s*(.*)$/i);
    const nextError = new Error(match?.[2] || text || "Operação não concluída.");
    nextError.code = match?.[1] || "";
    throw nextError;
  }
}
