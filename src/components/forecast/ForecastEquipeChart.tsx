import { Card } from "@/components/ui/card";
import { ChartContainer } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

const data = [
  { name: "Equipe Alpha", realizado: 980000, forecast: 420000, meta: 1200000 },
  { name: "João Silva", realizado: 850000, forecast: 380000, meta: 950000 },
  { name: "Maria Santos", realizado: 620000, forecast: 290000, meta: 780000 },
  { name: "Carlos Oliveira", realizado: 510000, forecast: 180000, meta: 600000 },
  { name: "Bruno Costa", realizado: 430000, forecast: 150000, meta: 520000 },
  { name: "Ana Souza", realizado: 380000, forecast: 120000, meta: 450000 },
  { name: "Luciana Pereira", realizado: 320000, forecast: 100000, meta: 380000 },
  { name: "Pedro Lima", realizado: 280000, forecast: 90000, meta: 340000 },
  { name: "Fernanda Alves", realizado: 220000, forecast: 80000, meta: 280000 },
  { name: "André Rodrigues", realizado: 180000, forecast: 60000, meta: 220000 },
  { name: "Camila Ferreira", realizado: 150000, forecast: 50000, meta: 180000 },
  { name: "Lucas Martins", realizado: 120000, forecast: 40000, meta: 160000 },
  { name: "Juliana Barbosa", realizado: 95000, forecast: 30000, meta: 140000 },
  { name: "Rafael Carvalho", realizado: 75000, forecast: 25000, meta: 120000 },
  { name: "Tatiana Godoy", realizado: 50000, forecast: 15000, meta: 100000 },
];

const chartConfig = {
  realizado: { label: "Realizado", color: "hsl(var(--primary))" },
  forecast: { label: "Forecast", color: "hsl(var(--chart-line-forecast))" },
  meta: { label: "Meta", color: "hsl(215, 60%, 50%)" },
};

interface Props { loading: boolean }

export function ForecastEquipeChart({ loading }: Props) {
  if (loading) return <div className="h-[420px] rounded-xl skeleton-loading" />;

  return (
    <Card className="neu-card p-5">
      <div className="mb-4">
        <h3 className="text-sm font-medium text-foreground">Resultado Acumulado por Equipe / Vendedor</h3>
        <p className="text-xs text-muted-foreground mt-0.5">Comparativo realizado vs forecast vs meta</p>
      </div>
      <ChartContainer config={chartConfig} className="h-[380px] w-full">
        <BarChart data={data} layout="vertical" margin={{ left: 10, right: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `R$ ${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`} />
          <YAxis dataKey="name" type="category" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" width={100} />
          <Tooltip
            contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }}
            formatter={(value: number) => `R$ ${value.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`}
          />
          <Bar dataKey="realizado" fill="hsl(var(--primary))" radius={[0, 2, 2, 0]} barSize={8} />
          <Bar dataKey="forecast" fill="hsl(var(--chart-line-forecast))" radius={[0, 2, 2, 0]} barSize={8} />
          <Bar dataKey="meta" fill="hsl(215, 60%, 50%)" radius={[0, 2, 2, 0]} barSize={8} />
        </BarChart>
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
