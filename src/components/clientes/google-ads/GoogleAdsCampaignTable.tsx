import { GoogleCampaignSummary } from "@/hooks/useGoogleAdsClienteData";

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

// Frações 0..1 vindas do banco → percentual; null → "—".
function fmtFracPct(val: number | null) {
  return val == null ? "—" : `${fmtDecimal(val * 100)}%`;
}

export function GoogleAdsCampaignTable({ campaigns }: { campaigns: GoogleCampaignSummary[] }) {
  const totalInvestimento = campaigns.reduce((s, c) => s + c.investimento, 0);
  const totalOrcamento = campaigns.reduce((s, c) => s + c.orcamento, 0);
  const totalLeads = campaigns.reduce((s, c) => s + c.leads, 0);
  const totalLeadsTrafego = campaigns.reduce((s, c) => s + c.leadsTrafego, 0);
  const totalCustoLeadTrafego = totalLeadsTrafego > 0 ? totalInvestimento / totalLeadsTrafego : 0;
  const totalImpressoes = campaigns.reduce((s, c) => s + c.impressoes, 0);
  const totalCliques = campaigns.reduce((s, c) => s + c.cliques, 0);
  const totalCTR = totalImpressoes > 0 ? (totalCliques / totalImpressoes) * 100 : 0;
  const totalCPC = totalCliques > 0 ? totalInvestimento / totalCliques : 0;
  const totalTaxaConversao = totalCliques > 0 ? (totalLeads / totalCliques) * 100 : 0;
  // Consultas agendadas do CRM (Origem = Google Ads), atribuídas por campanha.
  const totalAgendadas = campaigns.reduce((s, c) => s + (c.consultasAgendadas || 0), 0);

  // Métricas de share/perda no total: média ponderada das campanhas (parcela/perdas
  // por impressões) — mesma regra dos cards.
  const wavgCol = (val: (c: GoogleCampaignSummary) => number | null, weight: (c: GoogleCampaignSummary) => number): number | null => {
    let num = 0, den = 0;
    for (const c of campaigns) {
      const v = val(c);
      if (v == null) continue;
      const w = weight(c) || 0;
      if (w <= 0) continue;
      num += v * w;
      den += w;
    }
    return den > 0 ? num / den : null;
  };
  const totalParcelaImpressao = wavgCol((c) => c.parcelaImpressao, (c) => c.impressoes);
  const totalPerdaOrcamento = wavgCol((c) => c.perdaOrcamento, (c) => c.impressoes);
  const totalPerdaClassificacao = wavgCol((c) => c.perdaClassificacao, (c) => c.impressoes);

  // Mesma ordem dos cards do painel. "Leads CRM (Google Ads)" e "Custo / Lead CRM"
  // vêm do CRM no nível do cliente — não há atribuição por campanha, então exibimos "—".
  const columns = [
    { key: "campanha", label: "Campanha", align: "left" as const },
    { key: "orcamento", label: "Orçamento", align: "left" as const },
    { key: "investimento", label: "Custo", align: "left" as const },
    { key: "leadsTrafego", label: "Lead tráfego", align: "left" as const },
    { key: "custoLeadTrafego", label: "Custo / Lead tráfego", align: "left" as const },
    { key: "impressoes", label: "Impressões", align: "left" as const },
    { key: "ctr", label: "CTR", align: "left" as const },
    { key: "cpc", label: "CPC", align: "left" as const },
    { key: "cliques", label: "Cliques", align: "left" as const },
    { key: "taxaConversao", label: "Taxa de conversão", align: "left" as const },
    { key: "parcelaImpressao", label: "Parcela de Impressão (Pesquisa)", align: "left" as const },
    { key: "faltaOrcamento", label: "Por falta de Orçamento", align: "left" as const },
    { key: "faltaClassificacao", label: "Por falta de Classificação", align: "left" as const },
    { key: "leadsCRM", label: "Leads CRM", align: "left" as const },
    { key: "custoLeadCRM", label: "CPL CRM", align: "left" as const },
    { key: "agendadasCRM", label: "Consultas Agendadas", align: "left" as const },
  ];

  function renderCell(c: GoogleCampaignSummary, key: string) {
    switch (key) {
      case "campanha": return c.campanha;
      case "leadsCRM": return "—";
      case "custoLeadCRM": return "—";
      case "agendadasCRM": return fmtNumber(c.consultasAgendadas);
      case "orcamento": return c.orcamento > 0 ? fmtCurrency(c.orcamento) : "—";
      case "investimento": return fmtCurrency(c.investimento);
      case "leadsTrafego": return fmtNumber(c.leadsTrafego);
      case "custoLeadTrafego": return fmtCurrency(c.custoLeadTrafego);
      case "impressoes": return fmtNumber(c.impressoes);
      case "ctr": return fmtPercent(c.ctr);
      case "cpc": return fmtCurrency(c.cpc);
      case "cliques": return fmtNumber(c.cliques);
      case "taxaConversao": return fmtPercent(c.taxaConversao);
      case "parcelaImpressao": return fmtFracPct(c.parcelaImpressao);
      case "faltaOrcamento": return fmtFracPct(c.perdaOrcamento);
      case "faltaClassificacao": return fmtFracPct(c.perdaClassificacao);
      default: return "—";
    }
  }

  function renderTotalCell(key: string) {
    switch (key) {
      case "campanha": return "Total";
      case "leadsCRM": return "—";
      case "custoLeadCRM": return "—";
      case "agendadasCRM": return fmtNumber(totalAgendadas);
      case "orcamento": return totalOrcamento > 0 ? fmtCurrency(totalOrcamento) : "—";
      case "investimento": return fmtCurrency(totalInvestimento);
      case "leadsTrafego": return fmtNumber(totalLeadsTrafego);
      case "custoLeadTrafego": return fmtCurrency(totalCustoLeadTrafego);
      case "impressoes": return fmtNumber(totalImpressoes);
      case "ctr": return fmtPercent(totalCTR);
      case "cpc": return fmtCurrency(totalCPC);
      case "cliques": return fmtNumber(totalCliques);
      case "taxaConversao": return fmtPercent(totalTaxaConversao);
      case "parcelaImpressao": return fmtFracPct(totalParcelaImpressao);
      case "faltaOrcamento": return fmtFracPct(totalPerdaOrcamento);
      case "faltaClassificacao": return fmtFracPct(totalPerdaClassificacao);
      default: return "—";
    }
  }

  return (
    <div className="neu-card rounded-xl p-5 space-y-3">
      <h3 className="text-sm font-semibold text-foreground">Campanhas</h3>
      <div className="overflow-x-auto max-h-[420px] overflow-y-auto relative">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-secondary/70 backdrop-blur">
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
