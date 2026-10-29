import { Card } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from "recharts";

const data = Array.from({ length: 30 }, (_, i) => ({
  day: `${i + 1}`,
  realizado: Math.round(50000 + i * 18000 + Math.random() * 15000),
  meta: Math.round(40000 + i * 20000),
  forecast: i > 20 ? Math.round(50000 + i * 22000 + Math.random() * 10000) : null,
  pace: i > 15 ? Math.round(50000 + i * 16000) : null,
}));

const chartConfig = {
  realizado: { label: "Realizado", color: "hsl(var(--primary))" },
  meta: { label: "Meta", color: "hsl(var(--chart-line-forecast))" },
  forecast: { label: "Forecast", color: "hsl(var(--chart-line-pace))" },
  pace: { label: "Pace", color: "hsl(var(--destructive))" },
};

const filters = ["D", "S", "M", "T", "A"];

interface Props { loading: boolean }

export function VendasChart({ loading }: Props) {
  if (loading) return <div className="h-64 rounded-xl skeleton-loading" />;

  return (
    <Card className="neu-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-destructive animate-pulse-live" />
          <span className="text-sm font-medium text-foreground">Vendas Acumuladas</span>
        </div>
        <div className="flex items-center gap-1">
          {filters.map((f, i) => (
            <button
              key={f}
              className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                i === 2 ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <ChartContainer config={chartConfig} className="h-64 w-full">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
          <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => v.toLocaleString("pt-BR")} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Line type="monotone" dataKey="realizado" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="meta" stroke="hsl(var(--chart-line-forecast))" strokeWidth={2} dot={false} strokeDasharray="5 5" />
          <Line type="monotone" dataKey="forecast" stroke="hsl(var(--chart-line-pace))" strokeWidth={2} dot={false} connectNulls={false} />
          <Line type="monotone" dataKey="pace" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} connectNulls={false} />
        </LineChart>
      </ChartContainer>

      <div className="flex items-center gap-4 mt-3">
        {Object.entries(chartConfig).map(([key, cfg]) => (
          <div key={key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className="h-2 w-2 rounded-full" style={{ backgroundColor: cfg.color }} />
            <span>{cfg.label}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
