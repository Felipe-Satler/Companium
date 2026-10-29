import { DollarSign, Target, TrendingUp, Calendar, Percent } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, ComposedChart } from "recharts";

const metrics = [
  { label: "META", value: "20.7K", sub: "Meta do mês", icon: Target, iconColor: "text-orange-600 dark:text-orange-400", bg: "" },
  { label: "REALIZADO", value: "8.9K", sub: "Acumulado até hoje", icon: TrendingUp, iconColor: "text-red-600 dark:text-red-400", bg: "" },
  { label: "% ATINGIMENTO", value: "42,9%", sub: "vs. meta total", icon: Percent, iconColor: "text-primary", bg: "bg-primary/20", valueColor: "text-primary" },
  { label: "MQL MTD", value: "16.0K", sub: "Esperado até hoje", icon: Calendar, iconColor: "text-blue-600 dark:text-blue-400", bg: "" },
  { label: "% MTD", value: "55,4%", sub: "vs. meta proporcional", icon: Percent, iconColor: "text-primary", bg: "bg-primary/20", valueColor: "text-primary" },
];

const chartData = Array.from({ length: 24 }, (_, i) => {
  const day = i + 1;
  return {
    name: `${String(day).padStart(2, "0")}mar`,
    Realizado: Math.floor(300 + i * 350 + Math.random() * 200),
    "Meta MTD": Math.floor(20700 * ((i + 1) / 31)),
  };
});

export function MetaMidiaPaga() {
  return (
    <div className="space-y-5">
      {/* Section Header */}
      <div className="neu-card rounded-xl p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/20">
            <DollarSign className="h-5 w-5 text-primary" />
          </div>
          <div>
            <span className="text-base font-bold text-foreground">Mídia Paga</span>
            <p className="text-xs text-muted-foreground">Paid social e tráfego</p>
          </div>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-5 gap-3">
          {metrics.map((m) => {
            const Icon = m.icon;
            return (
              <div key={m.label} className={`rounded-lg border border-border/50 p-4 ${m.bg || "bg-card"}`}>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{m.label}</p>
                  <Icon className={`h-4 w-4 ${m.iconColor}`} />
                </div>
                <p className={`text-2xl font-bold ${m.valueColor || "text-foreground"}`}>{m.value}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{m.sub}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Evolution Chart */}
      <div className="neu-card rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm font-semibold text-foreground">Evolução por Meta</span>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-sm font-bold text-foreground">MQL Total Março 2026</p>
              <p className="text-[10px] text-muted-foreground">Março/2026</p>
            </div>
            <span className="px-2.5 py-1 text-[10px] rounded-md font-medium bg-primary/20 text-primary">⊙ Geral</span>
          </div>
          <div className="flex items-center gap-4 text-xs mb-3">
            <span className="text-muted-foreground">
              Realizado: <span className="text-foreground font-semibold">8,9K</span>
            </span>
            <span className="text-muted-foreground">
              Meta: <span className="text-foreground font-semibold">20,7K</span>
            </span>
            <span className="text-primary font-bold">42,9%</span>
            <span className="text-muted-foreground">
              MTD: <span className="text-primary font-bold">55,4%</span>
            </span>
          </div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
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
                <Area type="monotone" dataKey="Realizado" fill="hsl(var(--primary))" fillOpacity={0.2} stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Meta MTD" stroke="#f472b6" strokeDasharray="5 5" dot={false} strokeWidth={1.5} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
