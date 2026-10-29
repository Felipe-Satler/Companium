import { Navigate } from "react-router-dom";
import { useChatbotAccess } from "@/chatbot/react/useChatbotAccess";

/**
 * Guard da página do GrooChat (/assistente): só entra quem tem um bot disponível.
 * Internos sempre têm (bot default); usuário-cliente só se tiver bot atribuído/permitido.
 * Usado DENTRO de <ProtectedRoute> (login/aprovação já resolvidos). Enquanto a config do
 * bot carrega, segura o redirect pra não expulsar quem tem acesso.
 */
export function ChatbotRoute({ children }: { children: React.ReactNode }) {
  const { hasBot, isLoading } = useChatbotAccess();
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ background: "var(--chat-surface)" }}>
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent" />
      </div>
    );
  }
  if (!hasBot) return <Navigate to="/" replace />;
  return <>{children}</>;
}
