import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  authenticateUser,
  authErrorMessage,
  changePassword,
  inspectLoginEmail,
  normalizeEmail,
  resumeSecureSession,
  saveSecureSession,
} from "../../services/auth";
import { commandNames, invokeCommand } from "../../services/tauriCommands";

import appLogo from "../../../src-tauri/icons/arizona_icon.ico";
import closeIcon from "../../assets/icones/close.svg";
import minimizeIcon from "../../assets/icones/minimize.svg";
import visibilityIcon from "../../assets/icones/visibility.svg";
import visibilityOffIcon from "../../assets/icones/visibility_off.svg";

const MODES = Object.freeze({
  LOGIN: "login",
  SETUP: "setup",
  CHANGE: "change",
});

const EMAIL_LOOKUP_DELAY_MS = 450;

function LoginWindow() {
  const [mode, setMode] = useState(MODES.LOGIN);
  const [draft, setDraft] = useState({ email: "", password: "", newPassword: "", confirmPassword: "" });
  const [appInfo, setAppInfo] = useState({ version: "" });
  const [toast, setToast] = useState({ message: "", variant: "error" });
  const [emailStatus, setEmailStatus] = useState({ state: "idle", email: "" });
  const [isBusy, setIsBusy] = useState(false);
  const [visiblePasswords, setVisiblePasswords] = useState({
    password: false,
    newPassword: false,
    confirmPassword: false,
  });
  const emailLookupRef = useRef(0);
  const modeRef = useRef(mode);
  const isSetup = mode === MODES.SETUP;
  const isChange = mode === MODES.CHANGE;
  const canSubmit = useMemo(() => {
    const email = normalizeEmail(draft.email);
    if (!email || !draft.password || isBusy) return false;
    if (isChange && !draft.newPassword) return false;
    if (isSetup && draft.password !== draft.confirmPassword) return false;
    if (isChange && draft.newPassword !== draft.confirmPassword) return false;
    return true;
  }, [draft, isBusy, isChange, isSetup]);
  const title = isSetup ? "Criar senha" : isChange ? "Mudar senha" : "Entrar";
  const passwordLabel = isChange ? "Senha atual" : isSetup ? "Criar senha" : "Senha";
  const passwordTooltip = isChange
    ? "Informe sua senha atual."
    : isSetup
      ? "Crie uma senha com pelo menos 6 caracteres."
      : "Informe sua senha cadastrada.";
  const submitTooltip = submitButtonTitle({ mode, draft, isBusy, emailStatus });

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    let mounted = true;

    async function boot() {
      let version = "";
      try {
        const info = await invokeCommand(commandNames.appInfo);
        version = String(info?.version || "").trim();
        if (mounted) setAppInfo({ version });
      } catch {
        // A versão ajuda na auditoria, mas não deve bloquear o login.
      }

      if (!mounted) return;
      setIsBusy(true);
      try {
        const auth = await resumeSecureSession({ appVersion: version });
        if (!mounted || !auth) return;
        await completeAppLogin(auth);
      } catch (error) {
        if (!mounted) return;
        const email = normalizeEmail(error?.email);
        if (email) setDraft((current) => ({ ...current, email }));

        const code = String(error?.code || "");
        if (code === "daily_login_required" || code === "stored_session_invalid") {
          setToast({ message: authErrorMessage(error), variant: "success" });
        } else if (code && code !== "network_error") {
          setToast({ message: authErrorMessage(error), variant: "error" });
        }
      } finally {
        if (mounted) setIsBusy(false);
      }
    }

    boot();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const email = normalizeEmail(draft.email);
    const lookupId = emailLookupRef.current + 1;
    emailLookupRef.current = lookupId;

    if (!email || !email.includes("@") || isBusy) {
      setEmailStatus({ state: "idle", email });
      return undefined;
    }

    setEmailStatus({ state: "checking", email });
    const timer = setTimeout(async () => {
      try {
        const status = await inspectLoginEmail(email);
        if (emailLookupRef.current !== lookupId) return;

        const nextStatus = {
          state: status?.setupRequired ? "setup" : status?.hasPassword ? "login" : "unknown",
          email,
        };
        setEmailStatus(nextStatus);

        if (status?.setupRequired && modeRef.current !== MODES.CHANGE) {
          setMode(MODES.SETUP);
          modeRef.current = MODES.SETUP;
          setDraft((current) => ({ ...current, newPassword: "" }));
        } else if (status?.hasPassword && modeRef.current === MODES.SETUP) {
          setMode(MODES.LOGIN);
          modeRef.current = MODES.LOGIN;
          setDraft((current) => ({ ...current, confirmPassword: "" }));
        }
      } catch (error) {
        if (emailLookupRef.current !== lookupId) return;
        setEmailStatus({ state: "unknown", email, code: String(error?.code || "") });
        if (modeRef.current === MODES.SETUP) {
          setMode(MODES.LOGIN);
          modeRef.current = MODES.LOGIN;
          setDraft((current) => ({ ...current, confirmPassword: "" }));
        }
      }
    }, EMAIL_LOOKUP_DELAY_MS);

    return () => clearTimeout(timer);
  }, [draft.email, isBusy]);

  const updateDraft = (field, value) => {
    setDraft((current) => ({ ...current, [field]: value }));
    if (toast.message) setToast({ message: "", variant: "error" });
  };

  const togglePasswordVisibility = (field) => {
    setVisiblePasswords((current) => ({ ...current, [field]: !current[field] }));
  };

  const switchMode = () => {
    const nextMode = mode === MODES.LOGIN ? MODES.CHANGE : MODES.LOGIN;
    setMode(nextMode);
    modeRef.current = nextMode;
    setDraft((current) => ({ ...current, password: "", newPassword: "", confirmPassword: "" }));
    setToast({ message: "", variant: "error" });
  };

  const submit = async (event) => {
    event.preventDefault();
    const email = normalizeEmail(draft.email);

    if (!email || !draft.password) {
      setToast({ message: "Informe e-mail e senha.", variant: "error" });
      return;
    }

    if (isChange && !draft.newPassword) {
      setToast({ message: "Informe a nova senha.", variant: "error" });
      return;
    }

    const targetPassword = isChange ? draft.newPassword : draft.password;
    if ((isSetup || isChange) && targetPassword.length < 6) {
      setToast({ message: "Use uma senha com pelo menos 6 caracteres.", variant: "error" });
      return;
    }

    if ((isSetup || isChange) && targetPassword !== draft.confirmPassword) {
      setToast({ message: "As senhas não conferem.", variant: "error" });
      return;
    }

    setIsBusy(true);
    try {
      const auth = isChange
        ? await changePassword({
          email,
          currentPassword: draft.password,
          newPassword: draft.newPassword,
          appVersion: appInfo.version,
        })
        : await authenticateUser({
          mode,
          email,
          password: draft.password,
          appVersion: appInfo.version,
        });

      await saveSecureSession(auth);
      await completeAppLogin(auth);
    } catch (error) {
      setToast({ message: authErrorMessage(error), variant: "error" });
      setIsBusy(false);
    }
  };

  const completeAppLogin = async (auth) => {
    const response = await invokeCommand(commandNames.completeLogin, {
      session: {
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken,
        cepLicenseReceipt: auth.cepLicenseReceipt,
        email: auth.email,
        memberId: auth.memberId,
        role: auth.role,
        organizationId: auth.organizationId,
        organizationName: auth.organizationName,
        seatsAllowed: auth.seatsAllowed,
        expiresAt: auth.expiresAt,
      },
    });

    if (response?.ok === false) {
      throw new Error(response.message || "Não foi possível abrir o app.");
    }
  };

  const minimizeWindow = () => {
    getCurrentWindow().minimize().catch(() => {});
  };

  const closeWindow = async () => {
    try {
      await invokeCommand(commandNames.exitApp);
    } catch {
      getCurrentWindow().close().catch(() => {});
    }
  };

  const startWindowDrag = (event) => {
    if (event.button !== 0) return;
    getCurrentWindow().startDragging().catch(() => {});
  };

  return (
    <main className="login-shell">
      <header className="app-titlebar" aria-label="Barra da janela">
        <div
          className="app-titlebar__brand"
          data-tauri-drag-region
          onMouseDown={startWindowDrag}
          title="Arizona App"
        >
          <img className="app-titlebar__logo" src={appLogo} alt="" aria-hidden="true" />
          <span>Arizona App</span>
        </div>
        <div
          className="app-titlebar__drag"
          data-tauri-drag-region
          onMouseDown={startWindowDrag}
        />
        <div className="app-titlebar__controls">
          <button
            className="titlebar-icon-btn titlebar-icon-btn--minimize"
            onClick={minimizeWindow}
            tabIndex="-1"
            title="Minimizar"
            aria-label="Minimizar"
          >
            <img src={minimizeIcon} alt="" aria-hidden="true" />
          </button>
          <button
            className="titlebar-icon-btn titlebar-icon-btn--close"
            onClick={closeWindow}
            tabIndex="-1"
            title="Fechar"
            aria-label="Fechar"
          >
            <img src={closeIcon} alt="" aria-hidden="true" />
          </button>
        </div>
      </header>

      <section className="login-panel" aria-labelledby="loginTitle">
        {appInfo.version && (
          <span className="login-version" title={`Versão ${appInfo.version}`}>
            v{appInfo.version}
          </span>
        )}
        <div className="login-brand">
          <img src={appLogo} alt="" aria-hidden="true" />
          <div>
            <h1 id="loginTitle">{title}</h1>
          </div>
        </div>

        <form className="login-form" onSubmit={submit} noValidate>
          <label className="login-field">
            <span className="login-label-row">
              E-mail
              {emailStatus.state === "checking" && (
                <span className="login-label-chip login-label-chip--muted">verificando</span>
              )}
              {emailStatus.state === "setup" && isSetup && (
                <span className="login-label-chip">Primeiro Acesso</span>
              )}
            </span>
            <input
              className="input"
              type="email"
              autoComplete="email"
              value={draft.email}
              onChange={(event) => updateDraft("email", event.target.value)}
              disabled={isBusy}
              title="Use o e-mail cadastrado na gestão."
            />
          </label>

          <label className="login-field">
            <span>{passwordLabel}</span>
            <PasswordField
              field="password"
              autoComplete={isSetup ? "new-password" : "current-password"}
              value={draft.password}
              onChange={(value) => updateDraft("password", value)}
              disabled={isBusy}
              title={passwordTooltip}
              isVisible={visiblePasswords.password}
              onToggleVisibility={togglePasswordVisibility}
            />
          </label>

          {isChange && (
            <label className="login-field">
              <span>Nova senha</span>
              <PasswordField
                field="newPassword"
                autoComplete="new-password"
                value={draft.newPassword}
                onChange={(value) => updateDraft("newPassword", value)}
                disabled={isBusy}
                title="Escolha uma nova senha com pelo menos 6 caracteres."
                isVisible={visiblePasswords.newPassword}
                onToggleVisibility={togglePasswordVisibility}
              />
            </label>
          )}

          {(isSetup || isChange) && (
            <label className="login-field">
              <span>Confirmar senha</span>
              <PasswordField
                field="confirmPassword"
                autoComplete="new-password"
                value={draft.confirmPassword}
                onChange={(value) => updateDraft("confirmPassword", value)}
                disabled={isBusy}
                title="Repita a nova senha para confirmar."
                isVisible={visiblePasswords.confirmPassword}
                onToggleVisibility={togglePasswordVisibility}
              />
            </label>
          )}

          <button
            className="btn btn-primary login-submit"
            type="submit"
            disabled={!canSubmit}
            title={submitTooltip}
          >
            {isBusy ? "Validando..." : isSetup ? "Criar senha" : isChange ? "Alterar e entrar" : "Entrar"}
          </button>
        </form>

        <button
          type="button"
          className="login-mode-btn"
          onClick={switchMode}
          disabled={isBusy}
          title={isSetup || isChange ? "Voltar para entrada com senha." : "Alterar a senha usando a senha atual."}
        >
          {isSetup || isChange ? "Entrar" : "Mudar senha"}
        </button>

        {toast.message && (
          <div className={`login-message login-message--${toast.variant}`} role="alert">
            {toast.message}
          </div>
        )}
      </section>
    </main>
  );
}

function PasswordField({
  field,
  autoComplete,
  value,
  onChange,
  disabled,
  title,
  isVisible,
  onToggleVisibility,
}) {
  const icon = isVisible ? visibilityOffIcon : visibilityIcon;
  const label = isVisible ? "Ocultar senha" : "Mostrar senha";

  return (
    <div className="login-password-control">
      <input
        className="input"
        type={isVisible ? "text" : "password"}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        title={title}
      />
      <button
        type="button"
        className="login-password-toggle"
        onClick={() => onToggleVisibility(field)}
        disabled={disabled}
        title={label}
        aria-label={label}
        tabIndex="-1"
      >
        <img src={icon} alt="" aria-hidden="true" />
      </button>
    </div>
  );
}

function submitButtonTitle({ mode, draft, isBusy, emailStatus }) {
  if (isBusy) return "Validando acesso.";

  const email = normalizeEmail(draft.email);
  if (!email) return "Informe o e-mail cadastrado.";
  if (emailStatus?.state === "checking") return "Aguarde a verificação do e-mail.";
  if (!draft.password) return mode === MODES.CHANGE ? "Informe sua senha atual." : "Informe sua senha.";

  if (mode === MODES.SETUP) {
    if (!draft.confirmPassword) return "Confirme a senha criada.";
    if (draft.password !== draft.confirmPassword) return "As senhas precisam ser iguais.";
    return "Criar senha e entrar.";
  }

  if (mode === MODES.CHANGE) {
    if (!draft.newPassword) return "Informe a nova senha.";
    if (!draft.confirmPassword) return "Confirme a nova senha.";
    if (draft.newPassword !== draft.confirmPassword) return "As senhas precisam ser iguais.";
    return "Alterar senha e entrar.";
  }

  return "Entrar no Arizona App.";
}

export default LoginWindow;
