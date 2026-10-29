import { Card } from "@/components/ui/card";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { ChartContainer } from "@/components/ui/chart";

const data = [
  { name: "Novo", value: 180, color: "hsl(var(--primary))" },
  { name: "Upgrade", value: 40, color: "hsl(260, 50%, 55%)" },
  { name: "Renovação", value: 25, color: "hsl(var(--chart-line-pace))" },
  { name: "Cross-sell", value: 10, color: "hsl(var(--chart-line-forecast))" },
];

const total = data.reduce((s, d) => s + d.value, 0);

const chartConfig = {
  novo: { label: "Novo", color: "hsl(var(--primary))" },
  upgrade: { label: "Upgrade", color: "hsl(260, 50%, 55%)" },
};

interface Props { loading: boolean }

export function TipoNegocioCard({ loading }: Props) {
  if (loading) return <div className="h-64 rounded-xl skeleton-loading" />;

  return (
    <Card className="neu-card p-5">
      <h3 className="text-sm font-medium text-foreground mb-4">Tipo de Negócio</h3>
      <div className="flex items-center gap-4">
        <div className="relative w-32 h-32">
          <ChartContainer config={chartConfig} className="w-full h-full">
            <PieChart>
              <Pie data={data} dataKey="value" innerRadius={35} outerRadius={55} paddingAngle={2}>
                {data.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-2xl font-bold text-primary">{total}</span>
          </div>
        </div>
        <div className="flex-1 space-y-2">
          {data.map((item) => (
            <div key={item.name} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="text-muted-foreground">{item.name}</span>
              </div>
              <span className="text-foreground font-medium">{item.value}</span>
            </div>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-3">Total: R$ 10.442.049</p>
    </Card>
  );
}
