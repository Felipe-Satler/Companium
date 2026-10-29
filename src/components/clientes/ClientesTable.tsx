import { ClienteSummary } from "@/hooks/useClientesData";
import { prettyClientLabel } from "@/data/clienteAliases";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TrendingUp } from "lucide-react";

function formatCurrency(val: number) {
  return val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatNumber(val: number) {
  // Sempre o valor inteiro exato (com separador de milhar), sem abreviar p/ "K"/"M".
  return val.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

export function ClientesTable({ clients }: { clients: ClienteSummary[] }) {
  return (
    <div className="neu-card rounded-xl overflow-hidden">
      <div className="p-4 border-b border-border/50">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full neu-inset text-primary shrink-0">
            <TrendingUp className="h-3.5 w-3.5" />
          </span>
          Performance por Cliente
        </h3>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-border/50 hover:bg-transparent">
              <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-left">#</TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-left">Cliente</TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-left">Especialidade</TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-left">Investimento</TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-left">Resultados</TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-left">Custo/Resultado</TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-left">Leads</TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-left">CPL</TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-left">Conversas</TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-left">Custo/Conversa</TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-left">Impressões</TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-left">Cliques</TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-left">CTR</TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-left">CPC</TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-left">Campanhas</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.map((c, i) => (
              <TableRow key={c.client} className="border-border/50 hover:bg-secondary/30">
                <TableCell className="text-left">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-xs font-bold text-muted-foreground">
                    {i + 1}
                  </div>
                </TableCell>
                <TableCell className="text-left">
                  <span className="text-sm font-medium text-foreground">
                    {prettyClientLabel(c.client)}
                  </span>
                </TableCell>
                <TableCell className="text-left">
                  {c.especialidades && c.especialidades.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {c.especialidades.map((esp) => (
                        <span
                          key={esp}
                          className="inline-flex items-center rounded-full neu-inset px-2 py-0.5 text-[10px] font-medium text-primary whitespace-nowrap"
                        >
                          {esp}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-left text-sm font-semibold text-foreground">
                  {formatCurrency(c.totalSpend)}
                </TableCell>
                <TableCell className="text-left text-sm font-semibold text-primary">
                  {c.totalResultados}
                </TableCell>
                <TableCell className="text-left text-sm text-foreground">
                  {c.avgCPResultado > 0 ? formatCurrency(c.avgCPResultado) : "—"}
                </TableCell>
                <TableCell className="text-left text-sm text-foreground">
                  {c.totalLeads}
                </TableCell>
                <TableCell className="text-left text-sm text-foreground">
                  {c.avgCPL > 0 ? formatCurrency(c.avgCPL) : "—"}
                </TableCell>
                <TableCell className="text-left text-sm text-foreground">
                  {c.totalConversas}
                </TableCell>
                <TableCell className="text-left text-sm text-foreground">
                  {c.avgCPConversa > 0 ? formatCurrency(c.avgCPConversa) : "—"}
                </TableCell>
                <TableCell className="text-left text-sm text-muted-foreground">
                  {formatNumber(c.totalImpressions)}
                </TableCell>
                <TableCell className="text-left text-sm text-muted-foreground">
                  {formatNumber(c.totalClicks)}
                </TableCell>
                <TableCell className="text-left text-sm text-foreground">
                  {c.avgCTR.toFixed(2)}%
                </TableCell>
                <TableCell className="text-left text-sm text-foreground">
                  {formatCurrency(c.avgCPC)}
                </TableCell>
                <TableCell className="text-left text-sm text-muted-foreground">
                  {c.campaigns}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
