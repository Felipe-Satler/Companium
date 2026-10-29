import { useState, useMemo } from "react";
import { format, subDays, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon, Filter, X } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ClientesHeader } from "@/components/clientes/ClientesHeader";
import { MetaAdsMetricsPanel } from "@/components/clientes/meta-ads/MetaAdsMetricsPanel";
import { MetaAdsComparacao, MetaCompareSide } from "@/components/clientes/meta-ads/MetaAdsComparacaoPeriodos";
import { MetaAdsEvolutionCharts } from "@/components/clientes/meta-ads/MetaAdsEvolutionCharts";
import { MetaAdsCampaignHierarchy } from "@/components/clientes/meta-ads/MetaAdsCampaignHierarchy";
import { MetaAdsInsightsAnuncios } from "@/components/clientes/meta-ads/MetaAdsInsightsAnuncios";
import { CaptacaoInvestimentoLeadsChart } from "@/components/captacao/CaptacaoInvestimentoLeadsChart";
import { useMetaAdsClienteData } from "@/hooks/useMetaAdsClienteData";
import { useMetaAdsCriativosData } from "@/hooks/useMetaAdsCriativosData";
import { useAuth } from "@/contexts/AuthContext";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { MedicoMultiSelect } from "@/components/clientes/MedicoMultiSelect";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { CarteiraToggle } from "@/components/clientes/CarteiraToggle";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { externalSupabase } from "@/integrations/external-supabase/client";
import { useEffect } from "react";
import { usePersistedState } from "@/hooks/usePersistedState";
import { useClientesFilters } from "@/contexts/ClientesFiltersContext";
import { buildAdsClientOptions, clientCmpKey, prettyClientLabel } from "@/data/clienteAliases";
import { canonicalResultType, formatCampaignResultType } from "@/lib/metaAdsResultTypeLabels";
import { periodLabel } from "@/utils/dateRange";

// Modos do SELECT de comparação: "off" = desligado; "periodo" = mesmo cliente em duas janelas;
// "cliente" = dois clientes no período atual. (Especialidade/maturidade ficam p/ a fase 2, pois
// exigem agregar várias contas — a base do Meta é por um cliente de cada vez.)
type AdsCompareMode = "off" | "periodo" | "cliente";

export default function ClientesMetaAds() {
  // Cliente/médico/período vêm dos filtros COMPARTILHADOS (valem em todas as telas de
  // /clientes). O "tipo de resultado" é específico desta tela → continua local.
  const { filters, patch, clear } = useClientesFilters();
  const clientFilter = filters.client; // slug canônico ("all" = todos)
  const medicoFilter = filters.medico;
  const dateFrom = filters.dateFrom;
  const dateTo = filters.dateTo;
  const [tipoResultadoFilter, setTipoResultadoFilter] = usePersistedState("clientesMetaAds.tipoResultadoFilter", () => "all");
  const [clients, setClients] = useState<string[]>([]);

  // Dropdown de cliente em forma CANÔNICA (mesma identidade das outras telas). `rawByCmpKey`
  // traduz o slug escolhido de volta p/ um nome cru da conta — necessário pro fetch do hook,
  // que restringe no servidor via `.ilike("Client", "%core%")`.
  const { options: clientOptions, rawByCmpKey } = useMemo(() => buildAdsClientOptions(clients, "meta"), [clients]);
  const clientCmp = clientFilter !== "all" ? clientCmpKey(clientFilter) : null;
  // Valor exibido no dropdown: a opção local cujo cmpKey casa com o cliente compartilhado.
  const clientForUI = clientFilter === "all"
    ? "all"
    : (clientOptions.find((o) => clientCmpKey(o.value) === clientCmp)?.value ?? clientFilter);
  // Valor passado ao hook: nome cru da conta (p/ o fetch); se o cliente não existir no Meta,
  // cai pro próprio slug (o fetch volta vazio e a tela mostra zero, que é o correto).
  const clientForHook = clientFilter === "all"
    ? "all"
    : ((clientCmp && rawByCmpKey.get(clientCmp)?.[0]) ?? clientFilter);

  // COMPARAÇÃO de períodos — LOCAL desta tela (não entra nos filtros compartilhados). Período
  // A = filtro corrente (dateFrom/dateTo); aqui guardamos o período B e o liga/desliga. Ao
  // ligar, se ainda não houver período B, sugerimos o MÊS ANTERIOR ao início do período A.
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

  // Fetch unique Meta Ads clients (paginated to bypass 1000-row limit).
  // O que define "cliente ativo" é ter linha nos últimos 7 dias — o bot faz poll das contas
  // Groohub ativas a cada ~2min, então legado (contas renomeadas/pausadas no Meta) para de
  // receber linhas e sai do dropdown sozinho. NÃO exigimos "groohub" no NOME da conta: contas
  // legítimas cujo nome não tem o sufixo (ex.: "Dra. Evelyne - CA 1.1.1") são ingeridas
  // porque suas campanhas carregam o prefixo GROOHUB — o `%groohub%` no nome as escondia
  // indevidamente do seletor (embora seus dados existissem na tabela). A tabela já só contém
  // linhas filtradas por Groohub na ingestão, então a janela de recência basta.
  useEffect(() => {
    async function fetchClients() {
      const recencyCutoff = format(subDays(new Date(), 7), "yyyy-MM-dd");
      const unique = new Set<string>();
      const pageSize = 1000;
      let from = 0;
      for (let i = 0; i < 100; i++) {
        const { data, error } = await externalSupabase
          .from("v_meta_google_ads")
          .select("Client")
          .in("Fonte_Ads", ["Meta", "Facebook"])
          .gte("Dia", recencyCutoff)
          // ORDER BY estável (id único) p/ paginação determinística — sem ele o .range()
          // pode pular linhas e omitir um cliente do dropdown.
          .order("id", { ascending: false })
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

  const { clientUser, user, canCompararPeriodos } = useAuth();

  // Converte um slug canônico de cliente no nome CRU da conta (o que o hook usa p/ o fetch via
  // ilike). Mesma derivação do `clientForHook`, mas para um cliente qualquer (lados da comparação).
  const hookFor = (slug: string) => {
    if (!slug || slug === "all") return "all";
    const cmp = clientCmpKey(slug);
    return rawByCmpKey.get(cmp)?.[0] ?? slug;
  };

  // Operandos da comparação (lado A e lado B). null = desligada / operando faltando → o painel
  // não aparece. "periodo": mesmo cliente, duas janelas; "cliente": dois clientes, período atual.
  const compareSides = useMemo<{ a: MetaCompareSide; b: MetaCompareSide } | null>(() => {
    if (!canCompararPeriodos || compareMode === "off") return null;
    if (!dateFromStr || !dateToStr) return null;
    if (compareMode === "periodo") {
      if (!compareFrom || !compareTo) return null;
      return {
        a: { label: periodLabel(dateFrom, dateTo), clientForHook, from: dateFromStr, to: dateToStr, medicoFilter },
        b: { label: periodLabel(compareFrom, compareTo), clientForHook, from: format(compareFrom, "yyyy-MM-dd"), to: format(compareTo, "yyyy-MM-dd"), medicoFilter },
      };
    }
    // cliente — mesmo período atual, dois clientes diferentes (sem filtro de médico: é por conta).
    if (!cmpClientA || !cmpClientB) return null;
    return {
      a: { label: prettyClientLabel(cmpClientA), clientForHook: hookFor(cmpClientA), from: dateFromStr, to: dateToStr },
      b: { label: prettyClientLabel(cmpClientB), clientForHook: hookFor(cmpClientB), from: dateFromStr, to: dateToStr },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCompararPeriodos, compareMode, dateFromStr, dateToStr, dateFrom, dateTo, compareFrom, compareTo, clientForHook, medicoFilter, cmpClientA, cmpClientB, rawByCmpKey]);

  // Liberação PONTUAL: usuários-cliente nesta lista veem a tela COMPLETA de Meta Ads
  // (hierarquia de Campanhas + Insights dos Anúncios), igual à equipe. Os demais
  // usuários-cliente continuam vendo só cards/gráficos. Match por email (case-insensitive).
  // O escopo de dados (só o próprio cliente) segue garantido pela RLS — isto só revela as seções.
  const FULL_META_ADS_CLIENT_EMAILS = ["cliente.exemplo@example.com"];
  const canSeeFullMetaAds = !clientUser || FULL_META_ADS_CLIENT_EMAILS.includes((user?.email ?? "").trim().toLowerCase());
  // Usuário-cliente: o escopo do Kommo é garantido pela RLS (client_matchkey, case/acento-
  // insensível — casa o slug real). NÃO filtramos no frontend por nome (o `.in` é case-sensitive
  // e erra o slug do Kommo). A RLS + filtro de data mantêm a query pequena.
  const { data, totals, leadsCRMMeta, monthlyEvolution, campaignSummary, medicos, loading, error } = useMetaAdsClienteData(clientForHook, dateFromStr, dateToStr, medicoFilter);

  // Hierarquia Campanha → Conjunto → Anúncio a partir da tabela "Criativos Meta Ads"
  // (mesmo escopo de cliente/data). Substitui a tabela plana de campanhas.
  const { campanhas: hierarquiaCampanhas, anuncios: hierarquiaAnuncios, crmSemCampanha, loading: loadingHierarquia } = useMetaAdsCriativosData(
    clientForHook,
    dateFromStr,
    dateToStr,
    medicoFilter,
  );

  // Opções do filtro de Tipo de Resultado — vêm da HIERARQUIA (tabela "Criativos Meta Ads"),
  // a mesma fonte do rótulo e do número exibidos na tabela de campanhas. Antes vinham do
  // `campaignSummary` (tabela principal, códigos crus do Meta), e a tela então filtrava as
  // campanhas por um valor que não era o delas: campanha classificada como mensagem na tabela
  // principal sumia do filtro "Visitas ao perfil" mesmo tendo todas as linhas gravadas como
  // visita ao perfil. Canonicalizado p/ que as duas caixas gravadas pela ingestão
  // ("Conversas Iniciadas" × "Conversas iniciadas") não virem duas opções no dropdown.
  const tiposResultado = useMemo(() => {
    const set = new Set<string>();
    for (const c of hierarquiaCampanhas) {
      const t = canonicalResultType(c.agg.tipoResultado);
      if (t) set.add(t);
    }
    return [...set].sort();
  }, [hierarquiaCampanhas]);

  // Tipo de resultado EFETIVO: se o valor persistido não existe no período atual
  // (ex.: filtrou "Conversas" e trocou p/ um mês que não tem esse tipo), tratamos
  // como "sem filtro" em vez de filtrar tudo p/ vazio. Sem isso, o dropdown mostra
  // "Todos os tipos" mas os cards/tabela zeram, passando a falsa impressão de que o
  // cliente não tem NADA no Meta. O valor persistido é mantido: volta a valer sozinho
  // assim que o tipo reaparecer em outro período.
  const effectiveTipoResultado =
    tipoResultadoFilter === "all" || tiposResultado.includes(tipoResultadoFilter)
      ? tipoResultadoFilter
      : "all";

  // Campanhas da tabela PRINCIPAL que alimentam os cards superiores. O tipo selecionado agora
  // vem do vocabulário dos criativos, então o código cru do `campaignSummary` precisa ser
  // canonicalizado antes de comparar. Ressalva conhecida: `link_click` canonicaliza p/
  // "Visitas ao perfil" (é assim que a tabela principal já tratava campanhas de tráfego pro
  // IG), então uma campanha gravada nos criativos literalmente como "Cliques no link" não
  // casa com a linha equivalente da tabela principal. Afeta só os cards, não a tabela.
  const filteredCampaigns = useMemo(() => {
    if (effectiveTipoResultado === "all") return campaignSummary;
    const alvo = canonicalResultType(effectiveTipoResultado);
    return campaignSummary.filter((c) => canonicalResultType(c.tipoResultado) === alvo);
  }, [campaignSummary, effectiveTipoResultado]);

  // Cards superiores: quando um tipo de resultado é selecionado, os totais são
  // reagregados a partir das campanhas daquele tipo (mesmo conjunto da tabela),
  // pra os cards baterem com o que está sendo exibido. Sem filtro → totals do hook.
  const displayTotals = useMemo(() => {
    if (effectiveTipoResultado === "all") return { ...totals, leadsCRMMeta };
    const sum = (sel: (c: typeof filteredCampaigns[number]) => number) =>
      filteredCampaigns.reduce((s, c) => s + (sel(c) || 0), 0);
    const spend = sum((c) => c.investimento);
    const leads = sum((c) => c.leadsTrafico);
    const impressions = sum((c) => c.impressoes);
    const clicks = sum((c) => c.cliques);
    // Reach NÃO é somável por campanha (é gente única). Usa o alcance deduplicado da conta
    // (totals.reach, já corrigido no hook) em vez de somar — evita repetir a inflação aqui.
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

  if (loading) {
    return (
      <DashboardLayout>
        <div className="p-6 space-y-6">
          <ClientesHeader activeTab="Meta Ads" />
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
          <ClientesHeader activeTab="Meta Ads" />
          <div className="neu-card rounded-lg p-8 text-center mt-6">
            <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      {/* pb-28: folga no rodapé p/ a paginação dos anúncios não ficar atrás do botão flutuante do chat */}
      <div className="p-6 pb-28 space-y-6">
        <ClientesHeader activeTab="Meta Ads" />

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
                value={effectiveTipoResultado}
                onValueChange={setTipoResultadoFilter}
                options={tiposResultado.map((t) => ({ value: t, label: formatCampaignResultType(t) }))}
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

            {(dateFrom || dateTo || clientFilter !== "all" || medicoFilter.length > 0 || effectiveTipoResultado !== "all" || compareMode !== "off") && (
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
          <MetaAdsComparacao sideA={compareSides.a} sideB={compareSides.b} />
        )}

        {/* Metrics */}
        <MetaAdsMetricsPanel totals={displayTotals} />

        {/* Investimento vs Leads gerados (mesmo gráfico da Captação) */}
        <CaptacaoInvestimentoLeadsChart data={data} />

        {/* Charts */}
        <MetaAdsEvolutionCharts data={monthlyEvolution} />

        {/* Conta de cliente (clientUser): de Campanhas pra baixo NÃO aparece — só cards/gráficos.
            Equipe (clientUser=null) vê tudo. Exceção: emails em FULL_META_ADS_CLIENT_EMAILS
            (ex.: cliente.exemplo@example.com) veem a tela completa mesmo sendo usuário-cliente. */}
        {canSeeFullMetaAds && (
          <>
            {/* Campanhas: hierarquia Campanha → Conjunto → Anúncio (tabela "Criativos Meta Ads") */}
            <MetaAdsCampaignHierarchy
              campanhas={hierarquiaCampanhas}
              tipoResultado={effectiveTipoResultado}
              crmSemCampanha={crmSemCampanha}
              loading={loadingHierarquia}
            />

            {/* Insights dos Anúncios: cards de criativos com filtros/ordenação (tabela "Criativos Meta Ads") */}
            <MetaAdsInsightsAnuncios anuncios={hierarquiaAnuncios} loading={loadingHierarquia} />
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
