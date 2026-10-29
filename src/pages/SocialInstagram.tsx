import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { SocialContasMonitoradas } from "@/components/social/SocialContasMonitoradas";
import { SocialMetricsConsolidadas } from "@/components/social/SocialMetricsConsolidadas";
import { SocialEvolucaoTemporal } from "@/components/social/SocialEvolucaoTemporal";
import { SocialComparativo } from "@/components/social/SocialComparativo";
import { SocialEngajamento } from "@/components/social/SocialEngajamento";
import { SocialPerformanceTipo } from "@/components/social/SocialPerformanceTipo";
import { SocialTopPosts } from "@/components/social/SocialTopPosts";
import { SocialInsights } from "@/components/social/SocialInsights";

const platformTabs = ["Instagram", "YouTube", "LinkedIn", "Metas", "Google de Metas", "Importar", "Clonar"];

export default function SocialInstagram() {
  const [loading, setLoading] = useState(true);
  const [activePlatform, setActivePlatform] = useState("Instagram");

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1200);
    return () => clearTimeout(timer);
  }, []);

  return (
    <DashboardLayout>
      <div className="flex-1 p-6 space-y-6 overflow-auto">
        <MarketingHeader activeTab="Social" />

        {/* Platform sub-tabs */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            {platformTabs.map((t) => (
              <button
                key={t}
                onClick={() => setActivePlatform(t)}
                className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${
                  activePlatform === t ? "bg-pink-500 text-white" : "text-muted-foreground hover:bg-secondary border border-border/50"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span>📊 Métricas: • 1 mês</span>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 text-xs">
          <button className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-secondary text-foreground border border-border">
            🔍 Todas as contas ▼
          </button>
          <span className="flex items-center gap-1 px-2 py-1 rounded bg-destructive/20 text-destructive text-[10px] font-medium">ⓘ 73%</span>
        </div>

        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-48 rounded-xl skeleton-loading" />
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            <SocialContasMonitoradas />
            <SocialMetricsConsolidadas />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <SocialEvolucaoTemporal />
              <SocialComparativo />
            </div>

            <SocialEngajamento />
            <SocialPerformanceTipo />
            <SocialTopPosts />
            <SocialInsights />
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
