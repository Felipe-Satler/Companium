import { Play } from "lucide-react";
import { useState } from "react";

const tabs = ["Relevância", "Eficiência"];
const filterTabs = ["Todos", "▼", "▲"];

const videos = [
  { name: "DG metodo5 leads plataforma", invest: "17.606", gastoM: "17.196", gastoDia: "1.44", mqlShare: "31,3%", mqlSharePct: 31, convMQL: "", cpmql: "R$ 41.145", cpr: "14,5%" },
  { name: "Ag_metodo5_video_dakbranding_...", invest: "604.41", gastoM: "127.696", gastoDia: "4,87", mqlShare: "39,5%", mqlSharePct: 40, convMQL: "", cpmql: "", cpr: "" },
  { name: "72 metodo5_leads_plataforma_k", invest: "30.566", gastoM: "7.100", gastoDia: "2,1", mqlShare: "26,2%", mqlSharePct: 26, convMQL: "", cpmql: "", cpr: "64,8%" },
  { name: "DC midezos web5 plataforma...", invest: "24.071", gastoM: "175.282", gastoDia: "29.241", mqlShare: "27,1%", mqlSharePct: 27, convMQL: "", cpmql: "R$ 68,9%", cpr: "" },
  { name: "DG_metodo5_video_dakbranding_...", invest: "320.177", gastoM: "161.71", gastoDia: "17,35", mqlShare: "99,5%", mqlSharePct: 99, convMQL: "", cpmql: "", cpr: "51,5%" },
  { name: "75 metodo5 leads plataforma_k", invest: "3,271", gastoM: "441,87", gastoDia: "185,81", mqlShare: "26,5%", mqlSharePct: 27, convMQL: "", cpmql: "", cpr: "" },
  { name: "FXZ_metodo5_dk_dakbranding_...", invest: "449.515", gastoM: "", gastoDia: "", mqlShare: "44,8%", mqlSharePct: 45, convMQL: "", cpmql: "", cpr: "48,1%" },
  { name: "DG metodo5 leads plataforma", invest: "779.116", gastoM: "247.581", gastoDia: "2,81", mqlShare: "26,2%", mqlSharePct: 26, convMQL: "", cpmql: "", cpr: "31,3%" },
  { name: "75 metodo5 leads plataforma_k", invest: "471.554", gastoM: "", gastoDia: "33,67", mqlShare: "22,6%", mqlSharePct: 23, convMQL: "", cpmql: "", cpr: "17,4%" },
  { name: "DG_metodo5_video_dakbranding_...", invest: "74.108", gastoM: "", gastoDia: "19,45", mqlShare: "", mqlSharePct: 0, convMQL: "", cpmql: "", cpr: "" },
  { name: "DG metodo5 leads plataforma", invest: "12.716", gastoM: "", gastoDia: "30,69", mqlShare: "", mqlSharePct: 0, convMQL: "", cpmql: "R$ —", cpr: "" },
  { name: "DG_metodo5_up_play_marketing...", invest: "1,971", gastoM: "", gastoDia: "", mqlShare: "", mqlSharePct: 0, convMQL: "", cpmql: "", cpr: "" },
  { name: "21 minutos_web5_plataforma_...", invest: "76.906", gastoM: "", gastoDia: "5,187", mqlShare: "13,3%", mqlSharePct: 13, convMQL: "", cpmql: "", cpr: "14,4%" },
  { name: "Ag metodo5_leads_plataforma5_...", invest: "30.815", gastoM: "78,475", gastoDia: "", mqlShare: "16", mqlSharePct: 0, convMQL: "", cpmql: "", cpr: "12,6%" },
  { name: "1000_metodo5_plataforma_exp_video", invest: "13.661", gastoM: "", gastoDia: "", mqlShare: "", mqlSharePct: 0, convMQL: "", cpmql: "", cpr: "17,3%" },
];

export function PaidMediaVideoEngagement() {
  const [activeFilter, setActiveFilter] = useState("Relevância");

  return (
    <div className="neu-card rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Play className="h-4 w-4 text-primary" />
          <span className="text-sm font-bold text-foreground">Engajamento de Vídeo</span>
          <span className="text-xs text-muted-foreground ml-1">- 52 criativos analisados</span>
        </div>
        <div className="flex items-center gap-1">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setActiveFilter(t)}
              className={`px-2.5 py-1 text-[10px] rounded font-medium transition-colors ${
                activeFilter === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"
              }`}
            >
              {t}
            </button>
          ))}
          <button className="px-2 py-1 text-[10px] rounded text-muted-foreground hover:bg-secondary border border-border/50">Todos</button>
          <button className="px-2 py-1 text-[10px] rounded text-muted-foreground hover:bg-secondary border border-border/50 flex items-center gap-1">
            ▼
            <svg className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none"><path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button className="px-2 py-1 text-[10px] rounded text-muted-foreground hover:bg-secondary border border-border/50">▲</button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="border-b border-border/50">
              <th className="text-left text-muted-foreground font-medium py-2 pr-3">CRIATIVOS</th>
              <th className="text-right text-muted-foreground font-medium py-2 px-2">IMPRESSÕES</th>
              <th className="text-right text-muted-foreground font-medium py-2 px-2">GASTO M</th>
              <th className="text-right text-muted-foreground font-medium py-2 px-2">GASTO/DIA</th>
              <th className="text-right text-muted-foreground font-medium py-2 px-2">MQL SHARE %</th>
              <th className="text-right text-muted-foreground font-medium py-2 px-2">CONV MQL %</th>
              <th className="text-right text-muted-foreground font-medium py-2 px-2">CPMQL</th>
              <th className="text-right text-muted-foreground font-medium py-2 px-2">CPR %</th>
            </tr>
          </thead>
          <tbody>
            {videos.map((v, i) => (
              <tr key={i} className="border-b border-border/20 hover:bg-secondary/20 transition-colors">
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">›</span>
                    <span className="text-foreground truncate max-w-[250px]">{v.name}</span>
                  </div>
                </td>
                <td className="text-right py-2 px-2 text-foreground">{v.invest}</td>
                <td className="text-right py-2 px-2 text-foreground">{v.gastoM}</td>
                <td className="text-right py-2 px-2 text-foreground">{v.gastoDia}</td>
                <td className="py-2 px-2">
                  <div className="flex items-center gap-1 justify-end">
                    {v.mqlShare && (
                      <>
                        <div className="w-12 h-1.5 rounded-full bg-secondary overflow-hidden">
                          <div className="h-full rounded-full" style={{
                            width: `${v.mqlSharePct}%`,
                            background: v.mqlSharePct > 40 ? "hsl(var(--primary))" : v.mqlSharePct > 25 ? "#f59e0b" : "#ef4444"
                          }} />
                        </div>
                        <span className="text-foreground">{v.mqlShare}</span>
                      </>
                    )}
                  </div>
                </td>
                <td className="text-right py-2 px-2 text-muted-foreground">{v.convMQL || "—"}</td>
                <td className="text-right py-2 px-2 text-foreground">{v.cpmql}</td>
                <td className="text-right py-2 px-2 text-foreground">{v.cpr}</td>
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
