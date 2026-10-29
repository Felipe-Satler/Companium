import { Card } from "@/components/ui/card";
import { ChartContainer } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, Cell } from "recharts";

const data = [
  { name: "Proposta", value: 520000, color: "hsl(45, 80%, 55%)" },
  { name: "Negociação", value: 380000, color: "hsl(35, 80%, 55%)" },
  { name: "Qualificação", value: 290000, color: "hsl(25, 80%, 55%)" },
  { name: "Apresentação", value: 220000, color: "hsl(45, 70%, 50%)" },
  { name: "Follow-up", value: 180000, color: "hsl(35, 70%, 50%)" },
  { name: "Contrato", value: 150000, color: "hsl(var(--primary))" },
  { name: "Fechamento", value: 120000, color: "hsl(25, 70%, 50%)" },
  { name: "Onboarding", value: 80000, color: "hsl(45, 60%, 45%)" },
  { name: "Lead", value: 50000, color: "hsl(35, 60%, 45%)" },
  { name: "Cancelado", value: 25000, color: "hsl(var(--destructive))" },
];

const chartConfig = {
  value: { label: "Pipeline", color: "hsl(var(--chart-line-forecast))" },
};

interface Props { loading: boolean }

export function ForecastPipelineChart({ loading }: Props) {
  if (loading) return <div className="h-[340px] rounded-xl skeleton-loading" />;

  return (
    <Card className="neu-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-foreground">Previsão por Fase / Pipeline</h3>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className="h-2 w-2 rounded-full" style={{ backgroundColor: "hsl(var(--primary))" }} />
            <span>Realizado</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className="h-2 w-2 rounded-full" style={{ backgroundColor: "hsl(var(--chart-line-forecast))" }} />
            <span>Forecast</span>
          </div>
        </div>
      </div>
      <ChartContainer config={chartConfig} className="h-[280px] w-full">
        <BarChart data={data} layout="vertical" margin={{ left: 10 }}>
          <XAxis type="number" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `R$ ${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`} />
          <YAxis dataKey="name" type="category" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" width={80} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={14}>
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </Card>
  );
}
