import { supabaseConfig } from "../config/supabase";

export async function listAdminMembers(auth) {
  return functionRequest(auth, "admin-list-members", {
    organizationId: auth?.organizationId,
  });
}

export async function addAdminMember(auth, member) {
  return functionRequest(auth, "admin-add-member", {
    organizationId: auth?.organizationId,
    name: member.name,
    email: member.email,
    role: "user",
  });
}

export async function releaseAdminDevice(auth, memberId) {
  return functionRequest(auth, "admin-release-device", {
    organizationId: auth?.organizationId,
    memberId,
  });
}

export async function releaseCurrentDevice(auth) {
  return releaseAdminDevice(auth, auth?.currentMemberId || auth?.memberId);
}

export async function removeAdminMember(auth, memberId) {
  return functionRequest(auth, "admin-remove-member", {
    organizationId: auth?.organizationId,
    memberId,
  });
}

export function adminErrorMessage(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");

  if (code === "forbidden") return "Acesso não autorizado.";
  if (code === "invalid_user_token") return "Sessão expirada. Entre novamente.";
  if (code === "missing_organization_id") return "Organização não encontrada na sessão.";
  if (code === "organization_not_active") return "Licença inativa.";
  if (code === "license_expired") return "Licença expirada.";
  if (code === "seat_limit_exceeded") return "Não há vagas disponíveis.";
  if (code === "member_already_exists") return "Este e-mail já está cadastrado.";
  if (code === "email_domain_not_allowed") return "E-mail fora do domínio permitido.";
  if (code === "member_not_found") return "Usuário não encontrado.";
  if (code === "invalid_email") return "Informe um e-mail válido.";
  if (code === "missing_name") return "Informe o nome do usuário.";
  if (code === "network_error") return "Não foi possível conectar ao Supabase.";

  return message || "Operação não concluída.";
}

async function functionRequest(auth, functionName, body) {
  const accessToken = String(auth?.accessToken || "").trim();
  if (!accessToken) {
    const error = new Error("Missing access token.");
    error.code = "invalid_user_token";
    throw error;
  }

  return request(`${supabaseConfig.supabaseUrl}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      apikey: supabaseConfig.publishableKey,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function request(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch {
    const error = new Error("Network request failed.");
    error.code = "network_error";
    throw error;
  }

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok || data?.ok === false) {
    const error = new Error(
      data?.error?.message || data?.msg || data?.message || response.statusText,
    );
    error.code = data?.error?.code || data?.code || response.status;
    throw error;
  }

  return data;
}
