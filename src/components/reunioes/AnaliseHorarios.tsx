import { useState } from "react";
import { Card } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Clock, UserX } from "lucide-react";

const hoursLabels = ["0h", "1h", "2h", "3h", "4h", "5h", "6h", "7h", "8h", "9h", "10h", "11h", "12h", "13h", "14h", "15h", "16h", "17h", "18h", "19h", "20h", "21h", "22h", "23h"];

const agendData = hoursLabels.map((h, i) => ({
  hora: h,
  agendamentos: i < 7 ? Math.floor(Math.random() * 50) :
    i < 9 ? Math.floor(Math.random() * 400 + 200) :
    i < 12 ? Math.floor(Math.random() * 800 + 600) :
    i < 14 ? Math.floor(Math.random() * 600 + 400) :
    i < 17 ? Math.floor(Math.random() * 1200 + 800) :
    i < 20 ? Math.floor(Math.random() * 1000 + 600) :
    i < 22 ? Math.floor(Math.random() * 2000 + 1500) :
    Math.floor(Math.random() * 200 + 50),
}));

const noShowData = hoursLabels.map((h, i) => ({
  hora: h,
  noShows: i < 7 ? Math.floor(Math.random() * 20) :
    i < 9 ? Math.floor(Math.random() * 200 + 100) :
    i < 12 ? Math.floor(Math.random() * 500 + 300) :
    i < 14 ? Math.floor(Math.random() * 400 + 200) :
    i < 18 ? Math.floor(Math.random() * 600 + 300) :
    i < 22 ? Math.floor(Math.random() * 400 + 200) :
    Math.floor(Math.random() * 100 + 30),
}));

const agendTabs = ["Por Hora", "Por Dia", "Hora x Dia", "MQL por Hora", "Conversão por Hora"];
const noShowTabs = ["Por Hora", "Por Dia", "Hora x Dia", "Por Closer", "Por Time", "MQL por Hora", "Taxa No-Show"];

interface Props { loading: boolean }

export function AnaliseHorarios({ loading }: Props) {
  const [agendTab, setAgendTab] = useState(0);
  const [noShowTab, setNoShowTab] = useState(0);

  if (loading) return <div className="h-96 rounded-xl skeleton-loading" />;

  return (
    <div className="space-y-6">
      {/* Section header */}
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold text-foreground uppercase tracking-wide">Análise de Horários</span>
      </div>

      <Card className="neu-card p-5">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs text-muted-foreground">📅</span>
          <span className="text-sm font-semibold text-foreground">Distribuição de Agendamentos</span>
        </div>
        <p className="text-[11px] text-muted-foreground mb-4">Identifique os melhores dias e horários para o período</p>
      </Card>

      {/* Agendamentos por Horário */}
      <Card className="neu-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Clock className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Agendamentos por Horário</span>
        </div>

        <div className="flex items-center gap-1 mb-4">
          {agendTabs.map((tab, i) => (
            <button
              key={tab}
              onClick={() => setAgendTab(i)}
              className={`px-3 py-1 text-[11px] rounded-md font-medium transition-colors ${
                i === agendTab
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary border border-border"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={agendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="hora" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
              />
              <Bar dataKey="agendamentos" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* No-show por Horário */}
      <Card className="neu-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <UserX className="h-4 w-4 text-red-600 dark:text-red-400" />
          <span className="text-sm font-semibold text-foreground">No-show por Horário</span>
        </div>

        <div className="flex items-center gap-1 mb-4 flex-wrap">
          {noShowTabs.map((tab, i) => (
            <button
              key={tab}
              onClick={() => setNoShowTab(i)}
              className={`px-3 py-1 text-[11px] rounded-md font-medium transition-colors ${
                i === noShowTab
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary border border-border"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={noShowData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="hora" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
              />
              <Bar dataKey="noShows" fill="hsl(0 70% 55%)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
