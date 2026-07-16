import { useState } from "react";
import { useNavigate } from "react-router";

import AppHeader from "../components/AppHeader";
import { useAuth } from "../context/useAuth";

function getSubmitLabel(isSignUp, isSubmitting) {
  if (isSubmitting) {
    return isSignUp ? "Criando conta..." : "Entrando...";
  }

  return isSignUp ? "Criar conta" : "Entrar";
}

function LoginPage() {
  const navigate = useNavigate();
  const { signIn, signUp, isConfigured } = useAuth();
  const [authMode, setAuthMode] = useState("signin");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    email: "",
    password: "",
    confirmPassword: "",
  });

  const isSignUp = authMode === "signup";

  function handleChange(event) {
    const { name, value } = event.target;

    setFormData((currentData) => ({
      ...currentData,
      [name]: value,
    }));
  }

  function handleModeChange(nextMode) {
    setAuthMode(nextMode);
    setErrorMessage("");
    setSuccessMessage("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");

    if (!formData.email || !formData.password) {
      setErrorMessage("Preencha o e-mail e a senha.");
      return;
    }

    if (isSignUp && formData.password.length < 8) {
      setErrorMessage("A senha deve ter pelo menos 8 caracteres.");
      return;
    }

    if (isSignUp && formData.password !== formData.confirmPassword) {
      setErrorMessage("As senhas informadas não são iguais.");
      return;
    }

    setIsSubmitting(true);
    try {
      if (isSignUp) {
        const newSession = await signUp(formData.email, formData.password);
        if (newSession) {
          navigate("/dashboard", { replace: true });
          return;
        }

        setAuthMode("signin");
        setFormData((currentData) => ({
          ...currentData,
          password: "",
          confirmPassword: "",
        }));
        setSuccessMessage(
          "Conta criada sem sessão automática. Verifique se Confirm email está desativado no Supabase.",
        );
      } else {
        await signIn(formData.email, formData.password);
        navigate("/dashboard", { replace: true });
      }
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="app-layout">
      <AppHeader centerLogo />

      <main className="login-page">
        <section className="login-card">
          <div className="login-header">
            <h1>{isSignUp ? "Criar acesso" : "Operação remota"}</h1>

            <p>
              {isSignUp
                ? "Cadastre seu e-mail para acessar a operação do robô."
                : "Entre para acessar o sistema de controle e monitoramento do robô."}
            </p>
          </div>

          <div
            className="auth-mode-switch"
            role="tablist"
            aria-label="Tipo de acesso"
          >
            <button
              className={
                authMode === "signin"
                  ? "auth-mode-button is-active"
                  : "auth-mode-button"
              }
              type="button"
              role="tab"
              aria-selected={authMode === "signin"}
              onClick={() => handleModeChange("signin")}
            >
              Entrar
            </button>

            <button
              className={
                authMode === "signup"
                  ? "auth-mode-button is-active"
                  : "auth-mode-button"
              }
              type="button"
              role="tab"
              aria-selected={authMode === "signup"}
              onClick={() => handleModeChange("signup")}
            >
              Criar conta
            </button>
          </div>

          <form className="login-form" onSubmit={handleSubmit}>
            <label htmlFor="email">
              E-mail

              <input
                id="email"
                name="email"
                type="email"
                value={formData.email}
                onChange={handleChange}
                autoComplete="email"
                required
              />
            </label>

            <label htmlFor="password">
              Senha

              <input
                id="password"
                name="password"
                type="password"
                value={formData.password}
                onChange={handleChange}
                autoComplete={isSignUp ? "new-password" : "current-password"}
                required
              />
            </label>

            {isSignUp && (
              <label htmlFor="confirmPassword">
                Confirmar senha

                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </label>
            )}

            {errorMessage && (
              <p className="form-message form-message--error" role="alert">
                {errorMessage}
              </p>
            )}

            {successMessage && (
              <p className="form-message form-message--success" role="status">
                {successMessage}
              </p>
            )}

            {!isConfigured && (
              <p className="form-message" role="status">
                Configure o Supabase para habilitar o acesso.
              </p>
            )}

            <button
              className="primary-button"
              type="submit"
              disabled={isSubmitting || !isConfigured}
            >
              {getSubmitLabel(isSignUp, isSubmitting)}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}

export default LoginPage;
