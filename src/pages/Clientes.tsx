import { useMemo } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { useClientesData } from "@/hooks/useClientesData";
import { useClientesVisiveis } from "@/hooks/useClientesVisiveis";
import { useCRMClienteData } from "@/hooks/useCRMClienteData";
import { useClientesFilters } from "@/contexts/ClientesFiltersContext";
import { ClientesTable } from "@/components/clientes/ClientesTable";
import { ClientesInvestimentoChart } from "@/components/clientes/ClientesInvestimentoChart";
import { RelatorioGeralSummary } from "@/components/clientes/RelatorioGeralSummary";
import { ClientesFilters } from "@/components/clientes/ClientesFilters";
import { ClientesHeader } from "@/components/clientes/ClientesHeader";
import { origemKey } from "@/utils/crmCalculations";
import { canonicalizeAdsClient, foldMergedAdsClient, clientCmpKey, isExcludedClient } from "@/data/clienteAliases";
import { useEspecialidades } from "@/hooks/useEspecialidades";
import { format } from "date-fns";

// "Lead tráfego" = coluna "Lead" do banco (leads de verdade), tanto p/ Google quanto
// p/ Meta. (A coluna "Resultados" do Google acompanha cliques, não é lead — decisão do
// cliente jun/2026: leads seguem "Lead".)
function leadTrafegoOf(row: { Lead?: number }): number {
  return row.Lead || 0;
}

export default function Clientes() {
  // Recalcula quando a carteira visível (projetos_lista ATIVO + clientes_ocultos) chega.
  const visVersao = useClientesVisiveis();
  // Filtros COMPARTILHADOS com as demais telas de /clientes (cliente/médico/período etc.
  // valem em todas as páginas). Persistido em localStorage.
  const { filters, setFilters } = useClientesFilters();

  const dateFromStr = filters.dateFrom ? format(filters.dateFrom, "yyyy-MM-dd") : undefined;
  // Sem `to` (seleção de dia único) → colapsa para from..from.
  const dateToStr = filters.dateTo ? format(filters.dateTo, "yyyy-MM-dd") : dateFromStr;

  // Filtro de data agora aplicado no DB — antes puxava 80k linhas e filtrava no client.
  // `clientList` é a lista canônica (estilo slug do Kommo, ex.: "Gustavo_Nobre") unificando
  // os clientes do Kommo + os clientes do Ads (canonicalizados via heurística + aliases).
  const { data, clients: clientList, canonicalMap, loading, error } = useClientesData(dateFromStr, dateToStr);

  const clientFilterForCRM = filters.client !== "all" ? filters.client : undefined;
  const origemFilterForCRM = filters.origem.length > 0 ? filters.origem : undefined;
  const medicoFilterForCRM = filters.medico.length > 0 ? filters.medico : undefined;

  // Especialidades vêm da tabela `clientes` (via view v_cliente_especialidades) — fonte real,
  // cada cliente pode ter várias. `getEspecialidades(canonical)` casa o slug do relatório.
  const { especialidadeOptions, getEspecialidades, loading: espLoading } = useEspecialidades();

  const especialidadeList = especialidadeOptions;

  // Conjunto de clientes (slug canônico) que TÊM a especialidade selecionada. Como um cliente
  // pode ter múltiplas, basta a especialidade escolhida estar entre as dele.
  const clientsForEspecialidade = useMemo(() => {
    if (filters.especialidade === "all") return null;
    return new Set(
      clientList.filter((c) => getEspecialidades(c).includes(filters.especialidade))
    );
  }, [filters.especialidade, clientList, getEspecialidades]);

  // Lista (Array) dos clients da especialidade — passada ao useCRMClienteData.
  // CRÍTICO: retorna `undefined` quando "all", NUNCA `[]`. Array vazio dentro do hook
  // seria interpretado como "nenhum cliente corresponde" e zeraria silenciosamente os totais.
  const clientsForEspecialidadeArr = useMemo<string[] | undefined>(() => {
    if (!clientsForEspecialidade) return undefined;
    return [...clientsForEspecialidade];
  }, [clientsForEspecialidade]);

  // Filtro de data já aplicado no DB. Aqui sobra apenas client/especialidade/origem.
  // Filtro de origem: "Meta Ads" → Fonte_Ads in (Meta, Facebook); "Google Ads" → Google.
  // Outras origens (Instagram, Direct, etc.) não têm spend em ads, então quando o
  // usuário seleciona apenas elas, zeramos os ads (não há investimento aplicável).
  // O filtro de cliente compara o canonical (Kommo-slug-style) da linha — não o nome
  // longo do Ads — pra bater com a opção escolhida no dropdown.
  const filteredData = useMemo(() => {
    const origemSel = filters.origem.filter((o) => o && o !== "all");
    const selKeys = origemSel.map(origemKey);
    const wantsMeta = origemSel.length === 0 || selKeys.includes(origemKey("Meta Ads"));
    const wantsGoogle = origemSel.length === 0 || selKeys.includes(origemKey("Google Ads"));
    // `clientCmpKey` de um valor inválido (ex.: opção em branco) vira "" — nesse caso NÃO
    // filtra por cliente (trata como "todos"), senão nenhuma linha casaria e os totais zerariam.
    const clientSelRaw = filters.client !== "all" ? clientCmpKey(filters.client) : null;
    const clientSel = clientSelRaw || null;
    return data.filter((row) => {
      // Clientes encerrados não entram no Relatório Geral. (Alan Sampaio / Luiz Cardoso
      // aparecem normalmente aqui — só somem na tela de Google Ads.)
      if (isExcludedClient(row.Client, "overview")) return false;
      const canonical = canonicalMap.canonicalByAdsName.get(row.Client) || foldMergedAdsClient(canonicalizeAdsClient(row.Client));
      // Compara por cmpKey (tolerante a caixa/acento/formato) — o cliente pode ter sido
      // escolhido em outra tela com uma forma canônica ligeiramente diferente.
      if (clientSel && clientCmpKey(canonical) !== clientSel) return false;
      if (clientsForEspecialidade && !clientsForEspecialidade.has(canonical)) return false;
      const isMeta = row.Fonte_Ads === "Meta" || row.Fonte_Ads === "Facebook";
      const isGoogle = row.Fonte_Ads === "Google";
      if (isMeta && !wantsMeta) return false;
      if (isGoogle && !wantsGoogle) return false;
      // Quando o usuário selecionou apenas origens não-Ads, descarta tudo
      if (origemSel.length > 0 && !wantsMeta && !wantsGoogle) return false;
      return true;
    });
    // visVersao NÃO aparece no corpo de propósito: ela é o sinal de que o store de
    // clientes visíveis mudou (isExcludedClient lê estado de módulo, que o lint não
    // enxerga). Tirar a dep faz a lista congelar na versão pré-carregamento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, filters.client, filters.origem, clientsForEspecialidade, canonicalMap, visVersao]);

  // Reaproveitamos os Ads já carregados (sem fetch duplicado). IMPORTANTE: derivamos de
  // `filteredData` (não de `data`) para que o filtro de cliente/especialidade da UI
  // também reflita no spend/leadsTráfego do CRM. As linhas aqui já vêm agregadas por dia.
  // Convertemos Client → canonical (slug) antes de passar pro useCRMClienteData; assim
  // o filtro interno do hook (que checa `r.Client === clientFilter`) bate com o canonical
  // que o consumer enviou como clientFilter, e o `mergeByClient` agrupa por canonical.
  const adsRowsForCRM = useMemo(
    () => filteredData.map((r) => ({
      Client: canonicalMap.canonicalByAdsName.get(r.Client) || foldMergedAdsClient(canonicalizeAdsClient(r.Client)),
      Lead: r.Lead,
      // Conversas agregadas por dia — entram no "Leads tráfego" do CRM (leads + conversas).
      Mensagens_iniciadas: r.Conversa,
      Valor_usado_BRL: r.Valor_usado_BRL,
      Fonte_Ads: r.Fonte_Ads,
    })),
    [filteredData, canonicalMap]
  );
  const { totals: crmTotals, origens: crmOrigens, medicos: crmMedicos, loading: crmLoading, error: crmError } = useCRMClienteData(
    clientFilterForCRM,
    dateFromStr,
    dateToStr,
    origemFilterForCRM,
    medicoFilterForCRM,
    adsRowsForCRM,
    clientsForEspecialidadeArr,
  );

  const filteredSummary = useMemo(() => {
    const map = new Map<string, {
      client: string; totalSpend: number; totalLeads: number;
      totalConversas: number; totalResultados: number;
      totalSpendLead: number; totalSpendConversa: number;
      totalImpressions: number;
      totalClicks: number; totalReach: number;
      avgCPL: number; avgCPConversa: number; avgCPResultado: number;
      bounceLead: number; bounceConversa: number;
      avgCTR: number; avgCPC: number; campaigns: number;
    }>();
    for (const row of filteredData) {
      const rawKey = row.Client;
      if (!rawKey) continue;
      const key = canonicalMap.canonicalByAdsName.get(rawKey) || foldMergedAdsClient(canonicalizeAdsClient(rawKey));
      const existing = map.get(key) || {
        client: key, totalSpend: 0, totalLeads: 0,
        totalConversas: 0, totalResultados: 0,
        totalSpendLead: 0, totalSpendConversa: 0,
        totalImpressions: 0,
        totalClicks: 0, totalReach: 0,
        avgCPL: 0, avgCPConversa: 0, avgCPResultado: 0,
        bounceLead: 0, bounceConversa: 0,
        avgCTR: 0, avgCPC: 0, campaigns: 0,
      };
      existing.totalSpend += row.Valor_usado_BRL;
      // Lead tráfego por cliente: Meta usa "Lead"; Google usa conversões reais
      // (Resultados_meta). Mantém a coluna "Leads" da tabela alinhada com o KPI.
      existing.totalLeads += leadTrafegoOf(row);
      existing.totalConversas += row.Conversa || 0;
      // "Resultados" do Relatório = nativo do Meta (alinhado com a tabela de campanhas).
      existing.totalResultados += row.Resultados_meta || 0;
      existing.totalSpendLead += row.Spend_Lead || 0;
      existing.totalSpendConversa += row.Spend_Conversa || 0;
      existing.totalImpressions += row.Impressões;
      existing.totalClicks += row.Cliques_no_link;
      existing.totalReach += row.Alcance;
      existing.campaigns += row.campaign_count;
      map.set(key, existing);
    }
    return Array.from(map.values())
      .map((c) => ({
        ...c,
        avgCPL: c.totalLeads > 0 ? c.totalSpend / c.totalLeads : 0,
        avgCPConversa: c.totalConversas > 0 ? c.totalSpend / c.totalConversas : 0,
        avgCPResultado: c.totalResultados > 0 ? c.totalSpend / c.totalResultados : 0,
        bounceLead: c.totalClicks > 0 ? c.totalLeads / c.totalClicks : 0,
        bounceConversa: c.totalClicks > 0 ? c.totalConversas / c.totalClicks : 0,
        avgCTR: c.totalImpressions > 0 ? (c.totalClicks / c.totalImpressions) * 100 : 0,
        avgCPC: c.totalClicks > 0 ? c.totalSpend / c.totalClicks : 0,
        especialidades: getEspecialidades(c.client),
      }))
      .sort((a, b) => b.totalSpend - a.totalSpend);
  }, [filteredData, canonicalMap, getEspecialidades]);

  // O `client` compartilhado pode ter sido setado por outra tela numa forma canônica
  // ligeiramente diferente; mapeia p/ a entrada equivalente da lista local (por cmpKey)
  // pra o dropdown destacar a opção certa. Escrever de volta mantém o cmpKey (consistente).
  const filtersForUI = useMemo(() => {
    if (filters.client === "all") return filters;
    const sel = clientCmpKey(filters.client);
    const match = clientList.find((c) => clientCmpKey(c) === sel);
    return match ? { ...filters, client: match } : filters;
  }, [filters, clientList]);

  const adsTotals = useMemo(() => ({
    spend: filteredData.reduce((s, r) => s + r.Valor_usado_BRL, 0),
    // Leads tráfego: Google usa Resultados (fallback p/ Lead); demais fontes usam Lead.
    leads: filteredData.reduce((s, r) => s + leadTrafegoOf(r), 0),
    impressions: filteredData.reduce((s, r) => s + r.Impressões, 0),
    clicks: filteredData.reduce((s, r) => s + r.Cliques_no_link, 0),
    reach: filteredData.reduce((s, r) => s + r.Alcance, 0),
  }), [filteredData]);

  // Split by source.
  // ATENÇÃO: a view emite Fonte_Ads = "Meta" (com fallback histórico "Facebook").
  // Filtrar só por "Facebook" zerava o lado Meta inteiro.
  const metaTotals = useMemo(() => {
    const meta = filteredData.filter((r) => r.Fonte_Ads === "Meta" || r.Fonte_Ads === "Facebook");
    return {
      spend: meta.reduce((s, r) => s + r.Valor_usado_BRL, 0),
      leads: meta.reduce((s, r) => s + r.Lead, 0),
    };
  }, [filteredData]);

  const googleTotals = useMemo(() => {
    const google = filteredData.filter((r) => r.Fonte_Ads === "Google");
    return {
      spend: google.reduce((s, r) => s + r.Valor_usado_BRL, 0),
      // Lead tráfego do Google = Resultados (fallback p/ Lead em dias sem resultado).
      leads: google.reduce((s, r) => s + leadTrafegoOf(r), 0),
    };
  }, [filteredData]);

  if (loading || crmLoading || espLoading) {
    return (
      <DashboardLayout>
        <div className="p-6 space-y-6">
          <div className="skeleton-loading h-12 w-80 rounded-lg" />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
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
          <div className="neu-card rounded-lg p-8 text-center">
            <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <ClientesHeader />

        <ClientesFilters
          filters={filtersForUI}
          onFiltersChange={setFilters}
          clients={clientList}
          especialidades={especialidadeList}
          origens={crmOrigens}
          medicos={crmMedicos}
        />

        {crmError && (
          <div className="neu-card rounded-lg p-4 border border-destructive/40">
            <p className="text-destructive text-sm">
              Erro ao carregar dados do CRM: {crmError}
            </p>
          </div>
        )}

        {/* Consolidated Summary */}
        <RelatorioGeralSummary
          adsTotals={adsTotals}
          crmTotals={crmTotals}
          metaTotals={metaTotals}
          googleTotals={googleTotals}
        />

        {/* Chart */}
        <ClientesInvestimentoChart data={filteredData} />

        {/* Table */}
        <ClientesTable clients={filteredSummary} />
      </div>
    </DashboardLayout>
  );
}
