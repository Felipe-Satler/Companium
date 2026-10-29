import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

// Rotas que o usuário-CLIENTE pode acessar. Qualquer outra é redirecionada p/ o CRM.
// /assistente entra aqui; quem NÃO tem bot ainda é barrado depois pelo ChatbotRoute.
const CLIENT_USER_ALLOWED = ["/clientes/crm", "/clientes/meta-ads", "/clientes/google-ads", "/assistente"];

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isApproved, approvalStatus, loading, signOut, clientUser, canViewCronograma, canViewMetas } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ambient">
        <p className="text-sm text-muted-foreground">Carregando...</p>
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;

  if (!isApproved) {
    const isRejected = approvalStatus === "rejected";
    return (
      <main className="min-h-screen flex items-center justify-center bg-ambient bg-noise p-4">
        <Card className="w-full max-w-md p-8 text-center space-y-4">
          <h1 className="text-xl font-semibold text-foreground">
            {isRejected ? "Acesso negado" : "Aguardando aprovação"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isRejected
              ? "Seu cadastro foi rejeitado por um administrador. Caso acredite que isso é um engano, entre em contato com o responsável pelo sistema."
              : "Sua conta foi criada e está pendente de aprovação por um administrador. Você receberá acesso assim que for liberada."}
          </p>
          <Button variant="outline" onClick={signOut} className="w-full">
            Sair
          </Button>
        </Card>
      </main>
    );
  }

  // Usuário-cliente: só as 3 telas de Clientes; qualquer outra rota volta pro CRM. Exceções: o
  // Cronograma é liberado ao cliente que ganhou o papel cronograma_viewer (canViewCronograma),
  // e a tela de Metas ao que ganhou metas_viewer (canViewMetas). Sem o papel, nenhum dos dois.
  const clientAllowed =
    CLIENT_USER_ALLOWED.includes(location.pathname) ||
    (location.pathname === "/clientes/cronograma" && canViewCronograma) ||
    (location.pathname === "/clientes/metas" && canViewMetas);
  if (clientUser && !clientAllowed) {
    return <Navigate to="/clientes/crm" replace />;
  }

  return <>{children}</>;
}
