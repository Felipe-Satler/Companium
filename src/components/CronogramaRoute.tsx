import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Guard da página Cronograma (aba Clientes): a equipe Groohub entra por padrão; usuário-cliente
 * só com o papel `cronograma_viewer` (marcado na Administração → botão "Permitir Cronograma").
 * admin sempre entra. Usado DENTRO de <ProtectedRoute> — login/aprovação já resolvidos. Sem
 * acesso → redireciona pra home.
 */
export function CronogramaRoute({ children }: { children: React.ReactNode }) {
  const { canViewCronograma } = useAuth();
  if (!canViewCronograma) return <Navigate to="/" replace />;
  return <>{children}</>;
}
