import { useMemo } from "react";
import { useMetaAdsClienteData } from "@/hooks/useMetaAdsClienteData";
import {
  ComparacaoPanel,
  CompareMetricDef,
  fmtInt,
  fmtCurrency,
} from "@/components/clientes/ComparacaoPanel";

/**
 * COMPARAÇÃO DE PERÍODOS (Meta Ads). Recebe os totais já calculados do período A (o filtro
 * corrente da tela, para não refazer o fetch) e busca, por conta própria, os totais do
 * período B — reaproveitando o MESMO hook da página (useMetaAdsClienteData) com os mesmos
 * cliente/médico, mudando só as datas.
 *
 * Montado CONDICIONALMENTE (só quando a comparação está ativa), então o hook de fetch do
 * período B só dispara quando o usuário realmente compara. A visualização (barras, variação,
 * placar) fica no painel compartilhado ComparacaoPanel.
 */

// Campos comparados. `leadsCRMMeta` vem separado do hook; o resto é o objeto `totals` do Meta.
export interface MetaCompareTotals {
  spend: number;
  leads: number;
  mensagens: number;
  resultados: number;
  reach: number;
  impressions: number;
  frequency: number;
  clicks: number;
  cpl: number;
  cpc: number;
  ctr: number;
  cpm: number;
  custoResultado: number;
  custoMensagem: number;
  hook: number;
  hold: number;
  retencao95: number;
  bounceLead: number;
  bounceConversa: number;
  leadsCRMMeta: number;
}

// CPL do CRM derivado (investimento ÷ leads CRM Meta). null quando não há leads.
const cplCRMOf = (t: MetaCompareTotals) => (t.leadsCRMMeta > 0 ? t.spend / t.leadsCRMMeta : null);
// hook/hold/CTR já vêm em % (ex.: 2,5 = 2,5%); bounce vem como fração (ex.: -0,5 = -50%).
const fmtPct = (v: number | null) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`);
const fmtFracPct = (v: number | null) => (v == null ? "—" : `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`);
const fmtFreq = (v: number | null) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}x`);

const METRICS: CompareMetricDef<MetaCompareTotals>[] = [
  { key: "spend", label: "Investimento", group: "Investimento & CRM", dir: "neutral", get: (t) => t.spend, fmt: fmtCurrency },
  { key: "leadsCRMMeta", label: "Leads CRM", group: "Investimento & CRM", dir: "higher", get: (t) => t.leadsCRMMeta, fmt: fmtInt },
  { key: "cplCRM", label: "CPL CRM", group: "Investimento & CRM", dir: "lower", get: cplCRMOf, fmt: fmtCurrency },
  { key: "resultados", label: "Leads Tráfego", group: "Resultados", dir: "higher", get: (t) => t.resultados, fmt: fmtInt },
  { key: "custoResultado", label: "Custo / Resultado", group: "Resultados", dir: "lower", get: (t) => t.custoResultado, fmt: fmtCurrency },
  { key: "leads", label: "Leads", group: "Resultados", dir: "higher", get: (t) => t.leads, fmt: fmtInt },
  { key: "mensagens", label: "Mensagens", group: "Resultados", dir: "higher", get: (t) => t.mensagens, fmt: fmtInt },
  { key: "reach", label: "Alcance", group: "Entrega", dir: "higher", get: (t) => t.reach, fmt: fmtInt },
  { key: "impressions", label: "Impressões", group: "Entrega", dir: "higher", get: (t) => t.impressions, fmt: fmtInt },
  { key: "frequency", label: "Frequência", group: "Entrega", dir: "neutral", get: (t) => t.frequency, fmt: fmtFreq },
  { key: "clicks", label: "Cliques", group: "Entrega", dir: "higher", get: (t) => t.clicks, fmt: fmtInt },
  { key: "cpl", label: "CPL", group: "Eficiência", dir: "lower", get: (t) => t.cpl, fmt: fmtCurrency },
  { key: "cpc", label: "CPC", group: "Eficiência", dir: "lower", get: (t) => t.cpc, fmt: fmtCurrency },
  { key: "cpm", label: "CPM", group: "Eficiência", dir: "lower", get: (t) => t.cpm, fmt: fmtCurrency },
  { key: "ctr", label: "CTR", group: "Eficiência", dir: "higher", get: (t) => t.ctr, fmt: fmtPct },
  { key: "custoMensagem", label: "Custo / Mensagem", group: "Eficiência", dir: "lower", get: (t) => t.custoMensagem, fmt: fmtCurrency },
  { key: "hook", label: "Hook (3s/Impr)", group: "Vídeo & Engajamento", dir: "higher", get: (t) => t.hook, fmt: fmtPct },
  { key: "hold", label: "Hold (95%/Impr)", group: "Vídeo & Engajamento", dir: "higher", get: (t) => t.hold, fmt: fmtPct },
  { key: "bounceLead", label: "Bounce Lead", group: "Vídeo & Engajamento", dir: "higher", get: (t) => t.bounceLead, fmt: fmtFracPct },
  { key: "bounceConversa", label: "Bounce Conversa", group: "Vídeo & Engajamento", dir: "higher", get: (t) => t.bounceConversa, fmt: fmtFracPct },
];

const GROUP_ORDER = ["Investimento & CRM", "Resultados", "Entrega", "Eficiência", "Vídeo & Engajamento"];

// Totais zerados: usados só como placeholder do lado A enquanto carrega (o painel mostra
// skeleton nesse intervalo, então esses zeros nunca aparecem na tela).
const ZERO_META: MetaCompareTotals = {
  spend: 0, leads: 0, mensagens: 0, resultados: 0, reach: 0, impressions: 0, frequency: 0,
  clicks: 0, cpl: 0, cpc: 0, ctr: 0, cpm: 0, custoResultado: 0, custoMensagem: 0, hook: 0,
  hold: 0, retencao95: 0, bounceLead: 0, bounceConversa: 0, leadsCRMMeta: 0,
};

// Especificação de UM lado da comparação: um cliente (nome cru p/ o hook) sobre uma janela de
// datas. `label` é o rótulo exibido. Para comparar PERÍODOS, os dois lados usam o mesmo
// clientForHook com datas diferentes; para comparar CLIENTES, datas iguais e clientes diferentes.
export interface MetaCompareSide {
  label: string;
  clientForHook: string;
  from: string;
  to: string;
  medicoFilter?: string[];
}

// Busca os totais de UM lado reusando exatamente o hook da página (useMetaAdsClienteData).
function useMetaSide(side: MetaCompareSide): { totals: MetaCompareTotals | null; loading: boolean } {
  const { totals, leadsCRMMeta, loading } = useMetaAdsClienteData(side.clientForHook, side.from, side.to, side.medicoFilter);
  const t = useMemo<MetaCompareTotals | null>(
    () => (loading ? null : { ...totals, leadsCRMMeta }),
    [totals, leadsCRMMeta, loading],
  );
  return { totals: t, loading };
}

export function MetaAdsComparacao({ sideA, sideB }: { sideA: MetaCompareSide; sideB: MetaCompareSide }) {
  // Ordem FIXA de hooks: lado A, depois lado B. Quando os dois lados compartilham a janela de
  // datas (comparar clientes), o fetch do mesmo cliente é reaproveitado pelo cache do hook.
  const a = useMetaSide(sideA);
  const b = useMetaSide(sideB);
  const loading = a.loading || b.loading || !a.totals;

  return (
    <ComparacaoPanel
      title="Comparação"
      metrics={METRICS}
      groupOrder={GROUP_ORDER}
      totalsA={a.totals ?? ZERO_META}
      totalsB={b.totals}
      labelA={sideA.label}
      labelB={sideB.label}
      loading={loading}
    />
  );
}
