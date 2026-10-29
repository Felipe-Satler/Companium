import { useState, useEffect, useMemo } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon, Filter, X, Facebook, Chrome } from "lucide-react";
import { useClientesVisiveis } from "@/hooks/useClientesVisiveis";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ClientesHeader } from "@/components/clientes/ClientesHeader";
import { MetaAdsCampaignTable } from "@/components/clientes/meta-ads/MetaAdsCampaignTable";
import { GoogleAdsCampaignTable } from "@/components/clientes/google-ads/GoogleAdsCampaignTable";
import { PerformanceKPICards } from "@/components/clientes/performance/PerformanceKPICards";
import { PerformanceEvolutionCharts } from "@/components/clientes/performance/PerformanceEvolutionCharts";
import { PerformanceEfficiencyBars } from "@/components/clientes/performance/PerformanceEfficiencyBars";
import { MetricInfoTooltip } from "@/components/clientes/performance/MetricInfoTooltip";
import { useMetaAdsClienteData } from "@/hooks/useMetaAdsClienteData";
import { useGoogleAdsClienteData } from "@/hooks/useGoogleAdsClienteData";
import { useCRMClienteData } from "@/hooks/useCRMClienteData";
import { canonicalizeAdsClient, isExcludedClient, buildAdsClientOptions, clientCmpKey } from "@/data/clienteAliases";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { externalSupabase } from "@/integrations/external-supabase/client";
import { useClientesFilters } from "@/contexts/ClientesFiltersContext";

function fmt(val: number) {
  // Sempre o valor inteiro exato (com separador de milhar), sem abreviar p/ "Mil"/"Mi".
  return val.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

function fmtInt(val: number) {
  return val.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

function fmtCurrency(val: number) {
  return val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtDecimal(val: number, digits = 2) {
  return val.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

interface MetricRowProps {
  label: string;
  metaValue: string;
  googleValue: string;
  totalValue?: string;
  highlightBetter?: "lower" | "higher" | null;
  metaRaw?: number;
  googleRaw?: number;
  tooltip?: string;
}

function MetricRow({ label, metaValue, googleValue, totalValue, highlightBetter, metaRaw, googleRaw, tooltip }: MetricRowProps) {
  let metaWins = false;
  let googleWins = false;
  if (highlightBetter && metaRaw != null && googleRaw != null && metaRaw > 0 && googleRaw > 0) {
    if (highlightBetter === "lower") {
      metaWins = metaRaw < googleRaw;
      googleWins = googleRaw < metaRaw;
    } else {
      metaWins = metaRaw > googleRaw;
      googleWins = googleRaw > metaRaw;
    }
  }

  return (
    <div className="grid grid-cols-[1fr_auto_1fr_120px] items-center gap-3 py-3 border-b border-border/30 last:border-b-0">
      <div className={cn("text-right text-sm font-semibold tabular-nums", metaWins ? "text-primary" : "text-foreground")}>
        {metaValue}
      </div>
      <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground uppercase tracking-wider min-w-[110px] px-2">
        <span>{label}</span>
        {tooltip && <MetricInfoTooltip text={tooltip} />}
      </div>
      <div className={cn("text-left text-sm font-semibold tabular-nums", googleWins ? "text-primary" : "text-foreground")}>
        {googleValue}
      </div>
      <div className="text-right text-sm font-bold tabular-nums text-foreground/90 pr-2">
        {totalValue ?? "—"}
      </div>
    </div>
  );
}

export default function ClientesPerformance() {
  // Recalcula quando a carteira visível (projetos_lista ATIVO + clientes_ocultos) chega.
  const visVersao = useClientesVisiveis();
  // Cliente/período vêm dos filtros COMPARTILHADOS (valem em todas as telas de /clientes).
  const { filters, patch, clear } = useClientesFilters();
  const clientFilter = filters.client; // slug canônico ("all" = todos)
  const dateFrom = filters.dateFrom;
  const dateTo = filters.dateTo;
  // Nomes crus separados por plataforma — o nome da conta no Meta e no Google pode diferir,
  // então cada hook recebe o nome cru da SUA plataforma (o fetch restringe via `.ilike` core).
  const [metaClients, setMetaClients] = useState<string[]>([]);
  const [googleClients, setGoogleClients] = useState<string[]>([]);

  // Fetch clients que têm Meta OU Google (separando a fonte p/ traduzir corretamente).
  useEffect(() => {
    async function fetchClients() {
      const meta = new Set<string>();
      const google = new Set<string>();
      const pageSize = 1000;
      let from = 0;
      for (let i = 0; i < 100; i++) {
        const { data, error } = await externalSupabase
          .from("v_meta_google_ads")
          .select("Client, Fonte_Ads")
          .in("Fonte_Ads", ["Meta", "Facebook", "Google"])
          .range(from, from + pageSize - 1);
        if (error || !data || data.length === 0) break;
        for (const r of data as any[]) {
          // "overview": só remove clientes encerrados. Alan Sampaio / Luiz Cardoso NÃO são
          // escondidos aqui — eles só somem na tela dedicada de Google Ads (channel "google").
          if (!r.Client || isExcludedClient(r.Client, "overview")) continue;
          if (r.Fonte_Ads === "Google") google.add(r.Client);
          else meta.add(r.Client);
        }
        if (data.length < pageSize) break;
        from += pageSize;
      }
      setMetaClients([...meta].sort());
      setGoogleClients([...google].sort());
    }
    fetchClients();
  }, [visVersao]);

  // Opções do dropdown = união (Meta + Google) em forma canônica. Mapas por plataforma
  // traduzem o slug escolhido de volta p/ o nome cru de cada lado.
  const meta_ = useMemo(() => buildAdsClientOptions(metaClients), [metaClients]);
  const google_ = useMemo(() => buildAdsClientOptions(googleClients), [googleClients]);
  const clientOptions = useMemo(() => {
    const byValue = new Map<string, { value: string; label: string }>();
    for (const o of [...meta_.options, ...google_.options]) if (!byValue.has(o.value)) byValue.set(o.value, o);
    return [...byValue.values()].sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [meta_.options, google_.options]);

  const clientCmp = clientFilter !== "all" ? clientCmpKey(clientFilter) : null;
  const clientForUI = clientFilter === "all"
    ? "all"
    : (clientOptions.find((o) => clientCmpKey(o.value) === clientCmp)?.value ?? clientFilter);
  const clientForMeta = clientFilter === "all"
    ? "all"
    : ((clientCmp && meta_.rawByCmpKey.get(clientCmp)?.[0]) ?? clientFilter);
  const clientForGoogle = clientFilter === "all"
    ? "all"
    : ((clientCmp && google_.rawByCmpKey.get(clientCmp)?.[0]) ?? clientFilter);

  const dateFromStr = dateFrom ? format(dateFrom, "yyyy-MM-dd") : undefined;
  // Sem `to` (seleção de dia único) → colapsa para from..from.
  const dateToStr = dateTo ? format(dateTo, "yyyy-MM-dd") : dateFromStr;

  const meta = useMetaAdsClienteData(clientForMeta, dateFromStr, dateToStr, "all");
  const google = useGoogleAdsClienteData(clientForGoogle, dateFromStr, dateToStr, "all");

  // CRM autoritativo (mesma fonte do Relatório/CRM): consultas agendadas contadas pela
  // DATA DO EVENTO ("Consulta Agendada Em") no período e faturamento por eventos realizados —
  // não pela janela de created_at nem por atribuição de campanha. Garante que o número de
  // consultas/CAC bata com o Relatório e a tela de CRM. O `client` já é o slug canônico (Kommo).
  // externalAdsRows=[] evita refazer o fetch de ads (só precisamos do lado Kommo do CRM).
  const crmClientFilter = clientFilter !== "all" ? canonicalizeAdsClient(clientFilter) : undefined;
  const crm = useCRMClienteData(crmClientFilter, dateFromStr, dateToStr, undefined, undefined, [], undefined);

  const loading = meta.loading || google.loading || crm.loading;
  const error = meta.error || google.error;

  // Fallback values for Google (no reach/frequency)
  const googleFreq = useMemo(() => {
    if (!google.totals.impressions || !google.totals.impressions) return 0;
    return 0;
  }, [google.totals]);

  if (loading) {
    return (
      <DashboardLayout>
        <div className="p-6 space-y-6">
          <ClientesHeader activeTab="Performance" />
          <div className="skeleton-loading h-64 rounded-lg" />
        </div>
      </DashboardLayout>
    );
  }

  if (error) {
    return (
      <DashboardLayout>
        <div className="p-6">
          <ClientesHeader activeTab="Performance" />
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
        <ClientesHeader activeTab="Performance" />

        {/* Filters */}
        <div className="neu-card rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">Filtros</span>
          </div>

          

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <DateRangePicker
              from={dateFrom}
              to={dateTo}
              onChange={({ from, to }) => patch({ dateFrom: from, dateTo: to })}
            />

            <SearchableSelect
              value={clientForUI}
              onValueChange={(v) => patch({ client: v, medico: [] })}
              options={clientOptions}
              placeholder="Todos os clientes"
              searchPlaceholder="Buscar cliente..."
              emptyText="Nenhum cliente encontrado."
              allOption={{ value: "all", label: "Todos os clientes" }}
            />

            {(dateFrom || dateTo || clientFilter !== "all") && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => clear()}
                className="flex items-center gap-1.5 text-xs font-medium bg-destructive/10 border-destructive/30 text-destructive hover:bg-destructive/20 hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" />
                Limpar filtros
              </Button>
            )}
          </div>
        </div>

        {/* KPIs Consolidados */}
        <PerformanceKPICards
          metaSpend={meta.totals.spend}
          googleSpend={google.totals.spend}
          metaLeads={meta.totals.leads}
          googleLeads={google.totals.leads}
          consultas={crm.totals.consultasAgendadas}
          faturamento={crm.totals.faturamentoBruto}
        />

        {/* Evolução comparativa */}
        <PerformanceEvolutionCharts
          metaMonthly={meta.monthlyEvolution.map((m) => ({ month: m.month, investimento: m.investimento, leads: m.leads }))}
          googleMonthly={google.monthlyEvolution.map((m) => ({ month: m.month, investimento: m.investimento, leads: m.leads }))}
        />
        {/* Empty state notices */}
        {(meta.totals.spend === 0 || google.totals.spend === 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {meta.totals.spend === 0 && (
              <div className="neu-card rounded-lg p-3 flex items-center gap-2.5 border-l-2" style={{ borderLeftColor: "#1877F2" }}>
                <Facebook className="h-4 w-4" style={{ color: "#1877F2" }} />
                <p className="text-xs text-muted-foreground">
                  Sem dados de <span className="text-foreground font-medium">Meta Ads</span> para este filtro.
                </p>
              </div>
            )}
            {google.totals.spend === 0 && (
              <div className="neu-card rounded-lg p-3 flex items-center gap-2.5 border-l-2" style={{ borderLeftColor: "#E1306C" }}>
                <Chrome className="h-4 w-4" style={{ color: "#E1306C" }} />
                <p className="text-xs text-muted-foreground">
                  Sem dados de <span className="text-foreground font-medium">Google Ads</span> para este filtro.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Eficiência relativa */}
        <PerformanceEfficiencyBars
          metrics={[
            { label: "Custo / Lead", meta: meta.totals.cpl, google: google.totals.cpl, betterWhen: "lower" },
            { label: "CPM", meta: meta.totals.cpm, google: google.totals.cpm, betterWhen: "lower" },
            { label: "CPC", meta: meta.totals.cpc, google: google.totals.cpc, betterWhen: "lower" },
            { label: "CTR", meta: meta.totals.ctr, google: google.totals.ctr, betterWhen: "higher" },
          ]}
        />

        {/* Comparativo Meta x Google */}
        <div className="neu-card rounded-xl p-6">
          <h3 className="text-sm font-semibold text-foreground mb-4">Comparativo de Performance</h3>

          {/* Headers — branded */}
          <div className="grid grid-cols-[1fr_auto_1fr_120px] items-center gap-3 pb-3 mb-2 border-b border-border">
            <div className="flex items-center justify-end">
              <div className="neu-inset flex items-center gap-2 px-3 py-1.5 rounded-lg">
                <Facebook className="h-4 w-4" style={{ color: "#1877F2" }} />
                <span className="text-sm font-semibold" style={{ color: "#1877F2" }}>Meta Ads</span>
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider text-center min-w-[110px] px-2">
              Métrica
            </div>
            <div className="flex items-center justify-start">
              <div className="neu-inset flex items-center gap-2 px-3 py-1.5 rounded-lg">
                <Chrome className="h-4 w-4" style={{ color: "#E1306C" }} />
                <span className="text-sm font-semibold" style={{ color: "#E1306C" }}>Google Ads</span>
              </div>
            </div>
            <div className="text-right text-[10px] text-muted-foreground uppercase tracking-wider font-semibold pr-2">
              Total Combinado
            </div>
          </div>

          <div>
            <MetricRow
              label="Leads"
              metaValue={fmt(meta.totals.leads)}
              googleValue={fmt(google.totals.leads)}
              totalValue={fmt(meta.totals.leads + google.totals.leads)}
              highlightBetter="higher"
              metaRaw={meta.totals.leads}
              googleRaw={google.totals.leads}
            />
            <MetricRow
              label="Custo / Lead"
              metaValue={fmtCurrency(meta.totals.cpl)}
              googleValue={fmtCurrency(google.totals.cpl)}
              totalValue={(meta.totals.leads + google.totals.leads) > 0
                ? fmtCurrency((meta.totals.spend + google.totals.spend) / (meta.totals.leads + google.totals.leads))
                : "—"}
              highlightBetter="lower"
              metaRaw={meta.totals.cpl}
              googleRaw={google.totals.cpl}
              tooltip="Investimento dividido pelo número total de leads gerados. Quanto menor, melhor."
            />
            <MetricRow
              label="Investimento Total"
              metaValue={fmtCurrency(meta.totals.spend)}
              googleValue={fmtCurrency(google.totals.spend)}
              totalValue={fmtCurrency(meta.totals.spend + google.totals.spend)}
            />
            <MetricRow
              label="Alcance"
              metaValue={fmtInt(meta.totals.reach)}
              googleValue="—"
              totalValue={fmtInt(meta.totals.reach)}
              tooltip="Pessoas únicas que viram o anúncio. Google Ads não disponibiliza essa métrica."
            />
            <MetricRow
              label="Impressões"
              metaValue={fmtInt(meta.totals.impressions)}
              googleValue={fmtInt(google.totals.impressions)}
              totalValue={fmtInt(meta.totals.impressions + google.totals.impressions)}
              highlightBetter="higher"
              metaRaw={meta.totals.impressions}
              googleRaw={google.totals.impressions}
            />
            <MetricRow
              label="Frequência"
              metaValue={fmtDecimal(meta.totals.frequency)}
              googleValue="—"
              tooltip="Média de vezes que cada pessoa viu o anúncio (impressões ÷ alcance)."
            />
            <MetricRow
              label="CPM"
              metaValue={fmtCurrency(meta.totals.cpm)}
              googleValue={fmtCurrency(google.totals.cpm)}
              totalValue={(meta.totals.impressions + google.totals.impressions) > 0
                ? fmtCurrency(((meta.totals.spend + google.totals.spend) / (meta.totals.impressions + google.totals.impressions)) * 1000)
                : "—"}
              highlightBetter="lower"
              metaRaw={meta.totals.cpm}
              googleRaw={google.totals.cpm}
              tooltip="Custo por mil impressões: (investimento ÷ impressões) × 1000."
            />
            <MetricRow
              label="CTR"
              metaValue={`${fmtDecimal(meta.totals.ctr)}%`}
              googleValue={`${fmtDecimal(google.totals.ctr)}%`}
              totalValue={(meta.totals.impressions + google.totals.impressions) > 0
                ? `${fmtDecimal(((meta.totals.clicks + google.totals.clicks) / (meta.totals.impressions + google.totals.impressions)) * 100)}%`
                : "—"}
              highlightBetter="higher"
              metaRaw={meta.totals.ctr}
              googleRaw={google.totals.ctr}
              tooltip="Taxa de cliques: cliques ÷ impressões × 100. Mede atratividade do anúncio."
            />
            <MetricRow
              label="CPC"
              metaValue={fmtCurrency(meta.totals.cpc)}
              googleValue={fmtCurrency(google.totals.cpc)}
              totalValue={(meta.totals.clicks + google.totals.clicks) > 0
                ? fmtCurrency((meta.totals.spend + google.totals.spend) / (meta.totals.clicks + google.totals.clicks))
                : "—"}
              highlightBetter="lower"
              metaRaw={meta.totals.cpc}
              googleRaw={google.totals.cpc}
              tooltip="Custo por clique: investimento ÷ cliques."
            />
            <MetricRow
              label="Cliques"
              metaValue={fmtInt(meta.totals.clicks)}
              googleValue={fmtInt(google.totals.clicks)}
              totalValue={fmtInt(meta.totals.clicks + google.totals.clicks)}
              highlightBetter="higher"
              metaRaw={meta.totals.clicks}
              googleRaw={google.totals.clicks}
              tooltip="Total de cliques no link do anúncio."
            />

            {/* Vídeo (somente Meta) */}
            <MetricRow
              label="Hook (3s/Impr)"
              metaValue={`${fmtDecimal(meta.totals.hook)}%`}
              googleValue="—"
              totalValue={`${fmtDecimal(meta.totals.hook)}%`}
              highlightBetter="higher"
              metaRaw={meta.totals.hook}
              tooltip="Taxa de hook: vídeo 3s ÷ impressões × 100. Mede atratividade inicial do criativo."
            />
            <MetricRow
              label="Hold (95%/Impr)"
              metaValue={`${fmtDecimal(meta.totals.hold)}%`}
              googleValue="—"
              totalValue={`${fmtDecimal(meta.totals.hold)}%`}
              highlightBetter="higher"
              metaRaw={meta.totals.hold}
              tooltip="Taxa de hold: vídeo 95% ÷ impressões × 100. Mede retenção até quase o fim."
            />

            {/* Mensagens (Meta — Click-to-Message) */}
            <MetricRow
              label="Mensagens"
              metaValue={fmtInt(meta.totals.mensagens)}
              googleValue="—"
              totalValue={fmtInt(meta.totals.mensagens)}
              tooltip="Mensagens iniciadas via anúncio (Click-to-Message). Exclusivo do Meta."
            />
            <MetricRow
              label="Custo / Mensagem"
              metaValue={meta.totals.custoMensagem > 0 ? fmtCurrency(meta.totals.custoMensagem) : "—"}
              googleValue="—"
              totalValue={meta.totals.custoMensagem > 0 ? fmtCurrency(meta.totals.custoMensagem) : "—"}
              highlightBetter="lower"
              metaRaw={meta.totals.custoMensagem}
              tooltip="Investimento ÷ mensagens iniciadas. Quanto menor, melhor."
            />

            {/* Orçamento (Meta) */}
            <MetricRow
              label="Orçamento Diário"
              metaValue={meta.totals.orcamento > 0 ? fmtCurrency(meta.totals.orcamento) : "—"}
              googleValue="—"
              totalValue={meta.totals.orcamento > 0 ? fmtCurrency(meta.totals.orcamento) : "—"}
              tooltip="Soma dos orçamentos diários configurados nas campanhas Meta."
            />

            {/* Resultados (Google) */}
            <MetricRow
              label="Resultados"
              metaValue="—"
              googleValue={fmtInt(google.totals.resultados)}
              totalValue={fmtInt(google.totals.resultados)}
              tooltip="Conversões registradas pelo Google Ads (definição depende da meta da campanha)."
            />
            <MetricRow
              label="Custo / Resultado"
              metaValue="—"
              googleValue={google.totals.custoResultado > 0 ? fmtCurrency(google.totals.custoResultado) : "—"}
              totalValue={google.totals.custoResultado > 0 ? fmtCurrency(google.totals.custoResultado) : "—"}
              highlightBetter="lower"
              googleRaw={google.totals.custoResultado}
              tooltip="Investimento Google ÷ resultados. Quanto menor, melhor."
            />
          </div>

          <p className="text-[10px] text-muted-foreground mt-4 text-center italic">
            Valores em <span className="text-primary font-semibold">verde</span> indicam melhor performance entre os canais.
          </p>
        </div>

        {/* Tabelas de campanhas */}
        <div className="space-y-4">
          <div className="neu-inset flex items-center gap-2 px-3 py-2 rounded-lg w-fit">
            <Facebook className="h-4 w-4" style={{ color: "#1877F2" }} />
            <h3 className="text-sm font-semibold" style={{ color: "#1877F2" }}>Campanhas Meta Ads</h3>
          </div>
          {meta.campaignSummary.length > 0 ? (
            <MetaAdsCampaignTable campaigns={meta.campaignSummary} />
          ) : (
            <div className="neu-card rounded-lg p-8 text-center">
              <p className="text-sm text-muted-foreground">Sem campanhas Meta Ads para este filtro.</p>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="neu-inset flex items-center gap-2 px-3 py-2 rounded-lg w-fit">
            <Chrome className="h-4 w-4" style={{ color: "#E1306C" }} />
            <h3 className="text-sm font-semibold" style={{ color: "#E1306C" }}>Campanhas Google Ads</h3>
          </div>
          {google.campaignSummary.length > 0 ? (
            <GoogleAdsCampaignTable campaigns={google.campaignSummary} />
          ) : (
            <div className="neu-card rounded-lg p-8 text-center">
              <p className="text-sm text-muted-foreground">Sem campanhas Google Ads para este filtro.</p>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
