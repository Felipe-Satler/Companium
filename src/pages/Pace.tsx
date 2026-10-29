import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { VendasHeader } from "@/components/vendas/VendasHeader";
import { PaceSection } from "@/components/pace/PaceSection";
import { Card } from "@/components/ui/card";
import { Users, Eye, Target, Calendar } from "lucide-react";

// Generate cumulative chart data
function generateChartData(maxVal: number, currentDay: number) {
  const days = Array.from({ length: 31 }, (_, i) => `${String(i + 1).padStart(2, "0")}`);
  const metaTotal = maxVal;
  const dailyMeta = metaTotal / 31;

  return days.map((day, i) => {
    const dayNum = i + 1;
    const metaEsperada = Math.round(dailyMeta * dayNum);
    const realizado = dayNum <= currentDay
      ? Math.round(dailyMeta * dayNum * (0.3 + Math.random() * 0.4) + (dayNum > 15 ? dayNum * dailyMeta * 0.1 : 0))
      : null;
    const projecao = dayNum >= currentDay
      ? Math.round((realizado ?? metaEsperada * 0.4) + (dayNum - currentDay) * (dailyMeta * 0.6) + Math.random() * dailyMeta * 0.3)
      : null;
    return { day, realizado, metaEsperada, projecao };
  });
}

const mqls = generateChartData(25267, 24);
const reunioes = generateChartData(3700, 24);
const views = generateChartData(11100000, 24);

export default function Pace() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1200);
    return () => clearTimeout(timer);
  }, []);

  return (
    <DashboardLayout>
      <div className="flex-1 p-6 space-y-6 overflow-auto">
        <VendasHeader activeTab={2} />

        {/* Date selector + section title */}
        <div className="space-y-3">
          <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-secondary text-foreground border border-border">
            <Calendar className="h-4 w-4" />
            Março De 2026
            <svg className="h-3 w-3 ml-1" viewBox="0 0 12 12" fill="none"><path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-bold text-foreground">PACE da Operação</h2>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Dia <strong className="text-foreground">24</strong> de 31
              </span>
              <span className="px-2 py-0.5 rounded bg-secondary border border-border text-foreground">Faltam 7 dias</span>
            </div>
          </div>
        </div>

        {/* MQLS TOTAIS */}
        <PaceSection
          title="MQLS Totais"
          icon={Users}
          iconColor="text-cyan-600 dark:text-cyan-400"
          statusLabel="Abaixo"
          statusType="danger"
          meta={{ metaValue: "25.267", realizadoValue: "11.102", realizadoPct: "43.9%", faltaValue: "14.165" }}
          performance={{ esperadoHoje: "19.562", faltanteMTD: "8.460", faltanteColor: "text-destructive", progressoPct: 56.8, progressoLabel: "56.8%" }}
          ritmo={{ paceAtual: "462,6", necessario: "2.023,6", diasRestantes: 7 }}
          chartData={mqls}
          chartYFormatter={(v) => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}
          loading={loading}
        />

        {/* REUNIÕES REALIZADAS */}
        <PaceSection
          title="Reuniões Realizadas"
          icon={Calendar}
          iconColor="text-blue-600 dark:text-blue-400"
          statusLabel="Atenção"
          statusType="warning"
          meta={{ metaValue: "3.700", realizadoValue: "2.427", realizadoPct: "65.6%", faltaValue: "1.273" }}
          performance={{ esperadoHoje: "2.865", faltanteMTD: "438", faltanteColor: "text-destructive", progressoPct: 84.7, progressoLabel: "84.7%" }}
          ritmo={{ paceAtual: "101,1", necessario: "181,9", diasRestantes: 7 }}
          chartData={reunioes}
          chartYFormatter={(v) => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}
          loading={loading}
        />

        {/* VIEWS TOTAIS */}
        <PaceSection
          title="Views Totais"
          icon={Eye}
          iconColor="text-yellow-600 dark:text-yellow-400"
          statusLabel="Abaixo"
          statusType="danger"
          meta={{ metaValue: "11.100.000", realizadoValue: "3.955.738", realizadoPct: "35.6%", faltaValue: "7.144.262" }}
          performance={{ esperadoHoje: "8.593.548", faltanteMTD: "4.637.810", faltanteColor: "text-destructive", progressoPct: 46, progressoLabel: "46%" }}
          ritmo={{ paceAtual: "164.822,4", necessario: "1.020.608,9", diasRestantes: 7 }}
          chartData={views}
          chartYFormatter={(v) => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}
          loading={loading}
        />
      </div>
    </DashboardLayout>
  );
}
