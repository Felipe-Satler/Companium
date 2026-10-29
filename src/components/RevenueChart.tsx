import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { TrendingUp, Target } from "lucide-react";

const mockData = [
  { month: "Jan/23", acumulada: 1200000, forecast: null, pace: null, conversao: null },
  { month: "Fev/23", acumulada: 2100000, forecast: null, pace: null, conversao: null },
  { month: "Mar/23", acumulada: 2800000, forecast: null, pace: null, conversao: null },
  { month: "Abr/23", acumulada: 3500000, forecast: null, pace: null, conversao: null },
  { month: "Mai/23", acumulada: 4200000, forecast: null, pace: null, conversao: null },
  { month: "Jun/23", acumulada: 5000000, forecast: null, pace: null, conversao: null },
  { month: "Jul/23", acumulada: 5800000, forecast: null, pace: null, conversao: null },
  { month: "Ago/23", acumulada: 6500000, forecast: null, pace: null, conversao: null },
  { month: "Set/23", acumulada: 7200000, forecast: null, pace: null, conversao: null },
  { month: "Out/23", acumulada: 8000000, forecast: null, pace: null, conversao: null },
  { month: "Nov/23", acumulada: 8800000, forecast: null, pace: null, conversao: null },
  { month: "Dez/23", acumulada: 9500000, forecast: null, pace: null, conversao: null },
  { month: "Jan/24", acumulada: 10100000, forecast: 10100000, pace: null, conversao: null },
  { month: "Fev/24", acumulada: 10700000, forecast: 10700000, pace: 10700000, conversao: null },
  { month: "Mar/24", acumulada: null, forecast: 11200000, pace: 10100000, conversao: null },
  { month: "Abr/24", acumulada: null, forecast: 11800000, pace: 10500000, conversao: null },
  { month: "Mai/24", acumulada: null, forecast: 12500000, pace: 11000000, conversao: null },
];

const periods = ["D", "S", "M", "T", "A"];

const formatCurrency = (value: number) => {
  // Valor inteiro exato, sem abreviar p/ "K"/"M".
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
};

interface RevenueChartProps {
  loading?: boolean;
}

export function RevenueChart({ loading }: RevenueChartProps) {
  const [activePeriod, setActivePeriod] = useState("D");

  if (loading) {
    return (
      <div className="neu-card p-6">
        <div className="skeleton-loading h-5 w-48 rounded mb-2" />
        <div className="skeleton-loading h-3 w-64 rounded mb-6" />
        <div className="skeleton-loading h-[300px] w-full rounded" />
      </div>
    );
  }

  return (
    <div className="neu-card p-6">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h3 className="text-base font-bold text-foreground">Receita por Período</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Acompanhamento detalhado de performance vs meta
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-full neu-inset p-1">
            {periods.map((p) => (
              <button
                key={p}
                onClick={() => setActivePeriod(p)}
                className={`h-7 w-7 rounded-full text-xs font-medium transition-colors ${
                  activePeriod === p
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button className="h-8 w-8 rounded-full neu-button flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
              <TrendingUp className="h-4 w-4" />
            </button>
            <button className="h-8 w-8 rounded-full neu-button flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
              <Target className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={mockData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(215 40% 25%)" vertical={false} />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 11, fill: "hsl(215 20% 60%)" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={formatCurrency}
            tick={{ fontSize: 11, fill: "hsl(215 20% 60%)" }}
            axisLine={false}
            tickLine={false}
            width={50}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(215 50% 20%)",
              border: "1px solid hsl(215 40% 25%)",
              borderRadius: "8px",
              fontSize: "12px",
              color: "hsl(210 20% 95%)",
            }}
            formatter={(value: number) => [formatCurrency(value), ""]}
          />
          <Line
            type="monotone"
            dataKey="acumulada"
            stroke="hsl(160 60% 45%)"
            strokeWidth={2.5}
            dot={false}
            connectNulls={false}
            name="Receita Acumulada"
          />
          <Line
            type="monotone"
            dataKey="forecast"
            stroke="hsl(30 80% 55%)"
            strokeWidth={2}
            strokeDasharray="6 4"
            dot={false}
            connectNulls={false}
            name="Forecast"
          />
          <Line
            type="monotone"
            dataKey="pace"
            stroke="hsl(200 70% 50%)"
            strokeWidth={2}
            strokeDasharray="4 4"
            dot={false}
            connectNulls={false}
            name="PACE 90D"
          />
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: "12px", color: "hsl(215 20% 60%)", paddingTop: "16px" }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
