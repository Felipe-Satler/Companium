import { useEffect, useState, useCallback, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/external-supabase/client";
import { prettyClientLabel } from "@/data/clienteAliases";
import { useAuth, GESTAO_OWNER_EMAIL } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Check, X, Shield, ShieldOff, RefreshCw, PencilLine, Eye, Trash2, Search, UserRound, Users, CalendarRange, Target, Calculator, ChevronDown, ChevronUp, History, CalendarCheck, CalendarClock, GitCompareArrows, Briefcase, Flag, MessageCircle, Activity, EyeOff, type LucideIcon } from "lucide-react";
import { UserBotSettings } from "@/components/admin/UserBotSettings";
import { AdminClientesOcultos } from "@/components/admin/AdminClientesOcultos";
import { AdminClientUserControl } from "@/components/admin/AdminClientUserControl";
import { AdminPedidosDados } from "@/components/admin/AdminPedidosDados";
import { AdminEquipes, SeletorEquipe } from "@/components/admin/AdminEquipes";
import { usePedidosAdmin } from "@/hooks/usePedidosDados";
import { useAdminClientOptions } from "@/hooks/useAdminClientOptions";
// import { AdminBotTenancy } from "@/components/admin/AdminBotTenancy"; // aba ocultada — escopo agora é por usuário


type Status = "pending" | "approved" | "rejected";

type Row = {
  user_id: string;
  email: string;
  status: Status;
  requested_at: string;
  decided_at: string | null;
  is_admin: boolean;
  is_crm_editor: boolean;
  is_crm_number_editor: boolean;
  is_captacao_viewer: boolean;
  is_cronograma_viewer: boolean;
  is_metas_viewer: boolean;
  is_metas_edit_past: boolean;
  is_metas_edit_present: boolean;
  is_metas_edit_future: boolean;
  is_comparar_periodos: boolean;
  is_gestao_viewer: boolean;
  is_marcos_viewer: boolean;
  is_whatsapp_editor: boolean;
  is_usage_viewer: boolean;
  is_usage_optout: boolean; // pediu para não ter o uso medido (usage_optout)
  client_slug: string | null; // usuário-cliente vinculado (null = usuário normal)
};

// Estilo dos botões de permissão POR ESTADO: quando a permissão está ATIVA ("on") o botão usa
// a cor da própria feature (mesma do badge) e borda sólida; quando INATIVA ("off") fica neutro,
// apagado e com borda tracejada. Assim o estado marcado/desmarcado se lê pela cor, não só pelo
// ícone.
const TOGGLE_ON = {
  crm: "bg-primary/15 text-primary border-primary/40 hover:bg-primary/25 hover:text-primary",
  crmnum: "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/40 hover:bg-violet-500/25 hover:text-violet-400",
  captacao: "bg-emerald-500/15 text-emerald-500 border-emerald-500/40 hover:bg-emerald-500/25 hover:text-emerald-500",
  cronograma: "bg-amber-500/15 text-amber-500 border-amber-500/40 hover:bg-amber-500/25 hover:text-amber-500",
  metas: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/40 hover:bg-sky-500/25 hover:text-sky-400",
  comparar: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/40 hover:bg-rose-500/25 hover:text-rose-400",
  gestao: "bg-teal-500/15 text-teal-600 dark:text-teal-400 border-teal-500/40 hover:bg-teal-500/25 hover:text-teal-400",
  marcos: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/40 hover:bg-indigo-500/25 hover:text-indigo-400",
  admin: "bg-chart-forecast/15 text-chart-forecast border-chart-forecast/40 hover:bg-chart-forecast/25 hover:text-chart-forecast",
  cliente: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/40 hover:bg-blue-500/25 hover:text-blue-400",
  optout: "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/40 hover:bg-slate-500/25 hover:text-slate-300",
  uso: "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400 border-fuchsia-500/40 hover:bg-fuchsia-500/25 hover:text-fuchsia-400",
  whatsapp: "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/40 hover:bg-green-500/25 hover:text-green-400",
} as const;
const TOGGLE_OFF = "neu-button text-muted-foreground border-dashed hover:text-foreground";

// Envolve um botão num tooltip do app (Radix). Só apresentação: não altera o botão,
// que segue sendo o gatilho real (asChild encaminha ref/handlers ao elemento filho).
const Hint = ({ text, children }: { text: string; children: ReactNode }) => (
  <Tooltip>
    <TooltipTrigger asChild>{children}</TooltipTrigger>
    <TooltipContent className="max-w-xs text-center">{text}</TooltipContent>
  </Tooltip>
);

// Chip compacto de permissão: rótulo curto FIXO + ícone; o estado se lê pela cor (ligado =
// cor da feature + ✓; desligado = neutro tracejado). Clicar alterna. O tooltip carrega a
// explicação da ação, então o rótulo fica pequeno e a linha ocupa pouco espaço.
const ToggleChip = ({
  on,
  label,
  icon: Icon,
  hint,
  colorKey,
  onClick,
  disabled,
}: {
  on: boolean;
  label: string;
  icon: LucideIcon;
  hint: string;
  colorKey: keyof typeof TOGGLE_ON;
  onClick: () => void;
  disabled?: boolean;
}) => (
  <Hint text={hint}>
    <Button
      size="sm"
      variant="outline"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className={cn("h-7 gap-1 px-2 text-xs font-medium", on ? TOGGLE_ON[colorKey] : TOGGLE_OFF)}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
      {on && <Check className="h-3 w-3" />}
    </Button>
  </Hint>
);

// Rótulo curto de um grupo de ações (Clientes, Captação, …), inline antes dos chips.
const GroupLabel = ({ children }: { children: ReactNode }) => (
  <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/70 shrink-0">
    {children}
  </span>
);

export default function Admin() {
  const { user, isAdmin, canViewGestao, canViewMarcos, loading } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  // Lista de clientes p/ o seletor de usuário-cliente: MESMA fonte das telas de /clientes
  // (união canônica Ads+Kommo) + id resolvido do cadastro, robusta (retry + keep-last-good).
  const { options: clientOpts } = useAdminClientOptions(isAdmin);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Status>("pending");
  const [query, setQuery] = useState("");
  // user_id da linha com o painel "Edição Metas" expandido (null = todos fechados).
  const [metasEditOpen, setMetasEditOpen] = useState<string | null>(null);
  // Pedidos sobre dados de uso (página /privacidade): contagem dos abertos na aba.
  const { data: pedidos = [] } = usePedidosAdmin(isAdmin);
  const pedidosAbertos = pedidos.filter((p) => p.status === "aberto").length;

  const fetchRows = useCallback(async () => {
    setRefreshing(true);
    const { data: approvals, error } = await supabase
      .from("user_approvals")
      .select("user_id, status, requested_at, decided_at")
      .order("requested_at", { ascending: false });
    if (error) {
      toast.error(error.message);
      setRefreshing(false);
      return;
    }
    const ids = approvals?.map((a) => a.user_id) ?? [];
    const { data: roles } = await supabase
      .from("user_roles")
      .select("user_id, role")
      .in("user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);

    const { data: users, error: usersError } = await supabase.rpc("get_users_with_emails");
    if (usersError) toast.error(usersError.message);
    const emailMap = new Map((users ?? []).map((u: { id: string; email: string }) => [u.id, u.email]));

    const { data: scopes } = await supabase
      .from("user_client_scope")
      .select("user_id, client_slug")
      .in("user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    const scopeMap = new Map((scopes ?? []).map((s: any) => [s.user_id, s.client_slug as string]));

    const adminSet = new Set(roles?.filter((r) => r.role === "admin").map((r) => r.user_id));
    const crmSet = new Set(roles?.filter((r) => r.role === "crm_editor").map((r) => r.user_id));
    const crmNumSet = new Set(roles?.filter((r) => r.role === "crm_number_editor").map((r) => r.user_id));
    const captacaoSet = new Set(roles?.filter((r) => r.role === "captacao_viewer").map((r) => r.user_id));
    const cronogramaSet = new Set(roles?.filter((r) => r.role === "cronograma_viewer").map((r) => r.user_id));
    const metasSet = new Set(roles?.filter((r) => r.role === "metas_viewer").map((r) => r.user_id));
    const metasEditPastSet = new Set(roles?.filter((r) => r.role === "metas_edit_past").map((r) => r.user_id));
    const metasEditPresentSet = new Set(roles?.filter((r) => r.role === "metas_edit_present").map((r) => r.user_id));
    const metasEditFutureSet = new Set(roles?.filter((r) => r.role === "metas_edit_future").map((r) => r.user_id));
    const compararSet = new Set(roles?.filter((r) => r.role === "comparar_periodos_viewer").map((r) => r.user_id));
    const gestaoSet = new Set(roles?.filter((r) => r.role === "gestao_viewer").map((r) => r.user_id));
    const marcosSet = new Set(roles?.filter((r) => r.role === "marcos_viewer").map((r) => r.user_id));
    const whatsappSet = new Set(roles?.filter((r) => r.role === "whatsapp_editor").map((r) => r.user_id));
    const usoSet = new Set(roles?.filter((r) => r.role === "usage_viewer").map((r) => r.user_id));
    // Sem a migração 20261027 a tabela não existe: o erro só deixa todos como "medidos".
    const { data: optouts } = await supabase.from("usage_optout").select("user_id");
    const optoutSet = new Set(((optouts ?? []) as { user_id: string }[]).map((o) => o.user_id));
    setRows(
      (approvals ?? []).map((a) => ({
        user_id: a.user_id,
        email: (emailMap.get(a.user_id) as string | undefined) ?? `${a.user_id.slice(0, 8)}…`,
        status: a.status as Status,
        requested_at: a.requested_at,
        decided_at: a.decided_at,
        is_admin: adminSet.has(a.user_id),
        is_crm_editor: crmSet.has(a.user_id),
        is_crm_number_editor: crmNumSet.has(a.user_id),
        is_captacao_viewer: captacaoSet.has(a.user_id),
        is_cronograma_viewer: cronogramaSet.has(a.user_id),
        is_metas_viewer: metasSet.has(a.user_id),
        is_metas_edit_past: metasEditPastSet.has(a.user_id),
        is_metas_edit_present: metasEditPresentSet.has(a.user_id),
        is_metas_edit_future: metasEditFutureSet.has(a.user_id),
        is_comparar_periodos: compararSet.has(a.user_id),
        is_gestao_viewer: gestaoSet.has(a.user_id),
        is_marcos_viewer: marcosSet.has(a.user_id),
        is_whatsapp_editor: whatsappSet.has(a.user_id),
        is_usage_viewer: usoSet.has(a.user_id),
        is_usage_optout: optoutSet.has(a.user_id),
        client_slug: (scopeMap.get(a.user_id) as string | undefined) ?? null,
      })),
    );
    setRefreshing(false);
  }, []);

  useEffect(() => {
    document.title = "Administração | Companium";
    if (isAdmin) fetchRows();
  }, [isAdmin, fetchRows]);

  const emailDe = (id: string) => rows.find((r) => r.user_id === id)?.email ?? `${id.slice(0, 8)}…`;

  if (loading) return null;
  if (!user) return <Navigate to="/auth" replace />;
  if (!isAdmin) return <Navigate to="/" replace />;

  const setStatus = async (uid: string, status: Status) => {
    setBusyId(uid);
    const { error } = await supabase
      .from("user_approvals")
      .update({ status, decided_at: new Date().toISOString(), decided_by: user.id })
      .eq("user_id", uid);
    setBusyId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Cadastro ${status === "approved" ? "aprovado" : status === "rejected" ? "rejeitado" : "atualizado"}.`);
    fetchRows();
  };

  const toggleAdmin = async (uid: string, makeAdmin: boolean) => {
    setBusyId(uid);
    if (makeAdmin) {
      const { error } = await supabase.from("user_roles").insert({ user_id: uid, role: "admin" });
      if (error && !error.message.includes("duplicate")) {
        toast.error(error.message);
        setBusyId(null);
        return;
      }
      toast.success("Promovido a admin.");
    } else {
      const { error } = await supabase.from("user_roles").delete().eq("user_id", uid).eq("role", "admin");
      if (error) {
        toast.error(error.message);
        setBusyId(null);
        return;
      }
      toast.success("Privilégio de admin removido.");
    }
    setBusyId(null);
    fetchRows();
  };

  // Marca/desmarca o papel `crm_editor` — quem pode editar o planejado e escolher a base de
  // faturamento no CRM. Independente do admin (admin já tem acesso ao CRM implicitamente).
  const toggleCrmEditor = async (uid: string, make: boolean) => {
    setBusyId(uid);
    if (make) {
      const { error } = await supabase.from("user_roles").insert({ user_id: uid, role: "crm_editor" });
      if (error && !error.message.includes("duplicate")) {
        toast.error(error.message);
        setBusyId(null);
        return;
      }
      toast.success("Acesso de edição do CRM concedido.");
    } else {
      const { error } = await supabase.from("user_roles").delete().eq("user_id", uid).eq("role", "crm_editor");
      if (error) {
        toast.error(error.message);
        setBusyId(null);
        return;
      }
      toast.success("Acesso de edição do CRM removido.");
    }
    setBusyId(null);
    fetchRows();
  };

  // Marca/desmarca o papel `crm_number_editor` — quem pode CORRIGIR os números do CRM
  // (override de leads/consultas/procedimentos por filtro). Permissão SEPARADA da de planejado
  // (crm_editor). Independente do admin (admin já corrige implicitamente).
  const toggleCrmNumberEditor = async (uid: string, make: boolean) => {
    setBusyId(uid);
    if (make) {
      const { error } = await supabase.from("user_roles").insert({ user_id: uid, role: "crm_number_editor" });
      if (error && !error.message.includes("duplicate")) {
        toast.error(error.message);
        setBusyId(null);
        return;
      }
      toast.success("Acesso de correção dos números do CRM concedido.");
    } else {
      const { error } = await supabase.from("user_roles").delete().eq("user_id", uid).eq("role", "crm_number_editor");
      if (error) {
        toast.error(error.message);
        setBusyId(null);
        return;
      }
      toast.success("Acesso de correção dos números do CRM removido.");
    }
    setBusyId(null);
    fetchRows();
  };

  // Marca/desmarca o papel `captacao_viewer` — quem pode VER a seção Captação. Independente
  // do admin (admin já enxerga a Captação implicitamente).
  const toggleCaptacaoViewer = async (uid: string, make: boolean) => {
    setBusyId(uid);
    if (make) {
      const { error } = await supabase.from("user_roles").insert({ user_id: uid, role: "captacao_viewer" });
      if (error && !error.message.includes("duplicate")) {
        toast.error(error.message);
        setBusyId(null);
        return;
      }
      toast.success("Acesso à Captação concedido.");
    } else {
      const { error } = await supabase.from("user_roles").delete().eq("user_id", uid).eq("role", "captacao_viewer");
      if (error) {
        toast.error(error.message);
        setBusyId(null);
        return;
      }
      toast.success("Acesso à Captação removido.");
    }
    setBusyId(null);
    fetchRows();
  };

  // Marca/desmarca o papel `usage_viewer` — quem pode VER a página Uso do Companium (/uso: tempo
  // de uso por tela e cliques de TODOS os usuários). Por padrão só admin; não vale p/ usuário-cliente.
  const toggleUsageViewer = async (uid: string, make: boolean) => {
    setBusyId(uid);
    if (make) {
      const { error } = await supabase.from("user_roles").insert({ user_id: uid, role: "usage_viewer" });
      if (error && !error.message.includes("duplicate")) {
        toast.error(error.message);
        setBusyId(null);
        return;
      }
      toast.success("Acesso ao Uso do Companium concedido.");
    } else {
      const { error } = await supabase.from("user_roles").delete().eq("user_id", uid).eq("role", "usage_viewer");
      if (error) {
        toast.error(error.message);
        setBusyId(null);
        return;
      }
      toast.success("Acesso ao Uso do Companium removido.");
    }
    setBusyId(null);
    fetchRows();
  };

  // Liga/desliga a medição de uso de um usuário (usage_optout) — atende o pedido de oposição feito
  // na página /privacidade. Vale p/ qualquer usuário, inclusive admin e cliente.
  const toggleUsageOptout = async (uid: string, naoMedir: boolean) => {
    setBusyId(uid);
    const { error } = naoMedir
      ? await supabase.from("usage_optout").insert({ user_id: uid })
      : await supabase.from("usage_optout").delete().eq("user_id", uid);
    if (error && !error.message.includes("duplicate")) {
      toast.error(error.message);
      setBusyId(null);
      return;
    }
    toast.success(naoMedir ? "O uso deste usuário deixa de ser medido." : "O uso deste usuário volta a ser medido.");
    setBusyId(null);
    fetchRows();
  };

  // Marca/desmarca o papel `whatsapp_editor` — quem pode VER/usar a tela Agente WhatsApp
  // (/admin/whatsapp). Independente do admin (admin já enxerga a tela).
  const toggleWhatsappEditor = async (uid: string, make: boolean) => {
    setBusyId(uid);
    if (make) {
      const { error } = await supabase.from("user_roles").insert({ user_id: uid, role: "whatsapp_editor" });
      if (error && !error.message.includes("duplicate")) {
        toast.error(error.message);
        setBusyId(null);
        return;
      }
      toast.success("Acesso ao Agente WhatsApp concedido.");
    } else {
      const { error } = await supabase.from("user_roles").delete().eq("user_id", uid).eq("role", "whatsapp_editor");
      if (error) {
        toast.error(error.message);
        setBusyId(null);
        return;
      }
      toast.success("Acesso ao Agente WhatsApp removido.");
    }
    setBusyId(null);
    fetchRows();
  };

  // Marca/desmarca o papel `comparar_periodos_viewer` — quem pode usar o botão "Comparar
  // períodos" nas telas de Clientes (CRM/Meta/Google). NÃO é liberado por padrão a ninguém:
  // só admin (implícito) ou quem for marcado aqui.
  const toggleCompararPeriodos = async (uid: string, make: boolean) => {
    setBusyId(uid);
    if (make) {
      const { error } = await supabase.from("user_roles").insert({ user_id: uid, role: "comparar_periodos_viewer" });
      if (error && !error.message.includes("duplicate")) {
        toast.error(error.message);
        setBusyId(null);
        return;
      }
      toast.success("Acesso a Comparar períodos concedido.");
    } else {
      const { error } = await supabase.from("user_roles").delete().eq("user_id", uid).eq("role", "comparar_periodos_viewer");
      if (error) {
        toast.error(error.message);
        setBusyId(null);
        return;
      }
      toast.success("Acesso a Comparar períodos removido.");
    }
    setBusyId(null);
    fetchRows();
  };

  // Marca/desmarca o papel `gestao_viewer` — quem pode VER e ACESSAR a seção Gestão (aba na
  // sidebar + rota /gestao/gestao). NÃO é liberado por padrão a ninguém (nem admin): só o dono
  // (Bruno, por e-mail) ou quem for marcado aqui.
  const toggleGestaoViewer = async (uid: string, make: boolean) => {
    setBusyId(uid);
    if (make) {
      const { error } = await supabase.from("user_roles").insert({ user_id: uid, role: "gestao_viewer" });
      if (error && !error.message.includes("duplicate")) {
        toast.error(error.message);
        setBusyId(null);
        return;
      }
      toast.success("Acesso à Gestão concedido.");
    } else {
      const { error } = await supabase.from("user_roles").delete().eq("user_id", uid).eq("role", "gestao_viewer");
      if (error) {
        toast.error(error.message);
        setBusyId(null);
        return;
      }
      toast.success("Acesso à Gestão removido.");
    }
    setBusyId(null);
    fetchRows();
  };

  // Marca/desmarca o papel `marcos_viewer` — quem pode VER e ACESSAR a página Marcos (2ª página
  // da seção Gestão, rota /gestao/marcos). Permissão SEPARADA da Gestão: por padrão só o dono
  // (Bruno, por e-mail); ninguém mais entra sem ser marcado aqui.
  const toggleMarcosViewer = async (uid: string, make: boolean) => {
    setBusyId(uid);
    if (make) {
      const { error } = await supabase.from("user_roles").insert({ user_id: uid, role: "marcos_viewer" });
      if (error && !error.message.includes("duplicate")) {
        toast.error(error.message);
        setBusyId(null);
        return;
      }
      toast.success("Acesso à página Marcos concedido.");
    } else {
      const { error } = await supabase.from("user_roles").delete().eq("user_id", uid).eq("role", "marcos_viewer");
      if (error) {
        toast.error(error.message);
        setBusyId(null);
        return;
      }
      toast.success("Acesso à página Marcos removido.");
    }
    setBusyId(null);
    fetchRows();
  };

  // Marca/desmarca o papel `cronograma_viewer` — quem pode VER a página Cronograma (aba Clientes).
  // A equipe Groohub já enxerga o Cronograma por padrão; este papel serve p/ LIBERAR a página a um
  // usuário-cliente (que por padrão fica sem ela). Admin já vê implicitamente.
  const toggleCronogramaViewer = async (uid: string, make: boolean) => {
    setBusyId(uid);
    if (make) {
      const { error } = await supabase.from("user_roles").insert({ user_id: uid, role: "cronograma_viewer" });
      if (error && !error.message.includes("duplicate")) {
        toast.error(error.message);
        setBusyId(null);
        return;
      }
      toast.success("Acesso ao Cronograma concedido.");
    } else {
      const { error } = await supabase.from("user_roles").delete().eq("user_id", uid).eq("role", "cronograma_viewer");
      if (error) {
        toast.error(error.message);
        setBusyId(null);
        return;
      }
      toast.success("Acesso ao Cronograma removido.");
    }
    setBusyId(null);
    fetchRows();
  };

  // Marca/desmarca o papel `metas_viewer` — quem pode VER a página Metas (aba Clientes).
  // A equipe Groohub já enxerga por padrão; este papel LIBERA a página a um usuário-cliente,
  // que por padrão fica sem ela (a tela mostra a carteira inteira, não só o cliente dele).
  // Admin já vê implicitamente.
  const toggleMetasViewer = async (uid: string, make: boolean) => {
    setBusyId(uid);
    if (make) {
      const { error } = await supabase.from("user_roles").insert({ user_id: uid, role: "metas_viewer" });
      if (error && !error.message.includes("duplicate")) {
        toast.error(error.message);
        setBusyId(null);
        return;
      }
      toast.success("Acesso às Metas concedido.");
    } else {
      const { error } = await supabase.from("user_roles").delete().eq("user_id", uid).eq("role", "metas_viewer");
      if (error) {
        toast.error(error.message);
        setBusyId(null);
        return;
      }
      toast.success("Acesso às Metas removido.");
    }
    setBusyId(null);
    fetchRows();
  };

  // Marca/desmarca um dos papéis de EDIÇÃO das metas da Captação (metas_edit_past/present/future)
  // — controlam quais meses o usuário pode editar na página Metas (aba Captação). Substituem a
  // antiga regra fixa (só o Bruno editava o passado). admin edita tudo por padrão.
  const toggleMetasEdit = async (
    uid: string,
    role: "metas_edit_past" | "metas_edit_present" | "metas_edit_future",
    make: boolean,
  ) => {
    setBusyId(uid);
    if (make) {
      const { error } = await supabase.from("user_roles").insert({ user_id: uid, role });
      if (error && !error.message.includes("duplicate")) {
        toast.error(error.message);
        setBusyId(null);
        return;
      }
    } else {
      const { error } = await supabase.from("user_roles").delete().eq("user_id", uid).eq("role", role);
      if (error) {
        toast.error(error.message);
        setBusyId(null);
        return;
      }
    }
    setBusyId(null);
    fetchRows();
  };

  // Exclui o usuário do sistema (só admin, via RPC): apaga aprovação/papéis/vínculo/bot e a
  // conta de auth. Some da lista; se a pessoa se cadastrar de novo, volta como "pendente".
  // Diferente de "Rejeitar" (que mantém em Rejeitados). Funciona em QUALQUER status.
  const excluirUsuario = async (uid: string) => {
    setBusyId(uid);
    const { error } = await supabase.rpc("admin_delete_user", { _uid: uid });
    setBusyId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Usuário excluído do sistema.");
    fetchRows();
  };

  // Busca por e-mail OU nome do cliente (slug "Nome_Sobrenome" → "Nome Sobrenome"),
  // ignorando acento e caixa. Vazia = mostra tudo.
  const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const q = norm(query.trim());
  const matchesQuery = (r: Row) =>
    !q ||
    norm(r.email).includes(q) ||
    (r.client_slug ? norm(r.client_slug.replace(/_/g, " ")).includes(q) : false);

  const visible = rows.filter(matchesQuery);
  const filtered = visible.filter((r) => r.status === tab);
  // Aprovados separados: usuários-cliente (vínculo em user_client_scope) vs. equipe (normais + admins).
  const approvedClientUsers = visible.filter((r) => r.status === "approved" && r.client_slug);
  const approvedTeamUsers = visible.filter((r) => r.status === "approved" && !r.client_slug);

  const statusBadge = (s: Status) => {
    const map = {
      pending: { label: "Pendente", cls: "bg-yellow-500/15 text-yellow-500 border-yellow-500/30" },
      approved: { label: "Aprovado", cls: "bg-primary/15 text-primary border-primary/30" },
      rejected: { label: "Rejeitado", cls: "bg-destructive/15 text-destructive border-destructive/30" },
    } as const;
    return <Badge variant="outline" className={map[s].cls}>{map[s].label}</Badge>;
  };

  // Uma linha de usuário: identidade (nome do cliente + e-mail + status) numa coluna estreita
  // à esquerda e TODOS os botões de ação — chips compactos agrupados — começando AO LADO dela,
  // fluindo em várias linhas curtas. O estado ligado/desligado de cada permissão se lê pela cor
  // do chip (não só pelo ícone), então dá pra ver de relance o que está marcado / em uso.
  const renderRow = (r: Row) => {
    const clientName = r.client_slug ? prettyClientLabel(r.client_slug) : null;
    const busy = busyId === r.user_id;
    const approved = r.status === "approved";
    const anyMetasEdit = r.is_metas_edit_past || r.is_metas_edit_present || r.is_metas_edit_future;
    return (
      <li key={r.user_id} className="flex flex-col gap-2 p-3">
        <div className="flex flex-col gap-x-4 gap-y-2 lg:flex-row lg:items-start">
          {/* Identidade — coluna estreita. Os botões começam à direita, ao lado do e-mail. */}
          <div className="min-w-0 space-y-1 lg:w-60 lg:shrink-0">
            {clientName && (
              <div className="flex items-center gap-1.5 text-sm font-semibold text-blue-600 dark:text-blue-400">
                <UserRound className="h-4 w-4 shrink-0" />
                <span className="break-words">{clientName}</span>
              </div>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-foreground font-medium break-all">{r.email}</span>
              {statusBadge(r.status)}
              {r.is_admin && (
                <Badge variant="outline" className="bg-chart-forecast/15 text-chart-forecast border-chart-forecast/30">
                  Admin
                </Badge>
              )}
              {r.client_slug && (
                <Badge variant="outline" className="bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30">
                  Usuário-cliente
                </Badge>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Solicitado em {new Date(r.requested_at).toLocaleString("pt-BR")}
              {r.decided_at && ` · Decidido em ${new Date(r.decided_at).toLocaleString("pt-BR")}`}
            </p>
          </div>

          {/* Ações — chips compactos agrupados (Clientes · Captação · Perfil · Automação ·
              Ações). Cada chip mostra o estado pela cor; o tooltip explica a ação. */}
          <div className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-2">
            {/* Clientes (aprovado, não-admin) */}
            {approved && !r.is_admin && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <GroupLabel>Clientes</GroupLabel>
                <ToggleChip
                  on={r.is_crm_editor}
                  label="Metas CRM"
                  icon={PencilLine}
                  colorKey="crm"
                  hint={r.is_crm_editor ? "Bloquear a edição dos dados planejados na tela de CRM (aba Clientes)." : "Permitir a edição dos dados planejados na tela de CRM (aba Clientes)."}
                  onClick={() => toggleCrmEditor(r.user_id, !r.is_crm_editor)}
                  disabled={busy}
                />
                <ToggleChip
                  on={r.is_crm_number_editor}
                  label="Reais CRM"
                  icon={Calculator}
                  colorKey="crmnum"
                  hint={r.is_crm_number_editor ? "Bloquear o ajuste dos dados realizados na tela de CRM (aba Clientes)." : "Permitir o ajuste dos dados realizados na tela de CRM (aba Clientes)."}
                  onClick={() => toggleCrmNumberEditor(r.user_id, !r.is_crm_number_editor)}
                  disabled={busy}
                />
                <ToggleChip
                  on={r.is_cronograma_viewer}
                  label="Cronograma"
                  icon={CalendarRange}
                  colorKey="cronograma"
                  hint={r.is_cronograma_viewer ? "Bloquear o acesso à página Cronograma (aba Clientes)." : "Liberar o acesso à página Cronograma (aba Clientes)."}
                  onClick={() => toggleCronogramaViewer(r.user_id, !r.is_cronograma_viewer)}
                  disabled={busy}
                />
                <ToggleChip
                  on={r.is_comparar_periodos}
                  label="Comparar"
                  icon={GitCompareArrows}
                  colorKey="comparar"
                  hint={r.is_comparar_periodos ? "Bloquear o botão \"Comparar períodos\" nas telas de Clientes (CRM/Meta/Google)." : "Liberar o botão \"Comparar períodos\" nas telas de Clientes (CRM/Meta/Google)."}
                  onClick={() => toggleCompararPeriodos(r.user_id, !r.is_comparar_periodos)}
                  disabled={busy}
                />
              </div>
            )}

            {/* Captação (aprovado, não-admin) */}
            {approved && !r.is_admin && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <GroupLabel>Captação</GroupLabel>
                <ToggleChip
                  on={r.is_captacao_viewer}
                  label="Captação"
                  icon={Eye}
                  colorKey="captacao"
                  hint={r.is_captacao_viewer ? "Bloquear o acesso à seção Captação." : "Liberar o acesso à seção Captação."}
                  onClick={() => toggleCaptacaoViewer(r.user_id, !r.is_captacao_viewer)}
                  disabled={busy}
                />
                <ToggleChip
                  on={r.is_metas_viewer}
                  label="Metas"
                  icon={Target}
                  colorKey="metas"
                  hint={r.is_metas_viewer ? "Bloquear o acesso à página de Metas da Captação." : "Liberar o acesso à página de Metas da Captação."}
                  onClick={() => toggleMetasViewer(r.user_id, !r.is_metas_viewer)}
                  disabled={busy}
                />
                <Hint text="Abrir as opções de quais meses o usuário pode editar nas Metas da Captação.">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setMetasEditOpen((cur) => (cur === r.user_id ? null : r.user_id))}
                    disabled={busy}
                    aria-pressed={anyMetasEdit}
                    className={cn("h-7 gap-1 px-2 text-xs font-medium", anyMetasEdit ? TOGGLE_ON.metas : TOGGLE_OFF)}
                  >
                    <PencilLine className="h-3.5 w-3.5" />
                    Editar Metas
                    {anyMetasEdit && <Check className="h-3 w-3" />}
                    {metasEditOpen === r.user_id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </Button>
                </Hint>
              </div>
            )}

            {/* Gestão: o controle de liberação só aparece para quem já tem acesso à Gestão
                (o dono Bruno + admins que ele liberou). Some na linha do próprio dono, que já
                enxerga por e-mail. Serve p/ equipe E outros admins (admin não libera sozinho).
                O botão "Marcos" fica ao lado e é gated à parte (canViewMarcos → por padrão só o
                dono Bruno vê). A divisão aparece se a pessoa pode liberar Gestão OU Marcos. */}
            {(canViewGestao || canViewMarcos) && approved && r.email.trim().toLowerCase() !== GESTAO_OWNER_EMAIL && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <GroupLabel>Gestão</GroupLabel>
                {canViewGestao && (
                  <ToggleChip
                    on={r.is_gestao_viewer}
                    label="Gestão"
                    icon={Briefcase}
                    colorKey="gestao"
                    hint={r.is_gestao_viewer ? "Bloquear o acesso à seção Gestão." : "Liberar acesso à seção Gestão"}
                    onClick={() => toggleGestaoViewer(r.user_id, !r.is_gestao_viewer)}
                    disabled={busy}
                  />
                )}
                {canViewMarcos && (
                  <ToggleChip
                    on={r.is_marcos_viewer}
                    label="Marcos"
                    icon={Flag}
                    colorKey="marcos"
                    hint={r.is_marcos_viewer ? "Bloquear o acesso à página Marcos da seção Gestão." : "Liberar Acesso à página Marcos da seção Gestão"}
                    onClick={() => toggleMarcosViewer(r.user_id, !r.is_marcos_viewer)}
                    disabled={busy}
                  />
                )}
              </div>
            )}

            {/* Agente WhatsApp (aprovado, não-admin): libera a tela /admin/whatsapp. */}
            {approved && !r.is_admin && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <GroupLabel>WhatsApp</GroupLabel>
                <ToggleChip
                  on={r.is_whatsapp_editor}
                  label="Agente WhatsApp"
                  icon={MessageCircle}
                  colorKey="whatsapp"
                  hint={r.is_whatsapp_editor ? "Bloquear o acesso à tela Agente WhatsApp." : "Liberar o acesso à tela Agente WhatsApp."}
                  onClick={() => toggleWhatsappEditor(r.user_id, !r.is_whatsapp_editor)}
                  disabled={busy}
                />
              </div>
            )}

            {/* Uso do Companium (aprovado, não-admin, equipe): libera a página /uso. Usuário-cliente
                não recebe — a página mostra o uso de todos. */}
            {approved && !r.is_admin && !r.client_slug && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <GroupLabel>Uso</GroupLabel>
                <ToggleChip
                  on={r.is_usage_viewer}
                  label="Uso do Companium"
                  icon={Activity}
                  colorKey="uso"
                  hint={r.is_usage_viewer ? "Bloquear o acesso à página Uso do Companium." : "Liberar o acesso à página Uso do Companium (tempo de uso e cliques de todos os usuários)."}
                  onClick={() => toggleUsageViewer(r.user_id, !r.is_usage_viewer)}
                  disabled={busy}
                />
              </div>
            )}

            {/* Equipe (aprovado, equipe interna — admin incluso): base da comparação entre equipes em /uso. */}
            {approved && !r.client_slug && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <GroupLabel>Equipe</GroupLabel>
                <SeletorEquipe userId={r.user_id} disabled={busy} />
              </div>
            )}

            {/* Privacidade (todo aprovado): oposição à medição de uso, pedida em /privacidade. */}
            {approved && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <GroupLabel>Privacidade</GroupLabel>
                <ToggleChip
                  on={r.is_usage_optout}
                  label="Não medir uso"
                  icon={EyeOff}
                  colorKey="optout"
                  hint={r.is_usage_optout ? "Voltar a medir o uso deste usuário." : "Parar de medir o uso deste usuário (pedido de oposição)."}
                  onClick={() => toggleUsageOptout(r.user_id, !r.is_usage_optout)}
                  disabled={busy}
                />
              </div>
            )}

            {/* Perfil e permissões (aprovado) */}
            {approved && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <GroupLabel>Perfil</GroupLabel>
                {!r.is_admin && (
                  <AdminClientUserControl
                    userId={r.user_id}
                    currentSlug={r.client_slug}
                    clients={clientOpts}
                    disabled={busy}
                    onChanged={fetchRows}
                  />
                )}
                {r.is_admin ? (
                  <ConfirmActionDialog
                    title="Remover admin"
                    description={
                      <>
                        Tem certeza que quer remover o admin da conta{" "}
                        <span className="font-semibold text-foreground">{r.email}</span>?
                      </>
                    }
                    confirmLabel="Remover admin"
                    onConfirm={() => toggleAdmin(r.user_id, false)}
                    tooltip="Remover o cargo de administrador do usuário."
                    trigger={
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || r.user_id === user.id}
                        title={r.user_id === user.id ? "Você não pode alterar seu próprio papel" : ""}
                        className={cn("h-7 gap-1 px-2 text-xs font-medium", TOGGLE_ON.admin)}
                      >
                        <ShieldOff className="h-3.5 w-3.5" />
                        Remover admin
                      </Button>
                    }
                  />
                ) : (
                  <Hint text="Promover o usuário para o cargo de administrador.">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => toggleAdmin(r.user_id, true)}
                      disabled={busy || r.user_id === user.id}
                      title={r.user_id === user.id ? "Você não pode alterar seu próprio papel" : ""}
                      className={cn("h-7 gap-1 px-2 text-xs font-medium", TOGGLE_OFF)}
                    >
                      <Shield className="h-3.5 w-3.5" />
                      Tornar admin
                    </Button>
                  </Hint>
                )}
              </div>
            )}

            {/* Automação */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <GroupLabel>Automação</GroupLabel>
              <UserBotSettings userId={r.user_id} email={r.email} />
            </div>

            {/* Ações sobre o usuário */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <GroupLabel>Ações</GroupLabel>
              {r.status !== "approved" && (
                <Hint text="Aprovar o cadastro e liberar o acesso do usuário ao sistema.">
                  <Button
                    size="sm"
                    onClick={() => setStatus(r.user_id, "approved")}
                    disabled={busy}
                    className="neu-button-primary h-7 gap-1 px-2 text-xs font-medium"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Aprovar
                  </Button>
                </Hint>
              )}
              {r.status !== "rejected" && (
                <ConfirmActionDialog
                  title="Rejeitar conta"
                  description={
                    <>
                      Tem certeza que quer rejeitar a conta{" "}
                      <span className="font-semibold text-foreground">{r.email}</span>?
                    </>
                  }
                  confirmLabel="Rejeitar"
                  onConfirm={() => setStatus(r.user_id, "rejected")}
                  tooltip="Rejeitar o cadastro e negar o acesso do usuário ao sistema."
                  trigger={
                    <Button size="sm" variant="outline" disabled={busy} className="neu-button h-7 gap-1 px-2 text-xs font-medium">
                      <X className="h-3.5 w-3.5" />
                      Rejeitar
                    </Button>
                  }
                />
              )}
              {/* Excluir do sistema — funciona em QUALQUER status; não permite excluir a si mesmo. */}
              {r.user_id !== user.id && (
                <ConfirmActionDialog
                  title="Excluir usuário"
                  description={
                    <>
                      Excluir <span className="font-semibold text-foreground">{r.email}</span> do sistema?
                      Isso remove o acesso e todas as permissões. A pessoa só volta se se cadastrar de novo
                      (aí entra como pendente para ser aceita outra vez).
                    </>
                  }
                  confirmLabel="Excluir"
                  onConfirm={() => excluirUsuario(r.user_id)}
                  tooltip="Excluir o usuário do sistema, removendo acesso e permissões."
                  trigger={
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      className="h-7 gap-1 px-2 text-xs font-medium bg-destructive/10 border-destructive/30 text-destructive hover:bg-destructive/20 hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Excluir
                    </Button>
                  }
                />
              )}
            </div>
          </div>
        </div>

        {/* Sub-chips de meses — abrem ao clicar em "Editar Metas" (Captação). Ficam abaixo,
            recuados p/ se alinhar com a área de ações e visualmente ligados a ela. */}
        {approved && !r.is_admin && metasEditOpen === r.user_id && (
          <div className="flex flex-col gap-1.5 border-l-2 border-primary/30 pl-2 ml-1 lg:ml-64">
            <p className="text-[11px] font-medium text-muted-foreground">
              Meses que <span className="font-semibold text-foreground">{r.email}</span> pode editar
              na página Metas (Captação). Selecione um ou mais.
            </p>
            <div className="flex items-center gap-1.5 flex-wrap">
              {([
                { role: "metas_edit_past", label: "Passado", icon: History, on: r.is_metas_edit_past, hint: "Permitir que o usuário edite as metas de meses passados na Captação." },
                { role: "metas_edit_present", label: "Presente", icon: CalendarCheck, on: r.is_metas_edit_present, hint: "Permitir que o usuário edite as metas do mês atual na Captação." },
                { role: "metas_edit_future", label: "Futuro", icon: CalendarClock, on: r.is_metas_edit_future, hint: "Permitir que o usuário edite as metas de meses futuros na Captação." },
              ] as const).map(({ role, label, icon: Icon, on, hint }) => (
                <ToggleChip
                  key={role}
                  on={on}
                  label={label}
                  icon={Icon}
                  colorKey="metas"
                  hint={hint}
                  onClick={() => toggleMetasEdit(r.user_id, role, !on)}
                  disabled={busy}
                />
              ))}
            </div>
          </div>
        )}
      </li>
    );
  };

  return (
    <DashboardLayout>
      <div className="p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Administração</h1>
            <p className="text-sm text-muted-foreground">Aprove cadastros e gerencie privilégios de acesso</p>
          </div>
          <Button variant="outline" onClick={fetchRows} disabled={refreshing} className="neu-button">
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </header>

        {/* Administração de usuários. O escopo de cliente (tenancy do bot) NÃO é mais
            configurado por bot — é por USUÁRIO, via "Acesso de cliente" no controle de
            cada usuário (AdminClientUserControl -> user_client_scope). A antiga aba
            "Tenancy de Bots" (AdminBotTenancy, colunas chatbot_bots.access_mode/
            tenant_id/allowed_clinic_ids) virou no-op e foi ocultada para não induzir
            erro. Mantida COMENTADA (não excluída) caso precise reativar. */}
        <Tabs defaultValue="usuarios" className="space-y-4">
          <TabsList className="neu-inset bg-transparent gap-1 p-1.5">
            <TabsTrigger value="usuarios" className="neu-tab">Usuários</TabsTrigger>
            <TabsTrigger value="clientes" className="neu-tab">Clientes</TabsTrigger>
            <TabsTrigger value="equipes" className="neu-tab">Equipes</TabsTrigger>
            <TabsTrigger value="pedidos" className="neu-tab">
              Pedidos de dados
              {pedidosAbertos > 0 && <span className="ml-2 text-xs text-muted-foreground">{pedidosAbertos}</span>}
            </TabsTrigger>
            {/* <TabsTrigger value="tenancy" className="neu-tab">Tenancy de Bots</TabsTrigger> */}
          </TabsList>

          {/* Carteira visível no dashboard: a planilha de projetos manda (só ATIVO), e esta
              aba é a trava manual por cima dela. */}
          <TabsContent value="clientes" className="space-y-4">
            <AdminClientesOcultos />
          </TabsContent>

          {/* Cadastro de equipes; a atribuição de cada pessoa fica na linha dela (aba Usuários). */}
          <TabsContent value="equipes" className="space-y-4">
            <AdminEquipes emailDe={emailDe} />
          </TabsContent>

          {/* Pedidos feitos na página /privacidade (cópia dos dados de uso, dúvida, oposição). */}
          <TabsContent value="pedidos" className="space-y-4">
            <AdminPedidosDados emailDe={emailDe} />
          </TabsContent>

          <TabsContent value="usuarios" className="space-y-4">
        {/* Busca por nome do cliente ou e-mail (vale para todas as abas). */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Pesquisar por nome do cliente ou e-mail..."
            className="neu-inset border-0 bg-transparent pl-9 pr-9"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Limpar busca"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as Status)}>
          <TabsList className="neu-inset bg-transparent gap-1 p-1.5">
            <TabsTrigger value="pending" className="neu-tab">
              Pendentes
              <span className="ml-2 text-xs text-muted-foreground">
                {rows.filter((r) => r.status === "pending").length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="approved" className="neu-tab">
              Aprovados
              <span className="ml-2 text-xs text-muted-foreground">
                {rows.filter((r) => r.status === "approved").length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="rejected" className="neu-tab">
              Rejeitados
              <span className="ml-2 text-xs text-muted-foreground">
                {rows.filter((r) => r.status === "rejected").length}
              </span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value={tab} className="mt-4">
            {tab === "approved" ? (
              // Aprovados divididos em duas sanfonas: usuários-cliente e equipe (normais + admins).
              <Accordion type="multiple" defaultValue={["clientes", "equipe"]} className="space-y-3">
                <AccordionItem value="clientes" className="border border-border rounded-xl bg-transparent px-3">
                  <AccordionTrigger className="hover:no-underline py-3">
                    <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <UserRound className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      Clientes Groohub
                      <span className="text-xs font-normal text-muted-foreground">({approvedClientUsers.length})</span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="pb-2">
                    {approvedClientUsers.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-8">
                        {query ? "Nenhum usuário-cliente para esta busca." : "Nenhum usuário-cliente."}
                      </p>
                    ) : (
                      <ul className="divide-y divide-border">{approvedClientUsers.map(renderRow)}</ul>
                    )}
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="equipe" className="border border-border rounded-xl bg-transparent px-3">
                  <AccordionTrigger className="hover:no-underline py-3">
                    <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Users className="h-4 w-4 text-primary" />
                      Membros Groohub
                      <span className="text-xs font-normal text-muted-foreground">({approvedTeamUsers.length})</span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="pb-2">
                    {approvedTeamUsers.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-8">
                        {query ? "Nenhum usuário para esta busca." : "Nenhum usuário normal ou admin."}
                      </p>
                    ) : (
                      <ul className="divide-y divide-border">{approvedTeamUsers.map(renderRow)}</ul>
                    )}
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            ) : (
              <Card className="neu-card border-0 bg-transparent shadow-none p-2">
                {filtered.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-12">
                    {query
                      ? "Nenhum cadastro para esta busca."
                      : `Nenhum cadastro ${tab === "pending" ? "pendente" : "rejeitado"}.`}
                  </p>
                ) : (
                  <ul className="divide-y divide-border">{filtered.map(renderRow)}</ul>
                )}
              </Card>
            )}
          </TabsContent>
        </Tabs>
          </TabsContent>

          {/* Aba "Tenancy de Bots" ocultada — escopo agora é por usuário (ver comentário
              no topo). Reativar só se voltar o modelo de tenancy por bot.
          <TabsContent value="tenancy">
            <AdminBotTenancy />
          </TabsContent> */}
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
