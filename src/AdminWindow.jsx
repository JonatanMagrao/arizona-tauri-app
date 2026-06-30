import { useEffect, useMemo, useRef, useState } from "react";
import {
  addAdminMember,
  adminErrorMessage,
  listAdminMembers,
  releaseAdminDevice,
  removeAdminMember,
} from "./lib/adminApi";
import deviceIcon from "./assets/icones/device.svg";
import removeDeviceIcon from "./assets/icones/remove_device.svg";
import removeUserIcon from "./assets/icones/remove_user.svg";

const REFRESH_INTERVAL_MS = 5000;

function AdminWindow({ auth, showError, showSuccess, onAccessRestricted }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({ name: "", email: "" });
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [isAccessRestricted, setIsAccessRestricted] = useState(false);
  const mountedRef = useRef(true);
  const accessRestrictedRef = useRef(false);

  const users = data?.users || [];
  const seatsAllowed = Number(data?.organization?.seatsAllowed || 0);
  const consumedSeats = Number(data?.consumedSeats || 0);
  const availableSeats = Math.max(0, seatsAllowed - consumedSeats);
  const licenseLimit = formatLicenseDate(data?.organization?.licenseExpiresOn);
  const licenseTime = licenseDaysInfo(data?.organization?.licenseExpiresOn);
  const availableSeatsText = `${availableSeats} ${availableSeats === 1 ? "disponível" : "disponíveis"}`;
  const availableSeatsTooltip = `${availableSeats} ${availableSeats === 1 ? "vaga disponível" : "vagas disponíveis"}`;
  const usedSeatsText = `${consumedSeats} de ${seatsAllowed} ${seatsAllowed === 1 ? "vaga" : "vagas"} em uso`;
  const licenseTooltip = `${availableSeatsTooltip}. ${usedSeatsText}. ${
    licenseLimit === "Sem data limite" ? "Sem data limite." : `Válido até ${licenseLimit}.`
  }`;
  const seatSegmentCount = Math.max(1, seatsAllowed);
  const usedSeatSegments = Math.min(consumedSeats, seatSegmentCount);
  const canManageManagers = Boolean(data?.canManageManagers);
  const canAdd = !isAccessRestricted && availableSeats > 0 && cleanText(draft.name) && cleanEmail(draft.email) && !busyId;
  const addButtonTitle = availableSeats <= 0
    ? "Sem vagas disponíveis."
    : !cleanText(draft.name) || !cleanEmail(draft.email)
      ? "Preencha nome e e-mail."
      : "Adicionar usuário.";

  const sortedUsers = useMemo(() => [...users].sort(compareUsers), [users]);

  useEffect(() => {
    mountedRef.current = true;
    accessRestrictedRef.current = false;
    setIsAccessRestricted(false);
    refresh({ silent: false });

    const interval = setInterval(() => refresh({ silent: true }), REFRESH_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [auth?.accessToken, auth?.organizationId]);

  useEffect(() => {
    const handleRefreshShortcut = () => {
      if (!busyId) refresh({ silent: false });
    };

    window.addEventListener("arizona-admin:refresh", handleRefreshShortcut);
    return () => window.removeEventListener("arizona-admin:refresh", handleRefreshShortcut);
  }, [auth?.accessToken, auth?.organizationId, busyId]);

  const updateDraft = (field, value) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  async function refresh({ silent }) {
    if (!auth?.accessToken || !auth?.organizationId) {
      if (!silent) showError("Sessão de gestão incompleta. Entre novamente.");
      setIsLoading(false);
      return;
    }

    if (accessRestrictedRef.current) {
      setIsLoading(false);
      return;
    }

    if (!silent) setIsLoading(true);
    try {
      const nextData = await listAdminMembers(auth);
      if (mountedRef.current) setData(nextData);
    } catch (error) {
      handleAdminError(error, { silent });
    } finally {
      if (mountedRef.current && !silent) setIsLoading(false);
    }
  }

  function handleAdminError(error, { silent = false } = {}) {
    const code = String(error?.code || "");
    if (code === "forbidden") {
      onAccessRestricted?.();
      if (!accessRestrictedRef.current) {
        accessRestrictedRef.current = true;
        setIsAccessRestricted(true);
        setData(null);
        showError("Seu acesso de gestão foi removido.");
      }
      return;
    }

    if (!silent) showError(adminErrorMessage(error));
  }

  const submitMember = async (event) => {
    event.preventDefault();
    if (!canAdd) return;

    setBusyId("add");
    try {
      await addAdminMember(auth, {
        name: cleanText(draft.name),
        email: cleanEmail(draft.email),
      });
      setDraft({ name: "", email: "" });
      showSuccess("Usuário adicionado.");
      await refresh({ silent: true });
    } catch (error) {
      handleAdminError(error);
    } finally {
      setBusyId("");
    }
  };

  const canReleaseUserDevice = (user) => {
    if (!user?.hasActiveDevice) return false;
    if (canManageManagers) return true;
    if (user.role !== "admin") return true;
    return user.id === data?.currentMemberId;
  };

  const canRemoveUser = (user) => {
    if (!user?.id || user.id === data?.currentMemberId) return false;
    if (canManageManagers) return true;
    return user.role !== "admin";
  };

  const releaseDevice = async (user) => {
    if (!canReleaseUserDevice(user)) return;
    setBusyId(`device:${user.id}`);
    try {
      await releaseAdminDevice(auth, user.id);
      showSuccess("Acesso liberado.");
      await refresh({ silent: true });
    } catch (error) {
      handleAdminError(error);
    } finally {
      setBusyId("");
    }
  };

  const removeMember = async (user) => {
    if (!canRemoveUser(user)) return;
    if (!window.confirm(`Remover usuário ${user.email}?`)) return;

    setBusyId(`remove:${user.id}`);
    try {
      await removeAdminMember(auth, user.id);
      showSuccess("Usuário removido.");
      await refresh({ silent: true });
    } catch (error) {
      handleAdminError(error);
    } finally {
      setBusyId("");
    }
  };

  if (isAccessRestricted) {
    return (
      <main className="admin-window" aria-label="Gestão de usuários">
        <section className="admin-table" aria-label="Acesso de gestão">
          <div className="admin-empty">Seu acesso de gestão foi removido.</div>
        </section>
      </main>
    );
  }

  return (
    <main className="admin-window" aria-label="Gestão de usuários">
      <section className="admin-summary">
        <div className="admin-license-strip" title={licenseTooltip}>
          <div className="admin-license-strip__main">
            <span className="admin-license-strip__label">Vagas</span>
            <strong>{availableSeatsText}</strong>
            <span>{usedSeatsText}</span>
            <span className={`admin-license-strip__days admin-license-strip__days--${licenseTime.tone}`}>
              Validade: {licenseTime.label}
            </span>
          </div>
          <div className="admin-license-strip__meter" aria-hidden="true" title="Laranja em uso. Cinza disponível.">
            {Array.from({ length: seatSegmentCount }, (_, index) => (
              <span
                key={index}
                className={`admin-license-strip__meter-segment ${
                  index < usedSeatSegments ? "admin-license-strip__meter-segment--used" : ""
                }`}
              ></span>
            ))}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-outline admin-refresh-btn"
          onClick={() => refresh({ silent: false })}
          disabled={isLoading || Boolean(busyId)}
          title="Atualizar lista de usuários"
        >
          {isLoading ? "Atualizando..." : "Atualizar"}
        </button>
      </section>

      <form className="admin-add-form" onSubmit={submitMember}>
        <label className="admin-field">
          <span>Nome</span>
          <input
            className="input"
            type="text"
            value={draft.name}
            onChange={(event) => updateDraft("name", event.target.value)}
            maxLength={160}
            disabled={Boolean(busyId) || availableSeats <= 0}
            placeholder="Nome do usuário"
          />
        </label>
        <label className="admin-field">
          <span>E-mail</span>
          <input
            className="input"
            type="email"
            value={draft.email}
            onChange={(event) => updateDraft("email", event.target.value)}
            maxLength={254}
            disabled={Boolean(busyId) || availableSeats <= 0}
            placeholder="email@empresa.com"
          />
        </label>
        <button
          className="btn btn-primary admin-add-btn"
          type="submit"
          disabled={!canAdd}
          title={addButtonTitle}
        >
          {busyId === "add" ? "Salvando..." : "Adicionar"}
        </button>
      </form>

      <section className="admin-table" aria-label="Lista de usuários">
        <div className="admin-row admin-row--head">
          <span>Usuário</span>
          <span>Perfil</span>
          <span>Situação</span>
          <span>Acesso</span>
          <span>Ações</span>
        </div>

        {isLoading && !data ? (
          <div className="admin-empty">Carregando...</div>
        ) : sortedUsers.length === 0 ? (
          <div className="admin-empty">Nenhum usuário cadastrado.</div>
        ) : sortedUsers.map((user) => {
          const isCurrentUser = user.id === data?.currentMemberId;
          const isDeviceBusy = busyId === `device:${user.id}`;
          const isRemoveBusy = busyId === `remove:${user.id}`;
          const canReleaseDevice = canReleaseUserDevice(user);
          const canRemoveMember = canRemoveUser(user);
          const selfRemoveTitle = isCurrentUser ? "Você não pode remover seu próprio acesso." : undefined;
          const protectedManagerTitle = user.role === "admin" && !canManageManagers && !isCurrentUser
            ? "Apenas master admin pode alterar gestores."
            : undefined;
          const deviceTitle = user.hasActiveDevice
            ? canReleaseDevice
              ? "Dispositivo ativo. Clique para liberar este acesso."
              : protectedManagerTitle || "Dispositivo ativo."
            : "Sem dispositivo ativo.";

          return (
            <div className="admin-row" key={user.id}>
              <div className="admin-user">
                <strong title={user.name || user.email}>{user.name || user.email}</strong>
                <span title={user.email}>{user.email}</span>
              </div>
              <span className={`admin-badge ${user.role === "admin" ? "admin-badge--manager" : ""}`}>
                {user.role === "admin" ? "Gestor" : "Usuário"}
              </span>
              <span className="admin-muted">{user.status === "active" ? "Ativo" : "Pendente"}</span>
              <button
                type="button"
                className={`admin-device-btn ${user.hasActiveDevice ? "admin-device-btn--active" : "admin-device-btn--inactive"} ${canReleaseDevice ? "admin-device-btn--action" : ""}`}
                onClick={() => releaseDevice(user)}
                disabled={!canReleaseDevice || Boolean(busyId)}
                title={deviceTitle}
                aria-label={`${deviceTitle} ${user.email}`}
              >
                {isDeviceBusy ? (
                  <span className="admin-action-spinner">...</span>
                ) : (
                  <>
                    <img
                      className="admin-device-btn__icon admin-device-btn__icon--state"
                      src={deviceIcon}
                      alt=""
                      aria-hidden="true"
                    />
                    <img
                      className="admin-device-btn__icon admin-device-btn__icon--release"
                      src={removeDeviceIcon}
                      alt=""
                      aria-hidden="true"
                    />
                  </>
                )}
              </button>
              <div className="admin-actions">
                <button
                  type="button"
                  className="admin-icon-action admin-icon-action--danger"
                  onClick={() => removeMember(user)}
                  disabled={!canRemoveMember || Boolean(busyId)}
                  title={!canRemoveMember ? selfRemoveTitle || protectedManagerTitle : "Remover este usuário."}
                  aria-label={`Remover usuário ${user.email}`}
                >
                  {isRemoveBusy ? (
                    <span className="admin-action-spinner">...</span>
                  ) : (
                    <img src={removeUserIcon} alt="" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </section>
    </main>
  );
}

function cleanText(value) {
  return String(value || "").trim();
}

function cleanEmail(value) {
  return cleanText(value).toLowerCase();
}

function formatLicenseDate(value) {
  const text = String(value || "").trim();
  if (!text) return "Sem data limite";

  const [year, month, day] = text.slice(0, 10).split("-");
  if (/^\d{4}$/.test(year) && /^\d{2}$/.test(month) && /^\d{2}$/.test(day)) {
    return `${day}/${month}/${year}`;
  }

  return text;
}

function licenseDaysInfo(value) {
  const text = String(value || "").trim();
  if (!text) return { label: "sem data limite", tone: "ok" };

  const [yearText, monthText, dayText] = text.slice(0, 10).split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!year || !month || !day) return { label: "data inválida", tone: "danger" };

  const today = new Date();
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const limitUtc = Date.UTC(year, month - 1, day);
  const diffDays = Math.ceil((limitUtc - todayUtc) / 86400000);

  if (diffDays < 0) return { label: "expirada", tone: "danger" };
  if (diffDays === 0) return { label: "vence hoje", tone: "danger" };
  if (diffDays === 1) return { label: "1 dia restante", tone: "danger" };
  if (diffDays <= 7) return { label: `${diffDays} dias restantes`, tone: "danger" };
  if (diffDays <= 15) return { label: `${diffDays} dias restantes`, tone: "warn" };
  return { label: `${diffDays} dias restantes`, tone: "ok" };
}

function compareUsers(a, b) {
  if (a.role !== b.role) return a.role === "admin" ? -1 : 1;
  return cleanEmail(a.email).localeCompare(cleanEmail(b.email));
}

export default AdminWindow;
