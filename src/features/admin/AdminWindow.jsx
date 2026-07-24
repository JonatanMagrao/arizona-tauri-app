import { useEffect, useMemo, useRef, useState } from "react";
import {
  addAdminMember,
  adminErrorMessage,
  generateActivationCode,
  listAdminMembers,
  releaseAdminDevice,
  removeAdminMember,
} from "../../services/adminApi";
import deviceIcon from "../../assets/icones/device.svg";
import removeDeviceIcon from "../../assets/icones/remove_device.svg";
import removeUserIcon from "../../assets/icones/remove_user.svg";
import copyIcon from "../../assets/icones/file_copy.svg";
import closeIcon from "../../assets/icones/close.svg";

const REFRESH_INTERVAL_MS = 15000;

function AdminWindow({ auth, showError, showSuccess, onAccessRestricted }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({ name: "", email: "" });
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [isAccessRestricted, setIsAccessRestricted] = useState(false);
  const [activation, setActivation] = useState(null);
  const mountedRef = useRef(true);
  const busyIdRef = useRef("");
  const accessRestrictedRef = useRef(false);
  const activationDialogRef = useRef(null);
  const activationPrimaryActionRef = useRef(null);
  const activationReturnFocusRef = useRef(null);

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
    busyIdRef.current = "";
    accessRestrictedRef.current = false;
    setIsAccessRestricted(false);
    activationReturnFocusRef.current = null;
    setActivation(null);
    refresh({ silent: false });

    const interval = setInterval(() => refresh({ silent: true }), REFRESH_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      busyIdRef.current = "";
      clearInterval(interval);
    };
  }, [auth?.organizationId]);

  useEffect(() => {
    const handleRefreshShortcut = () => {
      if (!busyIdRef.current) refresh({ silent: false });
    };

    window.addEventListener("arizona-admin:refresh", handleRefreshShortcut);
    return () => window.removeEventListener("arizona-admin:refresh", handleRefreshShortcut);
  }, [auth?.organizationId]);

  useEffect(() => {
    if (!activation?.code) return undefined;

    const focusFrame = window.requestAnimationFrame(() => {
      activationPrimaryActionRef.current?.focus();
    });
    const handleModalKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setActivation(null);
        return;
      }

      trapDialogFocus(event, activationDialogRef.current);
    };

    document.addEventListener("keydown", handleModalKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleModalKeyDown, true);

      const returnFocus = activationReturnFocusRef.current;
      activationReturnFocusRef.current = null;
      if (returnFocus?.isConnected) {
        window.requestAnimationFrame(() => returnFocus.focus());
      }
    };
  }, [activation?.code]);

  const updateDraft = (field, value) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const presentActivation = (nextActivation, trigger) => {
    if (!nextActivation?.code) {
      setActivation(null);
      return;
    }

    activationReturnFocusRef.current = trigger instanceof HTMLElement
      ? trigger
      : document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setActivation(nextActivation);
  };

  const dismissActivation = () => {
    setActivation(null);
  };

  const beginOperation = (operationId) => {
    if (!operationId || busyIdRef.current) return false;

    busyIdRef.current = operationId;
    setBusyId(operationId);
    return true;
  };

  const endOperation = (operationId) => {
    if (busyIdRef.current !== operationId) return;

    busyIdRef.current = "";
    setBusyId("");
  };

  async function refresh({ silent }) {
    if (!auth?.organizationId) {
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
      const nextData = await listAdminMembers();
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
        activationReturnFocusRef.current = null;
        setActivation(null);
        setData(null);
        showError("Seu acesso de gestão foi removido.");
      }
      return;
    }

    if (!silent) showError(adminErrorMessage(error));
  }

  const submitMember = async (event) => {
    event.preventDefault();
    const operationId = "add";
    if (!canAdd || !beginOperation(operationId)) return;

    const activationTrigger = event.nativeEvent?.submitter || document.activeElement;
    try {
      const created = await addAdminMember(auth, {
        name: cleanText(draft.name),
        email: cleanEmail(draft.email),
      });
      setDraft({ name: "", email: "" });
      if (created?.member?.id) {
        try {
          const generated = await generateActivationCode(auth, created.member.id);
          presentActivation(generated?.activation || null, activationTrigger);
          showSuccess("Usuário adicionado.");
        } catch (codeError) {
          showSuccess("Usuário adicionado.");
          showError(`O código não foi gerado: ${adminErrorMessage(codeError)}`);
        }
      } else {
        showSuccess("Usuário adicionado.");
      }
      await refresh({ silent: true });
    } catch (error) {
      handleAdminError(error);
    } finally {
      endOperation(operationId);
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

  const canGenerateCode = (user) => {
    if (!user?.id || user.id === data?.currentMemberId) return false;
    if (canManageManagers) return true;
    return user.role !== "admin";
  };

  const generateCode = async (user, trigger) => {
    if (!canGenerateCode(user)) return;
    const operationId = `code:${user.id}`;
    if (!beginOperation(operationId)) return;

    try {
      const generated = await generateActivationCode(auth, user.id);
      presentActivation(generated?.activation || null, trigger);
    } catch (error) {
      handleAdminError(error);
    } finally {
      endOperation(operationId);
    }
  };

  const copyActivationCode = async () => {
    const code = String(activation?.code || "");
    if (!code) return;
    try {
      await copyText(code);
      showSuccess("Código copiado.");
    } catch {
      showError("Não foi possível copiar o código.");
    }
  };

  const releaseDevice = async (user) => {
    if (!canReleaseUserDevice(user)) return;
    const operationId = `device:${user.id}`;
    if (!beginOperation(operationId)) return;

    try {
      await releaseAdminDevice(auth, user.id);
      showSuccess("Acesso liberado.");
      await refresh({ silent: true });
    } catch (error) {
      handleAdminError(error);
    } finally {
      endOperation(operationId);
    }
  };

  const removeMember = async (user) => {
    if (!canRemoveUser(user)) return;
    if (!window.confirm(`Remover usuário ${user.email}?`)) return;

    const operationId = `remove:${user.id}`;
    if (!beginOperation(operationId)) return;

    try {
      await removeAdminMember(auth, user.id);
      showSuccess("Usuário removido.");
      await refresh({ silent: true });
    } catch (error) {
      handleAdminError(error);
    } finally {
      endOperation(operationId);
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

      {activation?.code && (
        <div
          className="admin-activation-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) dismissActivation();
          }}
        >
          <section
            ref={activationDialogRef}
            className="admin-activation-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-activation-title"
            aria-describedby="admin-activation-description admin-activation-meta"
            tabIndex={-1}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="admin-activation-modal__header">
              <div>
                <span>Código gerado</span>
                <h2 id="admin-activation-title">
                  {activation.purpose === "recovery" ? "Código de recuperação" : "Código de ativação"}
                </h2>
              </div>
              <button
                type="button"
                className="modal-icon-btn admin-activation-close-btn"
                onClick={dismissActivation}
                title="Fechar"
                aria-label="Fechar código de ativação"
              >
                <img src={closeIcon} alt="" aria-hidden="true" />
              </button>
            </header>

            <div className="admin-activation-modal__body">
              <p id="admin-activation-description">
                Copie e envie este código para <strong>{activation.email}</strong>.
                Ele será exibido somente nesta tela.
              </p>
              <code className="admin-activation-modal__code">{activation.code}</code>
              <small id="admin-activation-meta">
                Válido até {formatDateTime(activation.expiresAt)}. Uso único.
              </small>
            </div>

            <footer className="admin-activation-modal__actions">
              <button type="button" className="btn btn-outline" onClick={dismissActivation}>
                Fechar
              </button>
              <button
                ref={activationPrimaryActionRef}
                type="button"
                className="btn btn-primary admin-activation-copy-btn"
                onClick={copyActivationCode}
              >
                <img src={copyIcon} alt="" aria-hidden="true" />
                <span>Copiar código</span>
              </button>
            </footer>
          </section>
        </div>
      )}

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
          const isCodeBusy = busyId === `code:${user.id}`;
          const canReleaseDevice = canReleaseUserDevice(user);
          const canRemoveMember = canRemoveUser(user);
          const canGenerate = canGenerateCode(user);
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
                  className="admin-icon-action"
                  onClick={(event) => generateCode(user, event.currentTarget)}
                  disabled={!canGenerate || Boolean(busyId)}
                  title={canGenerate ? "Gerar código de ativação ou recuperação." : protectedManagerTitle || "Código indisponível."}
                  aria-label={`Gerar código para ${user.email}`}
                >
                  {isCodeBusy ? (
                    <span className="admin-action-spinner">...</span>
                  ) : (
                    <img src={copyIcon} alt="" aria-hidden="true" />
                  )}
                </button>
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

function trapDialogFocus(event, dialog) {
  if (event.key !== "Tab" || !dialog) return;

  const focusable = Array.from(dialog.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  ));

  if (focusable.length === 0) {
    event.preventDefault();
    dialog.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;

  if (event.shiftKey && (active === first || !dialog.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
    event.preventDefault();
    first.focus();
  }
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

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const input = document.createElement("textarea");
  input.value = value;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("copy_failed");
}

function formatDateTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "horário informado";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export default AdminWindow;
