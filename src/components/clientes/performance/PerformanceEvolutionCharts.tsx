import { useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

const META_COLOR = "#1877F2";
const GOOGLE_COLOR = "#E1306C";

interface MonthPoint {
  month: string;
  investimento: number;
  leads: number;
}

interface Props {
  metaMonthly: { month: string; investimento: number; leads: number }[];
  googleMonthly: { month: string; investimento: number; leads: number }[];
}

function mergeMonthly(meta: MonthPoint[], google: MonthPoint[]) {
  const map = new Map<string, { month: string; metaInv: number; googleInv: number; metaLeads: number; googleLeads: number }>();
  for (const m of meta) {
    const e = map.get(m.month) || { month: m.month, metaInv: 0, googleInv: 0, metaLeads: 0, googleLeads: 0 };
    e.metaInv = m.investimento;
    e.metaLeads = m.leads;
    map.set(m.month, e);
  }
  for (const g of google) {
    const e = map.get(g.month) || { month: g.month, metaInv: 0, googleInv: 0, metaLeads: 0, googleLeads: 0 };
    e.googleInv = g.investimento;
    e.googleLeads = g.leads;
    map.set(g.month, e);
  }
  return Array.from(map.values())
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((e) => {
      const [year, month] = e.month.split("-");
      const monthNames = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
      return {
        ...e,
        label: `${monthNames[parseInt(month) - 1]}/${year.slice(2)}`,
      };
    });
}

function fmtCurrency(v: number) {
  // Valor inteiro exato, sem abreviar p/ "k"/"Mi".
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function CustomTooltip({ active, payload, label, isCurrency }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="neu-card rounded-lg px-3 py-2">
      <p className="text-xs font-semibold text-foreground mb-1.5">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
            <span className="text-muted-foreground">{p.name}</span>
          </div>
          <span className="font-mono font-medium text-foreground tabular-nums">
            {isCurrency ? p.value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }) : Math.round(p.value).toLocaleString("pt-BR")}
          </span>
        </div>
      ))}
    </div>
  );
}

export function PerformanceEvolutionCharts({ metaMonthly, googleMonthly }: Props) {
  const merged = useMemo(() => mergeMonthly(metaMonthly, googleMonthly), [metaMonthly, googleMonthly]);

  if (merged.length === 0) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="neu-card rounded-xl p-6 flex items-center justify-center min-h-[280px]">
          <p className="text-sm text-muted-foreground">Sem dados para o período</p>
        </div>
        <div className="neu-card rounded-xl p-6 flex items-center justify-center min-h-[280px]">
          <p className="text-sm text-muted-foreground">Sem dados para o período</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Investimento mensal */}
      <div className="neu-card rounded-xl p-5">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-foreground">Investimento mensal por canal</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Comparativo Meta Ads vs Google Ads</p>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={merged} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
            <XAxis dataKey="label" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} stroke="hsl(var(--border))" />
            <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} stroke="hsl(var(--border))" tickFormatter={fmtCurrency} />
            <Tooltip content={<CustomTooltip isCurrency />} />
            <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
            <Line type="monotone" dataKey="metaInv" name="Meta Ads" stroke={META_COLOR} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            <Line type="monotone" dataKey="googleInv" name="Google Ads" stroke={GOOGLE_COLOR} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Leads mensais */}
      <div className="neu-card rounded-xl p-5">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-foreground">Leads mensais por canal</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Volume de leads gerados por mês</p>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={merged} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
            <XAxis dataKey="label" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} stroke="hsl(var(--border))" />
            <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} stroke="hsl(var(--border))" />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
            <Line type="monotone" dataKey="metaLeads" name="Meta Ads" stroke={META_COLOR} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            <Line type="monotone" dataKey="googleLeads" name="Google Ads" stroke={GOOGLE_COLOR} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
