import { useCallback, useEffect, useMemo, useState } from "react";

import { isSupabaseConfigured, supabase } from "../lib/supabase";
import { getCurrentUser, recordLoginEvent } from "../services/api";
import { AuthContext } from "./auth-context";

const AUTH_ERROR_MESSAGES = {
  email_not_confirmed: "Confirme seu e-mail antes de entrar.",
  invalid_credentials: "E-mail ou senha incorretos.",
  email_address_invalid: "Informe um endereço de e-mail válido.",
  over_email_send_rate_limit:
    "Muitos e-mails foram solicitados. Aguarde alguns minutos.",
  over_request_rate_limit:
    "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
};

function getAuthErrorMessage(error) {
  return (
    AUTH_ERROR_MESSAGES[error?.code] ||
    "Não foi possível entrar. Verifique os dados e tente novamente."
  );
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profileState, setProfileState] = useState({
    sessionId: null,
    user: null,
  });
  const [isSessionLoading, setIsSessionLoading] = useState(Boolean(supabase));

  useEffect(() => {
    if (!supabase) {
      return undefined;
    }

    let isActive = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (isActive) setSession(data.session);
      })
      .catch((error) => {
        console.warn("Não foi possível restaurar a sessão salva.", error);
      })
      .finally(() => {
        if (isActive) setIsSessionLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setIsSessionLoading(false);
    });

    return () => {
      isActive = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const userId = session?.user?.id;
    const accessToken = session?.access_token;
    if (!userId || !accessToken) {
      return undefined;
    }

    let isActive = true;

    getCurrentUser(accessToken)
      .then((user) => {
        if (isActive) setProfileState({ sessionId: userId, user });
      })
      .catch((error) => {
        console.warn("Não foi possível carregar o perfil do usuário.", error);
        if (isActive) {
          setProfileState({
            sessionId: userId,
            user: {
              id: userId,
              email: session.user.email,
              display_name: null,
              role: "operator",
            },
          });
        }
      });

    return () => {
      isActive = false;
    };
  }, [session]);

  const signIn = useCallback(async (email, password) => {
    if (!supabase) {
      throw new Error(
        "Supabase não configurado. Preencha as variáveis VITE_SUPABASE_*.",
      );
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      throw new Error(getAuthErrorMessage(error));
    }

    try {
      await recordLoginEvent(data.session.access_token);
    } catch (error) {
      console.warn(
        "Login concluído, mas o evento de auditoria não foi salvo.",
        error,
      );
    }

    return data.session;
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, []);

  const value = useMemo(
    () => {
      const isProfileLoading = Boolean(
        session?.user?.id && profileState.sessionId !== session.user.id,
      );
      return {
        session,
        user: isProfileLoading ? null : profileState.user,
        isLoading: isSessionLoading || isProfileLoading,
        isConfigured: isSupabaseConfigured,
        signIn,
        signOut,
      };
    },
    [isSessionLoading, profileState, session, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
