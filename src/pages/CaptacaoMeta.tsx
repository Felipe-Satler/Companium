import { DashboardLayout } from "@/components/DashboardLayout";
import { CaptacaoHeader } from "@/components/captacao/CaptacaoHeader";
import MetaPage from "@/components/meta/MetaPage";

/**
 * Captação › Meta — Real x Planejado da captação (mídia própria da Groohub).
 * Página padrão da seção Captação (abre ao clicar em "Captação"). Metas
 * preenchidas manualmente e persistidas em `captacao_metas` (Supabase companium-db).
 */
export default function CaptacaoMeta() {
  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <CaptacaoHeader activeTab="Metas" />
        <MetaPage />
      </div>
    </DashboardLayout>
  );
}
