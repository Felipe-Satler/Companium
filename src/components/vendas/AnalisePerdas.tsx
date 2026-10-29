import { Card } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Cell } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

const data = [
  { name: "Preço alto", value: 45, pct: "32.4%" },
  { name: "Sem orçamento", value: 28, pct: "20.1%" },
  { name: "Concorrência", value: 22, pct: "15.8%" },
  { name: "Timing errado", value: 18, pct: "12.9%" },
  { name: "Sem necessidade", value: 12, pct: "8.6%" },
  { name: "Produto inadequado", value: 8, pct: "5.8%" },
  { name: "Sem resposta", value: 5, pct: "3.6%" },
  { name: "Outros", value: 3, pct: "2.2%" },
];

const tabs = ["Todos os Produtos", "Novos"];
const filters = ["Mês", "Trimestre", "Semestre", "Ano", "Tipo Negócio"];

const chartConfig = {
  value: { label: "Perdas", color: "hsl(var(--destructive))" },
};

interface Props { loading: boolean }

export function AnalisePerdas({ loading }: Props) {
  if (loading) return <div className="h-64 rounded-xl skeleton-loading" />;

  return (
    <Card className="neu-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-destructive" />
          <span className="text-sm font-medium text-foreground">Análise de Perdas</span>
        </div>
        <div className="flex items-center gap-1">
          {tabs.map((t, i) => (
            <button
              key={t}
              className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                i === 0 ? "bg-destructive/20 text-destructive" : "text-muted-foreground hover:bg-secondary"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-1 mb-4">
        {filters.map((f, i) => (
          <button
            key={f}
            className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
              i === 0 ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <ChartContainer config={chartConfig} className="h-72 w-full">
        <BarChart data={data} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
          <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" width={120} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="value" fill="hsl(var(--destructive))" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ChartContainer>
    </Card>
  );
}
