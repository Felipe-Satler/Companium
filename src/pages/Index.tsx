import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { MetricCard } from "@/components/MetricCard";
import { RevenueChart } from "@/components/RevenueChart";
import { LastSalesPanel } from "@/components/LastSalesPanel";
import { DollarSign, Target, BarChart3, AlertTriangle, Monitor } from "lucide-react";

export default function Index() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1200);
    return () => clearTimeout(timer);
  }, []);

  return (
    <DashboardLayout>
      <div className="flex flex-col lg:flex-row h-full">
        {/* Main content */}
        <div className="flex-1 p-6 space-y-6 overflow-auto">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <span className="neu-chip mb-1">
                Receita
              </span>
              <p className="text-sm text-muted-foreground">
                Visão consolidada de faturamento e metas
              </p>
            </div>
            <button className="neu-button flex items-center gap-2 px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              <Monitor className="h-4 w-4" />
              Modo TV
            </button>
          </div>

          {/* Metric cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <MetricCard
              title="Receita Acumulada"
              value="R$ 10.442.045"
              subtitle="Realizado no período"
              icon={DollarSign}
              iconColor="text-primary"
              valueColor="text-primary"
              loading={loading}
            />
            <MetricCard
              title="Meta do Período"
              value="R$ 15.000.000"
              subtitle="Objetivo total"
              icon={Target}
              iconColor="text-muted-foreground"
              valueColor="text-foreground"
              loading={loading}
            />
            <MetricCard
              title="% Atingimento"
              value="69.6%"
              subtitle="Da meta total"
              icon={BarChart3}
              iconColor="text-primary"
              valueColor="text-primary"
              loading={loading}
            />
            <MetricCard
              title="Restante da Meta"
              value="R$ 4.557.955"
              subtitle="Para bater a meta"
              icon={AlertTriangle}
              iconColor="text-chart-forecast"
              valueColor="text-chart-forecast"
              loading={loading}
            />
          </div>

          {/* Chart */}
          <RevenueChart loading={loading} />
        </div>

        {/* Right panel */}
        <div className="w-full lg:w-80 xl:w-96 border-t lg:border-t-0 lg:border-l border-border">
          <div className="h-full p-4">
            <LastSalesPanel loading={loading} />
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
