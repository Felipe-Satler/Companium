import { Card } from "@/components/ui/card";

const metrics = [
  {
    title: "Taxa de Conversão",
    icon: "🎯",
    iconBg: "bg-blue-500/20",
    value: "67%",
    valueColor: "text-chart-forecast",
    progress: 67,
    progressColor: "bg-[hsl(var(--chart-line-forecast))]",
    subtitle: "Meta: 70%",
  },
  {
    title: "Taxa Comercial",
    icon: "📊",
    iconBg: "bg-green-500/20",
    value: "67%",
    valueColor: "text-primary",
    progress: 67,
    progressColor: "bg-primary",
    subtitle: "Meta: 75%",
  },
  {
    title: "Taxa de Churn",
    icon: "🔄",
    iconBg: "bg-green-500/20",
    value: "88%",
    valueColor: "text-primary",
    progress: 88,
    progressColor: "bg-primary",
    subtitle: "Meta: 5%",
  },
  {
    title: "NPS",
    icon: "⭐",
    iconBg: "bg-orange-500/20",
    value: "0%",
    valueColor: "text-chart-forecast",
    progress: 0,
    progressColor: "bg-[hsl(var(--chart-line-forecast))]",
    subtitle: "Meta: 70",
  },
];

interface Props { loading: boolean }

export function TaxasConversao({ loading }: Props) {
  if (loading) return <div className="h-32 rounded-xl skeleton-loading" />;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-foreground">Taxas de Conversão</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map((m) => (
          <Card key={m.title} className="neu-card p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className={`h-8 w-8 rounded-full ${m.iconBg} flex items-center justify-center text-sm`}>
                  {m.icon}
                </div>
                <span className="text-xs font-medium text-foreground">{m.title}</span>
              </div>
              <span className={`text-lg font-bold ${m.valueColor}`}>{m.value}</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-secondary">
              <div
                className={`h-full rounded-full ${m.progressColor} transition-all`}
                style={{ width: `${m.progress}%` }}
              />
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5">{m.subtitle}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
