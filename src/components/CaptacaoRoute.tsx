import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Guard da seção Captação: só entra quem pode ver (admin OU papel captacao_viewer, marcado
 * na tela de Administração). Usado DENTRO de <ProtectedRoute> — quando renderiza, login e
 * aprovação já foram resolvidos. Sem acesso → redireciona pra home.
 */
export function CaptacaoRoute({ children }: { children: React.ReactNode }) {
  const { canViewCaptacao } = useAuth();
  if (!canViewCaptacao) return <Navigate to="/" replace />;
  return <>{children}</>;
}
