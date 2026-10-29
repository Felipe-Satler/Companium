import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, ComposedChart, Legend } from "recharts";
import { Target } from "lucide-react";

const dailyData = Array.from({ length: 24 }, (_, i) => {
  const day = i + 1;
  const meta = Math.floor(100 + day * 5);
  const realizado = Math.floor(80 + day * 8 + Math.random() * 30);
  return {
    name: `${day}mar`,
    Meta: meta,
    Realizado: realizado > meta * 1.2 ? meta * 1.1 : realizado,
    "Meta Linha": 154,
  };
});

export function MetaReunioesCard() {
  return (
    <div className="neu-card rounded-xl p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-500/20">
          <Target className="h-5 w-5 text-orange-600 dark:text-orange-400" />
        </div>
        <span className="text-base font-bold text-foreground">Meta de Reuniões Realizadas</span>
      </div>

      {/* Big number */}
      <div>
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-bold text-foreground">2.427</span>
          <span className="text-sm text-muted-foreground">/ 3.700</span>
        </div>
        <div className="mt-2 h-2 w-full rounded-full bg-secondary overflow-hidden">
          <div className="h-full rounded-full bg-orange-500" style={{ width: "65.6%" }} />
        </div>
        <div className="flex items-center justify-between mt-2">
          <div>
            <span className="text-lg font-bold text-primary">84,7%</span>
            <p className="text-[10px] text-muted-foreground">Ritmo MTD</p>
          </div>
          <div className="text-center">
            <span className="text-lg font-bold text-foreground">2.865</span>
            <p className="text-[10px] text-muted-foreground">Meta MTD</p>
          </div>
          <div className="text-right">
            <span className="text-lg font-bold text-foreground">65,6%</span>
            <p className="text-[10px] text-muted-foreground">da Meta</p>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div>
        <span className="text-sm font-semibold text-foreground mb-3 block">Evolução Diária</span>
        <div className="flex items-center gap-4 mb-3">
          {[
            { label: "Meta", color: "hsl(var(--primary))" },
            { label: "Realizado", color: "#f472b6" },
            { label: "Meta", color: "#22d3ee" },
          ].map((item) => (
            <div key={item.label + item.color} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
              <span className="text-[10px] text-muted-foreground">{item.label}</span>
            </div>
          ))}
        </div>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={dailyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 11,
                }}
              />
              <Area type="monotone" dataKey="Realizado" fill="hsl(var(--primary))" fillOpacity={0.15} stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Meta" stroke="#f472b6" strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="Meta Linha" stroke="#22d3ee" strokeDasharray="5 5" dot={false} strokeWidth={1.5} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
