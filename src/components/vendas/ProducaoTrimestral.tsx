import { Card } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

const months = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

const data = months.flatMap((m) => [
  { month: m, week: "S1", value: Math.round(300 + Math.random() * 500) },
  { month: m, week: "S2", value: Math.round(300 + Math.random() * 500) },
  { month: m, week: "S3", value: Math.round(300 + Math.random() * 500) },
  { month: m, week: "S4", value: Math.round(300 + Math.random() * 500) },
]);

const chartData = data.map((d, i) => ({
  name: i % 4 === 0 ? d.month : "",
  label: `${d.month} ${d.week}`,
  value: d.value,
}));

const chartConfig = {
  value: { label: "Produção", color: "hsl(var(--primary))" },
};

const filters = ["Semanal", "Quinzenal", "Mensal", "Trimestral"];

interface Props { loading: boolean }

export function ProducaoTrimestral({ loading }: Props) {
  if (loading) return <div className="h-64 rounded-xl skeleton-loading" />;

  return (
    <Card className="neu-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-primary" />
          <span className="text-sm font-medium text-foreground">Produção Trimestral</span>
        </div>
        <div className="flex items-center gap-1">
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
      </div>

      <ChartContainer config={chartConfig} className="h-64 w-full">
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
          <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ChartContainer>
    </Card>
  );
}
