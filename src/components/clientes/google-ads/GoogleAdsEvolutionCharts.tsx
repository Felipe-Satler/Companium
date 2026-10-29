import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { GoogleMonthlyEvolution } from "@/hooks/useGoogleAdsClienteData";

function fmtCurrency(val: number) {
  return val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtNumber(val: number) {
  // Valor inteiro exato, sem abreviar p/ "Mil"/"Mi".
  return val.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

interface ChartCardProps {
  title: string;
  data: GoogleMonthlyEvolution[];
  barKey: string;
  barLabel: string;
  lineKey?: string;
  lineLabel?: string;
  barFormatter: (v: number) => string;
  lineFormatter?: (v: number) => string;
  yBarFormatter?: (v: number) => string;
  wide?: boolean;
}

function ChartCard({ title, data, barKey, barLabel, lineKey, lineLabel, barFormatter, lineFormatter, yBarFormatter, wide }: ChartCardProps) {
  const hasLine = !!lineKey;
  return (
    <div className={`neu-card rounded-xl p-5 space-y-3 ${wide ? "lg:col-span-2" : ""}`}>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary" />{barLabel}</span>
        {hasLine && <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-400" />{lineLabel}</span>}
      </div>
      <div className={wide ? "h-72" : "h-52"}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 15, right: 10, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} vertical={false} />
            <XAxis dataKey="label" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} axisLine={false} tickLine={false} />
            <YAxis
              yAxisId="bar"
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={yBarFormatter || fmtNumber}
            />
            <YAxis yAxisId="line" orientation="right" hide />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
                fontSize: "11px",
              }}
              formatter={(value: number, name: string) => {
                if (name === barKey || !hasLine) return [barFormatter(value), barLabel];
                return [lineFormatter!(value), lineLabel];
              }}
            />
            <Bar yAxisId="bar" dataKey={barKey} fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} barSize={24} label={{ position: "top", fontSize: 9, fill: "hsl(var(--muted-foreground))", formatter: barFormatter }} />
            {hasLine && <Line yAxisId="line" type="monotone" dataKey={lineKey} stroke="#34d399" strokeWidth={2} dot={{ r: 3, fill: "#34d399" }} label={{ position: "top", fontSize: 9, fill: "#34d399", formatter: lineFormatter, offset: 10 }} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function GoogleAdsEvolutionCharts({ data }: { data: GoogleMonthlyEvolution[] }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ChartCard
        title="Evolução de Lead tráfego e Custo/Lead tráfego"
        data={data}
        barKey="leads"
        barLabel="Lead tráfego"
        lineKey="cpl"
        lineLabel="Custo / Lead tráfego"
        barFormatter={fmtNumber}
        lineFormatter={fmtCurrency}
      />
      <ChartCard
        title="Evolução do Investimento"
        data={data}
        barKey="investimento"
        barLabel="Investimento"
        barFormatter={fmtCurrency}
        yBarFormatter={(v) => `R$ ${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`}
      />
      <ChartCard
        title="Evolução de Cliques e CPC"
        data={data}
        barKey="cliques"
        barLabel="Total de Cliques"
        lineKey="cpc"
        lineLabel="CPC"
        barFormatter={fmtNumber}
        lineFormatter={fmtCurrency}
        wide
      />
    </div>
  );
}
