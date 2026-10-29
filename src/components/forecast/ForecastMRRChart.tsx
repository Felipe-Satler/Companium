import { Card } from "@/components/ui/card";
import { ChartContainer } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, Cell } from "recharts";

const data = [
  { name: "Plano Enterprise", value: 420000, color: "hsl(var(--primary))" },
  { name: "Plano Pro", value: 310000, color: "hsl(var(--chart-line-forecast))" },
  { name: "Plano Business", value: 250000, color: "hsl(215, 60%, 50%)" },
  { name: "Plano Starter", value: 180000, color: "hsl(var(--destructive))" },
  { name: "Add-ons", value: 120000, color: "hsl(260, 50%, 55%)" },
  { name: "Consultoria", value: 85000, color: "hsl(30, 70%, 50%)" },
  { name: "Suporte Premium", value: 65000, color: "hsl(var(--primary))" },
  { name: "Treinamento", value: 45000, color: "hsl(var(--chart-line-forecast))" },
  { name: "Customização", value: 30000, color: "hsl(215, 60%, 50%)" },
  { name: "Outros", value: 18000, color: "hsl(var(--muted-foreground))" },
];

const chartConfig = {
  value: { label: "MRR", color: "hsl(var(--primary))" },
};

interface Props { loading: boolean }

export function ForecastMRRChart({ loading }: Props) {
  if (loading) return <div className="h-[340px] rounded-xl skeleton-loading" />;

  return (
    <Card className="neu-card p-5">
      <h3 className="text-sm font-medium text-foreground mb-4">MRR por Produto</h3>
      <ChartContainer config={chartConfig} className="h-[280px] w-full">
        <BarChart data={data} layout="vertical" margin={{ left: 10 }}>
          <XAxis type="number" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `R$ ${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`} />
          <YAxis dataKey="name" type="category" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" width={90} />
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
