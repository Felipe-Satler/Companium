import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { VendasHeader } from "@/components/vendas/VendasHeader";
import { RankingList } from "@/components/ranking/RankingList";
import { Calendar, Tv, TrendingUp, Users } from "lucide-react";

export default function Ranking() {
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"vendedor" | "lider">("vendedor");

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1200);
    return () => clearTimeout(timer);
  }, []);

  return (
    <DashboardLayout>
      <div className="flex-1 p-6 space-y-6 overflow-auto">
        <VendasHeader activeTab={3} />

        {/* Period & TV Mode */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
              <Calendar className="h-3.5 w-3.5" />
              Mês atual
              <span className="text-muted-foreground">› 1–31 mar</span>
            </button>
            <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
              <Tv className="h-3.5 w-3.5" />
              TV Mode
            </button>
          </div>
        </div>

        {/* View toggle & Day counter */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setView("vendedor")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                view === "vendedor"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary border border-border"
              }`}
            >
              <TrendingUp className="h-3.5 w-3.5" />
              Por Vendedor
            </button>
            <button
              onClick={() => setView("lider")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                view === "lider"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary border border-border"
              }`}
            >
              <Users className="h-3.5 w-3.5" />
              Por Líder
            </button>
          </div>
          <div className="px-3 py-1.5 rounded-md bg-secondary text-xs font-medium text-foreground">
            Dia 24 de 31 (77%)
          </div>
        </div>

        {/* Ranking List */}
        <RankingList loading={loading} />
      </div>
    </DashboardLayout>
  );
}
