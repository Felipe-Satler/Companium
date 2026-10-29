import { useState, useEffect, useMemo } from "react";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { Filter, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ClientesHeader } from "@/components/clientes/ClientesHeader";
import { GoogleAdsMetricsPanel } from "@/components/clientes/google-ads/GoogleAdsMetricsPanel";
import { GoogleAdsComparacao, GoogleCompareSide } from "@/components/clientes/google-ads/GoogleAdsComparacaoPeriodos";
import { GoogleAdsEvolutionCharts } from "@/components/clientes/google-ads/GoogleAdsEvolutionCharts";
import { GoogleAdsCampaignTable } from "@/components/clientes/google-ads/GoogleAdsCampaignTable";
import { CaptacaoInvestimentoLeadsChart } from "@/components/captacao/CaptacaoInvestimentoLeadsChart";
import { useGoogleAdsClienteData } from "@/hooks/useGoogleAdsClienteData";
import { useAuth } from "@/contexts/AuthContext";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { MedicoMultiSelect } from "@/components/clientes/MedicoMultiSelect";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { CarteiraToggle } from "@/components/clientes/CarteiraToggle";
import { externalSupabase } from "@/integrations/external-supabase/client";
import { usePersistedState } from "@/hooks/usePersistedState";
import { useClientesFilters } from "@/contexts/ClientesFiltersContext";
import { buildAdsClientOptions, clientCmpKey, prettyClientLabel } from "@/data/clienteAliases";
import { periodLabel } from "@/utils/dateRange";

// Modos do SELECT de comparação: "off" = desligado; "periodo" = mesmo cliente em duas janelas;
// "cliente" = dois clientes no período atual. (Especialidade/maturidade ficam p/ a fase 2.)
type AdsCompareMode = "off" | "periodo" | "cliente";

export default function ClientesGoogleAds() {
  // Cliente/médico/período vêm dos filtros COMPARTILHADOS (valem em todas as telas de
  // /clientes). O "tipo de resultado" é específico desta tela → continua local.
  const { filters, patch, clear } = useClientesFilters();
  const clientFilter = filters.client; // slug canônico ("all" = todos)
  const medicoFilter = filters.medico;
  const dateFrom = filters.dateFrom;
  const dateTo = filters.dateTo;
  const [tipoResultadoFilter, setTipoResultadoFilter] = usePersistedState("clientesGoogleAds.tipoResultadoFilter", () => "all");
  const [clients, setClients] = useState<string[]>([]);

  // Dropdown de cliente em forma CANÔNICA (mesma identidade das outras telas). `rawByCmpKey`
  // traduz o slug escolhido de volta p/ um nome cru da conta — necessário pro fetch do hook.
  const { options: clientOptions, rawByCmpKey } = useMemo(() => buildAdsClientOptions(clients, "google"), [clients]);
  const clientCmp = clientFilter !== "all" ? clientCmpKey(clientFilter) : null;
  const clientForUI = clientFilter === "all"
    ? "all"
    : (clientOptions.find((o) => clientCmpKey(o.value) === clientCmp)?.value ?? clientFilter);
  const clientForHook = clientFilter === "all"
    ? "all"
    : ((clientCmp && rawByCmpKey.get(clientCmp)?.[0]) ?? clientFilter);

  // COMPARAÇÃO de períodos — LOCAL desta tela (não entra nos filtros compartilhados). Período
  // A = filtro corrente; B = período escolhido no seletor roxo. Ao ligar, sugere o mês anterior.
  const [compareMode, setCompareMode] = useState<AdsCompareMode>("off");
  const [compareFrom, setCompareFrom] = useState<Date | undefined>(undefined);
  const [compareTo, setCompareTo] = useState<Date | undefined>(undefined);
  const [cmpClientA, setCmpClientA] = useState<string>("");
  const [cmpClientB, setCmpClientB] = useState<string>("");
  const onChangeCompareMode = (m: AdsCompareMode) => {
    setCompareMode(m);
    if (m === "periodo" && !compareFrom) {
      const base = dateFrom ?? new Date();
      setCompareFrom(startOfMonth(subMonths(base, 1)));
      setCompareTo(endOfMonth(subMonths(base, 1)));
    }
  };

  useEffect(() => {
    async function fetchClients() {
      const unique = new Set<string>();
      const pageSize = 1000;
      let from = 0;
      for (let i = 0; i < 100; i++) {
        const { data, error } = await externalSupabase
          .from("v_meta_google_ads")
          .select("Client")
          .eq("Fonte_Ads", "Google")
          .range(from, from + pageSize - 1);
        if (error || !data || data.length === 0) break;
        for (const r of data as any[]) if (r.Client) unique.add(r.Client);
        if (data.length < pageSize) break;
        from += pageSize;
      }
      setClients([...unique].sort());
    }
    fetchClients();
  }, []);

  const dateFromStr = dateFrom ? format(dateFrom, "yyyy-MM-dd") : undefined;
  // Sem `to` (seleção de dia único) → colapsa para from..from.
  const dateToStr = dateTo ? format(dateTo, "yyyy-MM-dd") : dateFromStr;

  const { data, totals, monthlyEvolution, campaignSummary, medicos, loading, error } = useGoogleAdsClienteData(clientForHook, dateFromStr, dateToStr, medicoFilter);

  const { clientUser, canCompararPeriodos } = useAuth();

  // Converte um slug canônico no nome CRU da conta (o que o hook usa p/ o fetch). Mesma derivação
  // do `clientForHook`, para um cliente qualquer (lados da comparação cliente×cliente).
  const hookFor = (slug: string) => {
    if (!slug || slug === "all") return "all";
    const cmp = clientCmpKey(slug);
    return rawByCmpKey.get(cmp)?.[0] ?? slug;
  };

  // Operandos da comparação (lado A e lado B). null = desligada / operando faltando → o painel
  // não aparece. "periodo": mesmo cliente, duas janelas; "cliente": dois clientes, período atual.
  const compareSides = useMemo<{ a: GoogleCompareSide; b: GoogleCompareSide } | null>(() => {
    if (!canCompararPeriodos || compareMode === "off") return null;
    if (!dateFromStr || !dateToStr) return null;
    if (compareMode === "periodo") {
      if (!compareFrom || !compareTo) return null;
      return {
        a: { label: periodLabel(dateFrom, dateTo), clientForHook, from: dateFromStr, to: dateToStr, medicoFilter },
        b: { label: periodLabel(compareFrom, compareTo), clientForHook, from: format(compareFrom, "yyyy-MM-dd"), to: format(compareTo, "yyyy-MM-dd"), medicoFilter },
      };
    }
    if (!cmpClientA || !cmpClientB) return null;
    return {
      a: { label: prettyClientLabel(cmpClientA), clientForHook: hookFor(cmpClientA), from: dateFromStr, to: dateToStr },
      b: { label: prettyClientLabel(cmpClientB), clientForHook: hookFor(cmpClientB), from: dateFromStr, to: dateToStr },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCompararPeriodos, compareMode, dateFromStr, dateToStr, dateFrom, dateTo, compareFrom, compareTo, clientForHook, medicoFilter, cmpClientA, cmpClientB, rawByCmpKey]);

  const tiposResultado = useMemo(() => {
    const set = new Set<string>();
    for (const c of campaignSummary) {
      if (c.tipoResultado && c.tipoResultado !== "—") set.add(c.tipoResultado);
    }
    return [...set].sort();
  }, [campaignSummary]);

  const filteredCampaigns = useMemo(() => {
    if (tipoResultadoFilter === "all") return campaignSummary;
    return campaignSummary.filter((c) => c.tipoResultado === tipoResultadoFilter);
  }, [campaignSummary, tipoResultadoFilter]);

  if (loading) {
    return (
      <DashboardLayout>
        <div className="p-6 space-y-6">
          <ClientesHeader activeTab="Google Ads" />
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
          <ClientesHeader activeTab="Google Ads" />
          <div className="neu-card rounded-lg p-8 text-center mt-6">
            <p className="text-destructive text-sm">{error}</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <ClientesHeader activeTab="Google Ads" />

        {/* Filters */}
        <div className="neu-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">Filtros</span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <CarteiraToggle />
            <DateRangePicker
              from={dateFrom}
              to={dateTo}
              onChange={({ from, to }) => patch({ dateFrom: from, dateTo: to })}
            />

            {clientUser ? (
              <span className="neu-inset rounded-lg px-3 py-1.5 text-xs text-muted-foreground">
                Cliente: <span className="font-semibold text-primary">{prettyClientLabel(clientFilter)}</span>
              </span>
            ) : (
              <SearchableSelect
                value={clientForUI}
                onValueChange={(v) => patch({ client: v, medico: [] })}
                options={clientOptions}
                placeholder="Todos os clientes"
                searchPlaceholder="Buscar cliente..."
                emptyText="Nenhum cliente encontrado."
                allOption={{ value: "all", label: "Todos os clientes" }}
              />
            )}

            {medicos.length > 1 && (
              <MedicoMultiSelect
                value={medicoFilter}
                onChange={(v) => patch({ medico: v })}
                options={medicos}
              />
            )}

            {tiposResultado.length > 0 && (
              <SearchableSelect
                value={tipoResultadoFilter}
                onValueChange={setTipoResultadoFilter}
                options={tiposResultado.map((t) => ({ value: t, label: t }))}
                placeholder="Todos os tipos"
                searchPlaceholder="Buscar tipo..."
                emptyText="Nenhum tipo encontrado."
                allOption={{ value: "all", label: "Todos os tipos" }}
              />
            )}

            {/* COMPARAÇÃO — no FIM da linha de filtros. Um select escolhe O QUE comparar; cada
                modo revela seus operandos (lado A vs lado B). Só p/ quem foi LIBERADO na
                Administração (canCompararPeriodos). */}
            {canCompararPeriodos && (
              <>
                <SearchableSelect
                  value={compareMode}
                  onValueChange={(v) => onChangeCompareMode(v as AdsCompareMode)}
                  options={[
                    { value: "off", label: "Sem comparação" },
                    { value: "periodo", label: "Comparar períodos" },
                    { value: "cliente", label: "Comparar clientes" },
                  ]}
                  placeholder="Comparar..."
                  searchPlaceholder="Buscar modo..."
                  emptyText="Nenhum modo."
                  allOption={null}
                  triggerClassName={cn(compareMode !== "off" && "ring-1 ring-violet-500/40 text-violet-600 dark:text-violet-400")}
                />

                {compareMode === "periodo" && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-[11px] font-medium text-violet-600 dark:text-violet-400">vs</span>
                    <DateRangePicker
                      from={compareFrom}
                      to={compareTo}
                      onChange={({ from, to }) => { setCompareFrom(from); setCompareTo(to); }}
                      placeholder="Período de comparação"
                      className="border border-violet-500/40 text-violet-600 dark:text-violet-400"
                    />
                  </span>
                )}

                {compareMode === "cliente" && (
                  <span className="inline-flex items-center gap-1.5">
                    <SearchableSelect
                      value={cmpClientA}
                      onValueChange={setCmpClientA}
                      options={clientOptions.filter((o) => o.value !== "all")}
                      placeholder="Cliente A"
                      searchPlaceholder="Buscar cliente..."
                      emptyText="Nenhum cliente."
                      allOption={null}
                    />
                    <span className="text-[11px] font-medium text-violet-600 dark:text-violet-400">vs</span>
                    <SearchableSelect
                      value={cmpClientB}
                      onValueChange={setCmpClientB}
                      options={clientOptions.filter((o) => o.value !== "all")}
                      placeholder="Cliente B"
                      searchPlaceholder="Buscar cliente..."
                      emptyText="Nenhum cliente."
                      allOption={null}
                    />
                  </span>
                )}
              </>
            )}

            {(dateFrom || dateTo || clientFilter !== "all" || medicoFilter.length > 0 || tipoResultadoFilter !== "all" || compareMode !== "off") && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => { clear(); setTipoResultadoFilter("all"); setCompareMode("off"); setCmpClientA(""); setCmpClientB(""); }}
                className="flex items-center gap-1.5 text-xs font-medium bg-destructive/10 border-destructive/30 text-destructive hover:bg-destructive/20 hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" />
                Limpar filtros
              </Button>
            )}
          </div>
        </div>

        {/* Comparação (A vs B). Montada só quando o modo está ligado e ambos os operandos foram
            escolhidos (compareSides != null) — os hooks dos dois lados só disparam aqui. */}
        {compareSides && (
          <GoogleAdsComparacao sideA={compareSides.a} sideB={compareSides.b} />
        )}

        {/* Metrics */}
        <GoogleAdsMetricsPanel totals={totals} />

        {/* Investimento vs Leads gerados (mesmo gráfico da Captação) */}
        <CaptacaoInvestimentoLeadsChart data={data} />

        {/* Charts */}
        <GoogleAdsEvolutionCharts data={monthlyEvolution} />

        {/* Campaign table — conta de cliente (clientUser) NÃO vê a tabela de Campanha.
            Equipe (clientUser=null) vê normal. */}
        {!clientUser && <GoogleAdsCampaignTable campaigns={filteredCampaigns} />}
      </div>
    </DashboardLayout>
  );
}
