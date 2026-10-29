import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, ComposedChart, Legend } from "recharts";
import { Target } from "lucide-react";
import { useState } from "react";

const views = ["Semanal", "Quinzenal", "Mensal"];

const data = (() => {
  const months = ["jan24","fev24","mar24","abr24","mai24","jun24","jul24","ago24","set24","out24","nov24","dez24","jan25","fev25","mar25"];
  return months.map((m, i) => ({
    name: m,
    "MQL Total": Math.floor(3000 + i * 400 + Math.random() * 500),
    "MQL Pago": Math.floor(1500 + i * 200 + Math.random() * 300),
    Meta: 7000,
    "Orgânico": Math.floor(1000 + i * 150 + Math.random() * 200),
  }));
})();

export function PaidMediaCaptacaoMQL() {
  const [view, setView] = useState("Mensal");

  return (
    <div className="neu-card rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <span className="text-sm font-bold text-foreground">Captação MQL</span>
          <span className="text-[10px] text-muted-foreground ml-1">Top 10 pages ou plataformas com mais MQL atingidas atualmente</span>
        </div>
        <div className="flex items-center gap-1">
          {views.map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-2.5 py-1 text-[10px] rounded font-medium transition-colors ${
                view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 text-xs">
        <div>
          <span className="text-muted-foreground">ROAS</span>
          <p className="text-sm font-bold text-foreground">1.47x</p>
        </div>
        <div>
          <span className="text-muted-foreground">META</span>
          <p className="text-sm font-bold text-foreground">7.000</p>
        </div>
      </div>

      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} vertical={false} />
            <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }} />
            <Line type="monotone" dataKey="MQL Total" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="MQL Pago" stroke="#22d3ee" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="Meta" stroke="#f472b6" strokeWidth={1} dot={false} strokeDasharray="5 5" />
            <Line type="monotone" dataKey="Orgânico" stroke="#a78bfa" strokeWidth={1.5} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center gap-5 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary" />MQL Total</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-cyan-400" />MQL Pago</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-pink-400" />Meta</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-purple-400" />Orgânico</span>
      </div>
    </div>
  );
}
