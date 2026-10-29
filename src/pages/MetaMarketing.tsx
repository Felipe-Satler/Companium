import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { MetaMarketingHeader } from "@/components/meta-marketing/MetaMarketingHeader";
import { MetaMQLCard } from "@/components/meta-marketing/MetaMQLCard";
import { MetaReunioesCard } from "@/components/meta-marketing/MetaReunioesCard";
import { MetaSocialSection } from "@/components/meta-marketing/MetaSocialSection";
import { MetaEvolucaoCanal } from "@/components/meta-marketing/MetaEvolucaoCanal";
import { MetaMidiaPaga } from "@/components/meta-marketing/MetaMidiaPaga";

export default function MetaMarketing() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 1200);
    return () => clearTimeout(t);
  }, []);

  if (loading) {
    return (
      <DashboardLayout>
        <div className="p-6 space-y-6">
          <div className="skeleton-loading h-10 w-72 rounded-lg" />
          <div className="skeleton-loading h-10 w-full rounded-lg" />
          <div className="skeleton-loading h-80 rounded-lg" />
          <div className="skeleton-loading h-80 rounded-lg" />
          <div className="skeleton-loading h-64 rounded-lg" />
          <div className="skeleton-loading h-96 rounded-lg" />
          <div className="skeleton-loading h-64 rounded-lg" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <MetaMarketingHeader />
        <h2 className="text-lg font-bold text-foreground">Metas Gerais</h2>
        <MetaMQLCard />
        <MetaReunioesCard />
        <MetaSocialSection />
        <MetaEvolucaoCanal />
        <MetaMidiaPaga />
      </div>
    </DashboardLayout>
  );
}
