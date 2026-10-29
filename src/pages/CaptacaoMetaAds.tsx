import { useMemo } from "react";
import { format, startOfMonth } from "date-fns";
import { Filter, X } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { CaptacaoHeader } from "@/components/captacao/CaptacaoHeader";
import { MetaAdsMetricsPanel } from "@/components/clientes/meta-ads/MetaAdsMetricsPanel";
import { MetaAdsEvolutionCharts } from "@/components/clientes/meta-ads/MetaAdsEvolutionCharts";
import { MetaAdsCampaignHierarchy } from "@/components/clientes/meta-ads/MetaAdsCampaignHierarchy";
import { MetaAdsInsightsAnuncios } from "@/components/clientes/meta-ads/MetaAdsInsightsAnuncios";
import { canonicalResultType, formatCampaignResultType } from "@/lib/metaAdsResultTypeLabels";
import { CaptacaoInvestimentoLeadsChart } from "@/components/captacao/CaptacaoInvestimentoLeadsChart";
import { CaptacaoPacingCard } from "@/components/captacao/CaptacaoPacingCard";
import { useMetaAdsClienteData } from "@/hooks/useMetaAdsClienteData";
import { useMetaAdsCriativosData } from "@/hooks/useMetaAdsCriativosData";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { usePersistedState } from "@/hooks/usePersistedState";
import { useCaptacaoDateRange } from "@/hooks/useCaptacaoDateRange";
import { useCaptacaoMeta } from "@/hooks/useCaptacaoMeta";
import { useAuth } from "@/contexts/AuthContext";
import { CAPTACAO_FILTER } from "@/lib/captacao";

export default function CaptacaoMetaAds() {
  // Filtro de DATA compartilhado entre as 3 telas da Captação (Metas, Meta Ads, Google Ads)
  // e persistido — muda numa tela, muda nas outras. O cliente segue fixo (Groohub).
  const { dateFrom, dateTo, setRange } = useCaptacaoDateRange();
  const [tipoResultadoFilter, setTipoResultadoFilter] = usePersistedState("captacaoMetaAds.tipoResultadoFilter", () => "all");

  const dateFromStr = dateFrom ? format(dateFrom, "yyyy-MM-dd") : undefined;
  const dateToStr = dateTo ? format(dateTo, "yyyy-MM-dd") : dateFromStr;

  const { data, totals, leadsCRMMeta, monthlyEvolution, campaignSummary, loading, error } =
    useMetaAdsClienteData(CAPTACAO_FILTER, dateFromStr, dateToStr);

  // Hierarquia Campanha → Conjunto → Anúncio a partir da tabela "Criativos Meta Ads" (mesmo
  // escopo de captação/data). Substitui a tabela plana de campanhas — igual à tela de clientes.
  const { campanhas: hierarquiaCampanhas, anuncios: hierarquiaAnuncios, crmSemCampanha, loading: loadingHierarquia } =
    useMetaAdsCriativosData(CAPTACAO_FILTER, dateFromStr, dateToStr);

  // Meta do Pacing (persistida em captacao_config; vazia até preencher). Segue o filtro de
  // data: target = soma das metas dos meses selecionados. Edição só p/ quem edita o CRM.
  const { canEditCrm } = useAuth();
  const {
    target: pacingTarget,
    monthTarget: pacingMonthTarget,
    editMonthLabel: pacingEditMonthLabel,
    saving: savingTarget,
    save: saveTarget,
  } = useCaptacaoMeta("meta", dateFrom, dateTo);

  // Opções do filtro de Tipo de Resultado — da HIERARQUIA ("Criativos Meta Ads"), mesma fonte
  // do rótulo e do número exibidos na tabela. Mesma regra da tela de clientes.
  const tiposResultado = useMemo(() => {
    const set = new Set<string>();
    for (const c of hierarquiaCampanhas) {
      const t = canonicalResultType(c.agg.tipoResultado);
      if (t) set.add(t);
    }
    return [...set].sort();
  }, [hierarquiaCampanhas]);

  const effectiveTipoResultado =
    tipoResultadoFilter === "all" || tiposResultado.includes(tipoResultadoFilter) ? tipoResultadoFilter : "all";

  const filteredCampaigns = useMemo(() => {
    if (effectiveTipoResultado === "all") return campaignSummary;
    const alvo = canonicalResultType(effectiveTipoResultado);
    return campaignSummary.filter((c) => canonicalResultType(c.tipoResultado) === alvo);
  }, [campaignSummary, effectiveTipoResultado]);

  // Cards superiores: reagrega os totais a partir das campanhas do tipo selecionado (mesma
  // regra da tela de clientes) pra os cards baterem com a tabela. Sem filtro → totals do hook.
  const displayTotals = useMemo(() => {
    if (effectiveTipoResultado === "all") return { ...totals, leadsCRMMeta };
    const sum = (sel: (c: (typeof filteredCampaigns)[number]) => number) =>
      filteredCampaigns.reduce((s, c) => s + (sel(c) || 0), 0);
    const spend = sum((c) => c.investimento);
    const leads = sum((c) => c.leadsTrafico);
    const impressions = sum((c) => c.impressoes);
    const clicks = sum((c) => c.cliques);
    const reach = totals.reach;
    const mensagens = sum((c) => c.mensagens);
    const visitas = sum((c) => c.visitas);
    const videoViews3s = sum((c) => c.videoViews3s);
    const videoViews95pct = sum((c) => c.videoViews95pct);
    const orcamento = sum((c) => c.orcamento);
    const resultados = leads + mensagens;
    return {
      spend,
      leads,
      impressions,
      clicks,
      reach,
      frequency: reach > 0 ? impressions / reach : 0,
      cpl: leads > 0 ? spend / leads : 0,
      cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      cpc: clicks > 0 ? spend / clicks : 0,
      videoViews3s,
      videoViews95pct,
      hook: impressions > 0 ? (videoViews3s / impressions) * 100 : 0,
      hold: impressions > 0 ? (videoViews95pct / impressions) * 100 : 0,
      retencao95: videoViews3s > 0 ? (videoViews95pct / videoViews3s) * 100 : 0,
      orcamento,
      mensagens,
      custoMensagem: mensagens > 0 ? spend / mensagens : 0,
      visitas,
      custoVisita: 0,
      resultados,
      custoResultado: resultados > 0 ? spend / resultados : 0,
      bounceLead: clicks > 0 ? leads / clicks - 1 : 0,
      bounceConversa: clicks > 0 ? mensagens / clicks - 1 : 0,
      qualityRanking: totals.qualityRanking,
      engagementRanking: totals.engagementRanking,
      conversionRanking: totals.conversionRanking,
      leadsCRMMeta,
    };
  }, [effectiveTipoResultado, filteredCampaigns, totals, leadsCRMMeta]);

  // Investimento total do PERÍODO selecionado (exclusivo do Meta Ads), independente do
  // filtro de tipo — base do pacing. totals.spend soma Valor_usado_BRL das linhas do período.
  const accumulatedPeriodo = totals.spend;

  if (loading) {
    return (
      <DashboardLayout>
        <div className="p-6 space-y-6">
          <CaptacaoHeader activeTab="Meta Ads" />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton-loading h-28 rounded-lg" />
            ))}
          </div>
          <div className="skeleton-loading h-64 rounded-lg" />
        </div>
      </DashboardLayout>
    );
  }

  if (error) {
    return (
      <DashboardLayout>
        <div className="p-6">
          <CaptacaoHeader activeTab="Meta Ads" />
          <div className="neu-card rounded-lg p-8 text-center mt-6">
            <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const hasFilters = !!dateFrom || !!dateTo || effectiveTipoResultado !== "all";

  return (
    <DashboardLayout>
      <div className="p-6 pb-28 space-y-6">
        <CaptacaoHeader activeTab="Meta Ads" />

        {/* Filtros */}
        <div className="neu-card rounded-xl p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold text-foreground">Filtros</span>
            </div>
            <span className="text-[11px] text-muted-foreground">
              Cliente fixo: <span className="font-semibold text-primary">Groohub</span>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <DateRangePicker
              from={dateFrom}
              to={dateTo}
              onChange={({ from, to }) => setRange(from, to)}
            />

            {tiposResultado.length > 0 && (
              <SearchableSelect
                value={effectiveTipoResultado}
                onValueChange={setTipoResultadoFilter}
                options={tiposResultado.map((t) => ({ value: t, label: formatCampaignResultType(t) }))}
                placeholder="Todos os tipos"
                searchPlaceholder="Buscar tipo..."
                emptyText="Nenhum tipo encontrado."
                allOption={{ value: "all", label: "Todos os tipos" }}
              />
            )}

            {hasFilters && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setRange(startOfMonth(new Date()), new Date());
                  setTipoResultadoFilter("all");
                }}
                className="flex items-center gap-1.5 text-xs font-medium bg-destructive/10 border-destructive/30 text-destructive hover:bg-destructive/20 hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" />
                Limpar filtros
              </Button>
            )}
          </div>
        </div>

        {/* KPIs */}
        <MetaAdsMetricsPanel totals={displayTotals} />

        {/* Investimento vs Leads + Pacing mensal */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <CaptacaoInvestimentoLeadsChart data={data} />
          <CaptacaoPacingCard
            accumulated={accumulatedPeriodo}
            target={pacingTarget}
            monthTarget={pacingMonthTarget}
            editMonthLabel={pacingEditMonthLabel}
            periodFrom={dateFrom}
            periodTo={dateTo}
            canEdit={canEditCrm}
            saving={savingTarget}
            onSave={saveTarget}
          />
        </div>

        {/* Evolução mensal */}
        <MetaAdsEvolutionCharts data={monthlyEvolution} />

        {/* Campanhas: hierarquia Campanha → Conjunto → Anúncio (tabela "Criativos Meta Ads") */}
        <MetaAdsCampaignHierarchy
          campanhas={hierarquiaCampanhas}
          tipoResultado={effectiveTipoResultado}
          crmSemCampanha={crmSemCampanha}
          loading={loadingHierarquia}
        />

        {/* Insights dos Anúncios: cards de criativos com filtros/ordenação (tabela "Criativos Meta Ads") */}
        <MetaAdsInsightsAnuncios anuncios={hierarquiaAnuncios} loading={loadingHierarquia} />
      </div>
    </DashboardLayout>
  );
}
