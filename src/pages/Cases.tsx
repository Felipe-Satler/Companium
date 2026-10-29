import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { CasesMetricCard } from "@/components/cases/CasesMetricCard";
import { CasesProgressPanel } from "@/components/cases/CasesProgressPanel";
import { CasesEvolutionChart } from "@/components/cases/CasesEvolutionChart";
import { CasesPerformanceTable } from "@/components/cases/CasesPerformanceTable";
import {
  FileCheck,
  Target,
  TrendingUp,
  ClipboardList,
  Star,
  Eye,
  Zap,
  AlertTriangle,
  Calendar,
  RefreshCw,
} from "lucide-react";

export default function Cases() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 1200);
    return () => clearTimeout(t);
  }, []);

  if (loading) {
    return (
      <DashboardLayout>
        <div className="p-6 space-y-6">
          <div className="skeleton-loading h-12 w-80 rounded-lg" />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton-loading h-28 rounded-lg" />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="skeleton-loading h-16 rounded-lg" />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="skeleton-loading h-48 rounded-lg" />
            <div className="skeleton-loading h-48 rounded-lg" />
          </div>
          <div className="skeleton-loading h-64 rounded-lg" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/20">
              <ClipboardList className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Dashboard de Cases</h1>
              <p className="text-sm text-muted-foreground">Acompanhe a criação e aprovação de cases de sucesso</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 rounded-lg neu-card px-3 py-1.5">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs font-medium text-foreground">Mês atual</span>
              <span className="text-xs text-muted-foreground">• 1–31 mar</span>
            </div>
            <button className="p-2 rounded-lg neu-card hover:bg-secondary transition-colors">
              <RefreshCw className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Top Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <CasesMetricCard
            title="Cases Aprovados"
            value="26"
            subtitle="+ 0 em análise"
            icon={FileCheck}
            borderColor="border-emerald-500/50"
            valueColor="text-foreground"
          />
          <CasesMetricCard
            title="Meta do Período"
            value="64"
            subtitle="Faltam: 38 pts"
            icon={Target}
            borderColor="border-blue-500/50"
          />
          <CasesMetricCard
            title="% Atingimento"
            value="40%"
            icon={TrendingUp}
            borderColor="border-purple-500/50"
            valueColor="text-amber-600 dark:text-amber-400"
            progress={40}
            progressColor="bg-amber-400"
          />
          <CasesMetricCard
            title="Forecast Total"
            value="1"
            subtitle="Projeção: 27 / 64"
            icon={ClipboardList}
            borderColor="border-pink-500/50"
          />
        </div>

        {/* Secondary Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="neu-card rounded-lg p-4 flex items-center gap-3">
            <Star className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Total Ano</p>
              <p className="text-lg font-bold text-foreground">25</p>
            </div>
          </div>
          <div className="neu-card rounded-lg p-4 flex items-center gap-3">
            <Eye className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Publicados</p>
              <p className="text-lg font-bold text-foreground">25</p>
            </div>
          </div>
          <div className="neu-card rounded-lg p-4 flex items-center gap-3">
            <Star className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Destaques</p>
              <p className="text-lg font-bold text-foreground">0</p>
            </div>
          </div>
        </div>

        {/* Progress Panels */}
        <CasesProgressPanel />

        {/* Forecast Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <CasesMetricCard
            title="Forecast Total"
            value="1"
            subtitle="Projeção de pontos no período"
            icon={TrendingUp}
            borderColor="border-emerald-500/30"
          />
          <CasesMetricCard
            title="Forecast Hoje"
            value="0"
            subtitle="Projeção até hoje"
            icon={Zap}
            borderColor="border-blue-500/30"
          />
          <CasesMetricCard
            title="Gap p/ Meta"
            value="37"
            subtitle="Diferença entre projeção e meta (pts)"
            icon={AlertTriangle}
            borderColor="border-red-500/30"
            valueColor="text-red-600 dark:text-red-400"
          />
        </div>

        {/* Evolution Chart */}
        <CasesEvolutionChart />

        {/* Performance Table */}
        <CasesPerformanceTable />
      </div>
    </DashboardLayout>
  );
}
