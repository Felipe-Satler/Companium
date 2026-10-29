import { Users } from "lucide-react";
import { useState } from "react";

const campaigns = [
  "Conversão_vendas_grupo1",
  "Remarketing_leads_quentes",
  "PS_conversão_video_branding",
  "YOG_remarketing_dinheiro",
  "LC_reels_stories",
  "TV_vendas_marketplace",
  "Google_search_marca",
  "LC_performance_remarketing",
  "Conversão_ecommerce_promo1",
  "YZ_remarketing_web_combo",
];

const days = Array.from({ length: 24 }, (_, i) => i + 1);
const viewOptions = ["Campanha", "Conjunto", "Anúncio"];

function getHeatColor(val: number): string {
  if (val === 0) return "bg-secondary/30";
  if (val <= 2) return "bg-blue-900/50 text-blue-700 dark:text-blue-300";
  if (val <= 5) return "bg-blue-700/50 text-blue-800 dark:text-blue-200";
  if (val <= 10) return "bg-cyan-600/50 text-cyan-800 dark:text-cyan-200";
  if (val <= 20) return "bg-cyan-500/60 text-cyan-100";
  return "bg-primary/60 text-primary-foreground";
}

export function PaidMediaHeatmap() {
  const [view, setView] = useState("Campanha");

  const heatData = campaigns.map((c) => ({
    name: c,
    values: days.map(() => Math.floor(Math.random() * 30)),
  }));

  return (
    <div className="neu-card rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
          <span className="text-sm font-bold text-foreground">MQLs por Dia</span>
          <span className="text-xs text-muted-foreground ml-1">– 24 DIAS</span>
        </div>
        <div className="flex items-center gap-1">
          {viewOptions.map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-2.5 py-1 text-[10px] rounded font-medium transition-colors ${
                view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-1 flex-wrap">
        {["Ativo", "Pausado", "Erro"].map((f, i) => (
          <button key={f} className={`px-2 py-0.5 text-[10px] rounded font-medium ${i === 0 ? "bg-primary/20 text-primary" : "text-muted-foreground bg-secondary/50"}`}>
            {f}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[9px]">
          <thead>
            <tr>
              <th className="text-left text-muted-foreground font-medium py-1 pr-3 min-w-[180px]">Campanha</th>
              {days.map((d) => (
                <th key={d} className="text-center text-muted-foreground font-medium px-0.5 min-w-[24px]">{d}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {heatData.map((row) => (
              <tr key={row.name}>
                <td className="text-muted-foreground truncate max-w-[180px] py-0.5 pr-3">{row.name}</td>
                {row.values.map((val, j) => (
                  <td key={j} className="px-0.5 py-0.5">
                    <div className={`flex items-center justify-center h-5 w-5 rounded text-[8px] font-medium mx-auto ${getHeatColor(val)}`}>
                      {val > 0 ? val : ""}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-center gap-3 text-[9px] text-muted-foreground pt-2">
        <span>% Variação MF</span>
        <div className="flex items-center gap-1">
          {["bg-secondary/30", "bg-blue-900/50", "bg-blue-700/50", "bg-cyan-600/50", "bg-cyan-500/60", "bg-primary/60"].map((c, i) => (
            <div key={i} className={`h-3 w-6 rounded ${c}`} />
          ))}
        </div>
      </div>
    </div>
  );
}
