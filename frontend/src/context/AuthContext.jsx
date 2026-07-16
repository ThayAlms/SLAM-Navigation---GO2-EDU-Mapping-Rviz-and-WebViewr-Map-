import { useCallback, useEffect, useMemo, useState } from "react";

import { isSupabaseConfigured, supabase } from "../lib/supabase";
import { recordLoginEvent } from "../services/api";
import { AuthContext } from "./auth-context";

const AUTH_ERROR_MESSAGES = {
  email_not_confirmed: "Confirme seu e-mail antes de entrar.",
  invalid_credentials: "E-mail ou senha incorretos.",
  email_address_invalid: "Informe um endereço de e-mail válido.",
  user_already_exists: "Já existe uma conta com este e-mail. Use a opção Entrar.",
  weak_password: "A senha informada não atende aos requisitos de segurança.",
  signup_disabled: "A criação de novas contas está desabilitada no Supabase.",
  over_email_send_rate_limit:
    "Muitos e-mails foram solicitados. Aguarde alguns minutos.",
  over_request_rate_limit:
    "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
};

function getAuthErrorMessage(error, action) {
  return (
    AUTH_ERROR_MESSAGES[error?.code] ||
    (action === "signup"
      ? "Não foi possível criar a conta. Verifique os dados e tente novamente."
      : "Não foi possível entrar. Verifique os dados e tente novamente.")
  );
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [isLoading, setIsLoading] = useState(Boolean(supabase));

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
        if (isActive) setIsLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setIsLoading(false);
    });

    return () => {
      isActive = false;
      subscription.unsubscribe();
    };
  }, []);

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
      throw new Error(getAuthErrorMessage(error, "signin"));
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

  const signUp = useCallback(async (email, password) => {
    if (!supabase) {
      throw new Error(
        "Supabase não configurado. Preencha as variáveis VITE_SUPABASE_*.",
      );
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/login`,
      },
    });

    if (error) {
      throw new Error(getAuthErrorMessage(error, "signup"));
    }

    if (data.session) {
      try {
        await recordLoginEvent(data.session.access_token);
      } catch (logError) {
        console.warn(
          "Conta criada, mas o evento de auditoria não foi salvo.",
          logError,
        );
      }
    }

    return data.session;
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, []);

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      isLoading,
      isConfigured: isSupabaseConfigured,
      signIn,
      signUp,
      signOut,
    }),
    [isLoading, session, signIn, signOut, signUp],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
