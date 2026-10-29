import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Guard da página Metas (aba Clientes): a equipe Groohub entra por padrão; usuário-cliente só
 * com o papel `metas_viewer` (marcado na Administração → botão "Permitir Metas"). A tela mostra
 * a situação de TODOS os clientes, por isso o externo fica de fora até ser liberado.
 * admin sempre entra. Usado DENTRO de <ProtectedRoute> — login/aprovação já resolvidos. Sem
 * acesso → redireciona pra home.
 */
export function MetasRoute({ children }: { children: React.ReactNode }) {
  const { canViewMetas } = useAuth();
  if (!canViewMetas) return <Navigate to="/" replace />;
  return <>{children}</>;
}
