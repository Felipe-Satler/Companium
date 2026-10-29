import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ClientesFiltersProvider } from "@/contexts/ClientesFiltersContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { CaptacaoRoute } from "@/components/CaptacaoRoute";
import { GestaoRoute } from "@/components/GestaoRoute";
import { MarcosRoute } from "@/components/MarcosRoute";
import { UsoRoute } from "@/components/UsoRoute";
import { UsageTracker } from "@/components/UsageTracker";
import { AvisoUsoDialog } from "@/components/AvisoUsoDialog";
import { CronogramaRoute } from "@/components/CronogramaRoute";
import { MetasRoute } from "@/components/MetasRoute";
import { ChatbotRoute } from "@/components/ChatbotRoute";
import { ChatbotHost } from "@/chatbot/react/ChatbotHost";


// Eager: Auth é o 1º render dos não-logados; NotFound é trivial e usado em fallback.
import Auth from "./pages/Auth.tsx";
import NotFound from "./pages/NotFound.tsx";

// Demais páginas viram chunks separados — bundle inicial cai de ~1.5MB pra ~300KB.
const ResetPassword = lazy(() => import("./pages/ResetPassword.tsx"));
const Admin = lazy(() => import("./pages/Admin.tsx"));
const WhatsappAgent = lazy(() => import("./pages/WhatsappAgent.tsx"));
const Index = lazy(() => import("./pages/Index.tsx"));
const Vendas = lazy(() => import("./pages/Vendas.tsx"));
const Forecast = lazy(() => import("./pages/Forecast.tsx"));
const Pace = lazy(() => import("./pages/Pace.tsx"));
const Ranking = lazy(() => import("./pages/Ranking.tsx"));
const Reunioes = lazy(() => import("./pages/Reunioes.tsx"));
const Clientes = lazy(() => import("./pages/Clientes.tsx"));
const Marketing = lazy(() => import("./pages/Marketing.tsx"));
const MarketingBiblioteca = lazy(() => import("./pages/MarketingBiblioteca.tsx"));
const MarketingCriativos = lazy(() => import("./pages/MarketingCriativos.tsx"));
const MarketingClientes = lazy(() => import("./pages/MarketingClientes.tsx"));
import { AvisoDeConclusao } from "./components/marketing/AvisoDeConclusao";
const MarketingComposer = lazy(() => import("./pages/MarketingComposer.tsx"));
const MarketingComposicoes = lazy(() => import("./pages/MarketingComposicoes.tsx"));
const MarketingOficina = lazy(() => import("./pages/MarketingOficina.tsx"));
const MarketingArtes = lazy(() => import("./pages/MarketingArtes.tsx"));
const RedirecionarEstatico = lazy(() =>
  import("./pages/MarketingOficina.tsx").then((m) => ({ default: m.RedirecionarEstatico })),
);
const MarketingOrquestrador = lazy(() => import("./pages/MarketingOrquestrador.tsx"));
const MetaMarketing = lazy(() => import("./pages/MetaMarketing.tsx"));
const PaceMarketing = lazy(() => import("./pages/PaceMarketing.tsx"));
const PaidMedia = lazy(() => import("./pages/PaidMedia.tsx"));
const SocialInstagram = lazy(() => import("./pages/SocialInstagram.tsx"));
const ClientesMetaAds = lazy(() => import("./pages/ClientesMetaAds.tsx"));
const ClientesGoogleAds = lazy(() => import("./pages/ClientesGoogleAds.tsx"));
const CaptacaoMeta = lazy(() => import("./pages/CaptacaoMeta.tsx"));
const CaptacaoMetaAds = lazy(() => import("./pages/CaptacaoMetaAds.tsx"));
const CaptacaoGoogleAds = lazy(() => import("./pages/CaptacaoGoogleAds.tsx"));
const Gestao = lazy(() => import("./pages/Gestao.tsx"));
const Marcos = lazy(() => import("./pages/Marcos.tsx"));
const Uso = lazy(() => import("./pages/Uso.tsx"));
const Privacidade = lazy(() => import("./pages/Privacidade.tsx"));
const ClientesCRM = lazy(() => import("./pages/ClientesCRM.tsx"));
const ClientesPerformance = lazy(() => import("./pages/ClientesPerformance.tsx"));
const ClientesMetas = lazy(() => import("./pages/ClientesMetas.tsx"));
const Biblioteca = lazy(() => import("./pages/Biblioteca.tsx"));
const ProjetosCronograma = lazy(() => import("./pages/ProjetosCronograma.tsx"));
const ChatPage = lazy(() => import("@/chatbot/react/ChatPage"));


// Defaults de cache: sem isto o react-query trata todo dado como "stale" na hora e
// refaz fetch a cada montagem/foco de janela (piora a sensação de lentidão ao navegar).
// staleTime 5min alinha com o cache em memória dos hooks de dados (dataCache.ts).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 min
      gcTime: 10 * 60 * 1000, // 10 min em cache após ficar sem observadores
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const Protected = ({ children }: { children: React.ReactNode }) => (
  <ProtectedRoute>{children}</ProtectedRoute>
);

const RouteFallback = () => {
  // On the chat route, paint the chat surface (not the app background) so the
  // lazy-bundle load doesn't flash a different color before ChatPage mounts.
  const { pathname } = useLocation();
  const isChat = pathname === '/assistente';
  return (
    <div
      className="flex h-screen items-center justify-center"
      style={isChat ? { background: 'var(--chat-surface)' } : undefined}
    >
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent" />
    </div>
  );
};

function FloatingChat() {
  const { pathname } = useLocation();
  const { clientUser } = useAuth();
  // Usuário-cliente não tem assistente/chat.
  if (clientUser || pathname === '/assistente') return null;
  return <ChatbotHost />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            {/* Filtros das telas de /clientes vivem aqui (acima das rotas) p/ persistirem
                em memória entre navegações — cliente/médico/período escolhidos numa página
                valem em todas. Também persistido em localStorage. */}
            <ClientesFiltersProvider>
            {/* Avisa quando uma orquestração ou composição disparada aqui termina. Não desenha nada
                e não faz requisição enquanto não houver o que acompanhar. */}
            <AvisoDeConclusao />
            {/* Coleta de uso (tempo ativo por tela + cliques) p/ a página /uso. Não desenha nada. */}
            <UsageTracker />
            {/* Aviso da coleta de uso: 1x por usuário e versão do texto (lib/usage/aviso.ts). */}
            <AvisoUsoDialog />
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/auth" element={<Auth />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                {/* "Saiba mais" do aviso de coleta de uso. Pública: abre também sem login. */}
                <Route path="/privacidade" element={<Privacidade />} />
                {/* Landing padrão: abre direto em Clientes › CRM. A Receita (Index) segue
                    acessível via /receita — mantida no código, só fora da home. */}
                <Route path="/" element={<Navigate to="/clientes/crm" replace />} />
                <Route path="/receita" element={<Protected><Index /></Protected>} />
                <Route path="/admin" element={<Protected><Admin /></Protected>} />
                <Route path="/admin/whatsapp" element={<Protected><WhatsappAgent /></Protected>} />
                {/* Uso do Companium: admin OU papel usage_viewer (UsoRoute). */}
                <Route path="/uso" element={<Protected><UsoRoute><Uso /></UsoRoute></Protected>} />
                <Route path="/vendas" element={<Protected><Vendas /></Protected>} />
                <Route path="/forecast" element={<Protected><Forecast /></Protected>} />
                <Route path="/biblioteca" element={<Protected><Biblioteca /></Protected>} />
                {/* Cronograma migrou da aba Projetos p/ Clientes. Rotas antigas redirecionam. */}
                <Route path="/projetos" element={<Navigate to="/clientes/cronograma" replace />} />
                <Route path="/projetos/cronograma" element={<Navigate to="/clientes/cronograma" replace />} />
                <Route path="/clientes/cronograma" element={<Protected><CronogramaRoute><ProjetosCronograma /></CronogramaRoute></Protected>} />
                <Route path="/assistente" element={<Protected><ChatbotRoute><ChatPage /></ChatbotRoute></Protected>} />
                <Route path="/pace" element={<Protected><Pace /></Protected>} />
                <Route path="/ranking" element={<Protected><Ranking /></Protected>} />
                <Route path="/reunioes" element={<Protected><Reunioes /></Protected>} />
                {/* Clicar em "Clientes" (menu) ou abrir /clientes cai direto no CRM. A antiga
                    "Relatório Geral" (<Clientes/>) já estava oculta da sidebar. */}
                <Route path="/clientes" element={<Navigate to="/clientes/crm" replace />} />
                <Route path="/clientes/meta-ads" element={<Protected><ClientesMetaAds /></Protected>} />
                <Route path="/clientes/crm" element={<Protected><ClientesCRM /></Protected>} />
                <Route path="/clientes/google-ads" element={<Protected><ClientesGoogleAds /></Protected>} />
                <Route path="/clientes/performance" element={<Protected><ClientesPerformance /></Protected>} />
                {/* Metas: visão de carteira do planejado. Equipe entra por padrão; usuário-
                    cliente só com o papel metas_viewer (Administração → "Permitir Metas"). */}
                <Route path="/clientes/metas" element={<Protected><MetasRoute><ClientesMetas /></MetasRoute></Protected>} />
                {/* Captação: mídia própria da Groohub (conta "Groohub", não "cliente | Groohub").
                    Visível só p/ admin ou papel captacao_viewer (CaptacaoRoute). */}
                <Route path="/captacao" element={<Navigate to="/captacao/meta" replace />} />
                <Route path="/captacao/meta" element={<Protected><CaptacaoRoute><CaptacaoMeta /></CaptacaoRoute></Protected>} />
                <Route path="/captacao/meta-ads" element={<Protected><CaptacaoRoute><CaptacaoMetaAds /></CaptacaoRoute></Protected>} />
                <Route path="/captacao/google-ads" element={<Protected><CaptacaoRoute><CaptacaoGoogleAds /></CaptacaoRoute></Protected>} />
                {/* Gestão: visão interna da carteira (RevOps/MRR) a partir de planilha publicada.
                    Restrito ao dono (Bruno) e a quem ele liberou — admin não basta (GestaoRoute). */}
                <Route path="/gestao" element={<Navigate to="/gestao/gestao" replace />} />
                <Route path="/gestao/gestao" element={<Protected><GestaoRoute><Gestao /></GestaoRoute></Protected>} />
                {/* Marcos: 2ª página da aba Gestão (metas mensais x realizado). Trava PRÓPRIA
                    (MarcosRoute): por padrão só o dono (Bruno) ou quem ele liberou (marcos_viewer). */}
                <Route path="/gestao/marcos" element={<Protected><MarcosRoute><Marcos /></MarcosRoute></Protected>} />
                <Route path="/marketing" element={<Protected><Marketing /></Protected>} />
                {/* Só equipe interna: fora da CLIENT_USER_ALLOWED do ProtectedRoute, e o worker também recusa cliente. */}
                <Route path="/marketing/biblioteca" element={<Protected><MarketingBiblioteca /></Protected>} />
                <Route path="/marketing/criativos" element={<Protected><MarketingCriativos /></Protected>} />
                <Route path="/marketing/clientes" element={<Protected><MarketingClientes /></Protected>} />
                <Route path="/marketing/composer" element={<Protected><MarketingComposer /></Protected>} />
                <Route path="/marketing/composer/salvas" element={<Protected><MarketingComposicoes /></Protected>} />
                {/* Endereço antigo da arte (antes da Oficina): segue para a Nova arte com os mesmos parâmetros. */}
                <Route path="/marketing/composer/estatico" element={<Protected><RedirecionarEstatico /></Protected>} />
                <Route path="/marketing/oficina" element={<Protected><MarketingOficina /></Protected>} />
                <Route path="/marketing/oficina/salvas" element={<Protected><MarketingArtes /></Protected>} />
                <Route path="/marketing/orquestrador" element={<Protected><MarketingOrquestrador /></Protected>} />
                {/* O endereço das primeiras horas, quando ele era uma aba do Composer. */}
                <Route path="/marketing/composer/orquestrador" element={<Navigate to="/marketing/orquestrador" replace />} />
                <Route path="/meta-marketing" element={<Protected><MetaMarketing /></Protected>} />
                <Route path="/pace-marketing" element={<Protected><PaceMarketing /></Protected>} />
                <Route path="/paid-media" element={<Protected><PaidMedia /></Protected>} />
                <Route path="/social-instagram" element={<Protected><SocialInstagram /></Protected>} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
            </ClientesFiltersProvider>
            <FloatingChat />
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
