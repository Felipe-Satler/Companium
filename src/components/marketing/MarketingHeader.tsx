import { useNavigate } from "react-router-dom";
import {
  Pickaxe,
  Megaphone,
  Share2,
  Target,
  BarChart3,
  Shield,
  DollarSign,
} from "lucide-react";

const tabs = [
  // /marketing deixou de ser o dashboard de funil (era placeholder, sem dado real) e passou a ser
  // a Mineração de anúncios — espionagem de criativos de concorrentes. Uso interno.
  { label: "Mineração", icon: Pickaxe, path: "/marketing" },
  { label: "Paid Media", icon: Megaphone, path: "/paid-media" },
  { label: "Social", icon: Share2, path: "/social-instagram" },
  { label: "PACE", icon: Target, path: "/pace-marketing" },
  { label: "Metas", icon: BarChart3, path: "/meta-marketing" },
  { label: "Admin", icon: Shield, path: null },
  { label: "Custos", icon: DollarSign, path: null },
];

const subTabs = [
  { label: "Funil", icon: BarChart3, active: true },
  { label: "Forecast", icon: Target, active: false },
];

interface MarketingHeaderProps {
  activeTab?: string;
}

// Compartilhado por Paid Media / Social / PACE. A Mineração tem cabeçalho próprio
// (mineracao/MineracaoHeader.tsx) — a aba abaixo é só o caminho de volta para lá.
export function MarketingHeader({ activeTab = "Paid Media" }: MarketingHeaderProps) {
  const navigate = useNavigate();
  return (
    <div className="space-y-4">
      <div>
        <span className="neu-chip mb-1">
          Marketing
        </span>
        <p className="text-sm text-muted-foreground">
          Performance, metas e operações de marketing
        </p>
      </div>

      {/* Main Tabs */}
      <div className="flex items-center justify-center gap-1 py-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.label}
              onClick={() => tab.path && navigate(tab.path)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                tab.label === activeTab
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

      {/* Sub Tabs + Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 rounded-md border border-border bg-secondary/50 p-0.5">
          {subTabs.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.label}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                  t.active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>

        <button className="px-3 py-1.5 text-xs rounded-md font-semibold bg-primary text-primary-foreground">
          Cohort
        </button>
        <button className="px-3 py-1.5 text-xs rounded-md font-medium text-muted-foreground hover:bg-secondary border border-border">
          Produtividade
        </button>

        <div className="h-4 w-px bg-border" />

        {["Todos os Canais", "Todos"].map((f) => (
          <button
            key={f}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md font-medium text-muted-foreground hover:bg-secondary border border-border"
          >
            {f}
            <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
              <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ))}

        <div className="h-4 w-px bg-border" />

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>📅 Mês atual • 1–31 mar</span>
          <span>⚙️ Ajustes</span>
          <span className="rounded-md border border-border px-2 py-1 text-xs">🕐 3 min</span>
        </div>
      </div>
    </div>
  );
}
