import { Card } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

const salesData = [
  { rank: 1, name: "Viver de IA", produto: "Enterprise", valor: "R$ 25.000", tipo: "Novo", data: "15/03", status: "Fechado" },
  { rank: 2, name: "Tech Solutions", produto: "Pro", valor: "R$ 18.500", tipo: "Upgrade", data: "14/03", status: "Fechado" },
  { rank: 3, name: "DataCorp", produto: "Business", valor: "R$ 15.200", tipo: "Novo", data: "13/03", status: "Fechado" },
  { rank: 4, name: "Cloud Nine", produto: "Starter", valor: "R$ 12.800", tipo: "Renovação", data: "12/03", status: "Fechado" },
  { rank: 5, name: "AI Partners", produto: "Pro", valor: "R$ 10.400", tipo: "Novo", data: "11/03", status: "Em negociação" },
  { rank: 6, name: "Smart Corp", produto: "Enterprise", valor: "R$ 9.200", tipo: "Cross-sell", data: "10/03", status: "Proposta" },
  { rank: 7, name: "Future Labs", produto: "Business", valor: "R$ 8.600", tipo: "Novo", data: "09/03", status: "Fechado" },
  { rank: 8, name: "InnovateTech", produto: "Pro", valor: "R$ 7.800", tipo: "Upgrade", data: "08/03", status: "Fechado" },
  { rank: 9, name: "Digital First", produto: "Starter", valor: "R$ 6.500", tipo: "Novo", data: "07/03", status: "Em negociação" },
  { rank: 10, name: "Scale Up", produto: "Business", valor: "R$ 5.200", tipo: "Renovação", data: "06/03", status: "Fechado" },
];

function StatusBadge({ status }: { status: string }) {
  const isGreen = status === "Fechado";
  const isYellow = status === "Em negociação";
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
      isGreen ? "bg-primary/20 text-primary" : isYellow ? "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400" : "bg-blue-500/20 text-blue-600 dark:text-blue-400"
    }`}>
      {status}
    </span>
  );
}

interface Props { loading: boolean }

export function DetalhesVendasMensais({ loading }: Props) {
  if (loading) return <div className="h-64 rounded-xl skeleton-loading" />;

  return (
    <Card className="neu-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="h-2 w-2 rounded-full bg-primary" />
        <span className="text-sm font-medium text-foreground">Detalhes das Vendas Mensais</span>
      </div>

      <Table>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent">
            <TableHead className="text-xs w-12">#</TableHead>
            <TableHead className="text-xs">Cliente</TableHead>
            <TableHead className="text-xs">Produto</TableHead>
            <TableHead className="text-xs text-right">Valor</TableHead>
            <TableHead className="text-xs">Tipo</TableHead>
            <TableHead className="text-xs">Data</TableHead>
            <TableHead className="text-xs">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {salesData.map((s) => (
            <TableRow key={s.rank} className="border-border">
              <TableCell className="py-2.5 text-xs text-muted-foreground">{s.rank}</TableCell>
              <TableCell className="py-2.5 text-xs font-medium text-foreground">{s.name}</TableCell>
              <TableCell className="py-2.5 text-xs text-muted-foreground">{s.produto}</TableCell>
              <TableCell className="py-2.5 text-xs text-right text-foreground">{s.valor}</TableCell>
              <TableCell className="py-2.5 text-xs text-muted-foreground">{s.tipo}</TableCell>
              <TableCell className="py-2.5 text-xs text-muted-foreground">{s.data}</TableCell>
              <TableCell className="py-2.5"><StatusBadge status={s.status} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
