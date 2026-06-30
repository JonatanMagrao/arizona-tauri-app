import { useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { authenticateUser, authErrorMessage, normalizeEmail } from "./lib/auth";
import { commandNames, invokeCommand } from "./lib/tauriCommands";

import appLogo from "../src-tauri/icons/arizona_icon.ico";
import closeIcon from "./assets/icones/close.svg";
import minimizeIcon from "./assets/icones/minimize.svg";

const MODES = Object.freeze({
  LOGIN: "login",
  SETUP: "setup",
});

function LoginWindow() {
  const [mode, setMode] = useState(MODES.LOGIN);
  const [draft, setDraft] = useState({ email: "", password: "", confirmPassword: "" });
  const [appInfo, setAppInfo] = useState({ version: "" });
  const [toast, setToast] = useState({ message: "", variant: "error" });
  const [isBusy, setIsBusy] = useState(false);
  const isSetup = mode === MODES.SETUP;
  const canSubmit = useMemo(() => {
    const email = normalizeEmail(draft.email);
    if (!email || !draft.password || isBusy) return false;
    if (isSetup && draft.password !== draft.confirmPassword) return false;
    return true;
  }, [draft, isBusy, isSetup]);

  useEffect(() => {
    invokeCommand(commandNames.appInfo)
      .then((info) => setAppInfo({ version: String(info?.version || "").trim() }))
      .catch(() => {});
  }, []);

  const updateDraft = (field, value) => {
    setDraft((current) => ({ ...current, [field]: value }));
    if (toast.message) setToast({ message: "", variant: "error" });
  };

  const switchMode = () => {
    setMode((current) => current === MODES.LOGIN ? MODES.SETUP : MODES.LOGIN);
    setDraft((current) => ({ ...current, password: "", confirmPassword: "" }));
    setToast({ message: "", variant: "error" });
  };

  const submit = async (event) => {
    event.preventDefault();
    const email = normalizeEmail(draft.email);

    if (!email || !draft.password) {
      setToast({ message: "Informe email e senha.", variant: "error" });
      return;
    }

    if (isSetup && draft.password.length < 6) {
      setToast({ message: "Use uma senha com pelo menos 6 caracteres.", variant: "error" });
      return;
    }

    if (isSetup && draft.password !== draft.confirmPassword) {
      setToast({ message: "As senhas nao conferem.", variant: "error" });
      return;
    }

    setIsBusy(true);
    try {
      const auth = await authenticateUser({
        mode,
        email,
        password: draft.password,
        appVersion: appInfo.version,
      });

      const response = await invokeCommand(commandNames.completeLogin, {
        session: {
          accessToken: auth.accessToken,
          refreshToken: auth.refreshToken,
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
        throw new Error(response.message || "Nao foi possivel abrir o app.");
      }
    } catch (error) {
      setToast({ message: authErrorMessage(error), variant: "error" });
      setIsBusy(false);
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
        <div className="login-brand">
          <img src={appLogo} alt="" aria-hidden="true" />
          <div>
            <h1 id="loginTitle">{isSetup ? "Primeiro acesso" : "Entrar"}</h1>
            {appInfo.version && <span>v{appInfo.version}</span>}
          </div>
        </div>

        <form className="login-form" onSubmit={submit}>
          <label className="login-field">
            <span>Email</span>
            <input
              className="input"
              type="email"
              autoComplete="email"
              value={draft.email}
              onChange={(event) => updateDraft("email", event.target.value)}
              disabled={isBusy}
              required
            />
          </label>

          <label className="login-field">
            <span>Senha</span>
            <input
              className="input"
              type="password"
              autoComplete={isSetup ? "new-password" : "current-password"}
              minLength={6}
              value={draft.password}
              onChange={(event) => updateDraft("password", event.target.value)}
              disabled={isBusy}
              required
            />
          </label>

          {isSetup && (
            <label className="login-field">
              <span>Confirmar senha</span>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                minLength={6}
                value={draft.confirmPassword}
                onChange={(event) => updateDraft("confirmPassword", event.target.value)}
                disabled={isBusy}
                required
              />
            </label>
          )}

          <button className="btn btn-primary login-submit" type="submit" disabled={!canSubmit}>
            {isBusy ? "Validando..." : isSetup ? "Criar senha" : "Entrar"}
          </button>
        </form>

        <button
          type="button"
          className="login-mode-btn"
          onClick={switchMode}
          disabled={isBusy}
        >
          {isSetup ? "Ja tenho senha" : "Primeiro acesso"}
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

export default LoginWindow;
