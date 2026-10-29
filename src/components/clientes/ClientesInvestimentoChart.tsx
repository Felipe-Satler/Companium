import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

// Aceita qualquer linha que tenha os 3 campos usados — funciona tanto com a view
// bruta (v_meta_google_ads) quanto com a diária agregada (v_meta_google_ads_daily).
interface ChartRow {
  Dia: string;
  Fonte_Ads: string;
  Valor_usado_BRL: number;
}

function buildChartData(data: ChartRow[]) {
  // ATENÇÃO: a view emite Fonte_Ads = "Meta" (com fallback histórico "Facebook").
  // Classificação explícita — fontes desconhecidas são ignoradas (não caem em Google).
  const map = new Map<string, { date: string; Meta: number; Google: number }>();
  for (const row of data) {
    if (!row.Dia) continue;
    const existing = map.get(row.Dia) || { date: row.Dia, Meta: 0, Google: 0 };
    if (row.Fonte_Ads === "Meta" || row.Fonte_Ads === "Facebook") {
      existing.Meta += row.Valor_usado_BRL || 0;
    } else if (row.Fonte_Ads === "Google") {
      existing.Google += row.Valor_usado_BRL || 0;
    } else {
      // Fonte desconhecida: ignora (evita inflar artificialmente um dos lados)
      continue;
    }
    map.set(row.Dia, existing);
  }
  return Array.from(map.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({
      ...d,
      date: new Date(d.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }),
    }));
}

export function ClientesInvestimentoChart({ data }: { data: ChartRow[] }) {
  const chartData = buildChartData(data);

  return (
    <div className="neu-card rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-foreground">Investimento Diário por Fonte</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
            <XAxis
              dataKey="date"
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `R$ ${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
                fontSize: "12px",
              }}
              formatter={(value: number) =>
                value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
              }
            />
            <Legend iconType="circle" wrapperStyle={{ fontSize: "11px" }} />
            <Bar dataKey="Meta" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Google" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
