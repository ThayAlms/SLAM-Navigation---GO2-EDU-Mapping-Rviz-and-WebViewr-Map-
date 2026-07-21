import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";

import App from "./App.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import { ThemeProvider } from "./context/ThemeProvider.jsx";
import { ToastProvider } from "./context/ToastProvider.jsx";
import "./styles/global.css";
import "./styles/light-polish.css";
import "./styles/responsive.css";
import "./styles/mobile-layout-final.css";
import "./styles/operation-presence.css";
import "./styles/client-polish.css";
import "./styles/toasts.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <ThemeProvider>
          <ToastProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </ToastProvider>
        </ThemeProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
