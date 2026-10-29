import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { MetricCard } from "@/components/MetricCard";
import { VendasHeader } from "@/components/vendas/VendasHeader";
import { ForecastEquipeChart } from "@/components/forecast/ForecastEquipeChart";
import { ForecastMRRChart } from "@/components/forecast/ForecastMRRChart";
import { ForecastPipelineChart } from "@/components/forecast/ForecastPipelineChart";
import { ForecastLineChart } from "@/components/forecast/ForecastLineChart";
import { ForecastDealsTable } from "@/components/forecast/ForecastDealsTable";
import { DollarSign, Target, BarChart3, AlertTriangle } from "lucide-react";

export default function Forecast() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1200);
    return () => clearTimeout(timer);
  }, []);

  return (
    <DashboardLayout>
      <div className="flex-1 p-6 space-y-6 overflow-auto">
        <VendasHeader activeTab={5} />

        {/* Metric cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <MetricCard
            title="Vendas Acumuladas"
            value="R$ 4.18M"
            subtitle="Realizado no período"
            icon={DollarSign}
            iconColor="text-primary"
            valueColor="text-primary"
            loading={loading}
          />
          <MetricCard
            title="Acumulado de Vendas"
            value="R$ 1.43M"
            subtitle="Forecast acumulado"
            icon={Target}
            iconColor="text-muted-foreground"
            valueColor="text-foreground"
            loading={loading}
          />
          <MetricCard
            title="% Atingimento"
            value="33.6%"
            subtitle="Da meta total"
            icon={BarChart3}
            iconColor="text-primary"
            valueColor="text-primary"
            loading={loading}
          />
          <MetricCard
            title="Restante da Meta"
            value="R$ 14k"
            subtitle="Para bater a meta"
            icon={AlertTriangle}
            iconColor="text-chart-forecast"
            valueColor="text-chart-forecast"
            loading={loading}
          />
        </div>

        {/* Resultado Acumulado por Equipe */}
        <ForecastEquipeChart loading={loading} />

        {/* MRR por Produto + Previsão por Fase */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ForecastMRRChart loading={loading} />
          <ForecastPipelineChart loading={loading} />
        </div>

        {/* Forecast vs Realizado line chart */}
        <ForecastLineChart loading={loading} />

        {/* Deals table */}
        <ForecastDealsTable loading={loading} />
      </div>
    </DashboardLayout>
  );
}
