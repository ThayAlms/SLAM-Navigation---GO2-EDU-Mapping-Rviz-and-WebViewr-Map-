import { useState } from "react";
import { Navigate, useNavigate } from "react-router";

import AppHeader from "../components/AppHeader";
import SlamBackground from "../components/SlamBackground";
import { useAuth } from "../context/useAuth";
import go2LoginUrl from "../assets/go2-login.png";

// Oferece ao navegador salvar as credenciais após um login bem-sucedido.
// Sem suporte (Firefox/Safari), o próprio formulário já aciona o gerenciador.
async function offerPasswordSave(email, password) {
  try {
    if (window.PasswordCredential) {
      const credential = new window.PasswordCredential({
        id: email,
        name: email,
        password,
      });
      await navigator.credentials.store(credential);
    }
  } catch {
    // Guardar a senha é opcional; a entrada continua normalmente.
  }
}

function LoginPage() {
  const navigate = useNavigate();
  const { signIn, isConfigured, session, isLoading } = useAuth();
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });

  // Sessão ativa vai direto para a home da operação.
  if (!isLoading && session) {
    return <Navigate to="/dashboard" replace />;
  }

  function handleChange(event) {
    const { name, value } = event.target;

    setFormData((currentData) => ({
      ...currentData,
      [name]: value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setErrorMessage("");

    if (!formData.email || !formData.password) {
      setErrorMessage("Preencha o e-mail e a senha.");
      return;
    }

    setIsSubmitting(true);
    try {
      await signIn(formData.email, formData.password);
      await offerPasswordSave(formData.email, formData.password);
      navigate("/dashboard", { replace: true });
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="app-layout login-layout">
      <AppHeader />
      <SlamBackground className="login-slam-background" variant="login" />
      <img
        className="login-go2"
        src={go2LoginUrl}
        alt=""
        aria-hidden="true"
      />

      <main className="login-page">
        <section className="login-card" aria-label="Acesso do operador">
          <div className="login-header login-header--pill">
            <h2>Acessar plataforma</h2>
            <p>Informe suas credenciais para continuar.</p>
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
                autoComplete="username"
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
                autoComplete="current-password"
                required
              />
            </label>

            {errorMessage && (
              <p className="form-message form-message--error" role="alert">
                {errorMessage}
              </p>
            )}

            {!isConfigured && (
              <p className="form-message" role="status">
                Acesso indisponível neste ambiente. Contate o administrador.
              </p>
            )}

            <button
              className="primary-button"
              type="submit"
              disabled={isSubmitting || !isConfigured}
            >
              {isSubmitting ? "Entrando..." : "Entrar"}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}

export default LoginPage;
