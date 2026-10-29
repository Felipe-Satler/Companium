import { Card } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Line, ComposedChart } from "recharts";

const months = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

const data = months.map((m, i) => ({
  month: m,
  realizado: i < 9 ? Math.round(300000 + Math.random() * 200000 + i * 30000) : null,
  forecast: i >= 7 ? Math.round(350000 + i * 50000 + Math.random() * 80000) : null,
  meta: 500000,
}));

const chartConfig = {
  realizado: { label: "Realizado", color: "hsl(var(--primary))" },
  forecast: { label: "Forecast", color: "hsl(var(--chart-line-forecast))" },
  meta: { label: "Meta", color: "hsl(var(--destructive))" },
};

interface Props { loading: boolean }

export function ForecastLineChart({ loading }: Props) {
  if (loading) return <div className="h-64 rounded-xl skeleton-loading" />;

  return (
    <Card className="neu-card p-5">
      <div className="mb-4">
        <h3 className="text-sm font-medium text-foreground">Forecast vs Realizado vs Meta (mensal)</h3>
        <p className="text-xs text-muted-foreground mt-0.5">Evolução mensal de vendas</p>
      </div>
      <ChartContainer config={chartConfig} className="h-48 w-full">
        <ComposedChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
          <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `R$ ${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Area type="monotone" dataKey="realizado" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.15)" strokeWidth={2} connectNulls={false} />
          <Area type="monotone" dataKey="forecast" stroke="hsl(var(--chart-line-forecast))" fill="hsl(var(--chart-line-forecast) / 0.1)" strokeWidth={2} strokeDasharray="5 5" connectNulls={false} />
          <Line type="monotone" dataKey="meta" stroke="hsl(var(--destructive))" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
        </ComposedChart>
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
