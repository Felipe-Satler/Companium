import { Card } from "@/components/ui/card";

const metricGroups = [
  {
    title: "Métricas de Eficiência",
    items: [
      { label: "Ciclo Médio", value: "32 dias", change: "-5%", positive: true },
      { label: "Ticket Médio", value: "R$ 8.500", change: "+12%", positive: true },
      { label: "Win Rate", value: "34%", change: "+3%", positive: true },
    ],
  },
  {
    title: "Atividades",
    items: [
      { label: "Calls realizadas", value: "450", change: "+8%", positive: true },
      { label: "Emails enviados", value: "1.200", change: "-2%", positive: false },
      { label: "Reuniões agendadas", value: "89", change: "+15%", positive: true },
    ],
  },
  {
    title: "Receita Recorrente",
    items: [
      { label: "MRR Atual", value: "R$ 245.000", change: "+4%", positive: true },
      { label: "Churn Rate", value: "2.1%", change: "-0.3%", positive: true },
      { label: "Expansão", value: "R$ 18.500", change: "+22%", positive: true },
    ],
  },
  {
    title: "Canal de Origem",
    items: [
      { label: "Orgânico", value: "42%", change: "+5%", positive: true },
      { label: "Pago", value: "28%", change: "-3%", positive: false },
      { label: "Indicação", value: "30%", change: "+8%", positive: true },
    ],
  },
  {
    title: "Desempenho por Região",
    items: [
      { label: "Sudeste", value: "R$ 5.2M", change: "+10%", positive: true },
      { label: "Sul", value: "R$ 2.1M", change: "+6%", positive: true },
      { label: "Nordeste", value: "R$ 1.8M", change: "-2%", positive: false },
    ],
  },
  {
    title: "Saúde do Pipeline",
    items: [
      { label: "Pipeline Total", value: "R$ 32M", change: "+15%", positive: true },
      { label: "Deals Ativos", value: "142", change: "+8%", positive: true },
      { label: "Cobertura", value: "3.2x", change: "+0.4x", positive: true },
    ],
  },
  {
    title: "Tempo de Resposta",
    items: [
      { label: "Primeiro contato", value: "2.5h", change: "-30min", positive: true },
      { label: "Follow-up", value: "4h", change: "+15min", positive: false },
      { label: "Proposta", value: "1.2 dias", change: "-6h", positive: true },
    ],
  },
  {
    title: "Forecast",
    items: [
      { label: "Comprometido", value: "R$ 8.5M", change: "+5%", positive: true },
      { label: "Provável", value: "R$ 4.2M", change: "+12%", positive: true },
      { label: "Possível", value: "R$ 2.8M", change: "-3%", positive: false },
    ],
  },
  {
    title: "Engajamento",
    items: [
      { label: "Taxa abertura", value: "35%", change: "+2%", positive: true },
      { label: "Taxa clique", value: "12%", change: "+1.5%", positive: true },
      { label: "Respostas", value: "8%", change: "+0.5%", positive: true },
    ],
  },
];

interface Props { loading: boolean }

export function MetricasDetalhadas({ loading }: Props) {
  if (loading) return <div className="h-64 rounded-xl skeleton-loading" />;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">📊 Métricas Detalhadas por Categoria</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {metricGroups.map((group) => (
          <Card key={group.title} className="neu-card p-4">
            <h4 className="text-xs font-semibold text-foreground mb-3">{group.title}</h4>
            <div className="space-y-2.5">
              {group.items.map((item) => (
                <div key={item.label} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">{item.label}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-foreground">{item.value}</span>
                      <span className={`text-[10px] font-medium ${item.positive ? "text-primary" : "text-destructive"}`}>
                        {item.change}
                      </span>
                    </div>
                  </div>
                  <div className="w-full h-1 rounded-full bg-secondary">
                    <div
                      className={`h-full rounded-full transition-all ${item.positive ? "bg-primary" : "bg-destructive"}`}
                      style={{ width: `${Math.random() * 60 + 30}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
