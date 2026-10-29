import { Card } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Trophy, Medal } from "lucide-react";

const sellers = [
  { rank: 1, name: "João Silva", vendas: "R$ 98.450", meta: "R$ 100.000", atingimento: "98.5%", deals: 23, badge: "gold" },
  { rank: 2, name: "Maria Santos", vendas: "R$ 87.200", meta: "R$ 90.000", atingimento: "96.9%", deals: 19, badge: "silver" },
  { rank: 3, name: "Pedro Oliveira", vendas: "R$ 76.800", meta: "R$ 80.000", atingimento: "96.0%", deals: 17, badge: "bronze" },
  { rank: 4, name: "Ana Costa", vendas: "R$ 65.400", meta: "R$ 80.000", atingimento: "81.8%", deals: 14, badge: null },
  { rank: 5, name: "Carlos Ferreira", vendas: "R$ 54.200", meta: "R$ 70.000", atingimento: "77.4%", deals: 12, badge: null },
];

function RankBadge({ rank, badge }: { rank: number; badge: string | null }) {
  if (badge === "gold") return <Trophy className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />;
  if (badge === "silver") return <Medal className="h-4 w-4 text-gray-700 dark:text-gray-300" />;
  if (badge === "bronze") return <Medal className="h-4 w-4 text-orange-600 dark:text-orange-400" />;
  return <span className="text-xs text-muted-foreground font-medium">{rank}</span>;
}

interface Props { loading: boolean }

export function LeaderboardMensal({ loading }: Props) {
  if (loading) return <div className="h-48 rounded-xl skeleton-loading" />;

  return (
    <Card className="neu-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="h-2 w-2 rounded-full bg-chart-forecast" />
        <span className="text-sm font-medium text-foreground">Leaderboard Mensal</span>
      </div>

      <Table>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent">
            <TableHead className="text-xs w-12">#</TableHead>
            <TableHead className="text-xs">Vendedor</TableHead>
            <TableHead className="text-xs text-right">Vendas</TableHead>
            <TableHead className="text-xs text-right">Meta</TableHead>
            <TableHead className="text-xs text-right">Atingimento</TableHead>
            <TableHead className="text-xs text-right">Deals</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sellers.map((s) => (
            <TableRow key={s.rank} className="border-border">
              <TableCell className="py-2.5">
                <RankBadge rank={s.rank} badge={s.badge} />
              </TableCell>
              <TableCell className="py-2.5 text-xs font-medium text-foreground">{s.name}</TableCell>
              <TableCell className="py-2.5 text-xs text-right text-foreground">{s.vendas}</TableCell>
              <TableCell className="py-2.5 text-xs text-right text-muted-foreground">{s.meta}</TableCell>
              <TableCell className="py-2.5 text-xs text-right text-primary font-medium">{s.atingimento}</TableCell>
              <TableCell className="py-2.5 text-xs text-right text-foreground">{s.deals}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
