import { useMemo } from "react";
import { format, startOfMonth } from "date-fns";
import { Filter, X } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { CaptacaoHeader } from "@/components/captacao/CaptacaoHeader";
import { GoogleAdsMetricsPanel } from "@/components/clientes/google-ads/GoogleAdsMetricsPanel";
import { GoogleAdsEvolutionCharts } from "@/components/clientes/google-ads/GoogleAdsEvolutionCharts";
import { GoogleAdsCampaignTable } from "@/components/clientes/google-ads/GoogleAdsCampaignTable";
import { CaptacaoInvestimentoLeadsChart } from "@/components/captacao/CaptacaoInvestimentoLeadsChart";
import { CaptacaoPacingCard } from "@/components/captacao/CaptacaoPacingCard";
import { useGoogleAdsClienteData } from "@/hooks/useGoogleAdsClienteData";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { usePersistedState } from "@/hooks/usePersistedState";
import { useCaptacaoDateRange } from "@/hooks/useCaptacaoDateRange";
import { useCaptacaoMeta } from "@/hooks/useCaptacaoMeta";
import { useAuth } from "@/contexts/AuthContext";
import { CAPTACAO_FILTER } from "@/lib/captacao";

export default function CaptacaoGoogleAds() {
  // Filtro de DATA compartilhado entre as 3 telas da Captação (Metas, Meta Ads, Google Ads)
  // e persistido — muda numa tela, muda nas outras. O cliente segue fixo (Groohub).
  const { dateFrom, dateTo, setRange } = useCaptacaoDateRange();
  const [tipoResultadoFilter, setTipoResultadoFilter] = usePersistedState("captacaoGoogleAds.tipoResultadoFilter", () => "all");

  const dateFromStr = dateFrom ? format(dateFrom, "yyyy-MM-dd") : undefined;
  const dateToStr = dateTo ? format(dateTo, "yyyy-MM-dd") : dateFromStr;

  const { data, totals, monthlyEvolution, campaignSummary, loading, error } =
    useGoogleAdsClienteData(CAPTACAO_FILTER, dateFromStr, dateToStr);

  // Meta do Pacing (persistida em captacao_config; vazia até preencher). Segue o filtro de
  // data: target = soma das metas dos meses selecionados. Edição só p/ quem edita o CRM.
  const { canEditCrm } = useAuth();
  const {
    target: pacingTarget,
    monthTarget: pacingMonthTarget,
    editMonthLabel: pacingEditMonthLabel,
    saving: savingTarget,
    save: saveTarget,
  } = useCaptacaoMeta("google", dateFrom, dateTo);

  const tiposResultado = useMemo(() => {
    const set = new Set<string>();
    for (const c of campaignSummary) {
      if (c.tipoResultado && c.tipoResultado !== "—") set.add(c.tipoResultado);
    }
    return [...set].sort();
  }, [campaignSummary]);

  const effectiveTipoResultado =
    tipoResultadoFilter === "all" || tiposResultado.includes(tipoResultadoFilter) ? tipoResultadoFilter : "all";

  const filteredCampaigns = useMemo(() => {
    if (effectiveTipoResultado === "all") return campaignSummary;
    return campaignSummary.filter((c) => c.tipoResultado === effectiveTipoResultado);
  }, [campaignSummary, effectiveTipoResultado]);

  // Investimento total do PERÍODO selecionado (exclusivo do Google Ads) — base do pacing.
  // totals.spend soma Valor_usado_BRL das linhas do período.
  const accumulatedPeriodo = totals.spend;

  if (loading) {
    return (
      <DashboardLayout>
        <div className="p-6 space-y-6">
          <CaptacaoHeader activeTab="Google Ads" />
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
          <CaptacaoHeader activeTab="Google Ads" />
          <div className="neu-card rounded-lg p-8 text-center mt-6">
            <p className="text-destructive text-sm">{error}</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const hasFilters = !!dateFrom || !!dateTo || effectiveTipoResultado !== "all";

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <CaptacaoHeader activeTab="Google Ads" />

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
                options={tiposResultado.map((t) => ({ value: t, label: t }))}
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
        <GoogleAdsMetricsPanel totals={totals} />

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
        <GoogleAdsEvolutionCharts data={monthlyEvolution} />

        {/* Campanhas */}
        <GoogleAdsCampaignTable campaigns={filteredCampaigns} />
      </div>
    </DashboardLayout>
  );
}
