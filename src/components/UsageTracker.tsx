import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { enterScreen, setUsageToken, startUsageTracking } from "@/lib/usage/tracker";

/**
 * Liga a coleta de uso (página /uso) para quem está logado e aprovado — equipe e usuário-
 * cliente. Não desenha nada. A regra de tempo ativo e o envio estão em lib/usage/tracker.ts.
 */
export function UsageTracker() {
  const { session, isApproved } = useAuth();
  const { pathname } = useLocation();
  const token = isApproved ? session?.access_token ?? null : null;
  const on = !!token;

  // O token muda a cada refresh do Supabase; o tracker só precisa do mais novo.
  useEffect(() => {
    setUsageToken(token);
  }, [token]);

  // Ao sair (on → false) a limpeza roda antes do token virar null e manda o que falta.
  useEffect(() => {
    if (!on) return;
    return startUsageTracking();
  }, [on]);

  useEffect(() => {
    if (on) enterScreen(pathname);
  }, [on, pathname]);

  return null;
}
