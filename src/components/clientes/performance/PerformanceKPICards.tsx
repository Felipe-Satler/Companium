import { TrendingUp, Users, Target, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";

interface SplitKPICardProps {
  title: string;
  totalValue: string;
  subtitle?: string;
  icon: typeof TrendingUp;
  metaValue: number;
  googleValue: number;
  formatValue?: (n: number) => string;
}

const META_COLOR = "#1877F2";
const GOOGLE_COLOR = "#E1306C";

function SplitKPICard({ title, totalValue, subtitle, icon: Icon, metaValue, googleValue, formatValue }: SplitKPICardProps) {
  const sum = metaValue + googleValue;
  const metaPct = sum > 0 ? (metaValue / sum) * 100 : 0;
  const googlePct = sum > 0 ? (googleValue / sum) * 100 : 0;

  return (
    <div className="neu-card rounded-xl p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        <div className="neu-inset rounded-lg p-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>

      <div>
        <p className="text-2xl font-bold text-foreground tabular-nums">{totalValue}</p>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>

      {/* Stacked breakdown bar */}
      <div className="space-y-1.5">
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-secondary/50">
          {sum > 0 ? (
            <>
              <div
                className="h-full transition-all"
                style={{ width: `${metaPct}%`, backgroundColor: META_COLOR }}
              />
              <div
                className="h-full transition-all"
                style={{ width: `${googlePct}%`, backgroundColor: GOOGLE_COLOR }}
              />
            </>
          ) : (
            <div className="h-full w-full bg-muted/40" />
          )}
        </div>
        <div className="flex items-center justify-between text-[10px] tabular-nums">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: META_COLOR }} />
            <span className="text-foreground/90 font-medium">
              Meta {formatValue ? formatValue(metaValue) : metaValue.toLocaleString("pt-BR")}{" "}
              <span className="text-foreground/70">({metaPct.toFixed(0)}%)</span>
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-foreground/90 font-medium">
              Google {formatValue ? formatValue(googleValue) : googleValue.toLocaleString("pt-BR")}{" "}
              <span className="text-foreground/70">({googlePct.toFixed(0)}%)</span>
            </span>
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: GOOGLE_COLOR }} />
          </div>
        </div>
      </div>
    </div>
  );
}

// Card sem split por canal — para métricas que vêm da fonte-da-verdade do CRM
// (consultas/faturamento), que não são atribuíveis por canal (Meta vs Google).
function SimpleKPICard({ title, totalValue, subtitle, icon: Icon }: { title: string; totalValue: string; subtitle?: string; icon: typeof TrendingUp }) {
  return (
    <div className="neu-card rounded-xl p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        <div className="neu-inset rounded-lg p-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>
      <div>
        <p className="text-2xl font-bold text-foreground tabular-nums">{totalValue}</p>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

interface Props {
  metaSpend: number;
  googleSpend: number;
  metaLeads: number;
  googleLeads: number;
  // Consultas agendadas e faturamento vêm da fonte-da-verdade do CRM (useCRMClienteData),
  // contados pela data do evento. Não atribuídos por canal, então estes cards não têm split.
  consultas: number;
  faturamento: number;
}

function fmtCurrency(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}
function fmtNumber(v: number) {
  return Math.round(v).toLocaleString("pt-BR");
}

export function PerformanceKPICards({
  metaSpend, googleSpend,
  metaLeads, googleLeads,
  consultas, faturamento,
}: Props) {
  const totalSpend = metaSpend + googleSpend;
  const totalLeads = metaLeads + googleLeads;
  // Consultas e faturamento são autoritativos do CRM (contados por data de evento).
  const cacGeral = consultas > 0 ? totalSpend / consultas : 0;
  const roasGeral = totalSpend > 0 ? faturamento / totalSpend : 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <SplitKPICard
        title="Investimento Total"
        totalValue={fmtCurrency(totalSpend)}
        icon={DollarSign}
        metaValue={metaSpend}
        googleValue={googleSpend}
        formatValue={fmtCurrency}
      />
      <SplitKPICard
        title="Leads Totais"
        totalValue={fmtNumber(totalLeads)}
        icon={Users}
        metaValue={metaLeads}
        googleValue={googleLeads}
        formatValue={fmtNumber}
      />
      <SimpleKPICard
        title="CAC Médio"
        totalValue={consultas > 0 ? fmtCurrency(cacGeral) : "—"}
        subtitle={`${fmtNumber(consultas)} consultas agendadas`}
        icon={Target}
      />
      <SimpleKPICard
        title="ROAS Geral"
        totalValue={totalSpend > 0 ? `${roasGeral.toFixed(2)}x` : "—"}
        subtitle={`Faturamento ${fmtCurrency(faturamento)}`}
        icon={TrendingUp}
      />
    </div>
  );
}
