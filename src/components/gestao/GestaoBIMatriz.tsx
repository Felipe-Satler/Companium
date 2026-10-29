import * as React from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BIResumo } from "./useGestaoBI";

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
const pct = (v: number) => `${v.toFixed(2).replace(".", ",")}%`;
const num = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const dec = (v: number) => v.toFixed(2).replace(".", ",");

type Linha = {
  label: string;
  valor: (m: BIResumo["meses"][number]) => number;
  total: number;
  media: number | null;
  fmt: (v: number) => string;
};

export function GestaoBIMatriz({ bi }: { bi: BIResumo }) {
  const t = bi.totais;
  const linhas: Linha[] = [
    { label: "Novos Clientes", valor: (m) => m.novos, total: t.novos, media: t.novos / Math.max(bi.meses.length, 1), fmt: num },
    { label: "nMRR", valor: (m) => m.nmrr, total: t.nmrr, media: t.nmrr / Math.max(bi.meses.length, 1), fmt: brl },
    { label: "nMRR - Ticket Médio", valor: (m) => m.nmrrTicket, total: t.nmrrTicket, media: null, fmt: brl },
    { label: "Clientes Ativos", valor: (m) => m.ativos, total: t.ativosFim, media: t.ativosMedia, fmt: num },
    { label: "MRR", valor: (m) => m.mrr, total: t.mrr, media: t.mrrMedia, fmt: brl },
    { label: "MRR - Ticket Médio", valor: (m) => m.mrrTicket, total: t.mrrTicket, media: null, fmt: brl },
    { label: "Aviso Prévio Solicitado", valor: (m) => m.avisos, total: t.avisos, media: t.avisos / Math.max(bi.meses.length, 1), fmt: num },
    { label: "Clientes Cancelados", valor: (m) => m.cancelados, total: t.cancelados, media: t.cancelados / Math.max(bi.meses.length, 1), fmt: num },
    { label: "MRR Perdido", valor: (m) => m.mrrPerdido, total: t.mrrPerdido, media: t.mrrPerdido / Math.max(bi.meses.length, 1), fmt: brl },
    { label: "Churn Quantitativo (%)", valor: (m) => m.churnQtd, total: t.churnQtd, media: null, fmt: pct },
    { label: "Churn Financeiro (%)", valor: (m) => m.churnFin, total: t.churnFin, media: null, fmt: pct },
    { label: "CLT (meses)", valor: (m) => m.clt, total: t.clt, media: null, fmt: dec },
  ];

  const exportar = () => {
    const head = ["Indicador", "Acumulado Total", "Acumulado Média", ...bi.meses.map((m) => m.label)];
    const body = linhas.map((l) => [
      l.label,
      l.fmt(l.total),
      l.media === null ? "" : l.fmt(l.media),
      ...bi.meses.map((m) => l.fmt(l.valor(m))),
    ]);
    const csv = [head, ...body]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";"))
      .join("\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "gestao-bi.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="neu-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">Indicadores mês a mês</h2>
        <Button variant="ghost" className="neu-button h-8 text-xs" onClick={exportar}>
          <Download className="mr-2 h-3.5 w-3.5" />
          Exportar CSV
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-semibold text-foreground/80">
                Indicador
              </th>
              <th className="px-3 py-2 text-left font-semibold text-foreground/80">Acum. Total</th>
              <th className="px-3 py-2 text-left font-semibold text-foreground/80">Acum. Média</th>
              {bi.meses.map((m) => (
                <th key={m.mes} className="px-3 py-2 text-left font-semibold capitalize text-foreground/80">
                  {m.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l, i) => (
              <tr
                key={l.label}
                className={`border-b border-border ${i % 2 ? "bg-muted/20" : ""} hover:bg-muted/60`}
              >
                <td className="sticky left-0 z-10 bg-card px-3 py-2 font-medium text-foreground">
                  {l.label}
                </td>
                <td
                  className="px-3 py-2 font-semibold text-primary"
                  title={
                    l.label === "Clientes Ativos"
                      ? "Clientes distintos que estiveram ativos em algum momento do período"
                      : undefined
                  }
                >
                  {l.fmt(l.total)}
                </td>
                <td className="px-3 py-2 text-foreground/80">{l.media === null ? "—" : l.fmt(l.media)}</td>
                {bi.meses.map((m) => (
                  <td key={m.mes} className="whitespace-nowrap px-3 py-2 text-foreground/95">
                    {l.fmt(l.valor(m))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
