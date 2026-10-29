import { CampaignSummary } from "@/hooks/useMetaAdsClienteData";
import { formatCampaignResultType } from "@/lib/metaAdsResultTypeLabels";

function fmtCurrency(val: number) {
  return val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtNumber(val: number) {
  return val.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

function fmtDecimal(val: number, digits = 2) {
  return val.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtPercent(val: number) {
  return `${fmtDecimal(val)}%`;
}

export function MetaAdsCampaignTable({ campaigns }: { campaigns: CampaignSummary[] }) {
  const totalInvestimento = campaigns.reduce((s, c) => s + c.investimento, 0);
  const totalLeads = campaigns.reduce((s, c) => s + c.leadsTrafico, 0);
  const totalAlcance = campaigns.reduce((s, c) => s + c.alcance, 0);
  const totalImpressoes = campaigns.reduce((s, c) => s + c.impressoes, 0);
  const totalCliques = campaigns.reduce((s, c) => s + c.cliques, 0);
  const totalCPM = totalImpressoes > 0 ? (totalInvestimento / totalImpressoes) * 1000 : 0;
  const totalCTR = totalImpressoes > 0 ? (totalCliques / totalImpressoes) * 100 : 0;
  const totalCPC = totalCliques > 0 ? totalInvestimento / totalCliques : 0;
  // Frequência total = ponderada por impressões (média simples distorce o número).
  const freqWeightedNum = campaigns.reduce((s, c) => s + (c.frequencia || 0) * (c.impressoes || 0), 0);
  const freqWeight = campaigns.reduce((s, c) => s + (c.impressoes || 0), 0);
  const avgFreq = freqWeight > 0 ? freqWeightedNum / freqWeight : 0;
  const totalV3s = campaigns.reduce((s, c) => s + (c.videoViews3s || 0), 0);
  const totalV95 = campaigns.reduce((s, c) => s + (c.videoViews95pct || 0), 0);
  const totalHook = totalImpressoes > 0 ? (totalV3s / totalImpressoes) * 100 : 0;
  const totalHold = totalImpressoes > 0 ? (totalV95 / totalImpressoes) * 100 : 0;
  const totalOrc = campaigns.reduce((s, c) => s + (c.orcamento || 0), 0);
  const totalMsg = campaigns.reduce((s, c) => s + (c.mensagens || 0), 0);
  const totalResultados = campaigns.reduce((s, c) => s + (c.resultados || 0), 0);
  // Todos os custos = totalSpend / count (mesma definição do Meta UI).
  const totalCPL = totalLeads > 0 ? totalInvestimento / totalLeads : 0;
  const totalCpMsg = totalMsg > 0 ? totalInvestimento / totalMsg : 0;
  const totalCustoResultado = totalResultados > 0 ? totalInvestimento / totalResultados : 0;
  const totalBounceLead = totalCliques > 0 ? totalLeads / totalCliques - 1 : 0;
  const totalBounceConversa = totalCliques > 0 ? totalMsg / totalCliques - 1 : 0;
  // Consultas agendadas do CRM (origem Meta Ads), atribuídas por campanha do Kommo.
  const totalConsultasAgen = campaigns.reduce((s, c) => s + (c.consultasAgen || 0), 0);

  const columns = [
    { key: "campanha", label: "Campanha", align: "left" as const },
    { key: "tipoResultado", label: "Tipo de Resultado", align: "left" as const },
    { key: "orcamento", label: "Orçamento", align: "left" as const },
    { key: "investimento", label: "Investimento", align: "left" as const },
    { key: "resultados", label: "Resultados", align: "left" as const },
    { key: "custoResultado", label: "Custo/Resultado", align: "left" as const },
    { key: "alcance", label: "Alcance", align: "left" as const },
    { key: "frequencia", label: "Frequência", align: "left" as const },
    { key: "impressoes", label: "Impressões", align: "left" as const },
    { key: "videoViews3s", label: "Vídeo 3s", align: "left" as const },
    { key: "hook", label: "Hook Rate", align: "left" as const },
    { key: "videoViews95pct", label: "Vídeo 95%", align: "left" as const },
    { key: "hold", label: "Hold Rate", align: "left" as const },
    { key: "cpm", label: "CPM", align: "left" as const },
    { key: "ctr", label: "CTR", align: "left" as const },
    { key: "cpc", label: "CPC", align: "left" as const },
    { key: "cliques", label: "Cliques (no link)", align: "left" as const },
    { key: "bounceConversa", label: "Bounce Rate (mensagem)", align: "left" as const },
    { key: "mensagens", label: "Mensagens Iniciadas", align: "left" as const },
    { key: "custoMensagem", label: "Custo/Mensagem", align: "left" as const },
    { key: "bounceLead", label: "Bounce Rate (lead)", align: "left" as const },
    { key: "leadsTrafico", label: "Lead", align: "left" as const },
    { key: "cplTrafico", label: "Custo/Lead", align: "left" as const },
    { key: "leadsCRM", label: "Leads CRM", align: "left" as const },
    { key: "custoLeadCRM", label: "CPL CRM", align: "left" as const },
    { key: "agendadasCRM", label: "Consultas Agendadas", align: "left" as const },
  ];

  function renderCell(c: CampaignSummary, key: string) {
    switch (key) {
      case "campanha": return c.campanha;
      case "tipoResultado": return formatCampaignResultType(c.tipoResultado);
      case "orcamento": return c.orcamento > 0 ? fmtCurrency(c.orcamento) : "—";
      case "investimento": return fmtCurrency(c.investimento);
      case "resultados": return fmtNumber(c.resultados);
      case "custoResultado": return c.custoResultado > 0 ? fmtCurrency(c.custoResultado) : "—";
      case "alcance": return fmtNumber(c.alcance);
      case "frequencia": return fmtDecimal(c.frequencia);
      case "impressoes": return fmtNumber(c.impressoes);
      case "videoViews3s": return fmtNumber(c.videoViews3s || 0);
      case "hook": return fmtPercent(c.hook || 0);
      case "videoViews95pct": return fmtNumber(c.videoViews95pct || 0);
      case "hold": return fmtPercent(c.hold || 0);
      case "cpm": return fmtCurrency(c.cpm);
      case "ctr": return fmtPercent(c.ctr);
      case "cpc": return fmtCurrency(c.cpc);
      case "cliques": return fmtNumber(c.cliques);
      case "bounceConversa": return fmtPercent((c.bounceConversa || 0) * 100);
      case "mensagens": return fmtNumber(c.mensagens || 0);
      case "custoMensagem": return c.custoMensagem > 0 ? fmtCurrency(c.custoMensagem) : "—";
      case "bounceLead": return fmtPercent((c.bounceLead || 0) * 100);
      case "leadsTrafico": return c.leadsTrafico > 0 ? fmtNumber(c.leadsTrafico) : "—";
      case "cplTrafico": return fmtCurrency(c.cplTrafico);
      case "leadsCRM": return "—";
      case "custoLeadCRM": return "—";
      case "agendadasCRM": return c.consultasAgen != null ? fmtNumber(c.consultasAgen) : "—";
      default: return "—";
    }
  }

  function renderTotalCell(key: string) {
    switch (key) {
      case "campanha": return "Total";
      case "tipoResultado": return "—";
      case "orcamento": return totalOrc > 0 ? fmtCurrency(totalOrc) : "—";
      case "investimento": return fmtCurrency(totalInvestimento);
      case "resultados": return fmtNumber(totalResultados);
      case "custoResultado": return totalCustoResultado > 0 ? fmtCurrency(totalCustoResultado) : "—";
      case "alcance": return fmtNumber(totalAlcance);
      case "frequencia": return fmtDecimal(avgFreq);
      case "impressoes": return fmtNumber(totalImpressoes);
      case "videoViews3s": return fmtNumber(totalV3s);
      case "hook": return fmtPercent(totalHook);
      case "videoViews95pct": return fmtNumber(totalV95);
      case "hold": return fmtPercent(totalHold);
      case "cpm": return fmtCurrency(totalCPM);
      case "ctr": return fmtPercent(totalCTR);
      case "cpc": return fmtCurrency(totalCPC);
      case "cliques": return fmtNumber(totalCliques);
      case "bounceConversa": return fmtPercent(totalBounceConversa * 100);
      case "mensagens": return fmtNumber(totalMsg);
      case "custoMensagem": return totalCpMsg > 0 ? fmtCurrency(totalCpMsg) : "—";
      case "bounceLead": return fmtPercent(totalBounceLead * 100);
      case "leadsTrafico": return totalLeads > 0 ? fmtNumber(totalLeads) : "—";
      case "cplTrafico": return fmtCurrency(totalCPL);
      case "leadsCRM": return "—";
      case "custoLeadCRM": return "—";
      case "agendadasCRM": return fmtNumber(totalConsultasAgen);
      default: return "—";
    }
  }

  return (
    <div className="neu-card rounded-xl p-5 space-y-3">
      <h3 className="text-sm font-semibold text-foreground">Campanhas</h3>
      <div className="overflow-x-auto max-h-[420px] overflow-y-auto relative">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-background">
            <tr className="border-b border-border/50">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`py-2 px-3 text-muted-foreground font-medium whitespace-nowrap ${
                    col.align === "left" ? "text-left" : "text-right"
                  }`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c, i) => (
              <tr key={i} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`py-2.5 px-3 whitespace-nowrap ${
                      col.align === "left" ? "text-left" : "text-right"
                    } ${col.key === "campanha" ? "text-foreground font-medium" : "text-foreground"}`}
                  >
                    {renderCell(c, col.key)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot className="sticky bottom-0 z-10 bg-background">
            <tr className="border-t-2 border-border font-semibold">
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={`py-2.5 px-3 text-foreground whitespace-nowrap ${
                    col.align === "left" ? "text-left" : "text-right"
                  }`}
                >
                  {renderTotalCell(col.key)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
