import * as React from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/external-supabase/client";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "unknown";

/** Dono da seção Gestão. Vê a página por padrão (sem precisar de papel) e é o único que
 *  enxerga o controle de liberação na Administração — até conceder acesso a outros admins,
 *  que passam a ver a seção e o próprio controle por consequência (papel `gestao_viewer`).
 *  Ser admin NÃO libera mais a Gestão sozinho. */
export const GESTAO_OWNER_EMAIL = "gestao@example.com";

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  isApproved: boolean;
  approvalStatus: ApprovalStatus;
  isAdmin: boolean;
  /** Pode executar as ações do CRM (editar planejado + escolher base de faturamento).
   *  admin OU papel `crm_editor` (marcado na tela de Administração). */
  canEditCrm: boolean;
  /** Pode CORRIGIR os números do CRM (override de leads/consultas/procedimentos por filtro).
   *  Permissão SEPARADA da de planejado: admin OU papel `crm_number_editor` (marcado na
   *  Administração). A trava real é a RLS de crm_metric_overrides (has_crm_number_access). */
  canEditCrmNumbers: boolean;
  /** Pode VER a seção Captação (mídia própria da Groohub). admin OU papel `captacao_viewer`
   *  (marcado na tela de Administração). Controla sidebar + rotas /captacao. */
  canViewCaptacao: boolean;
  /** Pode VER a página Cronograma (aba Clientes). A equipe Groohub (usuário normal) enxerga por
   *  padrão; usuário-cliente só se tiver o papel `cronograma_viewer` (marcado na Administração).
   *  admin sempre vê. Controla sidebar + rota /clientes/cronograma. */
  canViewCronograma: boolean;
  /** Pode VER a página Metas (aba Clientes). A equipe Groohub (usuário normal) enxerga por
   *  padrão; usuário-cliente NÃO — a tela mostra a carteira inteira, então ele só entra com o
   *  papel `metas_viewer` (botão "Permitir Metas" na Administração). admin sempre vê.
   *  Controla aba + sidebar + rota /clientes/metas. */
  canViewMetas: boolean;
  /** Escopos de EDIÇÃO das metas da Captação (página Metas › aba Captação). Concedidos por
   *  usuário na Administração ("Edição Metas"). admin sempre pode os três. Substituem a antiga
   *  regra fixa (só o Bruno editava meses passados). O gate real de mês é no frontend
   *  (MetaEditDialog/MetaPage); a RLS de captacao_metas libera escrita p/ admin, crm_editor ou
   *  qualquer papel metas_edit_*. */
  canEditMetasPast: boolean;
  canEditMetasPresent: boolean;
  canEditMetasFuture: boolean;
  /** Pode usar o botão "Comparar períodos" nas telas de Clientes (CRM/Meta/Google).
   *  NÃO é liberado por padrão para ninguém (nem equipe): só admin OU quem tiver o papel
   *  `comparar_periodos_viewer` marcado na tela de Administração. */
  canCompararPeriodos: boolean;
  /** Pode VER e ACESSAR a seção Gestão (aba na sidebar + rota /gestao/gestao). NÃO é liberada
   *  por padrão a ninguém (nem equipe): só admin OU papel `gestao_viewer` marcado na tela de
   *  Administração (divisão "GESTÃO"). */
  canViewGestao: boolean;
  /** Pode VER e ACESSAR a página Marcos (2ª página da seção Gestão, rota /gestao/marcos).
   *  Permissão SEPARADA da Gestão: por padrão SÓ o dono (Bruno, por e-mail) — nem admin, nem
   *  quem tem acesso à Gestão entra sozinho. Liberada por ele na Administração (papel
   *  `marcos_viewer`). Controla a rota /gestao/marcos + o subitem Marcos na sidebar. */
  canViewMarcos: boolean;
  /** Pode VER e ACESSAR a página Agente WhatsApp (/admin/whatsapp) + o item na sidebar.
   *  admin OU papel `whatsapp_editor` (concedido pelo admin no painel /admin). A RLS das
   *  tabelas whatsapp_group_agents/whatsapp_known_groups usa a mesma regra (has_whatsapp_access). */
  canManageWhatsapp: boolean;
  /** Pode VER e ACESSAR a página Uso do Companium (/uso: tempo de uso por tela, cliques,
   *  navegação). admin OU papel `usage_viewer` (marcado na Administração, divisão "USO").
   *  Controla a rota + o item na sidebar; os dados são travados no banco (has_usage_access). */
  canViewUso: boolean;
  /** Usuário-CLIENTE: acesso restrito a UM cliente (só CRM/Meta/Google, somente leitura).
   *  null = usuário normal (equipe). O isolamento real dos DADOS é no banco (RLS/views);
   *  aqui é só a experiência (trava de filtro, telas, dropdown). `adsNames` = nomes CRUS das
   *  contas de Ads do cliente (p/ escopar fetches por `.in("Client", ...)`, os mesmos da RLS). */
  clientUser: { clientId: string; slug: string; adsNames: string[] } | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = React.createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(null);
  const [session, setSession] = React.useState<Session | null>(null);
  const [isApproved, setIsApproved] = React.useState(false);
  const [approvalStatus, setApprovalStatus] = React.useState<ApprovalStatus>("unknown");
  const [isAdmin, setIsAdmin] = React.useState(false);
  const [canEditCrm, setCanEditCrm] = React.useState(false);
  const [canEditCrmNumbers, setCanEditCrmNumbers] = React.useState(false);
  const [canViewCaptacao, setCanViewCaptacao] = React.useState(false);
  const [canViewCronograma, setCanViewCronograma] = React.useState(false);
  const [canViewMetas, setCanViewMetas] = React.useState(false);
  const [canEditMetasPast, setCanEditMetasPast] = React.useState(false);
  const [canEditMetasPresent, setCanEditMetasPresent] = React.useState(false);
  const [canEditMetasFuture, setCanEditMetasFuture] = React.useState(false);
  const [canCompararPeriodos, setCanCompararPeriodos] = React.useState(false);
  const [canViewGestao, setCanViewGestao] = React.useState(false);
  const [canViewMarcos, setCanViewMarcos] = React.useState(false);
  const [canManageWhatsapp, setCanManageWhatsapp] = React.useState(false);
  const [canViewUso, setCanViewUso] = React.useState(false);
  const [clientUser, setClientUser] = React.useState<{ clientId: string; slug: string; adsNames: string[] } | null>(null);
  const [loading, setLoading] = React.useState(true);

  const fetchStatus = React.useCallback(async (uid: string, email: string | null | undefined) => {
    const [{ data: approval }, { data: roles }, { data: scope }] = await Promise.all([
      supabase.from("user_approvals").select("status").eq("user_id", uid).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", uid),
      supabase.from("user_client_scope").select("client_id, client_slug, ads_names").eq("user_id", uid).maybeSingle(),
    ]);
    // Usuário-cliente: 1 linha em user_client_scope (client_id + slug + ads_names). Ausente → normal.
    const isClientUser = !!scope;
    setClientUser(scope ? { clientId: (scope as any).client_id, slug: (scope as any).client_slug, adsNames: ((scope as any).ads_names as string[]) ?? [] } : null);
    const status = (approval?.status as ApprovalStatus | undefined) ?? "unknown";
    setApprovalStatus(status);
    setIsApproved(status === "approved");
    const admin = !!roles?.some((r) => r.role === "admin");
    setIsAdmin(admin);
    // Acesso de escrita ao CRM: admin OU papel crm_editor.
    setCanEditCrm(admin || !!roles?.some((r) => r.role === "crm_editor"));
    // Correção dos números do CRM (override): permissão SEPARADA — admin OU crm_number_editor.
    setCanEditCrmNumbers(admin || !!roles?.some((r) => r.role === "crm_number_editor"));
    // Visibilidade da seção Captação: admin OU papel captacao_viewer.
    setCanViewCaptacao(admin || !!roles?.some((r) => r.role === "captacao_viewer"));
    // Visibilidade da página Cronograma: equipe Groohub vê por padrão; usuário-cliente só com o
    // papel cronograma_viewer. admin sempre vê.
    setCanViewCronograma(admin || !isClientUser || !!roles?.some((r) => r.role === "cronograma_viewer"));
    // Visibilidade da página Metas: mesma regra do Cronograma — equipe vê por padrão, usuário-
    // cliente só com o papel metas_viewer (a tela expõe a carteira toda). admin sempre vê.
    setCanViewMetas(admin || !isClientUser || !!roles?.some((r) => r.role === "metas_viewer"));
    // Edição das metas da Captação por intervalo de mês: admin (sempre os três) OU o papel
    // específico. Sem papel = não edita aquele intervalo (config explícita na Administração).
    setCanEditMetasPast(admin || !!roles?.some((r) => r.role === "metas_edit_past"));
    setCanEditMetasPresent(admin || !!roles?.some((r) => r.role === "metas_edit_present"));
    setCanEditMetasFuture(admin || !!roles?.some((r) => r.role === "metas_edit_future"));
    // Botão "Comparar períodos": NÃO liberado por padrão — só admin OU quem foi marcado
    // (papel comparar_periodos_viewer) na Administração.
    setCanCompararPeriodos(admin || !!roles?.some((r) => r.role === "comparar_periodos_viewer"));
    // Seção Gestão: NÃO liberada por padrão a ninguém (nem admin) — só o dono (Bruno, por
    // e-mail) OU quem tiver o papel gestao_viewer (concedido por ele na Administração).
    // Controla a aba na sidebar + a rota /gestao/gestao.
    const isGestaoOwner = (email ?? "").trim().toLowerCase() === GESTAO_OWNER_EMAIL;
    setCanViewGestao(isGestaoOwner || !!roles?.some((r) => r.role === "gestao_viewer"));
    // Página Marcos (2ª página da Gestão): permissão PRÓPRIA. Por padrão só o dono (Bruno) —
    // nem admin, nem gestao_viewer entram sozinhos; os demais só com o papel marcos_viewer.
    setCanViewMarcos(isGestaoOwner || !!roles?.some((r) => r.role === "marcos_viewer"));
    // Tela Agente WhatsApp: admin OU papel whatsapp_editor (concedido na Administração).
    setCanManageWhatsapp(admin || !!roles?.some((r) => r.role === "whatsapp_editor"));
    // Página Uso do Companium: admin OU papel usage_viewer (concedido na Administração).
    setCanViewUso(admin || !!roles?.some((r) => r.role === "usage_viewer"));
  }, []);

  React.useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) {
        setTimeout(() => {
          fetchStatus(sess.user.id, sess.user.email);
        }, 0);
      } else {
        setIsApproved(false);
        setApprovalStatus("unknown");
        setIsAdmin(false);
        setCanEditCrm(false);
        setCanEditCrmNumbers(false);
        setCanViewCaptacao(false);
        setCanViewCronograma(false);
        setCanViewMetas(false);
        setCanEditMetasPast(false);
        setCanEditMetasPresent(false);
        setCanEditMetasFuture(false);
        setCanCompararPeriodos(false);
        setCanViewGestao(false);
        setCanViewMarcos(false);
        setCanManageWhatsapp(false);
        setCanViewUso(false);
        setClientUser(null);
      }
    });

    supabase.auth.getSession().then(({ data: { session: sess } }) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) {
        fetchStatus(sess.user.id, sess.user.email).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, [fetchStatus]);

  const signIn: AuthContextValue["signIn"] = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  };

  const signUp: AuthContextValue["signUp"] = async (email, password) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/` },
    });
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, isApproved, approvalStatus, isAdmin, canEditCrm, canEditCrmNumbers, canViewCaptacao, canViewCronograma, canViewMetas, canEditMetasPast, canEditMetasPresent, canEditMetasFuture, canCompararPeriodos, canViewGestao, canViewMarcos, canManageWhatsapp, canViewUso, clientUser, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
