import { useMemo, useState } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { ClienteAdsData } from "@/hooks/useClientesData";

function fmtCurrency(val: number) {
  return val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtNumber(val: number) {
  return val.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}
// Eixo Y de investimento em "R$ X.Xk" (mesma leitura do protótipo).
function fmtKBRL(val: number) {
  return `R$ ${(val / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}k`;
}

// "YYYY-MM-DD" → chave/rótulo de semana (segunda-feira de referência).
function weekStart(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (isNaN(d.getTime())) return dateStr;
  const dow = (d.getUTCDay() + 6) % 7; // 0 = segunda
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

// "YYYY-MM-DD" → "dd/MM".
function ddMM(dateStr: string): string {
  const [, m, dd] = dateStr.split("-");
  return `${dd}/${m}`;
}

type Gran = "diario" | "semanal";

interface Point {
  key: string;
  label: string;
  investimento: number;
  leads: number;
}

export function CaptacaoInvestimentoLeadsChart({ data }: { data: ClienteAdsData[] }) {
  const [gran, setGran] = useState<Gran>("diario");

  const points = useMemo<Point[]>(() => {
    const map = new Map<string, { investimento: number; leads: number }>();
    for (const r of data) {
      if (!r.Dia) continue;
      const dia = String(r.Dia).slice(0, 10);
      const key = gran === "semanal" ? weekStart(dia) : dia;
      const cur = map.get(key) || { investimento: 0, leads: 0 };
      cur.investimento += r.Valor_usado_BRL || 0;
      // "Leads" = leads de tráfego (Lead + Mensagens iniciadas), mesma definição dos cards.
      cur.leads += (r.Lead || 0) + (r.Mensagens_iniciadas || 0);
      map.set(key, cur);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => ({ key, label: ddMM(key), investimento: v.investimento, leads: v.leads }));
  }, [data, gran]);

  return (
    <div className="neu-card rounded-xl p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Investimento vs. Leads gerados</h3>
          <p className="text-[11px] text-muted-foreground">Barra = investimento · Linha = leads no período</p>
        </div>
        <div className="neu-inset inline-flex items-center gap-1 p-1 rounded-lg shrink-0">
          {([["diario", "Diário"], ["semanal", "Semanal"]] as [Gran, string][]).map(([g, lbl]) => (
            <button
              key={g}
              onClick={() => setGran(g)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-all ${
                gran === g ? "neu-button text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>

      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 15, right: 10, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} vertical={false} />
            <XAxis dataKey="label" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} axisLine={false} tickLine={false} />
            <YAxis
              yAxisId="bar"
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={fmtKBRL}
            />
            <YAxis
              yAxisId="line"
              orientation="right"
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={fmtNumber}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
                fontSize: "11px",
              }}
              formatter={(value: number, name: string) =>
                name === "investimento" ? [fmtCurrency(value), "Investimento"] : [fmtNumber(value), "Leads"]
              }
              labelFormatter={(l) => l}
            />
            <Legend
              iconType="circle"
              wrapperStyle={{ fontSize: "10px" }}
              formatter={(v) => (v === "investimento" ? "Investimento" : "Leads")}
            />
            <Bar yAxisId="bar" dataKey="investimento" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={28} />
            <Line yAxisId="line" type="monotone" dataKey="leads" stroke="hsl(var(--chart-line-primary))" strokeWidth={2} dot={{ r: 2.5, fill: "hsl(var(--chart-line-primary))" }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
