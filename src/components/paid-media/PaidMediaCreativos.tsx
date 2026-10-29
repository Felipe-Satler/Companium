import { BarChart3, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { useState } from "react";

const tabs = ["Geral", "Estáticos", "Vídeo"];
const filterTabs = ["Relevância", "Estáticos", "Tudo"];

interface Creative {
  id: number;
  name: string;
  invest: string;
  mqls: number;
  cpl: string;
  cpmql: string;
  roas: string;
  ctr: string;
  convBar: number;
  trend: "up" | "down";
  trendValue: string;
  amount: string;
}

const creatives: Creative[] = [
  { id: 1, name: "[video] Plataforma all-in-one | RKG", invest: "R$ 96.024", mqls: 14, cpl: "R$ 186,01", cpmql: "-", roas: "-", ctr: "-", convBar: 75, trend: "up", trendValue: "R$ 13.362,06", amount: "0,37s" },
  { id: 2, name: "72 minutos web plataforma oralheredia e desk galhos pipe", invest: "R$ 96.024", mqls: 922, cpl: "R$ 196,01", cpmql: "-", roas: "-", ctr: "-", convBar: 65, trend: "down", trendValue: "R$ 13.362,06", amount: "0,37s" },
  { id: 3, name: "[static] pv_branding_conversão_2025", invest: "", mqls: 15, cpl: "", cpmql: "-", roas: "-", ctr: "-", convBar: 30, trend: "down", trendValue: "", amount: "" },
  { id: 4, name: "63 metade5 web platform foi desk gathos typecrze", invest: "R$ 18.024", mqls: 12, cpl: "R$ 184.441", cpmql: "-", roas: "-", ctr: "-", convBar: 55, trend: "up", trendValue: "", amount: "3.804" },
  { id: 5, name: "90_remarketing_lead_quente_oferta_final", invest: "", mqls: 0, cpl: "", cpmql: "-", roas: "-", ctr: "-", convBar: 20, trend: "down", trendValue: "", amount: "" },
  { id: 6, name: "72 minutos web plataforma oralheredia e desk galhos pipe escala", invest: "R$ 39", mqls: 403, cpl: "R$ 112.903,73", cpmql: "-", roas: "-", ctr: "-", convBar: 45, trend: "up", trendValue: "R$ 95,0K", amount: "0,48s" },
  { id: 7, name: "90_remarketing_desconto_winter_conv_search2", invest: "", mqls: 0, cpl: "R$ 90.777", cpmql: "-", roas: "-", ctr: "-", convBar: 35, trend: "up", trendValue: "R$ 89.576K", amount: "0,48s" },
  { id: 8, name: "63 metade5 web platform foi desk gathos typecrze escala", invest: "R$ 18.024", mqls: 0.6, cpl: "R$ 18.441", cpmql: "-", roas: "-", ctr: "-", convBar: 50, trend: "up", trendValue: "R$ 115.132,0K", amount: "0,22s" },
];

export function PaidMediaCreativos() {
  const [activeTab, setActiveTab] = useState("Relevância");

  return (
    <div className="neu-card rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          <span className="text-sm font-bold text-foreground">Performance por Criativo</span>
        </div>
        <div className="flex items-center gap-1">
          {filterTabs.map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-2.5 py-1 text-[10px] rounded font-medium transition-colors ${
                activeTab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-1">
        {["Relevância", "Estáticos", "Vídeo"].map((t) => (
          <button key={t} className="px-2.5 py-1 text-[10px] rounded font-medium text-muted-foreground hover:bg-secondary border border-border/50">
            {t}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          {["Plataforma", "Objetivo"].map((f) => (
            <button key={f} className="px-2 py-1 text-[10px] rounded font-medium text-muted-foreground hover:bg-secondary border border-border/50 flex items-center gap-1">
              {f}
              <svg className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none"><path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="border-b border-border/50">
              <th className="text-left text-muted-foreground font-medium py-2 pr-3">CRIATIVOS</th>
              <th className="text-right text-muted-foreground font-medium py-2 px-2">INVEST</th>
              <th className="text-right text-muted-foreground font-medium py-2 px-2">MQLs</th>
              <th className="text-right text-muted-foreground font-medium py-2 px-2">CPL</th>
              <th className="text-right text-muted-foreground font-medium py-2 px-2">CPMQL</th>
              <th className="text-right text-muted-foreground font-medium py-2 px-2">CONV %</th>
              <th className="text-right text-muted-foreground font-medium py-2 px-2">MQLS SHARE %</th>
              <th className="text-right text-muted-foreground font-medium py-2 px-2">RECEITA</th>
              <th className="text-right text-muted-foreground font-medium py-2 px-2">CPR %</th>
            </tr>
          </thead>
          <tbody>
            {creatives.map((c) => (
              <tr key={c.id} className="border-b border-border/20 hover:bg-secondary/20 transition-colors">
                <td className="py-2.5 pr-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">›</span>
                    <span className="text-foreground truncate max-w-[280px]">{c.name}</span>
                  </div>
                </td>
                <td className="text-right py-2.5 px-2 text-foreground font-medium">{c.invest}</td>
                <td className="text-right py-2.5 px-2 text-foreground">{c.mqls}</td>
                <td className="text-right py-2.5 px-2 text-foreground">{c.cpl}</td>
                <td className="text-right py-2.5 px-2 text-muted-foreground">{c.cpmql}</td>
                <td className="py-2.5 px-2">
                  <div className="flex items-center gap-1 justify-end">
                    <div className="w-16 h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div className="h-full rounded-full" style={{
                        width: `${c.convBar}%`,
                        background: c.convBar > 50 ? "hsl(var(--primary))" : c.convBar > 30 ? "#f59e0b" : "#ef4444"
                      }} />
                    </div>
                  </div>
                </td>
                <td className="text-right py-2.5 px-2">
                  <span className={`flex items-center gap-0.5 justify-end text-[10px] ${c.trend === "up" ? "text-primary" : "text-destructive"}`}>
                    {c.trend === "up" ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                    {c.trendValue}
                  </span>
                </td>
                <td className="text-right py-2.5 px-2 text-foreground">{c.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-2">
        <span>24 campanhas</span>
        <div className="flex items-center gap-2">
          <span>‹ Anterior</span>
          <span className="px-1.5 py-0.5 rounded bg-primary text-primary-foreground">1</span>
          <span>2</span>
          <span>3</span>
          <span>Next ›</span>
        </div>
      </div>
    </div>
  );
}
