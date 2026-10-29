import * as React from "react";
import logo from "@/assets/logo.png";
import logoLight from "@/assets/logo-light.png";
import {
  DollarSign,
  ShoppingCart,
  Megaphone,
  HeadphonesIcon,
  Package,
  Settings,
  LayoutGrid,
  LogOut,
  ChevronDown,
  ChevronLeft,
  Sun,
  Moon,
  FileBarChart,
  Facebook,
  Chrome,
  BarChart3,
  ShieldCheck,
  Library,
  Bot,
  RadioTower,
  Target,
  CalendarRange,
  Briefcase,
  Flag,
  MessageCircle,
  Activity,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { useChatbotAccess } from "@/chatbot/react/useChatbotAccess";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

type SubItem = { title: string; url: string; icon: React.ComponentType<{ className?: string }> };
type MainItem = {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  hasSubmenu?: boolean;
  subItems?: SubItem[];
};

// Rota do Cronograma. Fica na aba Clientes (último item), mas é OCULTO p/ usuário-cliente
// (filtrado no useMemo abaixo) — só a equipe Groohub vê/edita.
const CRONOGRAMA_URL = "/clientes/cronograma";
// Metas: mesma ideia do Cronograma — some p/ usuário-cliente, salvo com o papel metas_viewer.
const METAS_URL = "/clientes/metas";

const clientesSubItems: SubItem[] = [
  // Ocultos temporariamente (telas sem uso no momento) — NÃO excluir, só comentar p/ não aparecer.
  // { title: "Relatório", url: "/clientes", icon: FileBarChart },
  { title: "CRM", url: "/clientes/crm", icon: HeadphonesIcon },
  { title: "Meta Ads", url: "/clientes/meta-ads", icon: Facebook },
  { title: "Google Ads", url: "/clientes/google-ads", icon: Chrome },
  // { title: "Performance", url: "/clientes/performance", icon: BarChart3 },
  // Cronograma (antes na aba Projetos) — último item, só p/ equipe Groohub.
  { title: "Cronograma", url: CRONOGRAMA_URL, icon: CalendarRange },
  // Metas (visão de carteira do planejado) — só p/ equipe Groohub ou cliente liberado.
  { title: "Metas", url: METAS_URL, icon: Target },
];

const captacaoSubItems: SubItem[] = [
  { title: "Metas", url: "/captacao/meta", icon: Target },
  { title: "Meta Ads", url: "/captacao/meta-ads", icon: Facebook },
  { title: "Google Ads", url: "/captacao/google-ads", icon: Chrome },
];

// Gestão: visão interna da carteira (RevOps/MRR) a partir de planilha publicada. Só admin.
const gestaoSubItems: SubItem[] = [
  { title: "Gestão", url: "/gestao/gestao", icon: BarChart3 },
  { title: "Marcos", url: "/gestao/marcos", icon: Flag },
];

const mainItems: MainItem[] = [
  // Itens ocultados temporariamente (mantidos no código, apenas comentados —
  // não excluir). Reative removendo o comentário quando as seções voltarem.
  // { title: "Receita", url: "/", icon: DollarSign },
  // { title: "Vendas", url: "/vendas", icon: ShoppingCart },
  { title: "Clientes", url: "/clientes", icon: HeadphonesIcon, hasSubmenu: true, subItems: clientesSubItems },
  { title: "Captação", url: "/captacao", icon: RadioTower, hasSubmenu: true, subItems: captacaoSubItems },
  // Gestão fica logo abaixo de Captação. Só admin (filtrado no useMemo abaixo).
  { title: "Gestão", url: "/gestao", icon: Briefcase, hasSubmenu: true, subItems: gestaoSubItems },
  // Marketing voltou: /marketing agora é a Mineração de anúncios (espionagem de criativos de
  // concorrentes), não mais o dashboard de funil placeholder. Só equipe Groohub — o usuário-cliente
  // nem vê, porque o branch de clientUser no useMemo abaixo só deixa passar "Clientes", e
  // /marketing não está na CLIENT_USER_ALLOWED do ProtectedRoute.
  { title: "Marketing", url: "/marketing", icon: Megaphone },
  // { title: "Produto", url: "/produto", icon: Package },
  // Configurações oculta temporariamente (mantida no código, só comentada — não excluir).
  // { title: "Configurações", url: "/configuracoes", icon: Settings, hasSubmenu: true },
  // { title: "Workspace", url: "/workspace", icon: LayoutGrid },
  { title: "Biblioteca", url: "/biblioteca", icon: Library },
];

export function AppSidebar() {
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const { user, signOut, isAdmin, canViewCaptacao, canViewCronograma, canViewMetas, canViewGestao, canViewMarcos, canManageWhatsapp, canViewUso, clientUser } = useAuth();
  // Perfil do rodapé (padrão do modelo): nome derivado do e-mail, papel e iniciais p/ o avatar.
  const displayName = React.useMemo(() => {
    const metaName = (user?.user_metadata as { name?: string; full_name?: string } | undefined);
    const raw = metaName?.name || metaName?.full_name;
    if (raw) return raw;
    const local = user?.email?.split("@")[0] ?? "Usuário";
    return local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }, [user]);
  const roleLabel = isAdmin ? "Administrador" : clientUser ? "Cliente" : "Equipe Groohub";
  const initials = React.useMemo(
    () =>
      displayName
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w.charAt(0).toUpperCase())
        .join("") || "U",
    [displayName],
  );
  // GrooChat: internos sempre têm bot (default); usuário-cliente só se tiver um atribuído.
  const { hasBot } = useChatbotAccess();
  const items: MainItem[] = React.useMemo(() => {
    // Usuário-cliente: vê SOMENTE a seção Clientes (CRM/Meta/Google). Nada mais — e o Cronograma
    // sai dos subitens por padrão (exclusivo da equipe Groohub), a menos que o cliente tenha ganho
    // o papel cronograma_viewer na Administração (canViewCronograma).
    if (clientUser)
      return mainItems
        .filter((it) => it.title === "Clientes")
        .map((it) => ({
          ...it,
          subItems: it.subItems?.filter(
            (s) =>
              (s.url !== CRONOGRAMA_URL || canViewCronograma) && (s.url !== METAS_URL || canViewMetas),
          ),
        }));
    // Captação só aparece p/ quem tem acesso (admin OU papel captacao_viewer).
    // Gestão: só o dono (Bruno) ou quem ele liberou (canViewGestao) — admin não basta. A seção
    // aparece também p/ quem só tem Marcos (canViewMarcos), p/ alcançar a 2ª página pela sidebar.
    let list = mainItems.filter(
      (it) =>
        (it.title !== "Captação" || canViewCaptacao) &&
        (it.title !== "Gestão" || canViewGestao || canViewMarcos),
    );
    // Dentro da Gestão, cada subitem tem sua própria trava: "Gestão" → canViewGestao;
    // "Marcos" → canViewMarcos (por padrão só o dono Bruno).
    list = list.map((it) =>
      it.title === "Gestão"
        ? {
            ...it,
            subItems: it.subItems?.filter(
              (s) =>
                (s.url !== "/gestao/gestao" || canViewGestao) &&
                (s.url !== "/gestao/marcos" || canViewMarcos),
            ),
          }
        : it,
    );
    // Administração entra ao final da lista. (Antes era inserida após "Workspace",
    // que agora está oculto — findIndex retornaria -1 e jogaria o item pro topo.)
    // Agente WhatsApp: aparece p/ admin OU quem tem o papel whatsapp_editor (liberado na
    // Administração). Fica fora do bloco admin porque um whatsapp_editor não-admin não vê /admin.
    if (canManageWhatsapp)
      list = [...list, { title: "Agente WhatsApp", url: "/admin/whatsapp", icon: MessageCircle }];
    // Uso do Companium: admin OU papel usage_viewer (liberado na Administração).
    if (canViewUso) list = [...list, { title: "Uso do Companium", url: "/uso", icon: Activity }];
    // Administração entra ao final da lista.
    if (isAdmin) list = [...list, { title: "Administração", url: "/admin", icon: ShieldCheck }];
    return list;
  }, [isAdmin, canViewCaptacao, canViewCronograma, canViewMetas, canViewGestao, canViewMarcos, canManageWhatsapp, canViewUso, clientUser]);
  const [openSubmenus, setOpenSubmenus] = React.useState<Record<string, boolean>>({});

  const isItemActive = (url: string, exact = false) =>
    exact ? location.pathname === url : location.pathname === url || location.pathname.startsWith(url + "/");


  return (
    <Sidebar collapsible="icon" className="neu-sidebar border-r-0 transition-[width] duration-300 ease-in-out">
      <div className={`relative pt-6 pb-5 ${collapsed ? "px-2" : "pl-3 pr-4"}`}>
        {!collapsed ? (
          <div className="flex items-center justify-between animate-fade-in gap-2">
            <img src={theme === "dark" ? logo : logoLight} alt="Companium" className="h-10 w-auto object-contain" />
            <button
              type="button"
              onClick={toggleSidebar}
              aria-label="Recolher sidebar"
              className="neu-inset inline-flex h-7 w-7 items-center justify-center rounded-full text-sidebar-foreground hover:text-sidebar-accent-foreground transition-all duration-300 shrink-0"
            >
              <ChevronLeft className="h-3.5 w-3.5 transition-transform duration-300" />
            </button>
          </div>
        ) : (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={toggleSidebar}
              aria-label="Expandir sidebar"
              className="neu-inset inline-flex h-7 w-7 items-center justify-center rounded-full text-sidebar-foreground hover:text-sidebar-accent-foreground transition-all duration-300"
            >
              <ChevronLeft className="h-3.5 w-3.5 rotate-180 transition-transform duration-300" />
            </button>
          </div>
        )}
      </div>

      <SidebarContent className={collapsed ? "px-0" : "px-2"}>
        <SidebarGroup>
          <SidebarGroupContent>
            {!collapsed && (
              <div className="mx-2 mb-1.5 mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-sidebar-muted-foreground">
                Navegação
              </div>
            )}
            <SidebarMenu className={collapsed ? "items-center" : ""}>
              {items.map((item) => {
                if (item.hasSubmenu && item.subItems) {
                  const isOpen = openSubmenus[item.title] ?? false;
                  const toggleSubmenu = (e: React.MouseEvent | React.KeyboardEvent) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpenSubmenus((prev) => ({ ...prev, [item.title]: !isOpen }));
                  };
                  return (
                    <Collapsible
                      key={item.title}
                      open={isOpen}
                      onOpenChange={(o) => setOpenSubmenus((prev) => ({ ...prev, [item.title]: o }))}
                      className="group/collapsible"
                    >
                      <>
                        <SidebarMenuItem className="relative">
                          <SidebarMenuButton
                            asChild
                            className={`neu-sidebar-item rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-transparent hover:text-sidebar-accent-foreground ${
                              collapsed ? "" : "pr-10"
                            } ${isItemActive(item.url, item.url === "/") ? "is-active" : ""}`}
                          >
                            <NavLink
                              to={item.url}
                              end={item.url === "/"}
                              className={`flex items-center w-full py-2.5 ${
                                collapsed ? "justify-center px-0" : "gap-3 px-3"
                              }`}
                              activeClassName="text-sidebar-accent-foreground"
                            >
                              <item.icon className="h-4 w-4 shrink-0" />
                              {!collapsed && (
                                <span className="flex-1 text-left">{item.title}</span>
                              )}
                            </NavLink>
                          </SidebarMenuButton>
                          {!collapsed && (
                            <button
                              type="button"
                              onClick={toggleSubmenu}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") toggleSubmenu(e);
                              }}
                              aria-label={`Alternar submenu ${item.title}`}
                              aria-expanded={isOpen}
                              className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center rounded-md text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors z-10"
                            >
                              <ChevronDown
                                className={`h-3.5 w-3.5 transition-transform duration-200 ${
                                  isOpen ? "rotate-180" : ""
                                }`}
                              />
                            </button>
                          )}
                        </SidebarMenuItem>
                        {!collapsed && (
                          <CollapsibleContent>
                            <SidebarMenuSub>
                              {item.subItems.map((sub) => {
                                const subActive = isItemActive(sub.url, sub.url === item.url);
                                return (
                                <SidebarMenuSubItem key={sub.url}>
                                  <SidebarMenuSubButton asChild>
                                    <NavLink
                                      to={sub.url}
                                      end={sub.url === item.url}
                                      className={`neu-sidebar-subitem flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-sidebar-muted-foreground hover:text-sidebar-accent-foreground transition-colors ${
                                        subActive ? "is-active" : ""
                                      }`}
                                      activeClassName="text-sidebar-accent-foreground font-medium"
                                    >
                                      <sub.icon className="h-3.5 w-3.5 shrink-0" />
                                      <span>{sub.title}</span>
                                    </NavLink>
                                  </SidebarMenuSubButton>
                                </SidebarMenuSubItem>
                                );
                              })}
                            </SidebarMenuSub>
                          </CollapsibleContent>
                        )}
                      </>
                    </Collapsible>
                  );
                }

                const active = isItemActive(item.url, item.url === "/");
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={item.url}
                        end={item.url === "/"}
                        className={`neu-sidebar-item flex items-center rounded-lg py-2.5 text-sm font-medium text-sidebar-foreground transition-colors hover:text-sidebar-accent-foreground ${
                          collapsed ? "justify-center px-0" : "gap-3 px-3"
                        } ${active ? "is-active" : ""}`}
                        activeClassName="text-sidebar-accent-foreground"
                      >
                        <item.icon className="h-4 w-4 shrink-0" />
                        {!collapsed && (
                          <>
                            <span className="flex-1">{item.title}</span>
                            {item.hasSubmenu && (
                              <ChevronDown className="h-3.5 w-3.5 text-sidebar-muted-foreground" />
                            )}
                          </>
                        )}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className={`pb-4 space-y-1 ${collapsed ? "px-0" : "px-2"}`}>
        <SidebarMenu className={collapsed ? "items-center" : ""}>
          {/* GrooChat — azul da paleta do sistema (#1A73E9). Aparece só p/ quem tem bot
              disponível: internos sempre; usuário-cliente apenas se tiver um bot atribuído. */}
          {hasBot && (
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <NavLink
                  to="/assistente"
                  className={`flex items-center rounded-xl py-2.5 text-sm font-semibold !text-white transition-all hover:brightness-105 bg-gradient-to-br from-[#2E86FF] to-[#1A73E9] shadow-[0_6px_16px_-6px_rgba(26,115,233,0.6)] ${
                    collapsed ? "justify-center px-0" : "gap-3 px-3"
                  }`}
                >
                  <Bot className="h-4 w-4 shrink-0" />
                  {!collapsed && <span>GrooChat</span>}
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}

          {/* Theme toggle */}
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={toggleTheme}
              className={`neu-sidebar-item flex items-center py-2.5 text-sm text-sidebar-foreground hover:bg-transparent hover:text-sidebar-accent-foreground rounded-lg ${
                collapsed ? "justify-center px-0" : "gap-3 px-3"
              }`}
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4 shrink-0" />
              ) : (
                <Moon className="h-4 w-4 shrink-0" />
              )}
              {!collapsed && (
                <span>{theme === "dark" ? "Modo Claro" : "Modo Escuro"}</span>
              )}
            </SidebarMenuButton>
          </SidebarMenuItem>

          {/* Perfil + Sair. Recolhido: só o ícone de sair (como antes). Expandido: bloco de
              perfil no padrão do modelo (avatar com iniciais, nome, papel e sair à direita). */}
          {collapsed ? (
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => signOut()}
                aria-label="Sair"
                className="neu-sidebar-item flex items-center justify-center px-0 py-2.5 text-sm text-sidebar-foreground hover:bg-transparent hover:text-sidebar-accent-foreground rounded-lg"
              >
                <LogOut className="h-4 w-4 shrink-0" />
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : (
            <div className="mt-2 flex items-center gap-2.5 border-t border-sidebar-border/70 px-2 pt-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#2E86FF] to-[#0E56B8] text-[11px] font-bold text-white">
                {initials}
              </span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[13px] font-semibold text-sidebar-foreground">{displayName}</span>
                <span className="block truncate text-[11px] text-sidebar-muted-foreground">{roleLabel}</span>
              </span>
              <button
                type="button"
                onClick={() => signOut()}
                aria-label="Sair"
                className="shrink-0 rounded-md p-1 text-sidebar-muted-foreground transition-colors hover:text-sidebar-accent-foreground"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          )}
          {!collapsed && (
            <NavLink
              to="/privacidade"
              className="block px-2 pt-1 text-[11px] text-sidebar-muted-foreground transition-colors hover:text-sidebar-accent-foreground"
            >
              Privacidade e dados de uso
            </NavLink>
          )}
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
