import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@supabase/supabase-js";
import { adminConfig } from "./config.js";
import { adminPublicErrorMessage } from "./publicErrors.js";
import {
  adminSessionExpiryReason,
  nextAdminSessionExpiryAt,
  normalizeAdminSessionTiming,
} from "./admin-session.js";
import arizonaIcon from "./assets/arizona-icon.png";

const flashKey = `arizona-admin-flash:${adminConfig.projectRef}`;
const sessionKey = `arizona-admin-session:${adminConfig.projectRef}`;
const oauthStorageKey = `arizona-admin-oauth:${adminConfig.projectRef}`;
const themeStorageKey = `arizona-admin-theme:${adminConfig.projectRef}`;
const adminAuthStorage = {
  getItem(key) {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      // PKCE will report a useful error if browser session storage is unavailable.
    }
  },
  removeItem(key) {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // Nothing else is required when storage is unavailable.
    }
  },
};
const supabaseAuth = createClient(adminConfig.supabaseUrl, adminConfig.publishableKey, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    flowType: "pkce",
    persistSession: true,
    storage: adminAuthStorage,
    storageKey: oauthStorageKey,
  },
});
const initialOAuthCallback = consumeOAuthCallback();
const arizonaDomain = "arizona.global";
const dailyAuthResetHourOptions = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: `${String(hour).padStart(2, "0")}:00`,
}));
const accessPolicyGroups = [
  {
    title: "Códigos de acesso",
    description: "Regras para geração e validade dos códigos enviados aos usuários.",
    fields: [
      {
        key: "activationCodeTtlMinutes",
        label: "Validade do código",
        unit: "min",
        min: 5,
        max: 60,
        description: "Por quanto tempo um código pode ser usado depois de gerado.",
      },
      {
        key: "activationGenerationLimit",
        label: "Gerações por usuário",
        unit: "códigos",
        min: 1,
        max: 50,
        description: "Máximo de códigos gerados para a mesma pessoa dentro da janela abaixo.",
      },
      {
        key: "activationGenerationWindowMinutes",
        label: "Janela de geração",
        unit: "min",
        min: 1,
        max: 1440,
        description: "Período usado para contar o limite de gerações por usuário.",
      },
    ],
  },
  {
    title: "Tentativas de ativação",
    description: "Proteção contra erros repetidos ou tentativas excessivas de acesso.",
    fields: [
      {
        key: "activationAttemptLimit",
        label: "Tentativas por e-mail",
        unit: "tentativas",
        min: 1,
        max: 100,
        description: "Máximo de tentativas, corretas ou incorretas, dentro da janela abaixo.",
      },
      {
        key: "activationAttemptWindowMinutes",
        label: "Janela de tentativas",
        unit: "min",
        min: 1,
        max: 1440,
        description: "Período usado para contar as tentativas de ativação.",
      },
    ],
  },
  {
    title: "Troca de máquina",
    description: "Limites para liberar um dispositivo e cadastrar outro.",
    fields: [
      {
        key: "deviceReleaseLimit",
        label: "Liberações por usuário",
        unit: "liberações",
        min: 1,
        max: 100,
        description: "Máximo de dispositivos liberados para a mesma pessoa dentro da janela abaixo.",
      },
      {
        key: "deviceReleaseWindowMinutes",
        label: "Janela de liberações",
        unit: "min",
        min: 1,
        max: 1440,
        description: "Período usado para contar as liberações de dispositivo.",
      },
      {
        key: "deviceSwitchIntervalDays",
        label: "Intervalo entre trocas",
        unit: "dias",
        min: 0,
        max: 365,
        description: "Tempo mínimo que o dispositivo precisa permanecer ativo. Use 0 para troca imediata.",
      },
      {
        key: "deviceRecoveryWindowMinutes",
        label: "Prazo de recuperação",
        unit: "min",
        min: 5,
        max: 60,
        description: "Prazo para concluir o autenticador e cadastrar o novo dispositivo.",
      },
    ],
  },
];
const accessPolicyFields = accessPolicyGroups.flatMap((group) => group.fields);
const productionAccessPolicy = {
  activationCodeTtlMinutes: "15",
  activationAttemptLimit: "8",
  activationAttemptWindowMinutes: "60",
  activationGenerationLimit: "3",
  activationGenerationWindowMinutes: "60",
  deviceReleaseLimit: "10",
  deviceReleaseWindowMinutes: "60",
  deviceSwitchIntervalDays: "7",
  deviceRecoveryWindowMinutes: "15",
};
const testAccessPolicy = {
  activationCodeTtlMinutes: "30",
  activationAttemptLimit: "30",
  activationAttemptWindowMinutes: "5",
  activationGenerationLimit: "10",
  activationGenerationWindowMinutes: "5",
  deviceReleaseLimit: "20",
  deviceReleaseWindowMinutes: "5",
  deviceSwitchIntervalDays: "0",
  deviceRecoveryWindowMinutes: "30",
};
const auditPageSize = 40;
const activityPersistenceIntervalMs = 15_000;

function createDefaultLicenseDraft() {
  return {
    users: [createUser()],
    seatsAllowed: "1",
    dailyAuthResetHour: "4",
    licenseExpiresOn: defaultExpiresOnBr(),
    licenseIsIndefinite: false,
    ...productionAccessPolicy,
  };
}

export default function AdminApp() {
  const [session, setSession] = useState(() => loadAdminSession());
  const [theme, setTheme] = useState(() => loadAdminTheme());
  const [licenseDraft, setLicenseDraft] = useState(() => createDefaultLicenseDraft());
  const [currentLicense, setCurrentLicense] = useState(null);
  const [licenseLoadState, setLicenseLoadState] = useState(
    session?.accessToken ? "loading" : "idle",
  );
  const [licenseLoadError, setLicenseLoadError] = useState("");
  const [licenseLoadAttempt, setLicenseLoadAttempt] = useState(0);
  const [activationCodes, setActivationCodes] = useState([]);
  const [activationPopover, setActivationPopover] = useState(null);
  const [openUserMenuId, setOpenUserMenuId] = useState(null);
  const [activeAdminSection, setActiveAdminSection] = useState("license");
  const [auditEvents, setAuditEvents] = useState([]);
  const [auditLoadState, setAuditLoadState] = useState("idle");
  const [auditLoadError, setAuditLoadError] = useState("");
  const [auditPagination, setAuditPagination] = useState({
    total: 0,
    nextPage: null,
  });
  const [policyDraft, setPolicyDraft] = useState({});
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => firstDayOfMonth(new Date()));
  const [toast, setToast] = useState(() => (
    initialOAuthCallback.error
      ? { message: initialOAuthCallback.error, variant: "error" }
      : loadFlash()
  ));
  const [isBusy, setIsBusy] = useState(Boolean(initialOAuthCallback.code));
  const dateControlRef = useRef(null);
  const oauthExchangeStartedRef = useRef(false);
  const sessionRef = useRef(session);

  const isAuthenticated = Boolean(session?.accessToken);
  const sessionLabel = session?.email || "Desconectado";
  const hasCurrentLicense = Boolean(currentLicense?.organization);
  const isOrganizationPaused = currentLicense?.organization?.status === "paused";
  const seatsAllowed = Number(licenseDraft.seatsAllowed) || 0;
  const filledUsers = licenseDraft.users.filter((user) => user.name.trim() || user.email.trim()).length;
  const availableSeats = Math.max(0, seatsAllowed - filledUsers);
  const popoverActivation = activationPopover
    ? activationCodes.find((activation) => (
      activation.memberId === activationPopover.memberId
      && new Date(activation.expiresAt).getTime() > Date.now()
    ))
    : null;

  useEffect(() => {
    sessionRef.current = session;
    if (session?.accessToken) persistAdminSession(session);
  }, [session]);

  useEffect(() => {
    if (!session?.accessToken) return undefined;

    let expirationTimer = 0;
    let expirationStarted = false;

    function expireIfNeeded() {
      const activeSession = sessionRef.current;
      if (!activeSession?.accessToken) return;

      const reason = adminSessionExpiryReason(activeSession);
      if (reason) {
        if (!expirationStarted) {
          expirationStarted = true;
          void expireAdminAccess(reason);
        }
        return;
      }

      window.clearTimeout(expirationTimer);
      expirationTimer = window.setTimeout(
        expireIfNeeded,
        Math.max(25, nextAdminSessionExpiryAt(activeSession) - Date.now() + 25),
      );
    }

    function recordActivity() {
      const activeSession = sessionRef.current;
      if (!activeSession?.accessToken) return;

      const now = Date.now();
      if (adminSessionExpiryReason(activeSession, now)) {
        expireIfNeeded();
        return;
      }
      if (now - Number(activeSession.lastActivityAt || 0) < activityPersistenceIntervalMs) {
        return;
      }

      replaceAdminSession({
        ...activeSession,
        lastActivityAt: now,
      });
      expireIfNeeded();
    }

    function recordVisibleActivity() {
      if (document.visibilityState === "visible") recordActivity();
    }

    document.addEventListener("pointerdown", recordActivity, { passive: true });
    document.addEventListener("keydown", recordActivity);
    document.addEventListener("visibilitychange", recordVisibleActivity);
    window.addEventListener("focus", recordActivity);
    expireIfNeeded();

    return () => {
      window.clearTimeout(expirationTimer);
      document.removeEventListener("pointerdown", recordActivity);
      document.removeEventListener("keydown", recordActivity);
      document.removeEventListener("visibilitychange", recordVisibleActivity);
      window.removeEventListener("focus", recordActivity);
    };
  }, [session?.sessionStartedAt]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(themeStorageKey, theme);
    } catch {
      // The selected theme still applies for the current page.
    }
  }, [theme]);

  useEffect(() => {
    if (!initialOAuthCallback.code || oauthExchangeStartedRef.current) return;
    oauthExchangeStartedRef.current = true;

    async function exchangeGoogleCode() {
      try {
        const { data, error } = await supabaseAuth.auth.exchangeCodeForSession(
          initialOAuthCallback.code,
        );
        if (error) throw error;
        const nextSession = sessionFromSupabaseSession(data.session);
        clearSupabaseAuthArtifacts();
        persistAdminSession(nextSession);
        setLicenseLoadState("loading");
        setLicenseLoadError("");
        replaceAdminSession(nextSession);
        showToast("Acesso Google confirmado.", "success");
      } catch (error) {
        clearAdminSession();
        replaceAdminSession(null);
        showToast(adminPublicErrorMessage(error), "error");
      } finally {
        setIsBusy(false);
      }
    }

    exchangeGoogleCode();
  }, []);

  useEffect(() => {
    if (!toast.message) return undefined;
    const timer = setTimeout(() => setToast({ message: "", variant: "success" }), 4200);
    return () => clearTimeout(timer);
  }, [toast.message]);

  useEffect(() => {
    if (!session?.accessToken) {
      setLicenseLoadState("idle");
      setLicenseLoadError("");
      return undefined;
    }

    let isCurrent = true;
    setLicenseLoadState("loading");
    setLicenseLoadError("");

    async function loadCurrentLicense() {
      let activeSession = null;
      try {
        activeSession = await validSession();
        const data = await functionRequest("master-get-license", {}, activeSession.accessToken);
        if (isCurrent) {
          applyLicense(data);
          setLicenseLoadState("ready");
        }
      } catch (error) {
        if (isCurrent) {
          const message = adminPublicErrorMessage(error);
          setLicenseLoadError(message);
          setLicenseLoadState("error");
          if (isInvalidAdminSessionError(error)) {
            clearAdminSession();
            replaceAdminSession(null);
          }
          showToast(message, "error");
        }
      }
    }

    loadCurrentLicense();
    return () => {
      isCurrent = false;
    };
  }, [session?.accessToken, licenseLoadAttempt]);

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

  useEffect(() => {
    if (!activationPopover) return undefined;

    function closeOverlayOnEscape(event) {
      if (event.key === "Escape") setActivationPopover(null);
    }

    document.addEventListener("keydown", closeOverlayOnEscape);
    return () => document.removeEventListener("keydown", closeOverlayOnEscape);
  }, [activationPopover]);

  useEffect(() => {
    if (!openUserMenuId) return undefined;

    function closeUserMenuOnOutsideClick(event) {
      if (!event.target.closest(".user-overflow")) setOpenUserMenuId(null);
    }

    function closeUserMenuOnEscape(event) {
      if (event.key === "Escape") setOpenUserMenuId(null);
    }

    document.addEventListener("pointerdown", closeUserMenuOnOutsideClick);
    document.addEventListener("keydown", closeUserMenuOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeUserMenuOnOutsideClick);
      document.removeEventListener("keydown", closeUserMenuOnEscape);
    };
  }, [openUserMenuId]);

  function updateLicenseDraft(field, value) {
    setLicenseDraft((current) => ({ ...current, [field]: value }));
  }

  function openPolicySection() {
    setPolicyDraft(accessPolicyDraftFrom(licenseDraft));
    setActiveAdminSection("policies");
  }

  function openLicenseSection() {
    setActiveAdminSection("license");
  }

  function openSettingsSection() {
    setActiveAdminSection("settings");
  }

  function openLogsSection() {
    setActiveAdminSection("logs");
    if (auditLoadState === "idle") loadAuditEvents();
  }

  async function loadAuditEvents({ page = 0, append = false } = {}) {
    const organizationId = currentLicense?.organization?.id;
    if (!organizationId) {
      setAuditLoadError("A licença precisa estar carregada para consultar os registros.");
      setAuditLoadState("error");
      return;
    }

    setAuditLoadError("");
    setAuditLoadState(append ? "loading-more" : "loading");
    try {
      const activeSession = await validSession();
      const data = await functionRequest(
        "master-list-audit-log",
        {
          organizationId,
          page,
          limit: auditPageSize,
        },
        activeSession.accessToken,
      );
      const nextEvents = Array.isArray(data?.events) ? data.events : [];
      setAuditEvents((current) => (append ? [...current, ...nextEvents] : nextEvents));
      setAuditPagination({
        total: Number(data?.pagination?.total || nextEvents.length),
        nextPage: Number.isInteger(data?.pagination?.nextPage)
          ? data.pagination.nextPage
          : null,
      });
      setAuditLoadState("ready");
    } catch (error) {
      const message = adminPublicErrorMessage(error);
      setAuditLoadError(message);
      setAuditLoadState("error");
      if (isInvalidAdminSessionError(error)) {
        clearAdminSession();
        replaceAdminSession(null);
      }
    }
  }

  function refreshAuditEvents() {
    loadAuditEvents({ page: 0, append: false });
  }

  function loadMoreAuditEvents() {
    if (auditPagination.nextPage === null || auditLoadState === "loading-more") return;
    loadAuditEvents({ page: auditPagination.nextPage, append: true });
  }

  function updatePolicyDraft(field, value) {
    setPolicyDraft((current) => ({ ...current, [field]: value }));
  }

  function applyPolicyDraft() {
    const invalidField = accessPolicyFields.find((field) => {
      const value = Number(policyDraft[field.key]);
      return !Number.isInteger(value) || value < field.min || value > field.max;
    });
    if (invalidField) {
      showToast(`Revise o campo "${invalidField.label}".`, "error");
      return;
    }

    setLicenseDraft((current) => ({
      ...current,
      ...accessPolicyDraftFrom(policyDraft),
    }));
    setActiveAdminSection("license");
    showToast("Políticas aplicadas. Salve as alterações da licença para concluir.", "success");
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

  async function handleGoogleLogin() {
    setIsBusy(true);
    try {
      clearAdminSession();
      const { data, error } = await supabaseAuth.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: adminOAuthRedirectUrl(),
          scopes: "openid email profile",
          queryParams: {
            prompt: "select_account",
          },
        },
      });
      if (error) throw error;
      if (!data?.url) throw new Error("Não foi possível iniciar o acesso com Google.");
    } catch (error) {
      setIsBusy(false);
      showToast(adminPublicErrorMessage(error), "error");
    }
  }

  async function handleLogout() {
    const activeSession = sessionRef.current;
    setIsBusy(true);
    resetAdminWorkspace();

    try {
      await revokeAdminSession(activeSession);
      showToast("Sessão encerrada.", "success");
    } catch {
      showToast(
        "Você saiu deste navegador, mas o encerramento nos outros acessos não pôde ser confirmado.",
        "error",
      );
    } finally {
      setIsBusy(false);
    }
  }

  function resetAdminWorkspace() {
    replaceAdminSession(null);
    setLicenseDraft(createDefaultLicenseDraft());
    setCurrentLicense(null);
    setLicenseLoadState("idle");
    setLicenseLoadError("");
    setActivationCodes([]);
    setActivationPopover(null);
    setOpenUserMenuId(null);
    setAuditEvents([]);
    setAuditLoadState("idle");
    setAuditLoadError("");
    setAuditPagination({ total: 0, nextPage: null });
    setPolicyDraft({});
    setActiveAdminSection("license");
  }

  async function expireAdminAccess(reason) {
    const activeSession = sessionRef.current;
    resetAdminWorkspace();
    showToast(
      reason === "inactivity"
        ? "Painel bloqueado após 30 minutos sem atividade."
        : "A sessão administrativa atingiu o limite de 8 horas.",
      "error",
    );

    try {
      await revokeAdminSession(activeSession);
    } catch {
      // The local lock is immediate; the server-side eight-hour check remains active.
    }
  }

  async function revokeAdminSession(activeSession) {
    if (!activeSession?.accessToken || !activeSession?.refreshToken) return;

    try {
      const { error: restoreError } = await supabaseAuth.auth.setSession({
        access_token: activeSession.accessToken,
        refresh_token: activeSession.refreshToken,
      });
      if (restoreError) throw restoreError;

      const { error: signOutError } = await supabaseAuth.auth.signOut({ scope: "local" });
      if (signOutError) throw signOutError;
    } finally {
      clearSupabaseAuthArtifacts();
    }
  }

  function replaceAdminSession(nextSession) {
    sessionRef.current = nextSession;
    setSession(nextSession);
    if (nextSession?.accessToken) {
      persistAdminSession(nextSession);
    } else {
      clearAdminSession();
    }
  }

  function retryLicenseLoad() {
    setLicenseLoadState("loading");
    setLicenseLoadError("");
    setLicenseLoadAttempt((current) => current + 1);
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
      dailyAuthResetHour: Number(licenseDraft.dailyAuthResetHour),
      licenseExpiresOn,
      licenseIsIndefinite: Boolean(licenseDraft.licenseIsIndefinite),
      ...Object.fromEntries(
        accessPolicyFields.map((field) => [field.key, Number(licenseDraft[field.key])]),
      ),
    };

    if (users.some((user) => !user.name || !user.email)) {
      showToast("Preencha o nome e o e-mail de todos os usuários adicionados.", "error");
      return;
    }

    if (users.some((user) => !isValidArizonaEmail(user.email))) {
      showToast("Revise o usuário informado antes de @arizona.global.", "error");
      return;
    }

    if (new Set(users.map((user) => user.email)).size !== users.length) {
      showToast("Há usuários com o mesmo e-mail. Revise os cadastros.", "error");
      return;
    }

    if (users.some((user) => domainFromEmail(user.email) !== arizonaDomain)) {
      showToast("Os e-mails dos usuários precisam usar o domínio arizona.global.", "error");
      return;
    }

    if (!Number.isInteger(payload.seatsAllowed) || payload.seatsAllowed < 1) {
      showToast("A licença precisa ter pelo menos uma vaga.", "error");
      return;
    }

    if (
      !Number.isInteger(payload.dailyAuthResetHour)
      || payload.dailyAuthResetHour < 0
      || payload.dailyAuthResetHour > 23
    ) {
      showToast("Escolha um horário válido para a renovação diária.", "error");
      return;
    }

    const invalidPolicyField = accessPolicyFields.find((field) => (
      !Number.isInteger(payload[field.key])
      || payload[field.key] < field.min
      || payload[field.key] > field.max
    ));
    if (invalidPolicyField) {
      showToast(`Revise o campo "${invalidPolicyField.label}".`, "error");
      return;
    }

    if (users.length > payload.seatsAllowed) {
      showToast("A quantidade de usuários ultrapassa as vagas disponíveis.", "error");
      return;
    }

    if (!payload.licenseIsIndefinite && !licenseExpiresOn) {
      showToast("Informe uma data limite válida.", "error");
      return;
    }

    if (!payload.licenseIsIndefinite && licenseExpiresOn < todayDateInput()) {
      showToast("A data limite não pode estar no passado.", "error");
      return;
    }

    await runAsync(async () => {
      const activeSession = await validSession();
      const newUserEmails = new Set(
        licenseDraft.users
          .filter((user) => !user.memberId)
          .map((user) => cleanEmail(user.email))
          .filter(Boolean),
      );
      const data = await functionRequest(
        "master-create-organization",
        payload,
        activeSession.accessToken,
      );
      const generatedCodes = [];
      const generationErrors = [];

      for (const user of data.users || []) {
        if (!newUserEmails.has(cleanEmail(user.email))) continue;

        try {
          const result = await requestActivationCode(
            data.organization?.id,
            user.id,
            activeSession.accessToken,
          );
          if (result?.activation) generatedCodes.push(result.activation);
        } catch (error) {
          generationErrors.push(adminPublicErrorMessage(error));
        }
      }

      if (generatedCodes.length) rememberActivationCodes(generatedCodes);

      try {
        const refreshed = await functionRequest(
          "master-get-license",
          {},
          activeSession.accessToken,
        );
        applyLicense(refreshed);
      } catch {
        applyLicense(data);
      }

      if (generationErrors.length) {
        showToast(
          `Licença salva, mas o código não foi gerado: ${generationErrors[0]}`,
          "error",
        );
      } else if (generatedCodes.length) {
        showToast("Licença salva. Use \"Ver código\" na linha de cada usuário.", "success");
      } else {
        showToast("Licença salva.", "success");
      }
    });
  }

  async function handleSuspendOrganization() {
    if (!hasCurrentLicense) {
      showToast("A licença ainda não foi carregada. Tente novamente.", "error");
      return;
    }

    const confirmed = window.confirm(
      "Suspender a licença agora? TODOS os usuários perdem o acesso ao aplicativo "
      + "em cerca de 30 segundos, na próxima validação de cada máquina. "
      + "Nada é apagado: usuários e máquinas continuam cadastrados e o acesso de "
      + "todos volta automaticamente quando a licença for reativada, sem novo código.",
    );
    if (!confirmed) return;

    await changeOrganizationStatus(
      "paused",
      "Licença suspensa. Cada máquina bloqueia na próxima validação.",
    );
  }

  async function handleResumeOrganization() {
    await changeOrganizationStatus(
      "active",
      "Licença reativada. O acesso volta automaticamente em cada máquina.",
    );
  }

  async function changeOrganizationStatus(status, successMessage) {
    await runAsync(async () => {
      const activeSession = await validSession();
      await functionRequest(
        "master-set-organization-status",
        { status },
        activeSession.accessToken,
      );

      try {
        const refreshed = await functionRequest(
          "master-get-license",
          {},
          activeSession.accessToken,
        );
        applyLicense(refreshed);
      } catch {
        setCurrentLicense((current) => (current?.organization ? {
          ...current,
          organization: { ...current.organization, status },
        } : current));
      }

      showToast(successMessage, "success");
    });
  }

  async function handleGenerateActivationCode(user, anchor = null) {
    const organizationId = currentLicense?.organization?.id;
    if (!organizationId || !user?.memberId) {
      showToast("Salve o usuário antes de gerar o código.", "error");
      return;
    }

    await runAsync(async () => {
      const activeSession = await validSession();
      const result = await requestActivationCode(
        organizationId,
        user.memberId,
        activeSession.accessToken,
      );
      if (!result?.activation) {
        throw new Error("O código de ativação não foi recebido. Tente novamente.");
      }
      rememberActivationCodes([result.activation]);
      setActivationPopover({
        memberId: result.activation.memberId,
        anchor: anchor || null,
      });
      showToast("Código gerado. Copie-o antes de fechar o painel.", "success");
    });
  }

  async function requestActivationCode(organizationId, memberId, accessToken) {
    return functionRequest(
      "admin-generate-activation-code",
      { organizationId, memberId },
      accessToken,
    );
  }

  function rememberActivationCodes(codes) {
    const newMemberIds = new Set(codes.map((activation) => activation.memberId));
    const now = Date.now();
    setActivationCodes((current) => [
      ...codes,
      ...current.filter((activation) => (
        !newMemberIds.has(activation.memberId)
        && new Date(activation.expiresAt).getTime() > now
      )),
    ]);
  }

  async function handleCopyActivationCode(activation) {
    try {
      await navigator.clipboard.writeText(activation.code);
      showToast("Código copiado.", "success");
    } catch {
      showToast("Não foi possível copiar. Selecione o código manualmente.", "error");
    }
  }

  function showActivationCode(user, anchor) {
    const activation = activationCodes.find((candidate) => (
      candidate.memberId === user.memberId
      && new Date(candidate.expiresAt).getTime() > Date.now()
    ));
    if (!activation) {
      handleGenerateActivationCode(user, anchor);
      return;
    }
    setActivationPopover({ memberId: user.memberId, anchor });
  }

  async function handleReleaseDevice(user) {
    const organizationId = currentLicense?.organization?.id;
    const deviceId = user.activeDevice?.id;

    if (!organizationId || !user.memberId || !deviceId) {
      showToast("Este usuário não possui um computador ativo para liberar.", "error");
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
      showToast("O computador foi liberado para este usuário.", "success");
    });
  }

  async function handleResetUserRateLimits(user) {
    const organizationId = currentLicense?.organization?.id;
    if (!organizationId || !user.memberId) {
      showToast("Salve o usuário antes de reiniciar os limites de acesso.", "error");
      return;
    }

    const confirmed = window.confirm(
      `Zerar os tempos das politicas de acesso de ${user.email}? `
      + "Os contadores deste usuario recomecarao do zero. "
      + "Limites globais de IP e de outros usuarios serao preservados.",
    );
    if (!confirmed) return;

    await runAsync(async () => {
      const activeSession = await validSession();
      const result = await functionRequest(
        "master-reset-member-rate-limits",
        { organizationId, memberId: user.memberId },
        activeSession.accessToken,
      );
      const deletedEvents = Number(result?.deletedEvents || 0);
      showToast(
        deletedEvents === 1
          ? "Tempos zerados: 1 contador deste usuario foi limpo."
          : `Tempos zerados: ${deletedEvents} contadores deste usuario foram limpos.`,
        "success",
      );
    });
  }

  async function handleClearUser(user) {
    if (!hasUserContent(user)) return;

    if (!user.memberId) {
      clearDraftUser(user.id);
      showToast("Os dados deste usuário foram removidos da linha.", "success");
      return;
    }

    const organizationId = currentLicense?.organization?.id;
    if (!organizationId) {
      showToast("A licença ainda não foi carregada. Tente novamente.", "error");
      return;
    }

    const confirmed = window.confirm(
      "Remover este usuário libera sua vaga e encerra o acesso no computador atual. Deseja continuar?",
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
      showToast("Usuário removido e vaga liberada.", "success");
    });
  }

  function clearDraftUser(userId) {
    setLicenseDraft((current) => ({
      ...current,
      users: current.users.map((draftUser) => (
        draftUser.id === userId
          ? {
            ...draftUser,
            memberId: null,
            name: "",
            email: "",
            isManager: false,
            activeDevice: null,
          }
          : draftUser
      )),
    }));
  }

  async function runAsync(fn) {
    setIsBusy(true);
    try {
      await fn();
    } catch (error) {
      if (isInvalidAdminSessionError(error)) {
        clearAdminSession();
        replaceAdminSession(null);
      }
      showToast(adminPublicErrorMessage(error), "error");
    } finally {
      setIsBusy(false);
    }
  }

  async function authApi(path, { method = "GET", body, accessToken = "" } = {}) {
    const headers = {
      apikey: adminConfig.publishableKey,
      "content-type": "application/json",
    };
    if (accessToken) headers.authorization = `Bearer ${accessToken}`;
    const response = await fetch(`${adminConfig.supabaseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
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
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        const error = new Error("Não foi possível entender a resposta do serviço.");
        error.code = response.status;
        throw error;
      }
    }

    if (!response.ok || data?.ok === false) {
      const error = new Error(
        data?.error?.message
        || data?.error_description
        || data?.msg
        || data?.message
        || response.statusText
        || `HTTP ${response.status}`,
      );
      error.code = data?.error?.code || data?.error_code || data?.code || response.status;
      error.retryAfterSeconds = Number(data?.error?.retryAfterSeconds || 0);
      error.retryAt = data?.error?.retryAt || "";
      throw error;
    }

    return data;
  }

  async function validSession() {
    const activeSession = sessionRef.current;
    if (!activeSession?.accessToken) {
      throw new Error("Entre com a conta administradora para continuar.");
    }

    const expiryReason = adminSessionExpiryReason(activeSession);
    if (expiryReason) {
      await expireAdminAccess(expiryReason);
      const error = new Error("Sessão administrativa expirada.");
      error.code = "admin_session_expired";
      throw error;
    }

    const expiresAt = Number(activeSession.expiresAt || 0);
    if (expiresAt > Date.now() + 60_000) return activeSession;

    if (!activeSession.refreshToken) {
      const error = new Error("Sessao expirada. Entre novamente com Google.");
      error.code = "invalid_user_token";
      throw error;
    }

    const { data, error } = await supabaseAuth.auth.refreshSession({
      refresh_token: activeSession.refreshToken,
    });
    if (error) throw error;
    const nextSession = sessionFromSupabaseSession(
      data.session,
      activeSession.email,
      activeSession,
    );
    clearSupabaseAuthArtifacts();
    replaceAdminSession(nextSession);
    return nextSession;
  }

  function sessionFromSupabaseSession(data, fallbackEmail = "", previousSession = null) {
    if (!data?.access_token || !data?.refresh_token || !hasOAuthAmr(data.access_token)) {
      const error = new Error("Entre com sua conta Google para acessar o Admin.");
      error.code = "admin_google_oauth_required";
      throw error;
    }

    const email = cleanEmail(
      data.user?.email
      || fallbackEmail
      || emailFromAccessToken(data.access_token),
    );
    if (!email) {
      const error = new Error("A conta Google nao retornou um email valido.");
      error.code = "invalid_user_token";
      throw error;
    }

    return normalizeAdminSessionTiming({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      email,
      expiresAt: Number(data.expires_at || 0) > 0
        ? Number(data.expires_at) * 1000
        : Date.now() + Number(data.expires_in || 3600) * 1000,
      authProvider: "google",
      sessionStartedAt: Number(previousSession?.sessionStartedAt)
        || oauthAuthenticatedAt(data.access_token)
        || Date.now(),
      lastActivityAt: Number(previousSession?.lastActivityAt) || Date.now(),
    });
  }

  function applyLicense(data) {
    setCurrentLicense(data);
    setAuditEvents([]);
    setAuditLoadState("idle");
    setAuditLoadError("");
    setAuditPagination({ total: 0, nextPage: null });

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
      dailyAuthResetHour: String(data.organization?.daily_auth_reset_hour ?? 4),
      licenseExpiresOn: data.organization?.license_expires_on
        ? formatLicenseDate(data.organization.license_expires_on)
        : defaultExpiresOnBr(),
      licenseIsIndefinite: !data.organization?.license_expires_on,
      activationCodeTtlMinutes: String(data.organization?.activation_code_ttl_minutes ?? 15),
      activationAttemptLimit: String(data.organization?.activation_attempt_limit ?? 8),
      activationAttemptWindowMinutes: String(
        data.organization?.activation_attempt_window_minutes ?? 60,
      ),
      activationGenerationLimit: String(
        data.organization?.activation_generation_limit ?? 3,
      ),
      activationGenerationWindowMinutes: String(
        data.organization?.activation_generation_window_minutes ?? 60,
      ),
      deviceReleaseLimit: String(data.organization?.device_release_limit ?? 10),
      deviceReleaseWindowMinutes: String(
        data.organization?.device_release_window_minutes ?? 60,
      ),
      deviceSwitchIntervalDays: String(
        data.organization?.device_switch_interval_days
        ?? data.organization?.device_switch_cooldown_days
        ?? Math.ceil(Number(data.organization?.device_switch_cooldown_minutes || 0) / 1440),
      ),
      deviceRecoveryWindowMinutes: String(
        data.organization?.device_recovery_window_minutes ?? 15,
      ),
    });
  }

  function showToast(message, variant) {
    setToast({ message, variant: variant || "success" });
  }

  return (
    <main
      data-theme={theme}
      className={`admin-shell ${
        isAuthenticated && licenseLoadState === "ready"
          ? "admin-shell--workspace"
          : ""
      }`}
    >
      <section className={`workspace ${isAuthenticated ? "" : "workspace--login"}`} aria-label="Arizona Admin">
        <header className="topbar">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true">
              <img src={arizonaIcon} alt="" />
            </span>
            <div>
              <h1>Arizona Admin</h1>
              <p>Gestão de acessos e licenças</p>
            </div>
          </div>
          <div className="session-actions">
            {isAuthenticated ? (
              <>
                <div className="session-pill session-pill--active">
                  <span className="session-avatar" aria-hidden="true">
                    {sessionLabel.charAt(0).toUpperCase()}
                  </span>
                  <span className="session-copy">
                    <small>Administrador</small>
                    <strong>{sessionLabel}</strong>
                  </span>
                </div>
                <button
                  className="button button--ghost button--small logout-button"
                  type="button"
                  onClick={handleLogout}
                  disabled={isBusy}
                >
                  Sair
                </button>
              </>
            ) : (
              <span className="secure-label">
                <span aria-hidden="true">●</span>
                Acesso protegido
              </span>
            )}
          </div>
        </header>

        {!isAuthenticated ? (
          <section className="panel panel--auth panel--login" aria-labelledby="authTitle">
            <div className="panel-header">
              <div className="panel-title">
                <span className="eyebrow">Conta administradora</span>
                <h2 id="authTitle">Acesse o painel</h2>
              </div>
            </div>
            <div className="form admin-google-login">
              <p>
                Entre com a conta Google vinculada ao administrador do Arizona.
              </p>
              <button
                className="button google-login-button"
                type="button"
                onClick={handleGoogleLogin}
                disabled={isBusy}
              >
                <span className="google-login-button__mark" aria-hidden="true">G</span>
                {isBusy ? "Conectando..." : "Entrar com Google"}
              </button>
              <small>Somente a conta administradora autorizada pode abrir este painel.</small>
            </div>
          </section>
        ) : licenseLoadState !== "ready" ? (
          <section className="panel panel--auth license-load-state" aria-live="polite">
            <div className="panel-header">
              <h2>Licenca Arizona</h2>
            </div>
            {licenseLoadState === "error" ? (
              <>
                <p>Nao foi possivel carregar a licenca e os usuarios.</p>
                <small>{licenseLoadError}</small>
                <button
                  className="button button--primary"
                  type="button"
                  onClick={retryLicenseLoad}
                  disabled={isBusy}
                >
                  Tentar novamente
                </button>
              </>
            ) : (
              <p>Carregando licenca e usuarios...</p>
            )}
          </section>
        ) : (
          <div className="admin-layout">
            <AdminNavigation
              activeSection={activeAdminSection}
              availableSeats={availableSeats}
              filledUsers={filledUsers}
              seatsAllowed={seatsAllowed}
              onOpenLicense={openLicenseSection}
              onOpenPolicies={openPolicySection}
              onOpenLogs={openLogsSection}
              onOpenSettings={openSettingsSection}
            />

            <div className="admin-content">
              {activeAdminSection === "logs" ? (
                <AuditLogPage
                  events={auditEvents}
                  loadState={auditLoadState}
                  loadError={auditLoadError}
                  pagination={auditPagination}
                  onRefresh={refreshAuditEvents}
                  onRetry={refreshAuditEvents}
                  onLoadMore={loadMoreAuditEvents}
                />
              ) : activeAdminSection === "settings" ? (
                <SettingsPage theme={theme} onThemeChange={setTheme} />
              ) : activeAdminSection === "policies" ? (
                <AccessPolicyPage
                  draft={policyDraft}
                  onChange={updatePolicyDraft}
                  onUseTestProfile={() => setPolicyDraft(accessPolicyDraftFrom(testAccessPolicy))}
                  onUseProductionProfile={() => (
                    setPolicyDraft(accessPolicyDraftFrom(productionAccessPolicy))
                  )}
                  onApply={applyPolicyDraft}
                  onBack={openLicenseSection}
                />
              ) : (
                <section className="panel panel--company" aria-labelledby="licenseTitle">
            <div className="panel-header panel-header--license">
              <div className="panel-title">
                <span className="eyebrow">Organização</span>
                <h2 id="licenseTitle">Licença Arizona</h2>
                <p>Controle quem pode acessar o aplicativo e em quais máquinas.</p>
              </div>
              <div className="license-summary">
                <span className="domain-badge">@arizona.global</span>
                <span className="seat-badge">
                  <strong>{availableSeats}</strong>
                  {availableSeats === 1 ? " vaga disponível" : " vagas disponíveis"}
                </span>
                {hasCurrentLicense ? (
                  <span
                    className={`license-status-badge ${
                      isOrganizationPaused ? "license-status-badge--paused" : ""
                    }`}
                  >
                    {isOrganizationPaused ? "Licença suspensa" : "Licença ativa"}
                  </span>
                ) : null}
                {hasCurrentLicense && !isOrganizationPaused ? (
                  <button
                    className="button button--danger button--small"
                    type="button"
                    disabled={isBusy}
                    onClick={handleSuspendOrganization}
                  >
                    Suspender licença agora
                  </button>
                ) : null}
              </div>
            </div>

            {isOrganizationPaused ? (
              <div className="license-suspended-banner" role="alert">
                <div className="license-suspended-banner__copy">
                  <strong>Licença suspensa</strong>
                  <p>
                    Todos os usuários estão bloqueados e veem o motivo na janela de
                    acesso do aplicativo. Usuários e máquinas continuam cadastrados:
                    ao reativar, o acesso de todos volta automaticamente, sem novo
                    código.
                  </p>
                </div>
                <button
                  className="button button--primary"
                  type="button"
                  disabled={isBusy}
                  onClick={handleResumeOrganization}
                >
                  Reativar licença
                </button>
              </div>
            ) : null}

            <form className="form" onSubmit={handleSaveLicense}>
              <section className="license-config" aria-labelledby="licenseConfigTitle">
                <div className="section-heading">
                  <div>
                    <h3 id="licenseConfigTitle">Configuração da licença</h3>
                    <p>Defina capacidade, renovação e validade.</p>
                  </div>
                </div>

                <div className="license-settings">
                  <label className="field field--compact">
                    <span>Vagas</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      required
                      value={licenseDraft.seatsAllowed}
                      onChange={(event) => updateSeatsAllowed(event.target.value)}
                    />
                  </label>
                  <div className="field field--reset-hour">
                    <span>Renovação diária</span>
                    <TimeSelect
                      value={licenseDraft.dailyAuthResetHour}
                      options={dailyAuthResetHourOptions}
                      label="Renovação diária"
                      onChange={(value) => updateLicenseDraft("dailyAuthResetHour", value)}
                    />
                  </div>
                  <div className="validity-field">
                    <span
                      className="setting-label"
                      title="O acesso bloqueia na hora da renovação diária do dia seguinte à data limite."
                    >
                      Validade
                    </span>
                    <div className="validity-controls">
                      <div className="date-control" ref={dateControlRef}>
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength="10"
                          aria-label="Data limite da licença"
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
                          aria-label="Abrir calendário"
                          title="Abrir calendário"
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
                      <label className="indefinite-toggle">
                        <input
                          type="checkbox"
                          checked={licenseDraft.licenseIsIndefinite}
                          onChange={(event) => {
                            updateLicenseDraft("licenseIsIndefinite", event.target.checked);
                            if (event.target.checked) setIsCalendarOpen(false);
                          }}
                        />
                        <span className="indefinite-toggle__control" aria-hidden="true" />
                        <span>Sem vencimento</span>
                      </label>
                    </div>
                  </div>
                  <div className="license-actions">
                    <button
                      className="button button--ghost policy-button"
                      type="button"
                      onClick={openPolicySection}
                    >
                      Revisar políticas
                    </button>
                    <button
                      className="button button--primary save-button"
                      type="submit"
                      disabled={isBusy}
                    >
                      {hasCurrentLicense ? "Salvar alterações" : "Salvar licença"}
                    </button>
                  </div>
                </div>
              </section>

              <section className="user-section" aria-labelledby="usersTitle">
                <div className="section-heading user-section__heading">
                  <div>
                    <h3 id="usersTitle">Usuários</h3>
                    <p>Cadastre a equipe, defina gestores e acompanhe cada dispositivo.</p>
                  </div>
                  <span className="filled-users">
                    <strong>{filledUsers}</strong>
                    {` de ${seatsAllowed || 0} preenchidos`}
                  </span>
                </div>
                <div className="user-list">
                  <div className="user-list__header" aria-hidden="true">
                    <span />
                    <span>Nome</span>
                    <span>E-mail</span>
                    <span>Dispositivo</span>
                    <span>Perfil</span>
                    <span>Ativação</span>
                    <span />
                  </div>
                  {licenseDraft.users.map((user, index) => {
                    const activation = activationCodes.find((candidate) => (
                      candidate.memberId === user.memberId
                      && new Date(candidate.expiresAt).getTime() > Date.now()
                    ));
                    return (
                      <article className="user-row" key={user.id}>
                        <span className="user-index" title={`Usuário ${index + 1}`}>
                          {index + 1}
                        </span>

                        <label className="field user-field user-field--name">
                          <span className="user-cell-label">Nome</span>
                          <input
                            type="text"
                            autoComplete="name"
                            maxLength="160"
                            placeholder="Nome completo"
                            value={user.name}
                            onChange={(event) => updateUser(user.id, "name", event.target.value)}
                          />
                        </label>

                        <label className="field user-field user-field--email">
                          <span className="user-cell-label">E-mail</span>
                          <span className="email-composer">
                            <input
                              type="text"
                              inputMode="email"
                              autoComplete="email"
                              maxLength="64"
                              aria-label={`Usuário do e-mail de ${user.name || `usuário ${index + 1}`}`}
                              placeholder="usuario"
                              value={arizonaEmailLocalPart(user.email)}
                              onChange={(event) => updateUser(
                                user.id,
                                "email",
                                arizonaEmailFromLocalPart(event.target.value),
                              )}
                            />
                            <span className="email-composer__domain">@arizona.global</span>
                          </span>
                        </label>

                        <div className="device-cell">
                          <span className="user-cell-label">Dispositivo</span>
                          {user.activeDevice ? (
                            <div className="device-active">
                              <span className="status-dot status-dot--active" aria-hidden="true" />
                              <div>
                                <strong>{deviceLabel(user.activeDevice)}</strong>
                                <small>{formatDateTimeBr(user.activeDevice.lastSeenAt)}</small>
                              </div>
                              <button
                                className="button button--text button--small"
                                type="button"
                                disabled={isBusy}
                                onClick={() => handleReleaseDevice(user)}
                              >
                                Liberar
                              </button>
                            </div>
                          ) : (
                            <div className="device-empty">
                              <span className="status-dot" aria-hidden="true" />
                              Sem máquina
                            </div>
                          )}
                        </div>

                        <div className="role-cell">
                          <span className="user-cell-label">Perfil</span>
                          <label className="role-toggle">
                            <input
                              type="checkbox"
                              checked={user.isManager}
                              onChange={() => toggleUserManager(user.id)}
                            />
                            <span className="role-toggle__switch" aria-hidden="true" />
                            <span>{user.isManager ? "Gestor" : "Usuário"}</span>
                          </label>
                        </div>

                        <div className="activation-cell">
                          <span className="user-cell-label">Ativação</span>
                          {user.memberId ? (
                            <button
                              className={`button button--small activation-button ${activation ? "button--code-ready" : ""}`}
                              type="button"
                              disabled={isBusy}
                              onClick={(event) => showActivationCode(
                                user,
                                buttonAnchor(event.currentTarget),
                              )}
                            >
                              {activation ? "Ver código" : "Gerar código"}
                            </button>
                          ) : (
                            <span className="draft-status">Disponível após salvar</span>
                          )}
                        </div>

                        <div className="user-overflow">
                          <button
                            className="icon-button user-overflow__trigger"
                            type="button"
                            aria-label={`Mais ações para ${user.name || `usuário ${index + 1}`}`}
                            aria-haspopup="menu"
                            aria-expanded={openUserMenuId === user.id}
                            aria-controls={`user-actions-${user.id}`}
                            disabled={isBusy || !hasUserContent(user)}
                            onClick={() => setOpenUserMenuId((current) => (
                              current === user.id ? null : user.id
                            ))}
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <circle cx="5" cy="12" r="1.5" />
                              <circle cx="12" cy="12" r="1.5" />
                              <circle cx="19" cy="12" r="1.5" />
                            </svg>
                          </button>
                          {openUserMenuId === user.id ? (
                            <div
                              className="user-overflow__menu"
                              id={`user-actions-${user.id}`}
                              role="menu"
                            >
                              {user.memberId ? (
                                <>
                                  <span className="user-overflow__label">Manutenção</span>
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => {
                                      setOpenUserMenuId(null);
                                      handleResetUserRateLimits(user);
                                    }}
                                  >
                                    Zerar limites de acesso
                                  </button>
                                  <span className="user-overflow__separator" />
                                </>
                              ) : null}
                              <button
                                className="user-overflow__danger"
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setOpenUserMenuId(null);
                                  handleClearUser(user);
                                }}
                              >
                                {user.memberId ? "Remover usuário" : "Limpar campos"}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            </form>
                </section>
              )}
            </div>
          </div>
        )}
      </section>

      {popoverActivation ? createPortal(
        <ActivationCodePopover
          activation={popoverActivation}
          anchor={activationPopover?.anchor}
          isBusy={isBusy}
          onClose={() => setActivationPopover(null)}
          onCopy={() => handleCopyActivationCode(popoverActivation)}
          onRegenerate={() => {
            const user = licenseDraft.users.find(
              (candidate) => candidate.memberId === popoverActivation.memberId,
            );
            if (user) handleGenerateActivationCode(user, activationPopover?.anchor);
          }}
        />,
        document.body,
      ) : null}

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

function AdminNavigation({
  activeSection,
  availableSeats,
  filledUsers,
  seatsAllowed,
  onOpenLicense,
  onOpenPolicies,
  onOpenLogs,
  onOpenSettings,
}) {
  return (
    <aside className="admin-sidebar">
      <div className="admin-sidebar__main">
        <div className="admin-sidebar__heading">
          <span>Administração</span>
          <strong>Painel de controle</strong>
        </div>

        <nav className="admin-nav" aria-label="Áreas do painel">
          <button
            className={activeSection === "license" ? "is-active" : ""}
            type="button"
            aria-current={activeSection === "license" ? "page" : undefined}
            onClick={() => {
              if (activeSection !== "license") onOpenLicense();
            }}
          >
            <span className="admin-nav__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M4 6.5h16M7 3.5v6M17 3.5v6M5.5 6.5h13a1.5 1.5 0 0 1 1.5 1.5v10.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a1.5 1.5 0 0 1 1.5-1.5Z" />
                <path d="M8 13h3M8 16.5h7" />
              </svg>
            </span>
            <span className="admin-nav__copy">
              <strong>Licença e usuários</strong>
            </span>
            <span className="admin-nav__count">{filledUsers}</span>
          </button>

          <button
            className={activeSection === "policies" ? "is-active" : ""}
            type="button"
            aria-current={activeSection === "policies" ? "page" : undefined}
            onClick={() => {
              if (activeSection !== "policies") onOpenPolicies();
            }}
          >
            <span className="admin-nav__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 3 5 6v5c0 4.5 2.7 8.2 7 10 4.3-1.8 7-5.5 7-10V6l-7-3Z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
            </span>
            <span className="admin-nav__copy">
              <strong>Políticas de acesso</strong>
            </span>
          </button>

          <button
            className={activeSection === "logs" ? "is-active" : ""}
            type="button"
            aria-current={activeSection === "logs" ? "page" : undefined}
            onClick={() => {
              if (activeSection !== "logs") onOpenLogs();
            }}
          >
            <span className="admin-nav__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M4 6h16M4 12h10M4 18h8" />
                <circle cx="18" cy="17" r="3" />
                <path d="M18 15.5V17l1 1" />
              </svg>
            </span>
            <span className="admin-nav__copy">
              <strong>Histórico de atividades</strong>
            </span>
          </button>

          <button
            className={activeSection === "settings" ? "is-active" : ""}
            type="button"
            aria-current={activeSection === "settings" ? "page" : undefined}
            onClick={() => {
              if (activeSection !== "settings") onOpenSettings();
            }}
          >
            <span className="admin-nav__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.12.37.34.7.63.96.3.27.68.41 1.08.4H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z" />
              </svg>
            </span>
            <span className="admin-nav__copy">
              <strong>Configurações</strong>
            </span>
          </button>
        </nav>
      </div>

      <div className="admin-sidebar__organization">
        <span className="admin-sidebar__organization-mark" aria-hidden="true">
          <img src={arizonaIcon} alt="" />
        </span>
        <span>
          <small>Organização</small>
          <strong>arizona.global</strong>
          <em>{`${availableSeats} de ${seatsAllowed || 0} vagas disponíveis`}</em>
        </span>
      </div>
    </aside>
  );
}

function AuditLogPage({
  events,
  loadState,
  loadError,
  pagination,
  onRefresh,
  onRetry,
  onLoadMore,
}) {
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const filters = [
    { value: "all", label: "Todos" },
    { value: "devices", label: "Computadores" },
    { value: "access", label: "Ativação" },
    { value: "members", label: "Usuários" },
    { value: "license", label: "Licença" },
    { value: "security", label: "Segurança" },
  ];
  const normalizedSearch = search.trim().toLowerCase();
  const rangeStart = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null;
  const rangeEnd = dateTo ? new Date(`${dateTo}T23:59:59.999`) : null;
  const hasDateFilter = Boolean(dateFrom || dateTo);
  const visibleEvents = events.filter((event) => {
    const info = auditActionInfo(event.action);
    if (category !== "all" && info.category !== category) return false;
    if (rangeStart || rangeEnd) {
      const eventDate = new Date(event.createdAt);
      if (Number.isNaN(eventDate.getTime())) return false;
      if (rangeStart && eventDate < rangeStart) return false;
      if (rangeEnd && eventDate > rangeEnd) return false;
    }
    if (!normalizedSearch) return true;
    return [
      info.label,
      info.description(event),
      auditIdentityName(event.actor),
      event.actor?.email,
      auditIdentityName(event.target),
      event.target?.email,
      auditSourceLabel(event.context?.source),
    ].some((value) => String(value || "").toLowerCase().includes(normalizedSearch));
  });
  const isInitialLoading = loadState === "loading" && events.length === 0;
  const isRefreshing = loadState === "loading" && events.length > 0;

  return (
    <section className="panel audit-page" aria-labelledby="auditPageTitle">
      <header className="audit-page__header">
        <div>
          <span className="eyebrow">Rastreabilidade</span>
          <h2 id="auditPageTitle">Histórico de atividades</h2>
          <p>Acompanhe ações administrativas, ativações e mudanças de computadores.</p>
        </div>
        <div className="audit-page__header-actions">
          <span className="audit-total">
            <strong>{pagination.total}</strong>
            {pagination.total === 1 ? " registro" : " registros"}
          </span>
          <button
            className="button button--ghost audit-refresh"
            type="button"
            disabled={loadState === "loading" || loadState === "loading-more"}
            onClick={onRefresh}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 7v5h-5M4 17v-5h5" />
              <path d="M6.1 9A7 7 0 0 1 18 6.3L20 8M4 16l2 1.7A7 7 0 0 0 17.9 15" />
            </svg>
            {isRefreshing ? "Atualizando..." : "Atualizar"}
          </button>
        </div>
      </header>

      <div className="audit-page__toolbar">
        <label className="audit-search">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m16 16 4 4" />
          </svg>
          <input
            type="search"
            placeholder="Buscar por pessoa, ação ou computador"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className="audit-filters" aria-label="Filtrar registros">
          {filters.map((filter) => (
            <button
              className={category === filter.value ? "is-selected" : ""}
              type="button"
              key={filter.value}
              aria-pressed={category === filter.value}
              onClick={() => setCategory(filter.value)}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <div className="audit-date-range" aria-label="Filtrar por período">
          <label className="audit-date-range__field">
            <span>De</span>
            <input
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(event) => setDateFrom(event.target.value)}
              aria-label="Data inicial"
            />
          </label>
          <span className="audit-date-range__sep" aria-hidden="true">–</span>
          <label className="audit-date-range__field">
            <span>Até</span>
            <input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(event) => setDateTo(event.target.value)}
              aria-label="Data final"
            />
          </label>
          {hasDateFilter ? (
            <button
              type="button"
              className="audit-date-range__clear"
              onClick={() => {
                setDateFrom("");
                setDateTo("");
              }}
              aria-label="Limpar filtro de período"
            >
              ×
            </button>
          ) : null}
        </div>
      </div>

      <div className="audit-page__content" aria-live="polite">
        {loadError && events.length > 0 ? (
          <div className="audit-inline-error">
            <span>{loadError}</span>
            <button type="button" onClick={onRetry}>Tentar novamente</button>
          </div>
        ) : null}

        {isInitialLoading ? (
          <AuditLogSkeleton />
        ) : loadState === "error" && events.length === 0 ? (
          <div className="audit-empty audit-empty--error">
            <span className="audit-empty__icon" aria-hidden="true">!</span>
            <h3>Não foi possível carregar os registros</h3>
            <p>{loadError}</p>
            <button className="button button--primary" type="button" onClick={onRetry}>
              Tentar novamente
            </button>
          </div>
        ) : events.length === 0 ? (
          <div className="audit-empty">
            <span className="audit-empty__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" />
              </svg>
            </span>
            <h3>Nenhuma atividade registrada</h3>
            <p>As próximas ações administrativas e de computadores aparecerão aqui.</p>
          </div>
        ) : visibleEvents.length === 0 ? (
          <div className="audit-empty">
            <h3>Nenhum resultado encontrado</h3>
            <p>
              {pagination.nextPage !== null
                ? `A busca considerou os ${events.length} registros carregados. Carregue mais para ampliar o período.`
                : "Ajuste a busca, o período selecionado ou escolha outra categoria."}
            </p>
            {pagination.nextPage !== null ? (
              <button
                className="button button--ghost"
                type="button"
                disabled={loadState === "loading-more"}
                onClick={onLoadMore}
              >
                {loadState === "loading-more" ? "Carregando..." : "Buscar em mais registros"}
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="audit-list">
              <div className="audit-list__header" aria-hidden="true">
                <span>Data e hora</span>
                <span>Ação</span>
                <span>Responsável</span>
                <span>Alvo</span>
                <span>Origem</span>
              </div>
              {visibleEvents.map((event) => {
                const info = auditActionInfo(event.action);
                return (
                  <article className="audit-row" key={event.id}>
                    <time dateTime={event.createdAt}>
                      <strong>{formatAuditDate(event.createdAt)}</strong>
                      <small>{formatAuditTime(event.createdAt)}</small>
                    </time>
                    <div className="audit-action-cell">
                      <span className={`audit-action-icon audit-action-icon--${info.tone}`}>
                        {auditActionIcon(info.icon)}
                      </span>
                      <span>
                        <strong>{info.label}</strong>
                        <small>{info.description(event)}</small>
                      </span>
                    </div>
                    <AuditIdentity identity={event.actor} fallback="Sistema" />
                    <AuditIdentity identity={event.target} fallback="—" target />
                    <span className="audit-source">
                      {auditSourceLabel(event.context?.source)}
                    </span>
                  </article>
                );
              })}
            </div>

            {pagination.nextPage !== null ? (
              <div className="audit-load-more">
                <span>{`${events.length} de ${pagination.total} registros carregados`}</span>
                <button
                  className="button button--ghost"
                  type="button"
                  disabled={loadState === "loading-more"}
                  onClick={onLoadMore}
                >
                  {loadState === "loading-more" ? "Carregando..." : "Carregar mais"}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function AuditIdentity({ identity, fallback, target = false }) {
  if (!identity) {
    return <span className="audit-identity audit-identity--empty">{fallback}</span>;
  }

  const primary = auditIdentityName(identity);
  const secondary = identity.email && identity.email !== primary
    ? identity.email
    : auditRoleLabel(identity.role, identity.kind);

  return (
    <span className="audit-identity">
      <span className={`audit-identity__avatar ${target ? "audit-identity__avatar--target" : ""}`}>
        {primary.charAt(0).toUpperCase()}
      </span>
      <span>
        <strong>{primary}</strong>
        {secondary ? <small>{secondary}</small> : null}
      </span>
    </span>
  );
}

function AuditLogSkeleton() {
  return (
    <div className="audit-skeleton" aria-label="Carregando registros">
      {Array.from({ length: 6 }, (_, index) => (
        <span key={index}>
          <i />
          <i />
          <i />
          <i />
        </span>
      ))}
    </div>
  );
}

function SettingsPage({ theme, onThemeChange }) {
  const options = [
    {
      value: "light",
      label: "Tema claro",
      description: "Superfícies claras e contraste suave para uso durante o dia.",
    },
    {
      value: "dark",
      label: "Tema escuro",
      description: "Superfícies escuras para ambientes com pouca luz.",
    },
  ];

  return (
    <section className="panel settings-page" aria-labelledby="settingsPageTitle">
      <header className="settings-page__header">
        <div>
          <span className="eyebrow">Preferências do painel</span>
          <h2 id="settingsPageTitle">Configurações</h2>
          <p>Personalize a aparência do Arizona Admin neste navegador.</p>
        </div>
      </header>

      <div className="settings-page__content">
        <section className="settings-section" aria-labelledby="appearanceTitle">
          <div className="settings-section__heading">
            <span className="settings-section__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" />
              </svg>
            </span>
            <div>
              <h3 id="appearanceTitle">Aparência</h3>
              <p>Escolha como o painel deve ser exibido.</p>
            </div>
          </div>

          <div className="theme-options" role="radiogroup" aria-label="Tema da interface">
            {options.map((option) => {
              const isSelected = theme === option.value;
              return (
                <button
                  className={`theme-option ${isSelected ? "is-selected" : ""}`}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  key={option.value}
                  onClick={() => onThemeChange(option.value)}
                >
                  <span className={`theme-preview theme-preview--${option.value}`} aria-hidden="true">
                    <span className="theme-preview__sidebar">
                      <img src={arizonaIcon} alt="" />
                      <i />
                      <i />
                      <i />
                    </span>
                    <span className="theme-preview__canvas">
                      <i />
                      <i />
                      <i />
                    </span>
                  </span>
                  <span className="theme-option__copy">
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </span>
                  <span className="theme-option__check" aria-hidden="true">
                    {isSelected ? (
                      <svg viewBox="0 0 24 24">
                        <path d="m6 12 4 4 8-8" />
                      </svg>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>

          <p className="settings-section__note">
            A preferência fica salva somente neste navegador e não altera o aplicativo distribuído.
          </p>
        </section>
      </div>
    </section>
  );
}

function TimeSelect({ value, options, label, onChange }) {
  const listboxId = useId();
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const [highlightedIndex, setHighlightedIndex] = useState(selectedIndex);
  const [inputValue, setInputValue] = useState(() => (
    options[selectedIndex]?.label || value
  ));
  const [isTyping, setIsTyping] = useState(false);
  const [hasInputError, setHasInputError] = useState(false);
  const selectedOption = options[selectedIndex] || options[0];

  useEffect(() => {
    if (!isOpen) return undefined;

    function closeOnOutsideClick(event) {
      if (!rootRef.current?.contains(event.target)) setIsOpen(false);
    }

    function closeOnEscape(event) {
      if (event.key === "Escape") setIsOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    document
      .getElementById(`${listboxId}-option-${highlightedIndex}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex, isOpen, listboxId]);

  function openMenu() {
    setHighlightedIndex(selectedIndex);
    setIsOpen(true);
  }

  function selectOption(index) {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setInputValue(option.label);
    setIsTyping(false);
    setHasInputError(false);
    setHighlightedIndex(index);
    setIsOpen(false);
  }

  function commitTypedValue() {
    const hour = parseResetHour(inputValue, true);
    if (hour === null) {
      setInputValue(selectedOption?.label || value);
      setIsTyping(false);
      setHasInputError(true);
      setIsOpen(false);
      return false;
    }

    const normalizedValue = String(hour);
    const normalizedIndex = options.findIndex((option) => option.value === normalizedValue);
    onChange(normalizedValue);
    setInputValue(`${String(hour).padStart(2, "0")}:00`);
    setHighlightedIndex(Math.max(0, normalizedIndex));
    setIsTyping(false);
    setHasInputError(false);
    setIsOpen(false);
    return true;
  }

  function handleInputChange(event) {
    const draft = sanitizeTimeInput(event.target.value);
    const completeHour = parseResetHour(draft, false);
    setInputValue(draft);
    setIsTyping(true);
    setHasInputError(false);
    if (!isOpen) setIsOpen(true);

    if (completeHour !== null) {
      const normalizedValue = String(completeHour);
      const matchingIndex = options.findIndex((option) => option.value === normalizedValue);
      onChange(normalizedValue);
      setHighlightedIndex(Math.max(0, matchingIndex));
    }
  }

  function handleInputBlur() {
    window.setTimeout(() => {
      if (!rootRef.current?.contains(document.activeElement)) commitTypedValue();
    }, 0);
  }

  function handleKeyDown(event) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) {
        openMenu();
        return;
      }
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setIsTyping(false);
      setHighlightedIndex((current) => (
        (current + direction + options.length) % options.length
      ));
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      if (!isOpen) return;
      event.preventDefault();
      setHighlightedIndex(event.key === "Home" ? 0 : options.length - 1);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (isTyping) {
        commitTypedValue();
      } else if (isOpen) {
        selectOption(highlightedIndex);
      } else {
        commitTypedValue();
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setInputValue(selectedOption?.label || value);
      setIsTyping(false);
      setHasInputError(false);
      setIsOpen(false);
      return;
    }

    if (event.key === "Tab") setIsOpen(false);
  }

  return (
    <div className="time-select" ref={rootRef}>
      <div className={`time-select__control ${hasInputError ? "time-select__control--error" : ""}`}>
        <input
          className="time-select__input"
          ref={inputRef}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          maxLength="5"
          role="combobox"
          aria-label={label}
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-invalid={hasInputError}
          aria-activedescendant={isOpen ? `${listboxId}-option-${highlightedIndex}` : undefined}
          value={inputValue}
          onBlur={handleInputBlur}
          onChange={handleInputChange}
          onFocus={(event) => {
            event.currentTarget.select();
            openMenu();
          }}
          onKeyDown={handleKeyDown}
        />
        <button
          className="time-select__toggle"
          type="button"
          tabIndex={-1}
          aria-label={isOpen ? "Fechar horários" : "Abrir horários"}
          aria-expanded={isOpen}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            inputRef.current?.focus();
            if (isOpen) {
              setIsOpen(false);
            } else {
              openMenu();
            }
          }}
        >
          <svg
            className="time-select__chevron"
            viewBox="0 0 20 20"
            aria-hidden="true"
          >
            <path d="m5.5 7.5 4.5 4.5 4.5-4.5" />
          </svg>
        </button>
      </div>

      {hasInputError ? (
        <small className="time-select__error" role="alert">
          Use 00:00–23:00, com minutos 00.
        </small>
      ) : null}

      {isOpen ? (
        <div className="time-select__menu" id={listboxId} role="listbox" aria-label={label}>
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isHighlighted = index === highlightedIndex;
            return (
              <button
                className={[
                  "time-select__option",
                  isSelected ? "time-select__option--selected" : "",
                  isHighlighted ? "time-select__option--highlighted" : "",
                ].filter(Boolean).join(" ")}
                id={`${listboxId}-option-${index}`}
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => selectOption(index)}
              >
                <span>{option.label}</span>
                {isSelected ? (
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="m5 10 3 3 7-7" />
                  </svg>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function sanitizeTimeInput(value) {
  const cleaned = String(value || "").replace(/[^\d:]/g, "");
  if (cleaned.includes(":")) {
    const [hour = "", ...minuteParts] = cleaned.split(":");
    const minutes = minuteParts.join("");
    return `${hour.slice(0, 2)}:${minutes.slice(0, 2)}`;
  }

  const digits = cleaned.slice(0, 4);
  return digits.length > 2
    ? `${digits.slice(0, 2)}:${digits.slice(2)}`
    : digits;
}

function parseResetHour(value, allowShortHour) {
  const text = String(value || "").trim();
  const shortMatch = allowShortHour ? text.match(/^(\d{1,2})$/) : null;
  const timeMatch = text.match(/^(\d{1,2}):(\d{2})$/);
  const hour = Number(shortMatch?.[1] ?? timeMatch?.[1]);
  const minutes = shortMatch ? 0 : Number(timeMatch?.[2]);

  if (
    !Number.isInteger(hour)
    || hour < 0
    || hour > 23
    || minutes !== 0
  ) {
    return null;
  }

  return hour;
}

function accessPolicyProfileFrom(draft) {
  const matches = (profile) => accessPolicyFields.every((field) => {
    const value = String(draft?.[field.key] ?? "").trim();
    return value !== "" && Number(value) === Number(profile[field.key]);
  });

  if (matches(productionAccessPolicy)) return "production";
  if (matches(testAccessPolicy)) return "test";
  return "custom";
}

function AccessPolicyPage({
  draft,
  onChange,
  onUseTestProfile,
  onUseProductionProfile,
  onApply,
  onBack,
}) {
  const selectedProfile = accessPolicyProfileFrom(draft);
  const profileDetails = {
    production: {
      label: "Produção",
      description: "Limites recomendados para o uso diário da equipe.",
    },
    test: {
      label: "Teste",
      description: "Limites mais permissivos para validar os fluxos rapidamente.",
    },
    custom: {
      label: "Personalizado",
      description: "Um ou mais valores foram ajustados manualmente.",
    },
  }[selectedProfile];

  return (
    <section className="panel policy-page" aria-labelledby="policyPageTitle">
      <header className="policy-page__header">
        <div className="policy-page__header-copy">
          <span className="eyebrow">Segurança e limites</span>
          <h2 id="policyPageTitle">Políticas de acesso</h2>
          <p>
            Controle a geração de códigos, as tentativas de ativação e a troca de dispositivos.
          </p>
        </div>
        <div className="policy-page__save-state">
          <span aria-hidden="true" />
          <div>
            <strong>Configuração da licença</strong>
            <small>O salvamento definitivo é feito em “Licença e usuários”.</small>
          </div>
        </div>
      </header>

      <section className={`policy-profile policy-profile--${selectedProfile}`}>
        <div className="policy-profile__summary">
          <div>
            <span>Perfil em edição</span>
            <strong>{profileDetails.label}</strong>
          </div>
          <p>{profileDetails.description}</p>
          <small>As proteções globais de emergência continuam ativas em qualquer perfil.</small>
        </div>

        <div
          className="policy-profile__toggle"
          role="radiogroup"
          aria-label="Perfil das políticas de acesso"
        >
          <button
            className={selectedProfile === "production" ? "is-selected" : ""}
            type="button"
            role="radio"
            aria-checked={selectedProfile === "production"}
            onClick={onUseProductionProfile}
          >
            <span>Produção</span>
            <small>Recomendado</small>
          </button>
          <button
            className={selectedProfile === "test" ? "is-selected" : ""}
            type="button"
            role="radio"
            aria-checked={selectedProfile === "test"}
            onClick={onUseTestProfile}
          >
            <span>Teste</span>
            <small>Validação rápida</small>
          </button>
        </div>

        {selectedProfile === "test" ? (
          <div className="policy-profile__notice" role="note">
            O perfil de teste reduz intervalos e amplia limites. Use-o apenas temporariamente.
          </div>
        ) : null}
      </section>

      <div className="policy-page__content">
        {accessPolicyGroups.map((group, groupIndex) => (
          <section className="policy-group" key={group.title}>
            <div className="policy-group__heading">
              <div>
                <span className="policy-group__index" aria-hidden="true">
                  {String(groupIndex + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3>{group.title}</h3>
                  <p>{group.description}</p>
                </div>
              </div>
              <span>{`${group.fields.length} ${group.fields.length === 1 ? "regra" : "regras"}`}</span>
            </div>
            <div className="policy-table__header" aria-hidden="true">
              <span>Regra</span>
              <span>Valor</span>
            </div>
            <div className="policy-grid">
              {group.fields.map((field) => (
                <label className="policy-field" key={field.key}>
                  <span className="policy-field__copy">
                    <strong>{field.label}</strong>
                    <small>{field.description}</small>
                  </span>
                  <span className="policy-field__control">
                    <input
                      type="number"
                      min={field.min}
                      max={field.max}
                      step="1"
                      required
                      aria-label={`${field.label}, de ${field.min} a ${field.max} ${field.unit}`}
                      value={draft[field.key] ?? ""}
                      onChange={(event) => onChange(field.key, event.target.value)}
                    />
                    <small>{field.unit}</small>
                  </span>
                </label>
              ))}
            </div>
          </section>
        ))}
      </div>

      <footer className="policy-page__footer">
        <div className="policy-apply-hint">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v6M12 7h.01" />
          </svg>
          <span>
            <strong>Aplicar não salva ainda.</strong>
            {" Você voltará à licença para revisar e salvar tudo junto."}
          </span>
        </div>
        <div className="button-row">
          <button className="button button--ghost" type="button" onClick={onBack}>
            Voltar sem aplicar
          </button>
          <button className="button button--primary" type="button" onClick={onApply}>
            Aplicar à licença
          </button>
        </div>
      </footer>
    </section>
  );
}

function ActivationCodePopover({
  activation,
  anchor,
  isBusy,
  onClose,
  onCopy,
  onRegenerate,
}) {
  return (
    <div className="popover-layer" onPointerDown={onClose}>
      <aside
        className="activation-popover"
        style={activationPopoverPosition(anchor)}
        role="dialog"
        aria-modal="false"
        aria-label={`Codigo de ativacao de ${activation.email}`}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="activation-popover__header">
          <div>
            <span>Codigo de ativacao</span>
            <strong>{activation.email}</strong>
          </div>
          <button
            className="overlay-close overlay-close--small"
            type="button"
            aria-label="Fechar codigo"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <code className="activation-popover__code">{activation.code}</code>
        <small className="activation-popover__expiry">
          {`Expira em ${formatDateTimeBr(activation.expiresAt)}`}
        </small>

        <div className="activation-popover__actions">
          <button className="button button--primary" type="button" onClick={onCopy}>
            <svg viewBox="0 0 960 960" aria-hidden="true">
              <path d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Z" />
            </svg>
            Copiar
          </button>
          <button
            className="button button--ghost"
            type="button"
            disabled={isBusy}
            onClick={onRegenerate}
          >
            Gerar novo
          </button>
        </div>
      </aside>
    </div>
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

function accessPolicyDraftFrom(source) {
  return Object.fromEntries(
    accessPolicyFields.map((field) => [field.key, String(source?.[field.key] ?? "")]),
  );
}

function buttonAnchor(element) {
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
  };
}

function activationPopoverPosition(anchor) {
  if (typeof window === "undefined") return {};

  const margin = 12;
  const gap = 8;
  const width = Math.min(360, window.innerWidth - (margin * 2));
  const estimatedHeight = 230;

  if (!anchor) {
    return {
      left: `${Math.max(margin, (window.innerWidth - width) / 2)}px`,
      top: `${Math.max(margin, (window.innerHeight - estimatedHeight) / 2)}px`,
    };
  }

  const left = Math.min(
    window.innerWidth - width - margin,
    Math.max(margin, anchor.right - width),
  );
  let top = anchor.bottom + gap;
  if (top + estimatedHeight > window.innerHeight - margin) {
    top = Math.max(margin, anchor.top - estimatedHeight - gap);
  }

  return {
    left: `${left}px`,
    top: `${top}px`,
  };
}

function loadAdminTheme() {
  if (typeof window === "undefined") return "light";

  try {
    return localStorage.getItem(themeStorageKey) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function loadJson(key) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function consumeOAuthCallback() {
  if (typeof window === "undefined") return { code: "", error: "" };

  const url = new URL(window.location.href);
  const code = url.searchParams.get("code") || "";
  const oauthError = url.searchParams.get("error_description")
    || url.searchParams.get("error")
    || "";
  const hasOAuthCallback = Boolean(
    code
    || oauthError
    || url.searchParams.get("error_code"),
  );

  if (hasOAuthCallback) {
    ["code", "error", "error_code", "error_description"].forEach((key) => {
      url.searchParams.delete(key);
    });
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  }

  return {
    code,
    error: oauthError ? `O acesso Google nao foi concluido: ${oauthError}` : "",
  };
}

function adminOAuthRedirectUrl() {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  return url.toString();
}

function accessTokenPayload(accessToken) {
  try {
    const payload = String(accessToken || "").split(".")[1];
    if (!payload) return {};
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded));
  } catch {
    return {};
  }
}

function hasOAuthAmr(accessToken) {
  const payload = accessTokenPayload(accessToken);
  return Array.isArray(payload?.amr)
    && payload.amr.some((entry) => entry?.method === "oauth");
}

function oauthAuthenticatedAt(accessToken) {
  const payload = accessTokenPayload(accessToken);
  if (!Array.isArray(payload?.amr)) return 0;

  const timestamps = payload.amr
    .filter((entry) => entry?.method === "oauth")
    .map((entry) => Number(entry?.timestamp))
    .filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0);
  return timestamps.length ? Math.max(...timestamps) * 1000 : 0;
}

function emailFromAccessToken(accessToken) {
  return cleanEmail(accessTokenPayload(accessToken)?.email);
}

function loadAdminSession() {
  try {
    const value = sessionStorage.getItem(sessionKey);
    if (!value) return null;
    const parsed = JSON.parse(value);
    if (
      !parsed?.accessToken
      || !parsed?.refreshToken
      || !parsed?.email
      || !Number.isFinite(Number(parsed?.expiresAt))
      || parsed?.authProvider !== "google"
      || !hasOAuthAmr(parsed.accessToken)
    ) {
      sessionStorage.removeItem(sessionKey);
      return null;
    }
    const normalized = normalizeAdminSessionTiming({
      ...parsed,
      sessionStartedAt: Number(parsed.sessionStartedAt)
        || oauthAuthenticatedAt(parsed.accessToken),
    });
    if (adminSessionExpiryReason(normalized)) {
      sessionStorage.removeItem(sessionKey);
      return null;
    }
    return normalized;
  } catch {
    return null;
  }
}

function persistAdminSession(session) {
  try {
    sessionStorage.setItem(sessionKey, JSON.stringify(session));
  } catch {
    // The page still works; only reload persistence is unavailable.
  }
}

function clearAdminSession() {
  try {
    sessionStorage.removeItem(sessionKey);
    clearSupabaseAuthArtifacts();
  } catch {
    // Nothing else is required when storage is unavailable.
  }
}

function clearSupabaseAuthArtifacts() {
  [
    oauthStorageKey,
    `${oauthStorageKey}-user`,
    `${oauthStorageKey}-code-verifier`,
  ].forEach((key) => {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // The standalone sanitized session is cleared independently.
    }
  });
}

function isInvalidAdminSessionError(error) {
  return [
    "admin_google_oauth_required",
    "admin_session_expired",
    "forbidden",
    "invalid_user_token",
    "refresh_token_not_found",
    "invalid_grant",
  ].includes(String(error?.code || ""));
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

function arizonaEmailLocalPart(value) {
  return cleanText(value).split("@")[0] || "";
}

function arizonaEmailFromLocalPart(value) {
  const localPart = cleanText(value)
    .split("@")[0]
    .replace(/\s+/g, "");
  return localPart ? `${localPart}@${arizonaDomain}` : "";
}

function isValidArizonaEmail(value) {
  return /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@arizona\.global$/i
    .test(cleanText(value));
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

function formatAuditDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data desconhecida";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date).replace(".", "");
}

function formatAuditTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function auditIdentityName(identity) {
  if (!identity) return "";
  if (identity.kind === "organization") return identity.name || "Arizona";
  if (identity.kind === "device") {
    return identity.name || identity.memberName || identity.email || "Computador";
  }
  return identity.name || identity.email || (
    identity.kind === "master" ? "Administrador principal" : "Usuário"
  );
}

function auditRoleLabel(role, kind) {
  if (kind === "device") return "Computador";
  if (kind === "organization") return "Organização";
  if (role === "master" || kind === "master") return "Administrador principal";
  if (role === "admin") return "Gestor";
  if (role === "user") return "Usuário";
  return "";
}

function auditSourceLabel(source) {
  return {
    admin_web_panel: "Painel administrativo",
    master_license_panel: "Painel administrativo",
    tauri_admin_panel: "Gestão no Arizona App",
    tauri_passwordless_login: "Arizona App",
    tauri_passwordless_activation: "Arizona App",
  }[source] || "Sistema";
}

function auditActionInfo(action) {
  const definitions = {
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
  };

  return definitions[action] || {
    category: "security",
    tone: "neutral",
    icon: "history",
    label: "Atividade registrada",
    description: () => "Uma atividade do sistema foi registrada.",
  };
}

function auditActionIcon(icon) {
  const paths = {
    device: (
      <>
        <rect x="5" y="4" width="14" height="12" rx="2" />
        <path d="M9 20h6M12 16v4" />
      </>
    ),
    key: (
      <>
        <circle cx="8" cy="12" r="4" />
        <path d="m12 12 7-7M16 8l2 2M18 6l2 2" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="8" r="3" />
        <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
      </>
    ),
    shield: (
      <>
        <path d="M12 3 5 6v5c0 4.5 2.7 8.2 7 10 4.3-1.8 7-5.5 7-10V6l-7-3Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
    license: (
      <>
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <path d="M8 9h8M8 13h5" />
      </>
    ),
    history: (
      <>
        <path d="M4 12a8 8 0 1 0 2.34-5.66L4 8.68" />
        <path d="M4 4v4.68h4.68M12 8v4l3 2" />
      </>
    ),
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {paths[icon] || paths.history}
    </svg>
  );
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
