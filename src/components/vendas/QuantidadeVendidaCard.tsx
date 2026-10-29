import { Card } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, Cell } from "recharts";
import { ChartContainer } from "@/components/ui/chart";

const data = [
  { name: "Produto A", value: 850, color: "hsl(var(--chart-line-forecast))" },
  { name: "Produto B", value: 620, color: "hsl(215, 60%, 50%)" },
  { name: "Produto C", value: 430, color: "hsl(var(--primary))" },
  { name: "Produto D", value: 280, color: "hsl(260, 50%, 55%)" },
];

const chartConfig = {
  value: { label: "Quantidade", color: "hsl(var(--primary))" },
};

interface Props { loading: boolean }

export function QuantidadeVendidaCard({ loading }: Props) {
  if (loading) return <div className="h-64 rounded-xl skeleton-loading" />;

  return (
    <Card className="neu-card p-5">
      <h3 className="text-sm font-medium text-foreground mb-4">Quantidade Vendida</h3>
      <ChartContainer config={chartConfig} className="h-40 w-full">
        <BarChart data={data} layout="vertical">
          <XAxis type="number" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
          <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" width={70} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]}>
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </Card>
  );
}
