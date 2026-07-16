import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import logoBranca from "../assets/images/xd4robotics-branco.svg";
import logoEscura from "../assets/images/xd4robotics-escuro.svg";
import { useAuth } from "../context/useAuth";

function AppHeader({ showLogout = false, centerLogo = false }) {
  const navigate = useNavigate();
  const { signOut } = useAuth();
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

  return (
    <header
      className={isScrolled ? "app-header app-header--scrolled" : "app-header"}
    >
      <div
        className={`app-header-inner ${
          centerLogo ? "app-header-inner--centered" : ""
        }`}
      >
        <button
          className="app-header-brand"
          type="button"
          onClick={handleLogoClick}
          aria-label="Ir para a página inicial"
        >
          <img
            className="app-header-logo"
            src={isScrolled ? logoEscura : logoBranca}
            alt="XD4 Robotics"
          />
        </button>

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
    </header>
  );
}

export default AppHeader;
