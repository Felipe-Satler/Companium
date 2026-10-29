import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { MetricCard } from "@/components/MetricCard";
import { VendasHeader } from "@/components/vendas/VendasHeader";
import { VendasChart } from "@/components/vendas/VendasChart";
import { TipoNegocioCard } from "@/components/vendas/TipoNegocioCard";
import { RankingPlanoCard } from "@/components/vendas/RankingPlanoCard";
import { QuantidadeVendidaCard } from "@/components/vendas/QuantidadeVendidaCard";
import { FunilVendas } from "@/components/vendas/FunilVendas";
import { ProducaoTrimestral } from "@/components/vendas/ProducaoTrimestral";
import { TaxasConversao } from "@/components/vendas/TaxasConversao";
import { LeaderboardMensal } from "@/components/vendas/LeaderboardMensal";
import { DetalhesVendasMensais } from "@/components/vendas/DetalhesVendasMensais";
import { AnalisePerdas } from "@/components/vendas/AnalisePerdas";
import { MetricasDetalhadas } from "@/components/vendas/MetricasDetalhadas";
import { DollarSign, Target, BarChart3, AlertTriangle } from "lucide-react";

export default function Vendas() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1200);
    return () => clearTimeout(timer);
  }, []);

  return (
    <DashboardLayout>
      <div className="flex-1 p-6 space-y-6 overflow-auto">
        <VendasHeader />

        {/* Section: Visão Geral da Operação */}
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-primary" />
          <h3 className="text-sm font-medium text-foreground">Visão Geral da Operação</h3>
        </div>

        {/* Metric cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <MetricCard
            title="Vendas Acumuladas"
            value="R$ 10.442.049"
            subtitle="Realizado no período"
            icon={DollarSign}
            iconColor="text-primary"
            valueColor="text-primary"
            loading={loading}
          />
          <MetricCard
            title="Meta do Período"
            value="R$ 10.442.049"
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

        {/* Sales Accumulated Chart */}
        <VendasChart loading={loading} />

        {/* 3-card row: Tipo de Negócio, Ranking por Plano, Quantidade Vendida */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <TipoNegocioCard loading={loading} />
          <RankingPlanoCard loading={loading} />
          <QuantidadeVendidaCard loading={loading} />
        </div>

        {/* Funil de Vendas */}
        <FunilVendas loading={loading} />

        {/* Produção Trimestral */}
        <ProducaoTrimestral loading={loading} />

        {/* Taxas de Conversão */}
        <TaxasConversao loading={loading} />

        {/* Leaderboard Mensal */}
        <LeaderboardMensal loading={loading} />

        {/* Detalhes das Vendas Mensais */}
        <DetalhesVendasMensais loading={loading} />

        {/* Análise de Perdas */}
        <AnalisePerdas loading={loading} />

        {/* Métricas Detalhadas */}
        <MetricasDetalhadas loading={loading} />
      </div>
    </DashboardLayout>
  );
}
