import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import logoBranca from "../assets/images/xd4robotics-branco.svg";
import logoPreta from "../assets/images/xd4robotics-preto.svg";
import oracleLogo from "../assets/images/oracle-logo.png";
import { useAuth } from "../context/useAuth";
import { useTheme } from "../context/useTheme";

function AppHeader({ showLogout = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut, user } = useAuth();
  const { theme, setTheme } = useTheme();
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    function handleScroll() {
      setIsScrolled(window.scrollY > 20);
    }

    handleScroll();

    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  function handleLogoClick() {
    navigate(showLogout ? "/dashboard" : "/login");
  }

  async function handleLogout() {
    try {
      await signOut();
    } finally {
      navigate("/login", { replace: true });
    }
  }

  const isUserManagement = location.pathname.startsWith("/admin/usuarios");

  return (
    <header
      className={isScrolled ? "app-header app-header--scrolled" : "app-header"}
    >
      <div className="app-header-inner">
        <div className="app-header-partners" aria-label="XD4 Robotics e Oracle">
          <button
            className="app-header-brand"
            type="button"
            onClick={handleLogoClick}
            aria-label="Ir para a página inicial"
          >
            <span className="partner-logo-slot">
              <img
                className="app-header-logo"
                src={theme === "light" ? logoPreta : logoBranca}
                alt="XD4 Robotics"
              />
            </span>
          </button>
          <span className="brand-divider" aria-hidden="true" />
          <span className="partner-logo-slot partner-logo-slot--oracle">
            <img className="app-header-oracle-logo" src={oracleLogo} alt="Oracle" />
          </span>
        </div>

        <div className="app-header-actions">
          <div className="theme-selector" aria-label="Tema da aplicação">
            <button
              type="button"
              className={theme === "light" ? "is-active" : ""}
              aria-label="Usar tema claro"
              aria-pressed={theme === "light"}
              onClick={() => setTheme("light")}
            >
              <span aria-hidden="true">☀</span>
              <span className="theme-label">Claro</span>
            </button>
            <button
              type="button"
              className={theme === "dark" ? "is-active" : ""}
              aria-label="Usar tema escuro"
              aria-pressed={theme === "dark"}
              onClick={() => setTheme("dark")}
            >
              <span aria-hidden="true">◐</span>
              <span className="theme-label">Escuro</span>
            </button>
          </div>

          {showLogout && user?.role === "admin" && (
            <button
              className="header-navigation-button"
              type="button"
              onClick={() => navigate(isUserManagement ? "/dashboard" : "/admin/usuarios")}
            >
              {isUserManagement ? "Operação" : "Usuários"}
            </button>
          )}

          {showLogout && (
            <button
              className="header-logout-button"
              type="button"
              onClick={handleLogout}
            >
              Sair
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

export default AppHeader;
