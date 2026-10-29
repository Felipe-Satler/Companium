import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { PaidMediaKPIs } from "@/components/paid-media/PaidMediaKPIs";
import { PaidMediaEvolucao } from "@/components/paid-media/PaidMediaEvolucao";
import { PaidMediaCaptacaoMQL } from "@/components/paid-media/PaidMediaCaptacaoMQL";
import { PaidMediaHeatmap } from "@/components/paid-media/PaidMediaHeatmap";
import { PaidMediaCreativos } from "@/components/paid-media/PaidMediaCreativos";
import { PaidMediaVideoEngagement } from "@/components/paid-media/PaidMediaVideoEngagement";
import { PaidMediaAudiencia } from "@/components/paid-media/PaidMediaAudiencia";

export default function PaidMedia() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1200);
    return () => clearTimeout(timer);
  }, []);

  return (
    <DashboardLayout>
      <div className="flex-1 p-6 space-y-6 overflow-auto">
        <MarketingHeader activeTab="Paid Media" />

        {/* Sub-tabs for Paid Media */}
        <div className="flex items-center gap-1 flex-wrap">
          {["Plataformas +Topo", "Geral", "Facebook Ads", "Google Ads"].map((t, i) => (
            <button
              key={t}
              className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${
                i === 1 ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary border border-border/50"
              }`}
            >
              {t}
            </button>
          ))}
          <button className="px-3 py-1.5 text-xs rounded-md font-semibold bg-cyan-500 text-white">Cohort</button>
          <button className="px-3 py-1.5 text-xs rounded-md font-medium text-muted-foreground hover:bg-secondary border border-border/50">Produtividade</button>
          <button className="px-3 py-1.5 text-xs rounded-md font-medium text-muted-foreground hover:bg-secondary border border-border/50 flex items-center gap-1">
            Somos
          </button>
        </div>

        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="h-48 rounded-xl skeleton-loading" />
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            <PaidMediaKPIs />
            <PaidMediaEvolucao />
            <PaidMediaCaptacaoMQL />
            <PaidMediaHeatmap />

            {/* Seção: Análise de Criativos */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>📊 Análise de Criativos para o Melhor Resultado</span>
            </div>
            <PaidMediaCreativos />

            {/* Seção: Análise Avançada */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>📊 Análise Avançada para o Melhor Resultado, Audiência, MQL</span>
            </div>
            <PaidMediaVideoEngagement />

            <PaidMediaAudiencia />
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
