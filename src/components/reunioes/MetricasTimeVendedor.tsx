import { useState } from "react";
import { Card } from "@/components/ui/card";
import { ChevronDown, ChevronRight, Users } from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface Vendedor {
  rank: number;
  name: string;
  agend: number;
  real: number;
  noShow: number;
  ganhos: number;
  progresso: number;
  realGanho: string;
}

interface Time {
  name: string;
  vendedores: number;
  agend: number;
  real: number;
  show: string;
  realGanho: string;
  members: Vendedor[];
}

const times: Time[] = [
  {
    name: "Time Gabriel",
    vendedores: 8,
    agend: 3937,
    real: 819,
    show: "20.8%",
    realGanho: "9.2%",
    members: [
      { rank: 1, name: "Mateus Elias", agend: 891, real: 89, noShow: 360, ganhos: 18, progresso: 23.6, realGanho: "8.5%" },
      { rank: 2, name: "Guilherme Inácio Fontes", agend: 958, real: 83, noShow: 681, ganhos: 19, progresso: 17.1, realGanho: "10.4%" },
      { rank: 3, name: "Lucas Viana Moreira", agend: 739, real: 162, noShow: 386, ganhos: 9, progresso: 21.9, realGanho: "14.3%" },
      { rank: 4, name: "Vitor Meireles Seixas", agend: 673, real: 175, noShow: 302, ganhos: 19, progresso: 29.1, realGanho: "16.5%" },
      { rank: 5, name: "Helena Martins Silva", agend: 601, real: 57, noShow: 145, ganhos: 4, progresso: 16.8, realGanho: "6%" },
      { rank: 6, name: "Alice Torres", agend: 235, real: 56, noShow: 138, ganhos: 8, progresso: 23.8, realGanho: "14.3%" },
      { rank: 7, name: "Antônio Medeiros", agend: 224, real: 47, noShow: 131, ganhos: 0, progresso: 21, realGanho: "0%" },
      { rank: 8, name: "Gabriel", agend: 0, real: 0, noShow: 0, ganhos: 0, progresso: 0, realGanho: "0%" },
    ],
  },
  { name: "Time Leo", vendedores: 1, agend: 4554, real: 921, show: "20.2%", realGanho: "10.6%", members: [] },
  { name: "Time Mateus Bianchi", vendedores: 0, agend: 2, real: 0, show: "0%", realGanho: "0%", members: [] },
  { name: "Time Rafa", vendedores: 0, agend: 4033, real: 814, show: "20.2%", realGanho: "9.6%", members: [] },
];

interface Props { loading: boolean }

export function MetricasTimeVendedor({ loading }: Props) {
  const [expanded, setExpanded] = useState<string | null>("Time Gabriel");

  if (loading) return <div className="h-64 rounded-xl skeleton-loading" />;

  return (
    <Card className="neu-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">MÉTRICAS POR TIME E VENDEDOR</span>
        </div>
        <span className="text-[11px] text-muted-foreground">Clique em vendedor para ver mais</span>
      </div>

      <div className="space-y-1">
        {times.map((t) => {
          const isOpen = expanded === t.name;
          return (
            <div key={t.name}>
              {/* Team row */}
              <button
                onClick={() => setExpanded(isOpen ? null : t.name)}
                className="w-full flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-secondary/40 transition-colors"
              >
                {isOpen ? (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span className="text-sm font-semibold text-foreground">{t.name}</span>
                <span className="text-[11px] text-muted-foreground">({t.vendedores} vendedores)</span>
                <div className="flex-1" />
                <div className="flex items-center gap-4 text-[11px]">
                  <span className="text-muted-foreground">Agend: <span className="text-foreground font-medium">{t.agend}</span></span>
                  <span className="text-muted-foreground">Real: <span className="text-foreground font-medium">{t.real}</span></span>
                  <span className="text-muted-foreground">Show: <span className="text-foreground font-medium">{t.show}</span></span>
                  <span className="text-muted-foreground">Real+Ganho: <span className="text-foreground font-medium">{t.realGanho}</span></span>
                </div>
              </button>

              {/* Members table */}
              {isOpen && t.members.length > 0 && (
                <div className="ml-6 mt-1 mb-2">
                  {/* Table header */}
                  <div className="grid grid-cols-[24px_1fr_70px_70px_80px_70px_120px_80px] gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <span></span>
                    <span>Vendedor(a)</span>
                    <span className="text-right">Agend</span>
                    <span className="text-right">Real</span>
                    <span className="text-right">No-Show</span>
                    <span className="text-right">Ganhos</span>
                    <span className="text-center">Progresso</span>
                    <span className="text-right">Real+Ganho</span>
                  </div>

                  {t.members.map((m) => (
                    <div
                      key={m.rank}
                      className="grid grid-cols-[24px_1fr_70px_70px_80px_70px_120px_80px] gap-2 px-3 py-2 rounded hover:bg-secondary/30 transition-colors items-center"
                    >
                      <span className="text-[11px] text-muted-foreground">{m.rank}</span>
                      <div className="flex items-center gap-1.5">
                        <div className="h-5 w-5 rounded-full bg-primary/20 flex items-center justify-center">
                          <span className="text-[9px] text-primary font-medium">{m.name.charAt(0)}</span>
                        </div>
                        <span className="text-xs text-foreground">{m.name}</span>
                      </div>
                      <span className="text-xs text-right text-foreground">{m.agend}</span>
                      <span className="text-xs text-right text-foreground">{m.real}</span>
                      <span className="text-xs text-right text-foreground">{m.noShow}</span>
                      <span className="text-xs text-right">
                        <span className={m.ganhos > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>
                          {m.ganhos > 0 ? `✅ ${m.ganhos}` : `❌ ${m.ganhos}`}
                        </span>
                      </span>
                      <div className="px-2">
                        <Progress value={m.progresso} className="h-1.5" />
                      </div>
                      <span className="text-xs text-right text-foreground font-medium">{m.realGanho}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
