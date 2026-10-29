import { useNavigate } from "react-router-dom";
import { FileBarChart, Facebook, Chrome, BarChart3, CalendarRange, Target } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const tabs = [
  // Ocultas temporariamente (telas sem uso no momento) — NÃO excluir, só comentar p/ ficarem
  // hidden pra todos. Reative removendo o comentário quando as telas voltarem.
  // { label: "Relatório", icon: FileBarChart, path: "/clientes" },
  { label: "CRM", icon: FileBarChart, path: "/clientes/crm" },
  { label: "Meta Ads", icon: Facebook, path: "/clientes/meta-ads" },
  { label: "Google Ads", icon: Chrome, path: "/clientes/google-ads" },
  // { label: "Performance", icon: BarChart3, path: "/clientes/performance" },
  // Cronograma: exclusivo da equipe Groohub — teamOnly esconde p/ usuário-cliente.
  { label: "Cronograma", icon: CalendarRange, path: "/clientes/cronograma", teamOnly: true },
  // Metas: visão de carteira do planejado — equipe Groohub por padrão. O usuário-cliente não
  // vê a situação dos outros clientes, a menos que ganhe o papel `metas_viewer` na
  // Administração ("Permitir Metas") — daí a aba volta a aparecer p/ ele (needsMetas).
  { label: "Metas", icon: Target, path: "/clientes/metas", teamOnly: true, needsMetas: true },
];

interface ClientesHeaderProps {
  activeTab?: string;
}

export function ClientesHeader({ activeTab = "Relatório" }: ClientesHeaderProps) {
  const navigate = useNavigate();
  const { clientUser, canViewMetas } = useAuth();
  // Usuário-cliente não vê as abas da equipe (Cronograma/Metas). Metas volta a aparecer p/ ele
  // quando a Administração libera o papel `metas_viewer` — sem isso a aba ficaria escondida e o
  // acesso concedido não teria por onde ser usado.
  const visibleTabs = tabs.filter(
    (tab) => !tab.teamOnly || !clientUser || (tab.needsMetas && canViewMetas),
  );

  return (
    <div className="space-y-4">
      <div>
        <span className="neu-chip mb-1">
          Clientes
        </span>
        <p className="text-sm text-muted-foreground">
          Performance de mídia e resultados por cliente
        </p>
      </div>

      {/* Tabs — pílula segmentada (ativa em azul), no padrão do modelo. */}
      <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-card border border-border shadow-sm">
        {visibleTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.label === activeTab;
          return (
            <button
              key={tab.label}
              onClick={() => tab.path && navigate(tab.path)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-2 text-[13px] font-semibold transition-all ${
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
