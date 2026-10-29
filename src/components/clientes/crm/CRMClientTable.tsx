import { CRMClientRow } from "@/hooks/useCRMClienteData";
import { prettyClientLabel } from "@/data/clienteAliases";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";


function fmtCurrency(val: number) {
  return val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmt(val: number) {
  return val.toLocaleString("pt-BR");
}

/** Iniciais do cliente p/ o avatar (ignora título Dr./Dra.). */
function initials(name: string) {
  const parts = name.replace(/^(Dr|Dra|Sr|Sra)\.?\s+/i, "").trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "";
  const b = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (a + b).toUpperCase() || "?";
}

interface CRMClientTableProps {
  data: CRMClientRow[];
  origemFilter?: string | string[];
}

export function CRMClientTable({ data, origemFilter = "all" }: CRMClientTableProps) {
  const cacLabel = (() => {
    const arr = Array.isArray(origemFilter) ? origemFilter : [origemFilter];
    const cleaned = arr.filter((v) => v && v !== "all");
    if (cleaned.length === 0) return "CAC (Geral)";
    if (cleaned.length === 1) {
      if (cleaned[0] === "Meta Ads") return "CAC (Meta)";
      if (cleaned[0] === "Google Ads") return "CAC (Google)";
      return "CAC";
    }
    return "CAC";
  })();
  const totalRow = data.reduce(
    (acc, r) => ({
      investimento: acc.investimento + r.investimento,
      leadsTrafego: acc.leadsTrafego + r.leadsTrafego,
      leadsTrafegoMeta: acc.leadsTrafegoMeta + r.leadsTrafegoMeta,
      leadsTrafegoGoogle: acc.leadsTrafegoGoogle + r.leadsTrafegoGoogle,
      leadsCRM: acc.leadsCRM + r.leadsCRM,
      consultasAgendadas: acc.consultasAgendadas + r.consultasAgendadas,
      valorConsultasAgendadas: acc.valorConsultasAgendadas + r.valorConsultasAgendadas,
      consultasRealizadas: acc.consultasRealizadas + r.consultasRealizadas,
      valorConsultasRealizadas: acc.valorConsultasRealizadas + r.valorConsultasRealizadas,
      procedimentosAgendados: acc.procedimentosAgendados + r.procedimentosAgendados,
      valorProcedimentosAgendados: acc.valorProcedimentosAgendados + r.valorProcedimentosAgendados,
      procedimentosRealizados: acc.procedimentosRealizados + r.procedimentosRealizados,
      valorProcedimentosRealizados: acc.valorProcedimentosRealizados + r.valorProcedimentosRealizados,
      faturamentoBrutoRealizados: acc.faturamentoBrutoRealizados + r.faturamentoBrutoRealizados,
    }),
    {
      investimento: 0, leadsTrafego: 0, leadsTrafegoMeta: 0, leadsTrafegoGoogle: 0, leadsCRM: 0,
      consultasAgendadas: 0, valorConsultasAgendadas: 0,
      consultasRealizadas: 0, valorConsultasRealizadas: 0,
      procedimentosAgendados: 0, valorProcedimentosAgendados: 0,
      procedimentosRealizados: 0, valorProcedimentosRealizados: 0,
      faturamentoBrutoRealizados: 0,
    }
  );

  const totalCac = totalRow.consultasAgendadas > 0 ? totalRow.investimento / totalRow.consultasAgendadas : 0;
  const totalRoas = totalRow.investimento > 0 ? totalRow.faturamentoBrutoRealizados / totalRow.investimento : 0;

  const cellClass = "text-xs whitespace-nowrap px-3 py-2.5";
  const headClass = "text-[10px] uppercase tracking-wider whitespace-nowrap px-3 py-2.5 text-muted-foreground font-semibold";

  return (
    <div className="neu-card rounded-xl overflow-hidden">
      <div className="p-4 border-b border-border/50">
        <h3 className="text-sm font-semibold text-foreground">Detalhamento por Cliente</h3>
        <p className="text-[10px] text-muted-foreground mt-1">
          INVESTIMENTO só é relevante para Meta Ads e/ou Google Ads
        </p>
      </div>
      <div className="overflow-auto max-h-[500px] w-full">
        <table className="w-full caption-bottom text-sm">
          <TableHeader className="sticky top-0 z-10 bg-secondary/70 backdrop-blur">
            <TableRow>
              <TableHead className={headClass}>Cliente</TableHead>
              <TableHead className={headClass}>Especialidade</TableHead>
              <TableHead className={`${headClass} text-left`}>Investimento</TableHead>
              <TableHead className={`${headClass} text-left`}>Leads Tráfego</TableHead>
              <TableHead className={`${headClass} text-left`}>LT Meta</TableHead>
              <TableHead className={`${headClass} text-left`}>LT Google</TableHead>
              <TableHead className={`${headClass} text-left`}>Leads CRM</TableHead>
              <TableHead className={`${headClass} text-left`}>Cons. Agen.</TableHead>
              <TableHead className={`${headClass} text-left`}>{cacLabel}</TableHead>
              <TableHead className={`${headClass} text-left`}>Vlr C. Agen.</TableHead>
              <TableHead className={`${headClass} text-left`}>Cons. Realiz.</TableHead>
              <TableHead className={`${headClass} text-left`}>Vlr C. Realiz.</TableHead>
              <TableHead className={`${headClass} text-left`}>Proc. Agen.</TableHead>
              <TableHead className={`${headClass} text-left`}>Vlr P. Agen.</TableHead>
              <TableHead className={`${headClass} text-left`}>Proc. Realiz.</TableHead>
              <TableHead className={`${headClass} text-left`}>Vlr P. Realiz.</TableHead>
              <TableHead className={`${headClass} text-left`}>Fat. Bruto (Realiz.)</TableHead>
              <TableHead className={`${headClass} text-left`}>ROAS</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => (
              <TableRow key={row.client} className="hover:bg-secondary/40 transition-colors">
                <TableCell className={`${cellClass} font-medium text-left`}>
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary text-[10px] font-bold">
                      {initials(prettyClientLabel(row.client))}
                    </span>
                    <span>{prettyClientLabel(row.client)}</span>
                  </div>
                </TableCell>
                <TableCell className={`${cellClass} text-left`}>{row.especialidade}</TableCell>
                <TableCell className={`${cellClass} text-left`}>{fmtCurrency(row.investimento)}</TableCell>
                <TableCell className={`${cellClass} text-left`}>{fmt(row.leadsTrafego)}</TableCell>
                <TableCell className={`${cellClass} text-left text-sky-600 dark:text-sky-400`}>{fmt(row.leadsTrafegoMeta)}</TableCell>
                <TableCell className={`${cellClass} text-left text-amber-600 dark:text-amber-400`}>{fmt(row.leadsTrafegoGoogle)}</TableCell>
                <TableCell className={`${cellClass} text-left`}>{fmt(row.leadsCRM)}</TableCell>
                <TableCell className={`${cellClass} text-left`}>{fmt(row.consultasAgendadas)}</TableCell>
                <TableCell className={`${cellClass} text-left`}>{fmtCurrency(row.cacGeral)}</TableCell>
                <TableCell className={`${cellClass} text-left`}>{fmtCurrency(row.valorConsultasAgendadas)}</TableCell>
                <TableCell className={`${cellClass} text-left`}>{fmt(row.consultasRealizadas)}</TableCell>
                <TableCell className={`${cellClass} text-left`}>{fmtCurrency(row.valorConsultasRealizadas)}</TableCell>
                <TableCell className={`${cellClass} text-left`}>{fmt(row.procedimentosAgendados)}</TableCell>
                <TableCell className={`${cellClass} text-left`}>{fmtCurrency(row.valorProcedimentosAgendados)}</TableCell>
                <TableCell className={`${cellClass} text-left`}>{fmt(row.procedimentosRealizados)}</TableCell>
                <TableCell className={`${cellClass} text-left`}>{fmtCurrency(row.valorProcedimentosRealizados)}</TableCell>
                <TableCell className={`${cellClass} text-left font-medium`}>{fmtCurrency(row.faturamentoBrutoRealizados)}</TableCell>
                <TableCell className={`${cellClass} text-left`}>
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${
                      row.roas >= 15
                        ? "bg-emerald-500/15 text-emerald-500"
                        : row.roas > 0
                          ? "bg-amber-500/15 text-amber-500"
                          : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    {`${row.roas.toFixed(2)}x`}
                  </span>
                </TableCell>
              </TableRow>
            ))}
            {/* Footer totals */}
            <TableRow className="bg-background font-semibold border-t-2 border-border sticky bottom-0 z-10">
              <TableCell className={`${cellClass} font-bold text-left`}>Total</TableCell>
              <TableCell className={`${cellClass} text-left`}>—</TableCell>
              <TableCell className={`${cellClass} text-left`}>{fmtCurrency(totalRow.investimento)}</TableCell>
              <TableCell className={`${cellClass} text-left`}>{fmt(totalRow.leadsTrafego)}</TableCell>
              <TableCell className={`${cellClass} text-left text-sky-600 dark:text-sky-400`}>{fmt(totalRow.leadsTrafegoMeta)}</TableCell>
              <TableCell className={`${cellClass} text-left text-amber-600 dark:text-amber-400`}>{fmt(totalRow.leadsTrafegoGoogle)}</TableCell>
              <TableCell className={`${cellClass} text-left`}>{fmt(totalRow.leadsCRM)}</TableCell>
              <TableCell className={`${cellClass} text-left`}>{fmt(totalRow.consultasAgendadas)}</TableCell>
              <TableCell className={`${cellClass} text-left`}>{fmtCurrency(totalCac)}</TableCell>
              <TableCell className={`${cellClass} text-left`}>{fmtCurrency(totalRow.valorConsultasAgendadas)}</TableCell>
              <TableCell className={`${cellClass} text-left`}>{fmt(totalRow.consultasRealizadas)}</TableCell>
              <TableCell className={`${cellClass} text-left`}>{fmtCurrency(totalRow.valorConsultasRealizadas)}</TableCell>
              <TableCell className={`${cellClass} text-left`}>{fmt(totalRow.procedimentosAgendados)}</TableCell>
              <TableCell className={`${cellClass} text-left`}>{fmtCurrency(totalRow.valorProcedimentosAgendados)}</TableCell>
              <TableCell className={`${cellClass} text-left`}>{fmt(totalRow.procedimentosRealizados)}</TableCell>
              <TableCell className={`${cellClass} text-left`}>{fmtCurrency(totalRow.valorProcedimentosRealizados)}</TableCell>
              <TableCell className={`${cellClass} text-left`}>{fmtCurrency(totalRow.faturamentoBrutoRealizados)}</TableCell>
              <TableCell className={`${cellClass} text-left`}>{`${totalRoas.toFixed(2)}x`}</TableCell>
            </TableRow>
          </TableBody>
        </table>
      </div>
    </div>
  );
}
