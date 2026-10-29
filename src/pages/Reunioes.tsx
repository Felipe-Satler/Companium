import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { VendasHeader } from "@/components/vendas/VendasHeader";
import { MetricCard } from "@/components/MetricCard";
import { MetricasTimeVendedor } from "@/components/reunioes/MetricasTimeVendedor";
import { PerformanceReunioesChart } from "@/components/reunioes/PerformanceReunioesChart";
import { AnaliseHorarios } from "@/components/reunioes/AnaliseHorarios";
import { Calendar, Users, UserX, Eye, Trophy, Tv } from "lucide-react";

export default function Reunioes() {
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"produtividade" | "cohort">("produtividade");

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1200);
    return () => clearTimeout(timer);
  }, []);

  const filterTabs = ["Todos (1)", "Todos", "Todos (24)", "Todos (7)", "Todos", "Duração"];

  return (
    <DashboardLayout>
      <div className="flex-1 p-6 space-y-6 overflow-auto">
        <VendasHeader activeTab={1} />

        {/* Sub-filters: Produtividade/Cohort + period + extra filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setViewMode("produtividade")}
              className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${
                viewMode === "produtividade"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary border border-border"
              }`}
            >
              Produtividade
            </button>
            <button
              onClick={() => setViewMode("cohort")}
              className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${
                viewMode === "cohort"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary border border-border"
              }`}
            >
              Cohort
            </button>
          </div>
          <div className="h-4 w-px bg-border" />
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
            <Calendar className="h-3.5 w-3.5" />
            Mês atual
            <span className="text-muted-foreground">› 1–31 mar</span>
          </button>
          <div className="h-4 w-px bg-border" />
          {filterTabs.map((f, i) => (
            <button
              key={`${f}-${i}`}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md font-medium text-muted-foreground hover:text-foreground hover:bg-secondary border border-border transition-colors"
            >
              {f}
              <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none"><path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          ))}
        </div>

        {/* Metric cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
          <MetricCard
            title="Reuniões Agendadas"
            value="12.535"
            subtitle=""
            icon={Calendar}
            iconColor="text-primary"
            valueColor="text-foreground"
            loading={loading}
          />
          <MetricCard
            title="Reuniões Realizadas"
            value="2.554"
            subtitle="20.4% de realização"
            icon={Users}
            iconColor="text-primary"
            valueColor="text-foreground"
            loading={loading}
          />
          <MetricCard
            title="No-Shows"
            value="6.100"
            subtitle="70.5% taxa"
            icon={UserX}
            iconColor="text-red-600 dark:text-red-400"
            valueColor="text-foreground"
            loading={loading}
          />
          <MetricCard
            title="Taxa de Show"
            value="20.4%"
            subtitle=""
            icon={Eye}
            iconColor="text-primary"
            valueColor="text-foreground"
            loading={loading}
          />
          <MetricCard
            title="Real + Ganho"
            value="9.9%"
            subtitle=""
            icon={Trophy}
            iconColor="text-chart-forecast"
            valueColor="text-chart-forecast"
            loading={loading}
          />
        </div>

        {/* Métricas por Time e Vendedor */}
        <MetricasTimeVendedor loading={loading} />

        {/* Performance de Reuniões por Vendedor */}
        <PerformanceReunioesChart loading={loading} />

        {/* Análise de Horários */}
        <AnaliseHorarios loading={loading} />
      </div>
    </DashboardLayout>
  );
}
