import { FocusStrip } from "@/components/clientes/FocusStrip";
import { SectionLabel } from "@/components/clientes/SectionLabel";

interface GoogleAdsMetricsPanelProps {
  totals: {
    leads: number;
    cpl: number;
    leadsTrafego: number;
    custoLeadTrafego: number;
    spend: number;
    orcamento: number;
    impressions: number;
    cpm: number;
    ctr: number;
    cpc: number;
    clicks: number;
    resultados: number;
    custoResultado: number;
    taxaConversao: number;
    // Frações 0..1 (ou null quando não há dado no período).
    conversaoLP: number | null;
    parcelaImpressao: number | null;
    perdaOrcamento: number | null;
    perdaClassificacao: number | null;
    leadsCRMGoogle: number;
    custoLeadCRM: number;
  };
}

// Exibido quando a métrica não tem dado no período selecionado.
const SEM_DADOS = "—";

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

// Célula do PAINEL ÚNICO (padrão do print): valor grande + rótulo, célula BRANCA.
function Cell({ value, label }: { value: string; label: string }) {
  const danger = value.trim().startsWith("-");
  return (
    <div className="bg-card p-4">
      <p className={`text-xl font-bold tabular-nums ${danger ? "text-red-500" : "text-foreground"}`}>{value}</p>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">{label}</p>
    </div>
  );
}

export function GoogleAdsMetricsPanel({ totals }: GoogleAdsMetricsPanelProps) {
  const fmtPct = (v: number) => `${v.toFixed(2).replace(".", ",")}%`;
  // Frações 0..1 vindas do banco → percentual; null → "—".
  const fmtFracPct = (v: number | null) => (v == null ? SEM_DADOS : fmtPct(v * 100));

  // Métricas detalhadas em uma única grade (o print não repete os 4 KPIs do topo:
  // Leads CRM, CPL CRM, Lead tráfego, Investimento).
  const cells: { value: string; label: string }[] = [
    { value: totals.orcamento > 0 ? fmtCurrency(totals.orcamento) : SEM_DADOS, label: "Orçamento" },
    { value: totals.custoLeadTrafego > 0 ? fmtCurrency(totals.custoLeadTrafego) : SEM_DADOS, label: "Custo/Lead tráfego" },
    { value: fmtInt(totals.impressions), label: "Impressões" },
    { value: fmtPct(totals.ctr), label: "CTR" },
    { value: fmtCurrency(totals.cpc), label: "CPC" },
    { value: fmtInt(totals.clicks), label: "Cliques" },
    { value: fmtPct(totals.taxaConversao), label: "Taxa de conversão" },
    { value: fmtFracPct(totals.parcelaImpressao), label: "Parcela de Impressão (Pesquisa)" },
    { value: fmtFracPct(totals.perdaOrcamento), label: "Perda por Orçamento" },
    { value: fmtFracPct(totals.perdaClassificacao), label: "Perda por Classificação" },
  ];

  return (
    <div className="space-y-4">
      {/* DADOS PRINCIPAIS em card: Leads CRM, CPL CRM, Lead tráfego, Investimento. */}
      <FocusStrip
        items={[
          { label: "Leads CRM", value: fmt(totals.leadsCRMGoogle) },
          { label: "CPL CRM", value: totals.leadsCRMGoogle > 0 ? fmtCurrency(totals.custoLeadCRM) : SEM_DADOS, accent: "blue" },
          { label: "Lead tráfego", value: fmt(totals.leadsTrafego) },
          { label: "Investimento Total", value: fmtCurrency(totals.spend) },
        ]}
      />

      <SectionLabel>Métricas detalhadas</SectionLabel>

      {/* Painel ÚNICO (padrão do print): células brancas separadas por linhas AZUL-CLARO. */}
      <div className="neu-card rounded-2xl overflow-hidden">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-px bg-primary/15">
          {cells.map((c, i) => (
            <Cell key={i} value={c.value} label={c.label} />
          ))}
        </div>
      </div>
    </div>
  );
}
