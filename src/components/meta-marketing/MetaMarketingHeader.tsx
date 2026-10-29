import { useNavigate } from "react-router-dom";
import {
  Pickaxe,
  Megaphone,
  Share2,
  Target,
  BarChart3,
  Shield,
  DollarSign,
  Calendar,
  Clock,
} from "lucide-react";

// Espelha o `tabs` de marketing/MarketingHeader.tsx (os dois headers duplicam a lista). Ao mexer
// num, mexa no outro — senão as duas barras discordam sobre o que existe em /marketing.
const tabs = [
  { label: "Mineração", icon: Pickaxe, path: "/marketing" },
  { label: "Paid Media", icon: Megaphone, path: null },
  { label: "Social", icon: Share2, path: null },
  { label: "PACE", icon: Target, path: null },
  { label: "Metas", icon: BarChart3, path: "/meta-marketing" },
  { label: "Admin", icon: Shield, path: null },
  { label: "Custos", icon: DollarSign, path: null },
];

export function MetaMarketingHeader() {
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
          const isActive = tab.label === "Metas";
          return (
            <button
              key={tab.label}
              onClick={() => tab.path && navigate(tab.path)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                isActive
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

      {/* Filters row */}
      <div className="flex items-center justify-end gap-3">
        <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md font-medium bg-secondary text-foreground border border-border">
          <Calendar className="h-3.5 w-3.5" />
          Março De 2026
          <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
            <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md font-medium bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/30">
          <Clock className="h-3.5 w-3.5" />
          3 Fonte(s)
        </button>
        <button className="p-1.5 text-muted-foreground hover:text-foreground">
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none">
            <rect x="1" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
            <rect x="9" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
            <rect x="1" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
            <rect x="9" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
