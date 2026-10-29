import { Card } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell } from "recharts";
import { ChartContainer } from "@/components/ui/chart";

const data = [
  { name: "Starter", value: 45, color: "hsl(var(--primary))" },
  { name: "Pro", value: 30, color: "hsl(260, 50%, 55%)" },
  { name: "Business", value: 15, color: "hsl(215, 60%, 50%)" },
  { name: "Enterprise", value: 10, color: "hsl(var(--chart-line-forecast))" },
];

const chartConfig = {
  value: { label: "Ranking", color: "hsl(var(--primary))" },
};

interface Props { loading: boolean }

export function RankingPlanoCard({ loading }: Props) {
  if (loading) return <div className="h-64 rounded-xl skeleton-loading" />;

  return (
    <Card className="neu-card p-5">
      <h3 className="text-sm font-medium text-foreground mb-4">Ranking por Plano</h3>
      <ChartContainer config={chartConfig} className="h-40 w-full">
        <BarChart data={data} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
          <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" width={70} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]}>
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
      <div className="flex items-center gap-3 mt-3 flex-wrap">
        {data.map((item) => (
          <div key={item.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
            <span>{item.name}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
