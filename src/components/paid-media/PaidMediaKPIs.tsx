import { DollarSign, TrendingUp, Target, Eye, Users, AlertTriangle, BarChart3 } from "lucide-react";
import { Card } from "@/components/ui/card";

export function PaidMediaKPIs() {
  return (
    <div className="space-y-3">
      {/* Row 1 - Financial KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: "Investimento", value: "R$ 2.333.149", icon: DollarSign, iconColor: "text-cyan-600 dark:text-cyan-400", bgColor: "bg-cyan-500/10 border-cyan-500/20" },
          { label: "Receita", value: "R$ 3.465.038", icon: TrendingUp, iconColor: "text-primary", bgColor: "bg-primary/10 border-primary/20" },
          { label: "ROAS", value: "1.5x", icon: Target, iconColor: "text-blue-600 dark:text-blue-400", bgColor: "bg-blue-500/10 border-blue-500/20" },
          { label: "CPA", value: "R$ 263", icon: Eye, iconColor: "text-purple-600 dark:text-purple-400", bgColor: "bg-purple-500/10 border-purple-500/20" },
          { label: "CPL", value: "R$ 82.615", icon: DollarSign, iconColor: "text-primary", bgColor: "bg-primary/10 border-primary/20", extra: "↑ 5,2% vs anterior" },
        ].map((kpi) => (
          <Card key={kpi.label} className={`p-4 border ${kpi.bgColor}`}>
            <div className="flex items-center gap-2 mb-1">
              <kpi.icon className={`h-3.5 w-3.5 ${kpi.iconColor}`} />
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{kpi.label}</span>
            </div>
            <p className="text-lg font-bold text-foreground">{kpi.value}</p>
            {kpi.extra && <p className="text-[10px] text-primary mt-0.5">{kpi.extra}</p>}
          </Card>
        ))}
      </div>

      {/* Row 2 - Operational KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Card className="p-3 bg-teal-900/30 border-teal-700/30">
          <span className="text-[10px] text-teal-700 dark:text-teal-300 font-semibold">Escopo Próximo</span>
          <p className="text-2xl font-bold text-foreground">1</p>
        </Card>
        <Card className="p-3 bg-blue-900/30 border-blue-700/30">
          <span className="text-[10px] text-blue-700 dark:text-blue-300 font-semibold">Escopo</span>
          <p className="text-2xl font-bold text-foreground">1</p>
        </Card>
        <Card className="p-3 bg-emerald-900/30 border-emerald-700/30">
          <span className="text-[10px] text-emerald-700 dark:text-emerald-300 font-semibold">Montanear</span>
          <p className="text-2xl font-bold text-foreground">43</p>
        </Card>
        <Card className="p-3 bg-red-900/30 border-red-700/30">
          <span className="text-[10px] text-red-700 dark:text-red-300 font-semibold flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Faltas</span>
          <p className="text-2xl font-bold text-foreground">51</p>
        </Card>
        <Card className="neu-card p-3">
          <div className="flex items-center gap-1.5">
            <BarChart3 className="h-3.5 w-3.5 text-primary" />
            <span className="text-[10px] text-muted-foreground font-semibold">Qualidade MQL</span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-2xl font-bold text-foreground">39%</span>
            <span className="text-[10px] text-muted-foreground">Ap 2.715 · Oct 1 · Mv 0.82</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden mt-1.5">
            <div className="h-full rounded-full bg-primary" style={{ width: "39%" }} />
          </div>
        </Card>
      </div>

      {/* Row 3 - Small metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: "Leads", value: "43.345", sub: "CR 1.96%", barPct: 70, barColor: "bg-primary" },
          { label: "MQLs", value: "8.484", sub: "", barPct: 50, barColor: "bg-cyan-400" },
          { label: "Env", value: "7.190", sub: "", barPct: 40, barColor: "bg-purple-400" },
          { label: "Agend.", value: "499", sub: "", barPct: 25, barColor: "bg-blue-400" },
        ].map((m) => (
          <Card key={m.label} className="p-3 neu-card">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground font-semibold uppercase">{m.label}</span>
              {m.sub && <span className="text-[9px] text-muted-foreground">{m.sub}</span>}
            </div>
            <p className="text-lg font-bold text-foreground">{m.value}</p>
            <div className="h-1 w-full rounded-full bg-secondary overflow-hidden mt-1">
              <div className={`h-full rounded-full ${m.barColor}`} style={{ width: `${m.barPct}%` }} />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
