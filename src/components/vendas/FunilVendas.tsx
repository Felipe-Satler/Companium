import { Card } from "@/components/ui/card";
import { CheckCircle } from "lucide-react";

const stages = [
  { name: "Leads", value: "R$ 15.000", count: 1200, color: "hsl(185, 80%, 55%)", width: "100%" },
  { name: "MQL", value: "R$ 11.500", count: 850, color: "hsl(210, 70%, 55%)", width: "85%" },
  { name: "SQL", value: "R$ 7.400", count: 520, color: "hsl(260, 50%, 55%)", width: "65%" },
  { name: "Proposta", value: "R$ 4.200", count: 280, color: "hsl(280, 50%, 55%)", width: "50%" },
  { name: "Negociação", value: "R$ 2.100", count: 140, color: "hsl(300, 40%, 50%)", width: "35%" },
  { name: "Fechamento", value: "R$ 1.200", count: 75, color: "hsl(var(--primary))", width: "25%" },
];

const sideMetrics = [
  { label: "Leads Gerados", value: "1.200", icon: "📊" },
  { label: "Conversão Funil", value: "6.25%", icon: "📈" },
  { label: "Ciclo Médio de Venda", value: "32 dias", icon: "⏱" },
  { label: "Valor Médio do Negócio", value: "R$ 2.450,20", icon: "💰" },
];

interface Props { loading: boolean }

export function FunilVendas({ loading }: Props) {
  if (loading) return <div className="h-64 rounded-xl skeleton-loading" />;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-foreground">Funil de Vendas</h3>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
        <Card className="neu-card p-5">
          <div className="flex items-end gap-3 justify-center">
            {stages.map((stage, i) => (
              <div key={stage.name} className="flex flex-col items-center gap-2">
                <div
                  className="rounded-lg w-20 flex items-end justify-center transition-all"
                  style={{
                    backgroundColor: stage.color,
                    height: `${160 - i * 20}px`,
                    opacity: 0.85 + i * 0.025,
                  }}
                >
                  <span className="text-[10px] font-bold text-white/90 pb-2">{stage.count}</span>
                </div>
                <span className="text-[10px] text-muted-foreground font-medium">{stage.name}</span>
                <span className="text-[10px] text-foreground font-semibold">{stage.value}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-center gap-2 text-xs text-primary">
            <CheckCircle className="h-3.5 w-3.5" />
            <span>Taxa de Conversão do Funil: 6.25%</span>
          </div>
        </Card>

        <Card className="neu-card p-4 space-y-3">
          {sideMetrics.map((m) => (
            <div key={m.label} className="flex items-center justify-between py-2 border-b border-border last:border-0">
              <div className="flex items-center gap-2">
                <span className="text-sm">{m.icon}</span>
                <span className="text-xs text-muted-foreground">{m.label}</span>
              </div>
              <span className="text-xs font-semibold text-foreground">{m.value}</span>
            </div>
          ))}
          <div className="pt-2 text-right">
            <span className="text-primary text-sm font-bold">R$ 2.450,20</span>
          </div>
        </Card>
      </div>
    </div>
  );
}
