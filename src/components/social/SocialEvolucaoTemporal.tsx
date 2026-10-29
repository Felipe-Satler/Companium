import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { BarChart3 } from "lucide-react";
import { useState } from "react";

const metricTabs = ["Alcance", "Views Perfil", "Seguidores", "Interações"];
const periodTabs = ["Semanal", "Por Conta"];

const data = (() => {
  const weeks = ["01/fev","07/fev","14/fev","21/fev","28/fev","07/mar","14/mar","21/mar","28/mar"];
  return weeks.map((w, i) => ({
    name: w,
    value: Math.floor(300000 + Math.random() * 200000 + (i === 4 ? 800000 : 0) + (i === 7 ? 500000 : 0)),
  }));
})();

export function SocialEvolucaoTemporal() {
  const [activeMetric, setActiveMetric] = useState("Alcance");
  const [activePeriod, setActivePeriod] = useState("Semanal");

  return (
    <div className="neu-card rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-pink-600 dark:text-pink-400" />
          <span className="text-sm font-bold text-foreground">Evolução Temporal</span>
          <span className="text-[10px] text-muted-foreground">Performance ao longo do tempo</span>
        </div>
        <span className="text-xs font-semibold text-primary">+50.6%</span>
      </div>

      <div className="flex items-center gap-1 flex-wrap">
        {metricTabs.map((t) => (
          <button
            key={t}
            onClick={() => setActiveMetric(t)}
            className={`px-3 py-1 text-[10px] rounded-md font-medium transition-colors ${
              activeMetric === t ? "bg-pink-500 text-white" : "text-muted-foreground hover:bg-secondary"
            }`}
          >
            {t}
          </button>
        ))}
        <div className="ml-2 flex items-center gap-1">
          <span className="text-[10px] text-foreground">📊 Diário</span>
        </div>
      </div>

      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        {periodTabs.map((t) => (
          <button
            key={t}
            onClick={() => setActivePeriod(t)}
            className={`flex items-center gap-1 ${activePeriod === t ? "text-foreground font-medium" : ""}`}
          >
            📅 {t}
          </button>
        ))}
      </div>

      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} vertical={false} />
            <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={(v) => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} />
            <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }} />
            <Area type="monotone" dataKey="value" fill="rgba(236,72,153,0.15)" stroke="#ec4899" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Mínimo", value: "162.4K", color: "text-cyan-600 dark:text-cyan-400" },
          { label: "Média", value: "541.2K", color: "text-foreground" },
          { label: "Máximo", value: "1.1M", color: "text-pink-600 dark:text-pink-400" },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/30 border border-border/30">
            <div className={`h-2 w-2 rounded-full ${s.color === "text-cyan-600 dark:text-cyan-400" ? "bg-cyan-400" : s.color === "text-pink-600 dark:text-pink-400" ? "bg-pink-400" : "bg-foreground"}`} />
            <div>
              <p className="text-[10px] text-muted-foreground">{s.label}</p>
              <p className={`text-sm font-bold ${s.color}`}>{s.value}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
