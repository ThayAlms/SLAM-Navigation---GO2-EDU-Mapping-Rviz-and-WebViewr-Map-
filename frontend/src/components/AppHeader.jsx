import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import xd4Logo from "../../logos/xd4robotics-escuro.svg";
import oracleLogo from "../../logos/Oracle-Logo.png";
import { useAuth } from "../context/useAuth";
import { useTheme } from "../context/useTheme";

function AppHeader({ showLogout = false, demoMode = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut, user } = useAuth();
  const { theme, setTheme } = useTheme();
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef(null);

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

  useEffect(() => {
    function closeMenu(event) {
      if (!menuRef.current?.contains(event.target)) setIsMenuOpen(false);
    }
    function closeOnEscape(event) {
      if (event.key === "Escape") setIsMenuOpen(false);
    }
    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  function handleLogoClick() {
    navigate(demoMode ? "/demo" : showLogout ? "/dashboard" : "/login");
  }

  async function handleLogout() {
    try {
      await signOut();
    } finally {
      navigate("/login", { replace: true });
    }
  }

  function navigateFromMenu(path) {
    setIsMenuOpen(false);
    navigate(path);
  }

  const isUserManagement = location.pathname.startsWith("/admin/usuarios");
  const isLogin = location.pathname === "/login";
  const headerClassName = [
    "app-header",
    isScrolled ? "app-header--scrolled" : "",
    isLogin ? "app-header--login" : "app-header--authenticated",
  ].filter(Boolean).join(" ");

  return (
    <header className={headerClassName}>
      <div className="app-header-inner">
        {!isLogin && <div className="header-menu" ref={menuRef}>
          <button
            className={`header-menu-trigger ${isMenuOpen ? "is-open" : ""}`}
            type="button"
            aria-label="Abrir menu"
            aria-expanded={isMenuOpen}
            onClick={() => setIsMenuOpen((current) => !current)}
          >
            <span /><span /><span />
          </button>
          {isMenuOpen && (
            <nav className="header-menu-popover" aria-label="Menu principal">
              <span className="header-menu-kicker">NAVEGAÇÃO</span>
              {showLogout ? (
                <>
                  <button type="button" onClick={() => navigateFromMenu("/dashboard")}>Painel de operação</button>
                  {user?.role === "admin" && (
                    <button type="button" onClick={() => navigateFromMenu(isUserManagement ? "/dashboard" : "/admin/usuarios")}>
                      {isUserManagement ? "Voltar à operação" : "Usuários e acessos"}
                    </button>
                  )}
                  <span className="header-menu-rule" />
                  <button className="header-menu-exit" type="button" onClick={handleLogout}>Encerrar sessão</button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => navigate("/login")}>Acesso do operador</button>
                  {demoMode && (
                    <button type="button" onClick={() => navigateFromMenu("/demo")}>Demonstração interativa</button>
                  )}
                  <span className="header-menu-note">XD4 Robotics × Oracle</span>
                </>
              )}
            </nav>
          )}
        </div>}

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
                src={xd4Logo}
                alt="XD4 Robotics"
              />
            </span>
          </button>
          <span className="brand-divider" aria-hidden="true" />
          <span className="partner-logo-slot partner-logo-slot--oracle">
            <img className="app-header-oracle-logo" src={oracleLogo} alt="Oracle" />
          </span>
        </div>

        {isLogin && (
          <div className="app-header-actions">
            <button
              type="button"
              className="header-demo-button"
              onClick={() => navigate("/demo")}
            >
              Ver demonstração
            </button>
          </div>
        )}

        {!isLogin && <div className="app-header-actions">
          <button
            type="button"
            className="theme-toggle"
            aria-label={theme === "dark" ? "Usar tema claro" : "Usar tema escuro"}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            <span aria-hidden="true">{theme === "dark" ? "☾" : "☀"}</span>
          </button>
        </div>}
      </div>
    </header>
  );
}

export default AppHeader;
