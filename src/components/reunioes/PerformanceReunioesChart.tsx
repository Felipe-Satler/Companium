import { Card } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell } from "recharts";
import { BarChart3 } from "lucide-react";

const data = [
  { name: "Tales Quintela", realizadas: 134, noShows: 54, total: 333 },
  { name: "Vitor Meireles Seixas", realizadas: 409, noShows: 115, total: 572 },
  { name: "Pedro Estevão", realizadas: 292, noShows: 120, total: 551 },
  { name: "Ariel Tavares", realizadas: 188, noShows: 71, total: 418 },
  { name: "Lucas Gabriel", realizadas: 158, noShows: 52, total: 463 },
  { name: "Alice Torres", realizadas: 134, noShows: 56, total: 235 },
  { name: "William Dorneles", realizadas: 297, noShows: 107, total: 647 },
  { name: "Matheus Santos", realizadas: 184, noShows: 95, total: 529 },
  { name: "Kevin Queiroz", realizadas: 87, noShows: 38, total: 256 },
  { name: "Guilherme Inácio Fontes", realizadas: 641, noShows: 193, total: 958 },
  { name: "Juan Barros", realizadas: 427, noShows: 100, total: 760 },
  { name: "Eduardo Gomes Marinho", realizadas: 328, noShows: 145, total: 637 },
  { name: "Murilo Bento", realizadas: 423, noShows: 167, total: 769 },
  { name: "Lucas Correia", realizadas: 335, noShows: 163, total: 676 },
  { name: "Mateus Elias", realizadas: 363, noShows: 139, total: 801 },
  { name: "Isabel Bragança", realizadas: 329, noShows: 153, total: 610 },
  { name: "Daniel Bastos Guerra", realizadas: 422, noShows: 161, total: 746 },
  { name: "Nadia Campos", realizadas: 142, noShows: 47, total: 330 },
  { name: "Helena Martins Silva", realizadas: 145, noShows: 47, total: 407 },
  { name: "Lucas Viana Moreira", realizadas: 366, noShows: 143, total: 739 },
  { name: "Eduardo Teixeira", realizadas: 248, noShows: 139, total: 482 },
  { name: "Antônio Medeiros", realizadas: 131, noShows: 47, total: 224 },
];

interface Props { loading: boolean }

export function PerformanceReunioesChart({ loading }: Props) {
  if (loading) return <div className="h-[500px] rounded-xl skeleton-loading" />;

  const topPerformers = [
    { name: "Tales Quintela", reunioes: "333 reuniões" },
    { name: "Vitor Meireles Seixas", reunioes: "573 reuniões" },
    { name: "Pedro Estevão", reunioes: "551 reuniões" },
    { name: "Ariel Tavares", reunioes: "418 reuniões" },
  ];

  return (
    <Card className="neu-card p-5">
      <div className="flex items-center gap-2 mb-1">
        <BarChart3 className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">Performance de Reuniões por Vendedor</span>
      </div>
      <p className="text-[11px] text-muted-foreground mb-4">Ranking por total Real + Ganho</p>

      <div className="h-[550px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 160, right: 40, top: 10, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              width={155}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
                fontSize: "12px",
              }}
            />
            <Bar dataKey="realizadas" stackId="a" fill="hsl(var(--primary))" radius={[0, 0, 0, 0]} />
            <Bar dataKey="noShows" stackId="a" fill="hsl(0 70% 55%)" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 mt-4">
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-primary" />
          <span className="text-[11px] text-muted-foreground">Realizadas</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
          <span className="text-[11px] text-muted-foreground">No-Shows</span>
        </div>
      </div>

      {/* Top performers */}
      <div className="grid grid-cols-4 gap-4 mt-6 pt-4 border-t border-border">
        {topPerformers.map((p) => (
          <div key={p.name} className="text-center">
            <p className="text-xs text-muted-foreground">{p.name}</p>
            <p className="text-sm font-semibold text-foreground">{p.reunioes}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}
