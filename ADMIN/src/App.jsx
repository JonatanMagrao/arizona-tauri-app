import { useEffect, useRef, useState } from "react";
import { adminConfig } from "./config.js";

const storageKey = `arizona-admin-session:${adminConfig.projectRef}`;
const flashKey = `arizona-admin-flash:${adminConfig.projectRef}`;
const arizonaDomain = "arizona.global";

function createDefaultLicenseDraft() {
  return {
    users: [createUser()],
    seatsAllowed: "1",
    licenseExpiresOn: defaultExpiresOnBr(),
    licenseIsIndefinite: false,
  };
}

export default function AdminApp() {
  const [session, setSession] = useState(() => loadJson(storageKey));
  const [authDraft, setAuthDraft] = useState({
    email: loadJson(storageKey)?.email || "",
    password: "",
  });
  const [licenseDraft, setLicenseDraft] = useState(() => createDefaultLicenseDraft());
  const [currentLicense, setCurrentLicense] = useState(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => firstDayOfMonth(new Date()));
  const [toast, setToast] = useState(() => loadFlash());
  const [isBusy, setIsBusy] = useState(false);
  const dateControlRef = useRef(null);

  const isAuthenticated = Boolean(session?.accessToken);
  const sessionLabel = session?.email || "Desconectado";
  const hasCurrentLicense = Boolean(currentLicense?.organization);
  const seatsAllowed = Number(licenseDraft.seatsAllowed) || 0;
  const filledUsers = licenseDraft.users.filter((user) => user.name.trim() || user.email.trim()).length;

  useEffect(() => {
    if (!toast.message) return undefined;
    const timer = setTimeout(() => setToast({ message: "", variant: "success" }), 4200);
    return () => clearTimeout(timer);
  }, [toast.message]);

  useEffect(() => {
    if (!session?.accessToken) return undefined;

    let isCurrent = true;

    async function loadCurrentLicense() {
      try {
        const activeSession = await validSession();
        const data = await functionRequest("master-get-license", {}, activeSession.accessToken);
        if (isCurrent) applyLicense(data);
      } catch (error) {
        if (isCurrent) showToast(errorMessage(error), "error");
      }
    }

    loadCurrentLicense();
    return () => {
      isCurrent = false;
    };
  }, [session?.accessToken]);

  useEffect(() => {
    if (!isCalendarOpen) return undefined;

    function closeCalendarOnOutsideClick(event) {
      if (!dateControlRef.current?.contains(event.target)) {
        setIsCalendarOpen(false);
      }
    }

    function closeCalendarOnEscape(event) {
      if (event.key === "Escape") setIsCalendarOpen(false);
    }

    document.addEventListener("pointerdown", closeCalendarOnOutsideClick);
    document.addEventListener("keydown", closeCalendarOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeCalendarOnOutsideClick);
      document.removeEventListener("keydown", closeCalendarOnEscape);
    };
  }, [isCalendarOpen]);

  function updateAuthDraft(field, value) {
    setAuthDraft((current) => ({ ...current, [field]: value }));
  }

  function updateLicenseDraft(field, value) {
    setLicenseDraft((current) => ({ ...current, [field]: value }));
  }

  function updateSeatsAllowed(value) {
    setLicenseDraft((current) => {
      const nextSeats = Math.max(1, Number(value) || 1);
      return {
        ...current,
        seatsAllowed: value,
        users: resizeUsers(current.users, nextSeats),
      };
    });
  }

  function updateUser(userId, field, value) {
    setLicenseDraft((current) => ({
      ...current,
      users: current.users.map((user) => (
        user.id === userId ? { ...user, [field]: value } : user
      )),
    }));
  }

  function toggleUserManager(userId) {
    setLicenseDraft((current) => ({
      ...current,
      users: current.users.map((user) => (
        user.id === userId ? { ...user, isManager: !user.isManager } : user
      )),
    }));
  }

  function openCalendar() {
    const selectedDate = brDateToDate(licenseDraft.licenseExpiresOn) || new Date();
    setCalendarMonth(firstDayOfMonth(selectedDate));
    setIsCalendarOpen(true);
  }

  function changeCalendarMonth(direction) {
    setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() + direction, 1));
  }

  function selectCalendarDay(date) {
    updateLicenseDraft("licenseExpiresOn", formatDateBr(date));
    setIsCalendarOpen(false);
  }

  async function handleLogin(event) {
    event.preventDefault();
    const email = cleanEmail(authDraft.email);

    if (!email || !authDraft.password) {
      showToast("Informe email e senha.", "error");
      return;
    }

    await runAsync(async () => {
      const data = await authRequest("/auth/v1/token?grant_type=password", {
        email,
        password: authDraft.password,
      });
      saveSession(data, email);
      setAuthDraft({ email, password: "" });
      showToast("Acesso confirmado.", "success");
    });
  }

  function handleLogout() {
    setSession(null);
    localStorage.removeItem(storageKey);
    setLicenseDraft(createDefaultLicenseDraft());
    setCurrentLicense(null);
    showToast("Sessao encerrada.", "success");
  }

  async function handleSaveLicense(event) {
    event.preventDefault();
    const allRows = licenseDraft.users.map((user) => ({
      name: cleanText(user.name),
      email: cleanEmail(user.email),
      isManager: Boolean(user.isManager),
    }));
    const users = allRows.filter((user) => user.name || user.email);
    const licenseExpiresOn = licenseDraft.licenseIsIndefinite
      ? null
      : brDateToIso(licenseDraft.licenseExpiresOn);
    const payload = {
      users,
      seatsAllowed: Number(licenseDraft.seatsAllowed),
      licenseExpiresOn,
      licenseIsIndefinite: Boolean(licenseDraft.licenseIsIndefinite),
    };

    if (users.some((user) => !user.name || !user.email)) {
      showToast("Revise nome e email dos usuarios preenchidos.", "error");
      return;
    }

    if (new Set(users.map((user) => user.email)).size !== users.length) {
      showToast("Ha emails de usuarios duplicados.", "error");
      return;
    }

    if (users.some((user) => domainFromEmail(user.email) !== arizonaDomain)) {
      showToast("Emails de usuarios precisam usar arizona.global.", "error");
      return;
    }

    if (!Number.isInteger(payload.seatsAllowed) || payload.seatsAllowed < 1) {
      showToast("Seats precisa ser pelo menos 1.", "error");
      return;
    }

    if (users.length > payload.seatsAllowed) {
      showToast("Usuarios nao podem passar do total de seats.", "error");
      return;
    }

    if (!payload.licenseIsIndefinite && !licenseExpiresOn) {
      showToast("Informe uma data limite valida.", "error");
      return;
    }

    if (!payload.licenseIsIndefinite && licenseExpiresOn < todayDateInput()) {
      showToast("A data limite nao pode estar no passado.", "error");
      return;
    }

    await runAsync(async () => {
      const activeSession = await validSession();
      const data = await functionRequest(
        "master-create-organization",
        payload,
        activeSession.accessToken,
      );
      applyLicense(data);
      localStorage.setItem(
        flashKey,
        JSON.stringify({ message: "Licenca salva.", variant: "success" }),
      );
      window.location.reload();
    });
  }

  async function handleReleaseDevice(user) {
    const organizationId = currentLicense?.organization?.id;
    const deviceId = user.activeDevice?.id;

    if (!organizationId || !user.memberId || !deviceId) {
      showToast("Nenhuma maquina ativa para liberar.", "error");
      return;
    }

    await runAsync(async () => {
      const activeSession = await validSession();
      await functionRequest(
        "admin-release-device",
        { organizationId, memberId: user.memberId, deviceId },
        activeSession.accessToken,
      );
      setLicenseDraft((current) => ({
        ...current,
        users: current.users.map((draftUser) => (
          draftUser.id === user.id ? { ...draftUser, activeDevice: null } : draftUser
        )),
      }));
      setCurrentLicense((current) => current ? {
        ...current,
        users: (current.users || []).map((licenseUser) => (
          licenseUser.id === user.memberId ? { ...licenseUser, activeDevice: null } : licenseUser
        )),
      } : current);
      showToast("Maquina liberada para este usuario.", "success");
    });
  }

  async function handleClearUser(user) {
    if (!hasUserContent(user)) return;

    if (!user.memberId) {
      clearDraftUser(user.id);
      showToast("Linha de usuario limpa.", "success");
      return;
    }

    const organizationId = currentLicense?.organization?.id;
    if (!organizationId) {
      showToast("Licenca ainda nao carregada.", "error");
      return;
    }

    const confirmed = window.confirm(
      "Limpar este usuario libera o seat e revoga o device ativo. Deseja continuar?",
    );
    if (!confirmed) return;

    await runAsync(async () => {
      const activeSession = await validSession();
      await functionRequest(
        "admin-remove-member",
        { organizationId, memberId: user.memberId },
        activeSession.accessToken,
      );
      clearDraftUser(user.id);
      setCurrentLicense((current) => current ? {
        ...current,
        users: (current.users || []).filter((licenseUser) => licenseUser.id !== user.memberId),
        consumedSeats: Math.max(0, Number(current.consumedSeats || 0) - 1),
      } : current);
      showToast("Usuario removido e seat liberado.", "success");
    });
  }

  function clearDraftUser(userId) {
    setLicenseDraft((current) => ({
      ...current,
      users: current.users.map((draftUser) => (
        draftUser.id === userId
          ? { ...draftUser, memberId: null, name: "", email: "", isManager: false, activeDevice: null }
          : draftUser
      )),
    }));
  }

  async function runAsync(fn) {
    setIsBusy(true);
    try {
      await fn();
    } catch (error) {
      showToast(errorMessage(error), "error");
    } finally {
      setIsBusy(false);
    }
  }

  async function authRequest(path, body) {
    const response = await fetch(`${adminConfig.supabaseUrl}${path}`, {
      method: "POST",
      headers: {
        apikey: adminConfig.publishableKey,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    return readResponse(response);
  }

  async function functionRequest(functionName, body, accessToken) {
    const response = await fetch(`${adminConfig.supabaseUrl}/functions/v1/${functionName}`, {
      method: "POST",
      headers: {
        apikey: adminConfig.publishableKey,
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    return readResponse(response);
  }

  async function readResponse(response) {
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};

    if (!response.ok || data?.ok === false) {
      const error = new Error(data?.error?.message || data?.msg || data?.message || response.statusText);
      error.code = data?.error?.code || data?.code || response.status;
      throw error;
    }

    return data;
  }

  async function validSession() {
    if (!session?.accessToken) {
      throw new Error("Entre com o acesso master.");
    }

    const expiresAt = Number(session.expiresAt || 0);
    if (expiresAt > Date.now() + 60_000) return session;

    if (!session.refreshToken) {
      throw new Error("Sessao expirada. Entre novamente.");
    }

    const data = await authRequest("/auth/v1/token?grant_type=refresh_token", {
      refresh_token: session.refreshToken,
    });

    return saveSession(data, session.email);
  }

  function saveSession(data, fallbackEmail) {
    const nextSession = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      email: data.user?.email || fallbackEmail,
      expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
    };
    setSession(nextSession);
    localStorage.setItem(storageKey, JSON.stringify(nextSession));
    return nextSession;
  }

  function applyLicense(data) {
    setCurrentLicense(data);

    if (!data?.organization) {
      setLicenseDraft(createDefaultLicenseDraft());
      return;
    }

    const seats = Number(data.organization?.seats_allowed || 1);
    const users = Array.isArray(data.users)
      ? data.users.map((user) => createUser(
        user.name || "",
        user.email || "",
        user.role === "admin",
        user.id || null,
        user.activeDevice || null,
      ))
      : [];

    setLicenseDraft({
      users: resizeUsers(users.length ? users : [createUser()], seats),
      seatsAllowed: String(seats),
      licenseExpiresOn: data.organization?.license_expires_on
        ? formatLicenseDate(data.organization.license_expires_on)
        : defaultExpiresOnBr(),
      licenseIsIndefinite: !data.organization?.license_expires_on,
    });
  }

  function showToast(message, variant) {
    setToast({ message, variant: variant || "success" });
  }

  return (
    <main className="admin-shell">
      <section className={`workspace ${isAuthenticated ? "" : "workspace--login"}`} aria-label="Arizona Admin">
        <header className="topbar">
          <div>
            <h1>Arizona Admin</h1>
            <p>Painel local</p>
          </div>
          <div className="session-actions">
            <div className={`session-pill ${isAuthenticated ? "session-pill--active" : ""}`}>
              {sessionLabel}
            </div>
            {isAuthenticated ? (
              <button className="button button--ghost button--small" type="button" onClick={handleLogout} disabled={isBusy}>
                Sair
              </button>
            ) : null}
          </div>
        </header>

        {!isAuthenticated ? (
          <section className="panel panel--auth panel--login" aria-labelledby="authTitle">
            <div className="panel-header">
              <h2 id="authTitle">Login master</h2>
            </div>

            <form className="form" onSubmit={handleLogin}>
              <label className="field">
                <span>Email</span>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={authDraft.email}
                  onChange={(event) => updateAuthDraft("email", event.target.value)}
                />
              </label>
              <label className="field">
                <span>Senha</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  minLength="6"
                  value={authDraft.password}
                  onChange={(event) => updateAuthDraft("password", event.target.value)}
                />
              </label>
              <div className="button-row">
                <button className="button button--primary" type="submit" disabled={isBusy}>
                  Entrar
                </button>
              </div>
            </form>
          </section>
        ) : (
          <section className="panel panel--company" aria-labelledby="licenseTitle">
            <div className="panel-header">
              <h2 id="licenseTitle">Licenca Arizona</h2>
              <span className="domain-badge">arizona.global</span>
            </div>

            <form className="form" onSubmit={handleSaveLicense}>
              <div className="license-settings">
                <label className="field field--compact">
                  <span>Seats</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={licenseDraft.seatsAllowed}
                    onChange={(event) => updateSeatsAllowed(event.target.value)}
                  />
                </label>
                <label className="field field--date">
                  <span>Data limite</span>
                  <div className="date-control" ref={dateControlRef}>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength="10"
                      placeholder="31/07/2026"
                      required={!licenseDraft.licenseIsIndefinite}
                      disabled={licenseDraft.licenseIsIndefinite}
                      value={licenseDraft.licenseExpiresOn}
                      onChange={(event) => updateLicenseDraft("licenseExpiresOn", maskBrDate(event.target.value))}
                      onFocus={() => setIsCalendarOpen(false)}
                    />
                    <button
                      className="icon-button calendar-button"
                      type="button"
                      aria-label="Abrir calendario"
                      title="Abrir calendario"
                      onClick={openCalendar}
                      disabled={licenseDraft.licenseIsIndefinite}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
                      </svg>
                    </button>
                    {isCalendarOpen ? (
                      <CalendarPopup
                        month={calendarMonth}
                        selectedDate={brDateToDate(licenseDraft.licenseExpiresOn)}
                        onPrevious={() => changeCalendarMonth(-1)}
                        onNext={() => changeCalendarMonth(1)}
                        onSelect={selectCalendarDay}
                      />
                    ) : null}
                  </div>
                </label>
                <label className="check-field check-field--inline">
                  <input
                    type="checkbox"
                    checked={licenseDraft.licenseIsIndefinite}
                    onChange={(event) => {
                      updateLicenseDraft("licenseIsIndefinite", event.target.checked);
                      if (event.target.checked) setIsCalendarOpen(false);
                    }}
                  />
                  <span>Validacao diaria sem data limite</span>
                </label>
                <button className="button button--primary" type="submit" disabled={isBusy}>
                  {hasCurrentLicense ? "Salvar alteracoes" : "Salvar licenca"}
                </button>
              </div>

              <div className="user-section">
                <div className="section-row">
                  <span>Usuarios</span>
                  <span>{filledUsers}/{seatsAllowed || 0} preenchidos</span>
                </div>
                <div className="user-list">
                  {licenseDraft.users.map((user, index) => (
                    <div className="user-row" key={user.id}>
                      <label className="field">
                        <span>{`Usuario ${index + 1}`}</span>
                        <input
                          type="text"
                          autoComplete="name"
                          maxLength="160"
                          value={user.name}
                          onChange={(event) => updateUser(user.id, "name", event.target.value)}
                        />
                      </label>
                      <label className="field">
                        <span>Email</span>
                        <input
                          type="email"
                          autoComplete="email"
                          maxLength="254"
                          placeholder="usuario@arizona.global"
                          value={user.email}
                          onChange={(event) => updateUser(user.id, "email", event.target.value)}
                        />
                      </label>
                      <div className="device-cell">
                        <span>Device</span>
                        {user.activeDevice ? (
                          <div className="device-active">
                            <div>
                              <strong>{deviceLabel(user.activeDevice)}</strong>
                              <small>{formatDateTimeBr(user.activeDevice.lastSeenAt)}</small>
                            </div>
                            <button
                              className="button button--small"
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleReleaseDevice(user)}
                            >
                              Liberar
                            </button>
                          </div>
                        ) : (
                          <div className="device-empty">Sem maquina</div>
                        )}
                      </div>
                      <label className="toggle-field">
                        <input
                          type="checkbox"
                          checked={user.isManager}
                          onChange={() => toggleUserManager(user.id)}
                        />
                        <span>Gestor</span>
                      </label>
                      <div className="user-actions">
                        <span>Acoes</span>
                        <button
                          className="button button--danger button--small"
                          type="button"
                          disabled={isBusy || !hasUserContent(user)}
                          onClick={() => handleClearUser(user)}
                        >
                          Limpar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </form>
          </section>
        )}
      </section>

      <div
        className={`toast ${toast.message ? "toast--visible" : ""} toast--${toast.variant || "success"}`}
        role="status"
        aria-live="polite"
      >
        {toast.message}
      </div>
    </main>
  );
}

function CalendarPopup({ month, selectedDate, onPrevious, onNext, onSelect }) {
  const days = calendarDays(month);
  const selectedKey = selectedDate ? toInputDate(selectedDate) : "";
  const todayKey = todayDateInput();

  return (
    <div className="calendar-popover" role="dialog" aria-label="Calendario">
      <div className="calendar-header">
        <button className="icon-button" type="button" aria-label="Mes anterior" onClick={onPrevious}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <strong>{monthLabel(month)}</strong>
        <button className="icon-button" type="button" aria-label="Proximo mes" onClick={onNext}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </div>
      <div className="calendar-grid calendar-grid--weekdays" aria-hidden="true">
        {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"].map((weekday) => (
          <span key={weekday}>{weekday}</span>
        ))}
      </div>
      <div className="calendar-grid">
        {days.map((date) => {
          const key = toInputDate(date);
          const isOutside = date.getMonth() !== month.getMonth();
          const isSelected = key === selectedKey;
          const isToday = key === todayKey;

          return (
            <button
              className={[
                "calendar-day",
                isOutside ? "calendar-day--outside" : "",
                isSelected ? "calendar-day--selected" : "",
                isToday ? "calendar-day--today" : "",
              ].filter(Boolean).join(" ")}
              type="button"
              key={key}
              onClick={() => onSelect(date)}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function loadJson(key) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function loadFlash() {
  const flash = loadJson(flashKey);
  localStorage.removeItem(flashKey);
  return flash || { message: "", variant: "success" };
}

function createUser(name = "", email = "", isManager = false, memberId = null, activeDevice = null) {
  return {
    id: typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`,
    memberId,
    name,
    email,
    isManager,
    activeDevice,
  };
}

function resizeUsers(users, count) {
  const targetCount = Math.max(1, count);
  const nextUsers = users.slice(0, targetCount);
  while (nextUsers.length < targetCount) {
    nextUsers.push(createUser());
  }
  return nextUsers;
}

function cleanText(value) {
  return String(value || "").trim();
}

function cleanEmail(value) {
  return cleanText(value).toLowerCase();
}

function cleanDomain(value) {
  return cleanText(value).toLowerCase().replace(/^@+/, "");
}

function domainFromEmail(value) {
  const [, domain = ""] = cleanEmail(value).split("@");
  return cleanDomain(domain);
}

function toInputDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayDateInput() {
  return toInputDate(new Date());
}

function defaultExpiresOnIso() {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return toInputDate(date);
}

function defaultExpiresOnBr() {
  return formatLicenseDate(defaultExpiresOnIso());
}

function maskBrDate(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function brDateToIso(value) {
  const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return "";

  const [, day, month, year] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (
    Number.isNaN(date.getTime())
    || date.getUTCFullYear() !== Number(year)
    || date.getUTCMonth() + 1 !== Number(month)
    || date.getUTCDate() !== Number(day)
  ) {
    return "";
  }

  return `${year}-${month}-${day}`;
}

function brDateToDate(value) {
  const iso = brDateToIso(value);
  if (!iso) return null;
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDateBr(date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatLicenseDate(value) {
  if (!value) return "Sem data limite";
  const [year, month, day] = String(value).slice(0, 10).split("-");
  if (!year || !month || !day) return "Sem data limite";
  return `${day}/${month}/${year}`;
}

function formatDateTimeBr(value) {
  if (!value) return "Sem uso recente";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sem uso recente";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function deviceLabel(device) {
  return device?.label || device?.installId || "Maquina ativa";
}

function hasUserContent(user) {
  return Boolean(
    user?.memberId
    || user?.activeDevice
    || cleanText(user?.name)
    || cleanText(user?.email)
    || user?.isManager
  );
}

function firstDayOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function calendarDays(month) {
  const first = firstDayOfMonth(month);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

function monthLabel(date) {
  const formatted = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
  }).format(date);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function errorMessage(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");

  if (code === "invalid_credentials" || message.toLowerCase().includes("invalid login")) {
    return "Email ou senha invalidos.";
  }
  if (code === "email_not_confirmed" || message.toLowerCase().includes("email not confirmed")) {
    return "Email ainda nao confirmado no Supabase Auth.";
  }
  if (code === "forbidden") return "Acesso master nao autorizado.";
  if (code === "invalid_publishable_key") return "Chave publica invalida no painel admin.";
  if (code === "invalid_user_token") return "Sessao expirada. Entre novamente.";
  if (code === "function_config_error") return "Configuracao da Edge Function incompleta.";
  if (code === "function_permission_error") return "Edge Function sem permissao para gravar licencas.";
  if (code === "seat_limit_exceeded") return "Nao ha seats disponiveis.";
  if (code === "seats_below_existing_members") return "Seats menor que os usuarios ja cadastrados.";
  if (code === "too_many_users") return "Usuarios nao podem passar do total de seats.";
  if (code === "organization_already_exists") return "Licenca ja cadastrada.";
  if (code === "missing_user_name") return "Informe o nome do usuario.";
  if (code === "invalid_user_email") return "Informe um email de usuario valido.";
  if (code === "missing_admin_name") return "Informe o nome do usuario.";
  if (code === "invalid_admin_email") return "Informe um email de usuario valido.";
  if (code === "invalid_license_expires_on") return "Informe uma data limite valida.";
  if (code === "license_expired") return "Licenca expirada.";
  if (code === "device_limit_reached") return "Usuario ja possui uma maquina ativa. Libere o device antes de usar outra.";
  if (code === "device_not_active") return "Device bloqueado. Libere ou cadastre uma nova maquina.";
  if (code === "member_not_found") return "Usuario nao encontrado.";
  if (code === "invalid_allowed_email_domain") return "Informe um dominio permitido valido.";
  if (code === "admin_email_domain_not_allowed") return "Email do usuario precisa usar arizona.global.";
  if (code === "email_domain_not_allowed") return "Email fora do dominio permitido.";

  return message || "Operacao nao concluida.";
}
