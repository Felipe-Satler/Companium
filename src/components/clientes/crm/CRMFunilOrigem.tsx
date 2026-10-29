import { Fragment } from "react";
import { OrigemFunnelRow } from "@/utils/crmCalculations";
import { ChevronRight } from "lucide-react";

const STAGE_LABELS = ["Leads", "Cons. Agend.", "Cons. Realiz.", "Proc. Agend.", "Proc. Realiz."];

function getStageValue(row: OrigemFunnelRow, idx: number): number {
  switch (idx) {
    case 0: return row.leads;
    case 1: return row.consultasAgendadas;
    case 2: return row.consultasRealizadas;
    case 3: return row.procedimentosAgendados;
    case 4: return row.procedimentosRealizados;
    default: return 0;
  }
}

const COLORS = [
  "bg-primary/80",
  "bg-blue-500/70",
  "bg-cyan-500/60",
  "bg-emerald-500/60",
  "bg-amber-500/60",
];

export function CRMFunilOrigem({ data }: { data: OrigemFunnelRow[] }) {
  if (!data.length) return null;

  // Show top 10 origins
  const rows = data.slice(0, 10);

  return (
    <div className="neu-card rounded-xl p-6">
      <h3 className="text-sm font-semibold text-foreground mb-4">Funil por Origem</h3>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mb-4">
        {STAGE_LABELS.map((label, i) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-sm ${COLORS[i]}`} />
            <span className="text-[10px] text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>

      {/* Table-style funnel */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/50">
              <th className="text-left text-[10px] text-muted-foreground uppercase tracking-wider py-2 pr-4 w-[160px]">
                Origem
              </th>
              {STAGE_LABELS.map((label, i) => (
                <Fragment key={label}>
                  {i > 0 && (
                    <th className="text-center text-[9px] text-muted-foreground/60 uppercase tracking-wider py-2 px-1 w-[50px]">
                      Conv.
                    </th>
                  )}
                  <th className="text-center text-[10px] text-muted-foreground uppercase tracking-wider py-2 px-2">
                    {label}
                  </th>
                </Fragment>
              ))}
              <th className="text-center text-[10px] text-muted-foreground uppercase tracking-wider py-2 pl-2">
                Conv. Total
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const totalConv = row.leads > 0
                ? ((row.procedimentosRealizados / row.leads) * 100).toFixed(1)
                : "0.0";
              return (
                <tr key={row.origem} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                  <td className="py-2.5 pr-4 text-foreground font-medium truncate max-w-[160px]" title={row.origem}>
                    {row.origem}
                  </td>
                  {STAGE_LABELS.map((_, idx) => {
                    const val = getStageValue(row, idx);
                    const pct = row.leads > 0 ? (val / row.leads) * 100 : 0;
                    const prevVal = idx > 0 ? getStageValue(row, idx - 1) : 0;
                    const stepConv = idx > 0 && prevVal > 0 ? (val / prevVal) * 100 : null;
                    return (
                      <Fragment key={idx}>
                        {idx > 0 && (
                          <td className="py-2.5 px-1 text-center align-middle">
                            <div className="flex items-center justify-center gap-0.5 text-muted-foreground/70">
                              <ChevronRight className="h-3 w-3" />
                              <span className="text-[10px] font-medium">
                                {stepConv !== null ? `${stepConv.toFixed(1)}%` : "—"}
                              </span>
                            </div>
                          </td>
                        )}
                        <td className="py-2.5 px-2">
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="font-semibold text-foreground">{val}</span>
                            {idx > 0 && (
                              <div className="w-full max-w-[60px] h-1.5 rounded-full bg-muted/30">
                                <div
                                  className={`h-full rounded-full ${COLORS[idx]} transition-all`}
                                  style={{ width: `${Math.max(pct, 2)}%` }}
                                />
                              </div>
                            )}
                          </div>
                        </td>
                      </Fragment>
                    );
                  })}
                  <td className="py-2.5 pl-2 text-center">
                    <span className="font-bold text-primary">{totalConv}%</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
