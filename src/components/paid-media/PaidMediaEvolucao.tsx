import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, ComposedChart } from "recharts";
import { TrendingUp } from "lucide-react";
import { useState } from "react";

const categories = ["MQLs", "Qtdtd", "Investimento", "CPC", "CPMC", "CAC", "Canetas", "Mix", "LTV"];

const data = Array.from({ length: 31 }, (_, i) => {
  const day = i + 1;
  const label = `${day}/${String(day).padStart(2, "0")}`;
  return {
    name: day <= 24 ? `${String(day).padStart(2, "0")}/03` : `${String(day).padStart(2, "0")}/03`,
    MQLs: Math.floor(200 + Math.random() * 400 + (day > 15 ? day * 15 : 0)),
    Investimento: Math.floor(50000 + Math.random() * 30000 + day * 3000),
    CPC: +(2 + Math.random() * 3).toFixed(2),
    Receita: Math.floor(60000 + Math.random() * 40000 + day * 4000),
  };
});

export function PaidMediaEvolucao() {
  const [active, setActive] = useState("MQLs");

  return (
    <div className="neu-card rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          <span className="text-sm font-bold text-foreground">Evolução Temporal</span>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setActive(c)}
              className={`px-2 py-1 text-[10px] rounded font-medium transition-colors ${
                active === c ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} vertical={false} />
            <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }}
            />
            <Area type="monotone" dataKey="MQLs" fill="hsl(var(--primary) / 0.15)" stroke="hsl(var(--primary))" strokeWidth={2} />
            <Line type="monotone" dataKey="Investimento" stroke="#a78bfa" strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey="CPC" stroke="#f472b6" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary" />MQLs</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-purple-400" />& INV</span>
      </div>
    </div>
  );
}
