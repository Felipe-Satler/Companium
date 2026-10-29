import { useMemo } from "react";
import { useGoogleAdsClienteData } from "@/hooks/useGoogleAdsClienteData";
import {
  ComparacaoPanel,
  CompareMetricDef,
  fmtInt,
  fmtCurrency,
} from "@/components/clientes/ComparacaoPanel";

/**
 * COMPARAÇÃO DE PERÍODOS (Google Ads). Espelha a comparação do Meta Ads: recebe os totais do
 * período A prontos do pai e busca sozinho os do período B pelo MESMO hook da página
 * (useGoogleAdsClienteData), mudando só as datas. Visualização no painel compartilhado.
 */

// Todos os dados do quadro (GoogleAdsMetricsPanel): FocusStrip + células.
export interface GoogleCompareTotals {
  spend: number;
  orcamento: number;
  leadsCRMGoogle: number;
  custoLeadCRM: number;
  leadsTrafego: number;
  custoLeadTrafego: number;
  leads: number;
  impressions: number;
  clicks: number;
  cpl: number;
  cpc: number;
  cpm: number;
  ctr: number;
  taxaConversao: number;
  conversaoLP: number | null;
  parcelaImpressao: number | null;
  perdaOrcamento: number | null;
  perdaClassificacao: number | null;
}

const fmtPct = (v: number | null) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`);
// Frações 0..1 exibidas em % (igual ao painel: parcela de impressão, perdas, conversão de LP).
const fmtFracPct = (v: number | null) => (v == null ? "—" : `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`);

const METRICS: CompareMetricDef<GoogleCompareTotals>[] = [
  { key: "spend", label: "Investimento", group: "Investimento & CRM", dir: "neutral", get: (t) => t.spend, fmt: fmtCurrency },
  { key: "orcamento", label: "Orçamento", group: "Investimento & CRM", dir: "neutral", get: (t) => (t.orcamento > 0 ? t.orcamento : null), fmt: fmtCurrency },
  { key: "leadsCRMGoogle", label: "Leads CRM", group: "Investimento & CRM", dir: "higher", get: (t) => t.leadsCRMGoogle, fmt: fmtInt },
  { key: "custoLeadCRM", label: "CPL CRM", group: "Investimento & CRM", dir: "lower", get: (t) => (t.leadsCRMGoogle > 0 ? t.custoLeadCRM : null), fmt: fmtCurrency },
  { key: "leadsTrafego", label: "Leads Tráfego", group: "Resultados", dir: "higher", get: (t) => t.leadsTrafego, fmt: fmtInt },
  { key: "custoLeadTrafego", label: "Custo / Lead Tráfego", group: "Resultados", dir: "lower", get: (t) => (t.leadsTrafego > 0 ? t.custoLeadTrafego : null), fmt: fmtCurrency },
  { key: "leads", label: "Leads", group: "Resultados", dir: "higher", get: (t) => t.leads, fmt: fmtInt },
  { key: "taxaConversao", label: "Taxa de Conversão", group: "Resultados", dir: "higher", get: (t) => t.taxaConversao, fmt: fmtPct },
  { key: "conversaoLP", label: "Conversão de LP", group: "Resultados", dir: "higher", get: (t) => t.conversaoLP, fmt: fmtFracPct },
  { key: "impressions", label: "Impressões", group: "Entrega", dir: "higher", get: (t) => t.impressions, fmt: fmtInt },
  { key: "clicks", label: "Cliques", group: "Entrega", dir: "higher", get: (t) => t.clicks, fmt: fmtInt },
  { key: "ctr", label: "CTR", group: "Entrega", dir: "higher", get: (t) => t.ctr, fmt: fmtPct },
  { key: "cpc", label: "CPC", group: "Entrega", dir: "lower", get: (t) => (t.clicks > 0 ? t.cpc : null), fmt: fmtCurrency },
  { key: "cpm", label: "CPM", group: "Entrega", dir: "lower", get: (t) => (t.impressions > 0 ? t.cpm : null), fmt: fmtCurrency },
  { key: "cpl", label: "CPL", group: "Entrega", dir: "lower", get: (t) => (t.leads > 0 ? t.cpl : null), fmt: fmtCurrency },
  { key: "parcelaImpressao", label: "Parcela de Impressão", group: "Rede de Pesquisa", dir: "higher", get: (t) => t.parcelaImpressao, fmt: fmtFracPct },
  { key: "perdaOrcamento", label: "Perda por Orçamento", group: "Rede de Pesquisa", dir: "lower", get: (t) => t.perdaOrcamento, fmt: fmtFracPct },
  { key: "perdaClassificacao", label: "Perda por Classificação", group: "Rede de Pesquisa", dir: "lower", get: (t) => t.perdaClassificacao, fmt: fmtFracPct },
];

const GROUP_ORDER = ["Investimento & CRM", "Resultados", "Entrega", "Rede de Pesquisa"];

// Totais zerados: placeholder do lado A enquanto carrega (o painel mostra skeleton nesse
// intervalo, então esses zeros nunca aparecem na tela).
const ZERO_GOOGLE: GoogleCompareTotals = {
  spend: 0, orcamento: 0, leadsCRMGoogle: 0, custoLeadCRM: 0, leadsTrafego: 0, custoLeadTrafego: 0,
  leads: 0, impressions: 0, clicks: 0, cpl: 0, cpc: 0, cpm: 0, ctr: 0, taxaConversao: 0,
  conversaoLP: null, parcelaImpressao: null, perdaOrcamento: null, perdaClassificacao: null,
};

// Especificação de UM lado: um cliente (nome cru p/ o hook) sobre uma janela de datas. Comparar
// PERÍODOS = mesmo clientForHook, datas diferentes; comparar CLIENTES = datas iguais, clientes diferentes.
export interface GoogleCompareSide {
  label: string;
  clientForHook: string;
  from: string;
  to: string;
  medicoFilter?: string[];
}

function useGoogleSide(side: GoogleCompareSide): { totals: GoogleCompareTotals | null; loading: boolean } {
  const { totals, loading } = useGoogleAdsClienteData(side.clientForHook, side.from, side.to, side.medicoFilter);
  const t = useMemo<GoogleCompareTotals | null>(() => (loading ? null : totals), [totals, loading]);
  return { totals: t, loading };
}

export function GoogleAdsComparacao({ sideA, sideB }: { sideA: GoogleCompareSide; sideB: GoogleCompareSide }) {
  const a = useGoogleSide(sideA);
  const b = useGoogleSide(sideB);
  const loading = a.loading || b.loading || !a.totals;

  return (
    <ComparacaoPanel
      title="Comparação"
      metrics={METRICS}
      groupOrder={GROUP_ORDER}
      totalsA={a.totals ?? ZERO_GOOGLE}
      totalsB={b.totals}
      labelA={sideA.label}
      labelB={sideB.label}
      loading={loading}
    />
  );
}
