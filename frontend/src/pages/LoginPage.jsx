import { useState } from "react";
import { useNavigate } from "react-router";

import AppHeader from "../components/AppHeader";
import SlamBackground from "../components/SlamBackground";
import { useAuth } from "../context/useAuth";
import go2LoginUrl from "../assets/go2-login.png";

function LoginPage() {
  const navigate = useNavigate();
  const { signIn, isConfigured } = useAuth();
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });

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
                Configure o Supabase para habilitar o acesso.
              </p>
            )}

            <button
              className="primary-button"
              type="submit"
              disabled={isSubmitting || !isConfigured}
            >
              {isSubmitting ? "Entrando..." : "Entrar"}
            </button>

            <button
              className="login-demo-button"
              type="button"
              onClick={() => navigate("/demo")}
            >
              Acessar demonstração
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}

export default LoginPage;
