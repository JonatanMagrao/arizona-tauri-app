import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { adminConfig } from "./config.js";

const flashKey = `arizona-admin-flash:${adminConfig.projectRef}`;
const sessionKey = `arizona-admin-session:${adminConfig.projectRef}`;
const arizonaDomain = "arizona.global";
const dailyAuthResetHourOptions = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: `${String(hour).padStart(2, "0")}:00`,
}));
const accessPolicyGroups = [
  {
    title: "Codigos e ativacao",
    fields: [
      {
        key: "activationCodeTtlMinutes",
        label: "Validade do codigo",
        unit: "min",
        min: 5,
        max: 60,
        description: "Tempo que um codigo gerado continua valido antes de expirar.",
      },
      {
        key: "activationGenerationLimit",
        label: "Geracoes por usuario",
        unit: "codigos",
        min: 1,
        max: 50,
        description: "Quantidade de codigos que o mesmo usuario pode receber dentro da janela de geracao.",
      },
      {
        key: "activationGenerationWindowMinutes",
        label: "Janela de geracao",
        unit: "min",
        min: 1,
        max: 1440,
        description: "Periodo movel usado para contar as geracoes por usuario.",
      },
      {
        key: "activationAttemptLimit",
        label: "Tentativas por email",
        unit: "tentativas",
        min: 1,
        max: 100,
        description: "Tentativas de ativacao permitidas para o mesmo e-mail, validas ou invalidas.",
      },
      {
        key: "activationAttemptWindowMinutes",
        label: "Janela de tentativas",
        unit: "min",
        min: 1,
        max: 1440,
        description: "Periodo movel usado para contar as tentativas de ativacao.",
      },
    ],
  },
  {
    title: "Troca de maquina",
    fields: [
      {
        key: "deviceReleaseLimit",
        label: "Liberacoes por usuario",
        unit: "liberacoes",
        min: 1,
        max: 100,
        description: "Quantidade de maquinas que podem ser liberadas para o mesmo usuario dentro da janela.",
      },
      {
        key: "deviceReleaseWindowMinutes",
        label: "Janela de liberacoes",
        unit: "min",
        min: 1,
        max: 1440,
        description: "Periodo movel usado para contar as liberacoes de maquina.",
      },
      {
        key: "deviceSwitchIntervalDays",
        label: "Intervalo entre trocas",
        unit: "dias",
        min: 0,
        max: 365,
        description: "Dias completos que a maquina atual precisa permanecer ativa antes de poder ser liberada. Depois da liberacao, a nova maquina entra imediatamente.",
      },
      {
        key: "deviceRecoveryWindowMinutes",
        label: "Janela de recuperacao",
        unit: "min",
        min: 5,
        max: 60,
        description: "Tempo para concluir TOTP e cadastrar a maquina depois de consumir um codigo de recuperacao.",
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
  const [pendingSession, setPendingSession] = useState(null);
  const [authStep, setAuthStep] = useState("password");
  const [mfaDraft, setMfaDraft] = useState("");
  const [mfaEnrollment, setMfaEnrollment] = useState(null);
  const [authDraft, setAuthDraft] = useState({
    email: "",
    password: "",
  });
  const [licenseDraft, setLicenseDraft] = useState(() => createDefaultLicenseDraft());
  const [currentLicense, setCurrentLicense] = useState(null);
  const [activationCodes, setActivationCodes] = useState([]);
  const [activationPopover, setActivationPopover] = useState(null);
  const [isPolicyDialogOpen, setIsPolicyDialogOpen] = useState(false);
  const [policyDraft, setPolicyDraft] = useState({});
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
  const popoverActivation = activationPopover
    ? activationCodes.find((activation) => (
      activation.memberId === activationPopover.memberId
      && new Date(activation.expiresAt).getTime() > Date.now()
    ))
    : null;

  useEffect(() => {
    if (session?.accessToken) persistAdminSession(session);
  }, [session]);

  useEffect(() => {
    if (!toast.message) return undefined;
    const timer = setTimeout(() => setToast({ message: "", variant: "success" }), 4200);
    return () => clearTimeout(timer);
  }, [toast.message]);

  useEffect(() => {
    if (!session?.accessToken) return undefined;

    let isCurrent = true;

    async function loadCurrentLicense() {
      let activeSession = null;
      try {
        activeSession = await validSession();
        const data = await functionRequest("master-get-license", {}, activeSession.accessToken);
        if (isCurrent) applyLicense(data);
      } catch (error) {
        if (isCurrent) {
          if (String(error?.code || "") === "daily_mfa_required" && activeSession) {
            try {
              await moveSessionToDailyMfa(activeSession);
              showToast("Confirme novamente o autenticador.", "error");
            } catch (mfaError) {
              setPendingSession(null);
              setAuthStep("password");
              showToast(errorMessage(mfaError), "error");
            }
            return;
          }
          if (isInvalidSessionError(error)) {
            clearAdminSession();
            setSession(null);
          }
          showToast(errorMessage(error), "error");
        }
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

  useEffect(() => {
    if (!isPolicyDialogOpen && !activationPopover) return undefined;

    function closeOverlayOnEscape(event) {
      if (event.key !== "Escape") return;
      if (activationPopover) {
        setActivationPopover(null);
      } else {
        setIsPolicyDialogOpen(false);
      }
    }

    document.addEventListener("keydown", closeOverlayOnEscape);
    return () => document.removeEventListener("keydown", closeOverlayOnEscape);
  }, [activationPopover, isPolicyDialogOpen]);

  function updateAuthDraft(field, value) {
    setAuthDraft((current) => ({ ...current, [field]: value }));
  }

  function updateLicenseDraft(field, value) {
    setLicenseDraft((current) => ({ ...current, [field]: value }));
  }

  function openPolicyDialog() {
    setPolicyDraft(accessPolicyDraftFrom(licenseDraft));
    setIsPolicyDialogOpen(true);
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
    setIsPolicyDialogOpen(false);
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
      await beginMasterMfa(data, email);
      setAuthDraft({ email, password: "" });
      showToast("Confirme o autenticador.", "success");
    });
  }

  async function beginMasterMfa(data, fallbackEmail) {
    const temporary = sessionFromAuthResponse(data, fallbackEmail);
    const user = await authApi("/auth/v1/user", {
      method: "GET",
      accessToken: temporary.accessToken,
    });
    const allFactors = uniqueFactors(Array.isArray(user?.factors) ? user.factors : []);
    const verified = allFactors.find((factor) => (
      factor?.status === "verified"
      && (!factor.factor_type || factor.factor_type === "totp")
    ));

    setPendingSession(temporary);
    setMfaDraft("");
    if (verified) {
      setMfaEnrollment(null);
      setAuthStep("totp");
      setPendingSession({ ...temporary, factorId: verified.id });
      return;
    }

    for (const factor of allFactors.filter((candidate) => candidate?.status !== "verified")) {
      await authApi(`/auth/v1/factors/${factor.id}`, {
        method: "DELETE",
        accessToken: temporary.accessToken,
      });
    }
    const enrollment = await authApi("/auth/v1/factors", {
      method: "POST",
      accessToken: temporary.accessToken,
      body: {
        factor_type: "totp",
        friendly_name: "Arizona Admin",
        issuer: "Arizona Admin",
      },
    });
    setMfaEnrollment(enrollment?.totp ? {
      ...enrollment.totp,
      qr_code: normalizeTotpQrCode(enrollment.totp.qr_code),
    } : null);
    setPendingSession({ ...temporary, factorId: enrollment?.id || "" });
    setAuthStep("enrollment");
  }

  async function handleMfaSubmit(event) {
    event.preventDefault();
    const code = String(mfaDraft || "").replace(/\D/g, "").slice(0, 6);
    if (!pendingSession?.accessToken || !pendingSession?.factorId || code.length !== 6) {
      showToast("Informe o codigo de 6 digitos.", "error");
      return;
    }

    await runAsync(async () => {
      const challenge = await authApi(
        `/auth/v1/factors/${pendingSession.factorId}/challenge`,
        {
          method: "POST",
          accessToken: pendingSession.accessToken,
          body: {},
        },
      );
      const verified = await authApi(
        `/auth/v1/factors/${pendingSession.factorId}/verify`,
        {
          method: "POST",
          accessToken: pendingSession.accessToken,
          body: {
            challenge_id: challenge.id,
            code,
          },
        },
      );
      saveSession(verified, pendingSession.email);
      setPendingSession(null);
      setMfaEnrollment(null);
      setMfaDraft("");
      setAuthStep("password");
      showToast("Acesso confirmado.", "success");
    });
  }

  function handleLogout() {
    clearAdminSession();
    setSession(null);
    setPendingSession(null);
    setMfaDraft("");
    setMfaEnrollment(null);
    setAuthStep("password");
    setLicenseDraft(createDefaultLicenseDraft());
    setCurrentLicense(null);
    setActivationCodes([]);
    setActivationPopover(null);
    setIsPolicyDialogOpen(false);
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
      dailyAuthResetHour: Number(licenseDraft.dailyAuthResetHour),
      licenseExpiresOn,
      licenseIsIndefinite: Boolean(licenseDraft.licenseIsIndefinite),
      ...Object.fromEntries(
        accessPolicyFields.map((field) => [field.key, Number(licenseDraft[field.key])]),
      ),
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

    if (
      !Number.isInteger(payload.dailyAuthResetHour)
      || payload.dailyAuthResetHour < 0
      || payload.dailyAuthResetHour > 23
    ) {
      showToast("Escolha um horario valido para a renovacao diaria.", "error");
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
          generationErrors.push(errorMessage(error));
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
          `Licenca salva, mas o codigo nao foi gerado: ${generationErrors[0]}`,
          "error",
        );
      } else if (generatedCodes.length) {
        showToast("Licenca salva. Use \"Ver codigo\" na linha de cada usuario.", "success");
      } else {
        showToast("Licenca salva.", "success");
      }
    });
  }

  async function handleGenerateActivationCode(user, anchor = null) {
    const organizationId = currentLicense?.organization?.id;
    if (!organizationId || !user?.memberId) {
      showToast("Salve o usuario antes de gerar o codigo.", "error");
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
        throw new Error("O Supabase nao retornou o codigo de ativacao.");
      }
      rememberActivationCodes([result.activation]);
      setActivationPopover({
        memberId: result.activation.memberId,
        anchor: anchor || null,
      });
      showToast("Codigo gerado. Copie antes de fechar o painel.", "success");
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
      showToast("Codigo copiado.", "success");
    } catch {
      showToast("Nao foi possivel copiar. Selecione o codigo manualmente.", "error");
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

  async function handleResetTotp(user) {
    const organizationId = currentLicense?.organization?.id;
    if (!organizationId || !user.memberId) {
      showToast("Salve o usuario antes de resetar o TOTP.", "error");
      return;
    }

    const confirmed = window.confirm(
      `Resetar o autenticador de ${user.email}? `
      + "As sessoes, a maquina ativa e os codigos abertos serao revogados. "
      + "Depois, gere um novo codigo para o usuario cadastrar outro QR Code.",
    );
    if (!confirmed) return;

    await runAsync(async () => {
      const activeSession = await validSession();
      const result = await functionRequest(
        "master-reset-member-totp",
        { organizationId, memberId: user.memberId },
        activeSession.accessToken,
      );

      if (!result?.reset) {
        const message = result?.reason === "auth_identity_missing"
          ? "Este usuario ainda nao possui identidade de acesso."
          : "Este usuario nao possui TOTP cadastrado.";
        showToast(message, "error");
        return;
      }

      setActivationCodes((current) => (
        current.filter((activation) => activation.memberId !== user.memberId)
      ));
      setActivationPopover((current) => (
        current?.memberId === user.memberId ? null : current
      ));
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
      showToast("TOTP resetado. Gere um novo codigo para cadastrar outro QR Code.", "success");
    });
  }

  async function handleResetUserRateLimits(user) {
    const organizationId = currentLicense?.organization?.id;
    if (!organizationId || !user.memberId) {
      showToast("Salve o usuario antes de zerar os tempos.", "error");
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
      if (String(error?.code || "") === "daily_mfa_required" && session?.accessToken) {
        try {
          const activeSession = await validSession();
          await moveSessionToDailyMfa(activeSession);
          showToast("Confirme novamente o autenticador.", "error");
        } catch (mfaError) {
          setPendingSession(null);
          setAuthStep("password");
          showToast(errorMessage(mfaError), "error");
        }
      } else {
        showToast(errorMessage(error), "error");
      }
    } finally {
      setIsBusy(false);
    }
  }

  async function authRequest(path, body) {
    return authApi(path, { method: "POST", body });
  }

  async function moveSessionToDailyMfa(activeSession) {
    clearAdminSession();
    setSession(null);
    await beginMasterMfa({
      access_token: activeSession.accessToken,
      refresh_token: activeSession.refreshToken,
      expires_in: Math.max(
        60,
        Math.floor((Number(activeSession.expiresAt || 0) - Date.now()) / 1000),
      ),
      user: { email: activeSession.email },
    }, activeSession.email);
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
        const error = new Error(`Resposta invalida do Supabase Auth (${response.status}).`);
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
    const nextSession = sessionFromAuthResponse(data, fallbackEmail);
    persistAdminSession(nextSession);
    setSession(nextSession);
    return nextSession;
  }

  function sessionFromAuthResponse(data, fallbackEmail) {
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      email: data.user?.email || fallbackEmail,
      expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
    };
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

            {authStep === "password" ? (
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
                    minLength="12"
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
            ) : (
              <form className="form admin-mfa-form" onSubmit={handleMfaSubmit}>
                {authStep === "enrollment" && mfaEnrollment ? (
                  <div className="admin-mfa-enrollment">
                    {mfaEnrollment.qr_code ? (
                      <img src={mfaEnrollment.qr_code} alt="QR Code do Arizona Admin" />
                    ) : null}
                    <span>Chave manual</span>
                    <code>{mfaEnrollment.secret}</code>
                  </div>
                ) : null}
                <label className="field">
                  <span>Codigo do autenticador</span>
                  <input
                    className="admin-mfa-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    maxLength="6"
                    value={mfaDraft}
                    onChange={(event) => setMfaDraft(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    autoFocus
                  />
                </label>
                <div className="button-row">
                  <button className="button button--primary" type="submit" disabled={isBusy || mfaDraft.length !== 6}>
                    Confirmar
                  </button>
                  <button className="button button--ghost" type="button" onClick={handleLogout} disabled={isBusy}>
                    Cancelar
                  </button>
                </div>
              </form>
            )}
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
                <label className="field field--reset-hour">
                  <span>Renovacao diaria</span>
                  <select
                    value={licenseDraft.dailyAuthResetHour}
                    onChange={(event) => updateLicenseDraft("dailyAuthResetHour", event.target.value)}
                  >
                    {dailyAuthResetHourOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
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
                <button
                  className="button button--ghost policy-button"
                  type="button"
                  onClick={openPolicyDialog}
                >
                  Politicas de acesso
                </button>
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
                  {licenseDraft.users.map((user, index) => {
                    const activation = activationCodes.find((candidate) => (
                      candidate.memberId === user.memberId
                      && new Date(candidate.expiresAt).getTime() > Date.now()
                    ));
                    return (
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
                          className={`button button--small user-action--activation ${activation ? "button--code-ready" : ""}`}
                          type="button"
                          disabled={isBusy || !user.memberId}
                          onClick={(event) => showActivationCode(
                            user,
                            buttonAnchor(event.currentTarget),
                          )}
                        >
                          {activation ? "Ver codigo" : "Gerar codigo"}
                        </button>
                        <button
                          className="button button--small"
                          type="button"
                          disabled={isBusy || !user.memberId}
                          title="Remove o TOTP atual para cadastrar um novo QR Code."
                          onClick={() => handleResetTotp(user)}
                        >
                          Resetar TOTP
                        </button>
                        <button
                          className="button button--small"
                          type="button"
                          disabled={isBusy || !user.memberId}
                          title="Zera os contadores das politicas de acesso deste usuario."
                          onClick={() => handleResetUserRateLimits(user)}
                        >
                          Zerar tempos
                        </button>
                        <button
                          className="button button--danger button--small user-action--delete"
                          type="button"
                          disabled={isBusy || !hasUserContent(user)}
                          onClick={() => handleClearUser(user)}
                        >
                          Limpar
                        </button>
                      </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </form>
          </section>
        )}
      </section>

      {isPolicyDialogOpen ? createPortal(
        <AccessPolicyDialog
          draft={policyDraft}
          onChange={updatePolicyDraft}
          onUseTestProfile={() => setPolicyDraft(accessPolicyDraftFrom(testAccessPolicy))}
          onUseProductionProfile={() => setPolicyDraft(accessPolicyDraftFrom(productionAccessPolicy))}
          onApply={applyPolicyDraft}
          onClose={() => setIsPolicyDialogOpen(false)}
        />,
        document.body,
      ) : null}

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

function AccessPolicyDialog({
  draft,
  onChange,
  onUseTestProfile,
  onUseProductionProfile,
  onApply,
  onClose,
}) {
  return (
    <div className="overlay-backdrop" onPointerDown={onClose}>
      <section
        className="policy-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="policyDialogTitle"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="overlay-header">
          <div>
            <h2 id="policyDialogTitle">Politicas de acesso</h2>
            <p>
              Preencha, aplique e depois salve a licenca. Os limites globais de emergencia continuam ativos.
            </p>
          </div>
          <button
            className="overlay-close"
            type="button"
            aria-label="Fechar politicas"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="policy-dialog__content">
          {accessPolicyGroups.map((group) => (
            <section className="policy-group" key={group.title}>
              <div className="policy-group__heading">
                <h3>{group.title}</h3>
              </div>
              <div className="policy-grid">
                {group.fields.map((field, index) => (
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
                        autoFocus={index === 0 && group === accessPolicyGroups[0]}
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

        <footer className="overlay-footer">
          <div className="policy-presets">
            <span>Preencher:</span>
            <button
              className="button button--ghost button--small"
              type="button"
              onClick={onUseTestProfile}
            >
              Perfil de teste
            </button>
            <button
              className="button button--ghost button--small"
              type="button"
              onClick={onUseProductionProfile}
            >
              Padrao de producao
            </button>
          </div>
          <div className="button-row">
            <button className="button button--ghost" type="button" onClick={onClose}>
              Cancelar
            </button>
            <button className="button button--primary" type="button" onClick={onApply}>
              Aplicar
            </button>
          </div>
        </footer>
      </section>
    </div>
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

function loadJson(key) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
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
    ) {
      sessionStorage.removeItem(sessionKey);
      return null;
    }
    return parsed;
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
  } catch {
    // Nothing else is required when storage is unavailable.
  }
}

function isInvalidSessionError(error) {
  return [
    "invalid_user_token",
    "refresh_token_not_found",
    "invalid_grant",
  ].includes(String(error?.code || ""));
}

function uniqueFactors(factors) {
  const byId = new Map();
  factors.forEach((factor) => {
    if (factor?.id) byId.set(factor.id, factor);
  });
  return [...byId.values()];
}

function normalizeTotpQrCode(value) {
  const qrCode = String(value || "").trim();
  if (!qrCode || qrCode.startsWith("data:")) return qrCode;
  return `data:image/svg+xml;utf-8,${qrCode}`;
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
  if (code === "daily_mfa_required") return "Confirme novamente o autenticador.";
  if (code === "rate_limited") {
    const remaining = Number(error?.retryAfterSeconds || 0);
    return remaining > 0
      ? `Muitas tentativas. Tente novamente em ${formatDuration(remaining)}.`
      : "Muitas tentativas. Aguarde antes de tentar novamente.";
  }
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
  if (code === "invalid_daily_auth_reset_hour") return "Escolha um horario valido para a renovacao diaria.";
  if (code === "invalid_access_policy") return "Revise os limites e tempos das politicas de acesso.";
  if (code === "device_switch_interval") {
    const remaining = Number(error?.retryAfterSeconds || 0);
    return remaining > 0
      ? `A maquina atual podera ser liberada em ${formatDuration(remaining)}.`
      : "A maquina atual ainda nao completou o intervalo minimo entre trocas.";
  }
  if (code === "license_expired") return "Licenca expirada.";
  if (code === "device_limit_reached") return "Usuario ja possui uma maquina ativa. Libere o device antes de usar outra.";
  if (code === "device_not_active") return "Device bloqueado. Libere ou cadastre uma nova maquina.";
  if (code === "member_not_found") return "Usuario nao encontrado.";
  if (code === "protected_identity") return "A identidade master nao pode ser resetada por esta acao.";
  if (code === "invalid_allowed_email_domain") return "Informe um dominio permitido valido.";
  if (code === "admin_email_domain_not_allowed") return "Email do usuario precisa usar arizona.global.";
  if (code === "email_domain_not_allowed") return "Email fora do dominio permitido.";

  return message || "Operacao nao concluida.";
}

function formatDuration(totalSeconds) {
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
