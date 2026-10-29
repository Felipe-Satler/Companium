import { FocusStrip } from "@/components/clientes/FocusStrip";
import { SectionLabel } from "@/components/clientes/SectionLabel";
import { investimentoComImposto } from "@/utils/crmCalculations";

interface MetaAdsMetricsPanelProps {
  totals: {
    leads: number;
    cpl: number;
    spend: number;
    reach: number;
    impressions: number;
    frequency: number;
    cpm: number;
    ctr: number;
    cpc: number;
    clicks: number;
    videoViews3s: number;
    videoViews95pct: number;
    hook: number;
    hold: number;
    retencao95: number;
    orcamento: number;
    mensagens: number;
    custoMensagem: number;
    visitas: number;
    custoVisita: number;
    resultados: number;
    custoResultado: number;
    leadsCRMMeta: number;
    bounceLead: number;
    bounceConversa: number;
    qualityRanking: string | null;
    engagementRanking: string | null;
    conversionRanking: string | null;
  };
}

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

function fmtPercent(val: number) {
  return `${(val * 100).toFixed(2).replace(".", ",")}%`;
}

const SEM_DADOS = "—";

// Célula do PAINEL ÚNICO (padrão do print): valor grande + rótulo, célula BRANCA.
// Valores negativos (ex.: bounce) saem em vermelho.
function Cell({ value, label }: { value: string; label: string }) {
  const danger = value.trim().startsWith("-");
  return (
    <div className="bg-card p-4">
      <p className={`text-xl font-bold tabular-nums ${danger ? "text-red-500" : "text-foreground"}`}>{value}</p>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">{label}</p>
    </div>
  );
}

export function MetaAdsMetricsPanel({ totals }: MetaAdsMetricsPanelProps) {
  // CPL CRM = investimento total ÷ leads CRM (Meta). É o "real" comparado ao planejado de CPL.
  const cplCRM = totals.leadsCRMMeta > 0 ? totals.spend / totals.leadsCRMMeta : 0;

  // Métricas detalhadas em uma única grade (o print não repete os 4 KPIs do topo:
  // Leads CRM, CPL CRM, Leads tráfego, Investimento).
  const cells: { value: string; label: string }[] = [
    { value: totals.custoResultado > 0 ? fmtCurrency(totals.custoResultado) : SEM_DADOS, label: "Custo/Lead tráfego" },
    { value: totals.leads > 0 ? fmt(totals.leads) : SEM_DADOS, label: "Leads" },
    { value: totals.cpl > 0 ? fmtCurrency(totals.cpl) : SEM_DADOS, label: "Custo / Lead" },
    { value: fmt(totals.mensagens), label: "Conversas" },
    { value: totals.custoMensagem > 0 ? fmtCurrency(totals.custoMensagem) : SEM_DADOS, label: "Custo / Conversa" },
    { value: fmtPercent(totals.bounceLead), label: "Bounce Lead" },
    { value: fmtPercent(totals.bounceConversa), label: "Bounce Conversa" },
    { value: fmtInt(totals.reach), label: "Alcance" },
    { value: fmtInt(totals.impressions), label: "Impressões" },
    { value: fmtInt(totals.clicks), label: "Cliques no Link" },
    { value: totals.frequency.toFixed(2).replace(".", ","), label: "Frequência" },
    { value: fmtCurrency(totals.cpm), label: "CPM" },
    { value: `${totals.ctr.toFixed(2).replace(".", ",")}%`, label: "CTR" },
    { value: fmtCurrency(totals.cpc), label: "CPC" },
    { value: `${totals.hook.toFixed(2).replace(".", ",")}%`, label: "Hook (3s/Impr)" },
    { value: `${totals.hold.toFixed(2).replace(".", ",")}%`, label: "Hold (95%/Impr)" },
  ];

  return (
    <div className="space-y-4">
      {/* DADOS PRINCIPAIS em card: Leads CRM, CPL CRM, Leads tráfego, Investimento, Investimento + Imposto. */}
      <FocusStrip
        items={[
          { label: "Leads CRM", value: fmt(totals.leadsCRMMeta) },
          { label: "CPL CRM", value: totals.leadsCRMMeta > 0 ? fmtCurrency(cplCRM) : SEM_DADOS, accent: "blue" },
          { label: "Leads tráfego", value: fmt(totals.resultados) },
          { label: "Investimento Total", value: fmtCurrency(totals.spend) },
          { label: "Investimento + Imposto", value: fmtCurrency(investimentoComImposto(totals.spend)) },
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
