import { useNavigate } from "react-router-dom";
import { LayoutGrid, Users, Target, Trophy, BarChart3, TrendingUp, Tv, UsersRound, UserCheck } from "lucide-react";

const tabs = [
  { label: "Funil de Vendas", icon: LayoutGrid, path: "/vendas" },
  { label: "Reuniões", icon: Users, path: "/reunioes" },
  { label: "PACE", icon: Target, path: "/pace" },
  { label: "Ranking", icon: Trophy, path: "/ranking" },
  { label: "Sales Dashboard", icon: BarChart3, path: null },
  { label: "Forecast", icon: TrendingUp, path: "/forecast" },
  { label: "TV Comercial", icon: Tv, path: null },
  { label: "Equipes", icon: UsersRound, path: null },
  { label: "Closers", icon: UserCheck, path: null },
];

const viewFilters = [
  { label: "Visão Geral", active: true },
  { label: "Cubos", active: false },
];

const periodFilters = ["Período", "Tipo Negócio", "Produto", "Equipe", "Vendedor", "Canal"];

interface VendasHeaderProps {
  activeTab?: number;
}

export function VendasHeader({ activeTab = 0 }: VendasHeaderProps) {
  const navigate = useNavigate();

  return (
    <div className="space-y-4">
      <div>
        <span className="neu-chip mb-1">
          Vendas
        </span>
        <p className="text-sm text-muted-foreground">
          Acompanhe metas, ranking e performance comercial
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {tabs.map((tab, i) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.label}
              onClick={() => tab.path && navigate(tab.path)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                i === activeTab
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* View & Period Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          {viewFilters.map((f) => (
            <button
              key={f.label}
              className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${
                f.active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary border border-border"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-1">
          {periodFilters.map((f) => (
            <button
              key={f}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md font-medium text-muted-foreground hover:text-foreground hover:bg-secondary border border-border transition-colors"
            >
              {f}
              <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none"><path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
