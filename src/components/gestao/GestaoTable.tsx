import * as React from "react";
import { toast } from "sonner";
import { ArrowUpDown, Download, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SearchableSelect } from "@/components/ui/searchable-select";
import type { GestaoCliente } from "@/hooks/useGestaoData";
import { titleCase } from "@/lib/utils";


const PAGE_SIZE = 25;

const brl = (v: number | null) =>
  v === null || v === undefined
    ? "—"
    : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const num = (v: number | null) => (v === null || v === undefined ? "—" : v.toFixed(1));
const date = (v: string | null) =>
  v ? new Date(`${v}T00:00:00`).toLocaleDateString("pt-BR") : "—";

const tempo = (v: number | null) => {
  if (v === null || v === undefined) return "—";
  if (v <= 12) return `${v.toFixed(1)} meses`;
  return `${(v / 12).toFixed(1)} anos`;
};

const isAtivo = (r: GestaoCliente) => (r.status ?? "").toUpperCase() === "ATIVO";
const temAviso = (r: GestaoCliente) => !!(r.data_aviso_previo_ref ?? r.data_aviso_previo);

type StatusKey = "ativo" | "aviso" | "cancelado";

const statusDe = (r: GestaoCliente): StatusKey =>
  !isAtivo(r) ? "cancelado" : temAviso(r) ? "aviso" : "ativo";

const STATUS_LABEL: Record<StatusKey, string> = {
  ativo: "Ativo",
  aviso: "Aviso prévio",
  cancelado: "Cancelado",
};

const STATUS_COLOR: Record<StatusKey, string> = {
  ativo: "hsl(var(--chart-line-primary, 156 64% 47%))",
  aviso: "hsl(var(--chart-line-pace, 30 80% 55%))",
  cancelado: "hsl(var(--destructive, 0 70% 50%))",
};

type SortKey = keyof GestaoCliente;

type ColumnDef = {
  key: SortKey;
  label: string;
  align?: "right";
  render?: (r: GestaoCliente) => React.ReactNode;
  className?: string;
};

const COLUMNS: ColumnDef[] = [
  {
    key: "cliente",
    label: "Cliente",
    className: "font-medium text-foreground",
    render: (r) => r.cliente,
  },
  { key: "data_inicio", label: "Data de Início", render: (r) => date(r.data_inicio) },
  {
    key: "status",
    label: "Status",
    render: (r) => {
      const isAtivo = (r.status ?? "").toUpperCase() === "ATIVO";
      return (
        <Badge
          variant="outline"
          className={`neu-badge ${isAtivo ? "active" : ""}`}
        >
          {r.status ?? "—"}
        </Badge>
      );
    },
  },
  { key: "plano", label: "Plano" },
  { key: "nmrr", label: "nMRR", render: (r) => brl(r.nmrr) },
  { key: "lider_revops", label: "Líder Revops" },
  { key: "responsavel_revops", label: "Responsável Revops" },
  { key: "especialidade", label: "Especialidade" },
  { key: "fonte_trafego", label: "Principal Fonte de Tráfego" },
  { key: "crm", label: "CRM" },
  { key: "tipo_crm", label: "Tipo CRM" },
  
  { key: "an_performance", label: "An. Performance" },
  { key: "an_design", label: "An. Design" },
  { key: "an_copy", label: "An. Copy" },
  { key: "an_edicao", label: "An. Edição" },
  {
    key: "data_inicio_ref",
    label: "Data de Início - Ref Mês",
    render: (r) => date(r.data_inicio_ref),
  },
  { key: "data_fim_ref", label: "Data de Fim - Ref Mês", render: (r) => date(r.data_fim_ref) },
  {
    key: "data_aviso_previo_ref",
    label: "Data Aviso Prévio - Ref Mês",
    render: (r) => date(r.data_aviso_previo_ref),
  },
  {
    key: "mrr_atual",
    label: "MRR Atual",
    className: "font-semibold text-foreground",
    render: (r) => brl(r.mrr_atual),
  },
  { key: "clt_previsto", label: "CLT Previsto", render: (r) => num(r.clt_previsto) },
  { key: "clt_atual", label: "CLT Atual", render: (r) => num(r.clt_atual) },
  { key: "ltv_previsto", label: "LTV Previsto", render: (r) => brl(r.ltv_previsto) },
  { key: "ltv_real", label: "LTV Real", render: (r) => brl(r.ltv_real) },
];


const optionsFrom = (rows: GestaoCliente[], key: SortKey) =>
  Array.from(new Set(rows.map((r) => (r[key] as string | null) ?? "").filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, "pt-BR"))
    .map((v) => ({ value: v, label: titleCase(v) }));

export function GestaoTable({ rows, loading }: { rows: GestaoCliente[]; loading?: boolean }) {
  const [busca, setBusca] = React.useState("");
  const [status, setStatus] = React.useState("all");
  const [plano, setPlano] = React.useState("all");
  const [especialidade, setEspecialidade] = React.useState("all");
  const [trafego, setTrafego] = React.useState("all");
  const [crm, setCrm] = React.useState("all");
  const [sort, setSort] = React.useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "mrr_atual",
    dir: "desc",
  });
  const [page, setPage] = React.useState(0);

  const SEM_CRM = "__sem_crm__";

  const crmOptions = React.useMemo(() => {
    const list = Array.from(
      new Set(
        rows
          .map((r) => (r.tipo_crm ?? "").trim())
          .filter((v) => v && v !== "-")
      )
    )
      .sort((a, b) => a.localeCompare(b, "pt-BR"))
      .map((v) => ({ value: v, label: titleCase(v) }));
    return list;
  }, [rows]);

  const hasCrm = (tipo: string) => tipo && tipo !== "-";

  const filtered = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (q && !r.cliente.toLowerCase().includes(q)) return false;
      if (status !== "all" && (r.status ?? "") !== status) return false;
      if (plano !== "all" && (r.plano ?? "") !== plano) return false;
      if (especialidade !== "all" && (r.especialidade ?? "") !== especialidade) return false;
      if (trafego !== "all" && (r.fonte_trafego ?? "") !== trafego) return false;
      if (crm !== "all") {
        const tipo = (r.tipo_crm ?? "").trim();
        if (crm === SEM_CRM) {
          if (hasCrm(tipo)) return false;
        } else if (tipo !== crm) {
          return false;
        }
      }
      return true;
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const va = a[sort.key];
      const vb = b[sort.key];
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), "pt-BR") * dir;
    });
  }, [rows, busca, status, plano, especialidade, trafego, crm, sort]);

  React.useEffect(() => setPage(0), [busca, status, plano, especialidade, trafego, crm]);

  // Se o valor selecionado deixar de existir no recorte atual, volta para "all".
  React.useEffect(() => {
    const has = (key: SortKey, v: string) =>
      v === "all" || rows.some((r) => ((r[key] as string | null) ?? "") === v);
    if (!has("status", status)) setStatus("all");
    if (!has("plano", plano)) setPlano("all");
    if (!has("especialidade", especialidade)) setEspecialidade("all");
    if (!has("fonte_trafego", trafego)) setTrafego("all");
    if (crm !== "all" && crm !== SEM_CRM) {
      const tipo = crm.trim();
      if (!rows.some((r) => (r.tipo_crm ?? "").trim() === tipo)) setCrm("all");
    }
  }, [rows, status, plano, especialidade, trafego, crm]);



  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const visible = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const toggleSort = (key: SortKey) =>
    setSort((s) => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" }));

  const exportCsv = React.useCallback(() => {
    try {
      const header = COLUMNS.map((c) => c.label).join(";");
      const body = filtered
        .map((r) =>
          COLUMNS.map((c) => {
            const v = r[c.key];
            return v === null || v === undefined ? "" : String(v).replace(/;/g, ",");
          }).join(";")
        )
        .join("\n");
      const blob = new Blob([`\uFEFF${header}\n${body}`], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gestao-carteira-${filtered.length}-clientes.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`CSV exportado com sucesso!`, {
        description: `${filtered.length} cliente${filtered.length === 1 ? "" : "s"} incluído${filtered.length === 1 ? "" : "s"} no arquivo.`,
      });
    } catch (err) {
      const motivo = err instanceof Error ? err.message : "Erro desconhecido ao gerar o arquivo.";
      toast.error("Falha ao exportar CSV", {
        description: motivo,
        action: {
          label: "Tentar novamente",
          onClick: () => exportCsv(),
        },
      });
    }
  }, [filtered]);

  const resetFiltros = () => {
    setBusca("");
    setStatus("all");
    setPlano("all");
    setEspecialidade("all");
    setTrafego("all");
    setCrm("all");
  };

  return (
    <div className="neu-card p-5 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-foreground">Tabela de Clientes</h3>
        <span className="neu-inset rounded-full px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
          {filtered.length} cliente{filtered.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar cliente..."
            className="neu-inset h-8 w-[200px] border-0 pl-9 text-xs"
          />
        </div>
        <div className="h-5 w-px bg-border/60 self-center" aria-hidden="true" />
        <SearchableSelect
          value={status}
          onValueChange={setStatus}
          options={optionsFrom(rows, "status")}
          placeholder="Status"
          allOption={{ value: "all", label: "Todos os Status" }}
          triggerClassName="h-8"
        />
        <SearchableSelect
          value={plano}
          onValueChange={setPlano}
          options={optionsFrom(rows, "plano")}
          placeholder="Plano"
          allOption={{ value: "all", label: "Todos os Planos" }}
          triggerClassName="h-8"
        />
        <SearchableSelect
          value={especialidade}
          onValueChange={setEspecialidade}
          options={optionsFrom(rows, "especialidade")}
          placeholder="Especialidade"
          allOption={{ value: "all", label: "Todas as Especialidades" }}
          triggerClassName="h-8"
        />
        <SearchableSelect
          value={trafego}
          onValueChange={setTrafego}
          options={optionsFrom(rows, "fonte_trafego")}
          placeholder="Tráfego"
          allOption={{ value: "all", label: "Todas as Fontes" }}
          triggerClassName="h-8"
        />
        <SearchableSelect
          value={crm}
          onValueChange={setCrm}
          options={[
            { value: SEM_CRM, label: "Não Possui" },
            ...crmOptions,
          ]}
          placeholder="CRM"
          allOption={{ value: "all", label: "Todos os CRM" }}
          triggerClassName="h-8"
        />
        <div className="h-5 w-px bg-border/60 self-center" aria-hidden="true" />
        <Button
          variant="ghost"
          onClick={resetFiltros}
          className="neu-button h-8 gap-1.5 px-3 text-[11px]"
          title="Limpar filtros da tabela"
        >
          <X className="h-3.5 w-3.5" />
          Limpar
        </Button>
      </div>

      <div className="overflow-auto rounded-lg max-h-[calc(100vh-16rem)] min-h-[420px] neu-scroll">
        <table className="w-full min-w-[1900px] text-xs">
          <thead>
            <tr className="border-b border-border">
              {COLUMNS.map((c, idx) => (
                <th
                  key={c.key}
                  onClick={() => toggleSort(c.key)}
                  className={`cursor-pointer select-none whitespace-nowrap px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-[10px] text-foreground/90 hover:text-foreground sticky top-0 z-10 bg-background ${idx === 0 ? "left-0 z-30 border-r border-border" : ""} ${
                    c.className ?? ""
                  }`}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.label}
                    {sort.key === c.key && <ArrowUpDown className="h-3 w-3 text-primary" />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-8 text-center text-foreground/80">
                  Carregando...
                </td>
              </tr>
            )}
            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-8 text-center text-foreground/80">
                  Nenhum cliente encontrado. Importe a planilha para começar.
                </td>
              </tr>
            )}
            {!loading &&
              visible.map((r, i) => (
                <tr
                  key={`${r.cliente}-${i}`}
                  className={`border-b border-border transition-colors hover:bg-muted/60 ${
                    i % 2 === 1 ? "bg-muted/20" : ""
                  }`}
                >
                  {COLUMNS.map((c, idx) => {
                    const raw = r[c.key];
                    return (
                      <td
                        key={c.key}
                        className={`whitespace-nowrap px-3 py-2.5 text-left ${idx === 0 ? "sticky left-0 z-20 bg-background border-r border-border" : ""} ${
                          c.className ?? "text-foreground/95"
                        }`}
                      >
                        {c.render
                          ? c.render(r)
                          : raw === null || raw === undefined || raw === ""
                            ? "—"
                            : String(raw)}
                      </td>
                    );
                  })}
                </tr>
              ))}

          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {filtered.length} cliente(s) · página {page + 1} de {pageCount}
        </span>
        <div className="flex items-center gap-2">
          <Button onClick={exportCsv} className="neu-button h-8 px-3 text-xs" variant="ghost">
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Exportar CSV
          </Button>
          <Button
            variant="ghost"
            className="neu-button h-8 text-xs"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Anterior
          </Button>
          <Button
            variant="ghost"
            className="neu-button h-8 text-xs"
            disabled={page >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          >
            Próxima
          </Button>
        </div>
      </div>
    </div>
  );
}
