import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  TrendingDown,
  TrendingUp,
  DollarSign,
  Flame,
  Search,
} from "lucide-react";
import type { AnuncioCardData } from "@/hooks/useMetaAdsCriativosData";
import { MetaAdsAnuncioCard, MetaAdsAnuncioDetailDialog } from "./MetaAdsAnuncioCard";
import {
  MetaAdsOrganizarMenu,
  METRICAS_OCULTAVEIS,
  type MetricaOcultavel,
  type ViewMode,
  type Colunas,
  type Preset,
} from "./MetaAdsOrganizarMenu";

type Metric = "investimento" | "resultado" | "hook" | "hold" | "cpc";
type SortDir = "asc" | "desc";
const CRITERIOS: { id: Metric; label: string; icon: "dollar" | "flame" | "up" | "down" }[] = [
  { id: "investimento", label: "Investimento", icon: "dollar" },
  { id: "resultado", label: "Resultados", icon: "flame" },
  { id: "hook", label: "Hook", icon: "up" },
  { id: "hold", label: "Hold", icon: "up" },
  { id: "cpc", label: "CPC", icon: "down" },
];

// Valor numérico de cada métrica p/ a ordenação.
const METRIC_VALUE: Record<Metric, (a: AnuncioCardData) => number> = {
  investimento: (a) => a.agg.gasto,
  resultado: (a) => a.agg.resultado,
  hook: (a) => a.agg.hookRate,
  hold: (a) => a.agg.holdRate,
  cpc: (a) => a.agg.cpc,
};

function iconFor(name: string) {
  const cls = "h-3.5 w-3.5";
  switch (name) {
    case "down":
      return <TrendingDown className={cls} />;
    case "up":
      return <TrendingUp className={cls} />;
    case "dollar":
      return <DollarSign className={cls} />;
    case "flame":
      return <Flame className={cls} />;
    default:
      return null;
  }
}

const PAGE_SIZE = 9;

// Ordena por métrica + direção. metric = null → SEM ordenação (mantém a ordem natural da lista).
function ordenar(list: AnuncioCardData[], metric: Metric | null, dir: SortDir): AnuncioCardData[] {
  if (!metric) return list;
  const get = METRIC_VALUE[metric];
  return [...list].sort((a, b) => (dir === "asc" ? get(a) - get(b) : get(b) - get(a)));
}

export function MetaAdsInsightsAnuncios({
  anuncios,
  loading = false,
}: {
  anuncios: AnuncioCardData[];
  loading?: boolean;
}) {
  // Ordenação em 3 estados por métrica: 1º clique = crescente, 2º = decrescente, 3º = remove.
  const [sortMetric, setSortMetric] = useState<Metric | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [campanha, setCampanha] = useState<string>("todas");
  const [status, setStatus] = useState<string>("todos");
  const [objetivo, setObjetivo] = useState<"geracao_demanda" | "seguidores">("geracao_demanda");
  const [busca, setBusca] = useState("");
  const [hidden, setHidden] = useState<Set<MetricaOcultavel>>(new Set());
  const [filtrosAbertos, setFiltrosAbertos] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [colunas, setColunas] = useState<Colunas>(3);
  const [preset, setPreset] = useState<Preset>("todas");
  const [selected, setSelected] = useState<AnuncioCardData | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [page, setPage] = useState(1);

  const campanhasUnicas = useMemo(() => Array.from(new Set(anuncios.map((a) => a.campanha))), [anuncios]);

  const lista = useMemo(() => {
    let l = anuncios.filter((a) => a.objetivo === objetivo);
    if (campanha !== "todas") l = l.filter((a) => a.campanha === campanha);
    if (status !== "todos") l = l.filter((a) => a.status === status);
    if (busca.trim()) {
      const q = busca.toLowerCase();
      l = l.filter(
        (a) =>
          a.nome.toLowerCase().includes(q) ||
          a.campanha.toLowerCase().includes(q) ||
          a.conjunto.toLowerCase().includes(q),
      );
    }
    return ordenar(l, sortMetric, sortDir);
  }, [anuncios, objetivo, campanha, status, busca, sortMetric, sortDir]);

  const totalPages = Math.max(1, Math.ceil(lista.length / PAGE_SIZE));
  // Volta pra 1ª página sempre que os filtros/ordenação mudam o conjunto exibido.
  useEffect(() => {
    setPage(1);
  }, [objetivo, campanha, status, busca, sortMetric, sortDir]);
  // Garante que a página atual continua válida se a lista encolher.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);
  const pageItems = useMemo(
    () => lista.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [lista, page],
  );

  // Clique na métrica de ordenação: outra métrica → crescente; mesma métrica crescente →
  // decrescente; mesma métrica decrescente → remove a ordenação (volta à ordem natural).
  function onSortClick(m: Metric) {
    if (sortMetric !== m) { setSortMetric(m); setSortDir("asc"); }
    else if (sortDir === "asc") { setSortDir("desc"); }
    else { setSortMetric(null); setSortDir("asc"); }
  }

  function toggleMetrica(mm: MetricaOcultavel) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(mm)) next.delete(mm);
      else next.add(mm);
      return next;
    });
    setPreset("personalizado");
  }

  function openDetail(a: AnuncioCardData) {
    setSelected(a);
    setDetailOpen(true);
  }

  const gridCols =
    viewMode === "lista"
      ? "grid-cols-1"
      : colunas === 2
        ? "grid-cols-1 sm:grid-cols-2"
        : colunas === 4
          ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
          : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold tracking-tight text-foreground">Insights dos Anúncios</h2>
        <span className="text-xs text-muted-foreground">{lista.length} anúncios</span>
      </div>

      {/* Toolbar */}
      <div className="neu-card rounded-xl p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Filtrar por tipo:</span>
            <div className="flex gap-2">
              {(["geracao_demanda", "seguidores"] as const).map((o) => {
                const active = objetivo === o;
                return (
                  <button
                    key={o}
                    onClick={() => setObjetivo(o)}
                    className={`cursor-pointer rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider transition ${
                      active ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {o === "geracao_demanda" ? "Geração de Demanda" : "Seguidores"}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar anúncios..."
              className="w-full rounded-full bg-secondary/30 py-2 pl-9 pr-3 text-xs outline-none placeholder:text-muted-foreground/70"
            />
          </div>
        </div>
      </div>

      {/* Filtros e ordenação */}
      <div className="neu-card rounded-xl p-5">
        <button className="flex w-full items-center justify-between" onClick={() => setFiltrosAbertos((v) => !v)}>
          <span className="text-sm font-semibold tracking-wide text-foreground/90">Filtros e ordenação</span>
          {filtrosAbertos ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        {filtrosAbertos && (
          <div className="mt-5 space-y-5">
            <div className="flex flex-wrap items-end gap-4">
              <div className="min-w-[260px] flex-1">
                <p className="mb-2 text-xs text-muted-foreground">
                  Ordenar por <span className="text-foreground/50">(clique: crescente → decrescente → sem ordenação)</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  {CRITERIOS.map((c) => {
                    const active = sortMetric === c.id;
                    return (
                      <button
                        key={c.id}
                        onClick={() => onSortClick(c.id)}
                        title={active ? (sortDir === "asc" ? "Crescente (clique p/ decrescente)" : "Decrescente (clique p/ remover)") : "Ordenar (crescente)"}
                        className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                          active ? "bg-emerald-500 text-white" : "neu-card rounded-full text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {iconFor(c.icon)}
                        {c.label}
                        {active && (sortDir === "asc" ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />)}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-wrap gap-4">
                <div className="min-w-[180px]">
                  <p className="mb-2 text-xs text-muted-foreground">Filtrar por Campanha</p>
                  <select
                    value={campanha}
                    onChange={(e) => setCampanha(e.target.value)}
                    className="neu-card w-full cursor-pointer truncate rounded-xl bg-transparent px-3 py-2 text-xs font-medium text-foreground outline-none sm:w-52"
                  >
                    <option value="todas">Todas as campanhas</option>
                    {campanhasUnicas.map((c) => (
                      <option key={c} value={c}>
                        {c.length > 60 ? c.slice(0, 57) + "…" : c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-[180px]">
                  <p className="mb-2 text-xs text-muted-foreground">Filtrar por Status</p>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="neu-card w-full cursor-pointer rounded-xl bg-transparent px-3 py-2 text-xs font-medium text-foreground outline-none sm:w-52"
                  >
                    <option value="todos">Todos Status</option>
                    <option value="ativo">Ativo</option>
                    <option value="pausado">Pausado</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Ocultar métricas */}
            <div>
              <p className="mb-2 text-xs text-muted-foreground">
                Ocultar métricas? <span className="text-foreground/70">({hidden.size} ocultas)</span>
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                {METRICAS_OCULTAVEIS.map((mm) => {
                  const isHidden = hidden.has(mm);
                  return (
                    <button
                      key={mm}
                      onClick={() => toggleMetrica(mm)}
                      className={`cursor-pointer rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                        isHidden ? "bg-muted/50 text-muted-foreground line-through" : "neu-card rounded-full text-foreground/80 hover:text-foreground"
                      }`}
                    >
                      {mm}
                    </button>
                  );
                })}
                <div className="ml-auto">
                  <MetaAdsOrganizarMenu
                    viewMode={viewMode}
                    setViewMode={setViewMode}
                    colunas={colunas}
                    setColunas={setColunas}
                    filtrosAbertos={filtrosAbertos}
                    setFiltrosAbertos={setFiltrosAbertos}
                    preset={preset}
                    setPreset={setPreset}
                    setHidden={setHidden}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Grid de anúncios */}
      {loading ? (
        <div className="neu-card rounded-xl p-10 text-center text-sm text-muted-foreground">Carregando anúncios…</div>
      ) : lista.length === 0 ? (
        <div className="neu-card rounded-xl p-10 text-center text-sm text-muted-foreground">
          Nenhum anúncio encontrado com os filtros atuais.
        </div>
      ) : (
        <>
          <div className={`grid gap-4 ${gridCols}`}>
            {pageItems.map((a) => (
              <MetaAdsAnuncioCard key={a.id} anuncio={a} hiddenMetrics={hidden} layout={viewMode} colunas={colunas} onSelect={openDetail} />
            ))}
          </div>
          {totalPages > 1 && (
            <Paginacao page={page} totalPages={totalPages} total={lista.length} onChange={setPage} />
          )}
        </>
      )}

      <MetaAdsAnuncioDetailDialog anuncio={selected} open={detailOpen} onOpenChange={setDetailOpen} />
    </div>
  );
}

function Paginacao({
  page,
  totalPages,
  total,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onChange: (p: number) => void;
}) {
  const inicio = (page - 1) * PAGE_SIZE + 1;
  const fim = Math.min(page * PAGE_SIZE, total);
  const paginas = Array.from({ length: totalPages }, (_, i) => i + 1);

  return (
    <div className="mt-5 flex flex-col items-center justify-center gap-3">
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <button
          onClick={() => onChange(Math.max(1, page - 1))}
          disabled={page === 1}
          className="neu-card inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-foreground/80 transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Página anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {paginas.map((p) => (
          <button
            key={p}
            onClick={() => onChange(p)}
            aria-current={p === page ? "page" : undefined}
            className={`inline-flex h-8 min-w-8 cursor-pointer items-center justify-center rounded-lg px-2 text-xs font-medium transition ${
              p === page
                ? "bg-emerald-500 text-white"
                : "neu-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {p}
          </button>
        ))}
        <button
          onClick={() => onChange(Math.min(totalPages, page + 1))}
          disabled={page === totalPages}
          className="neu-card inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-foreground/80 transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Próxima página"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <span className="text-xs text-muted-foreground">
        Exibindo {inicio}–{fim} de {total} anúncios
      </span>
    </div>
  );
}
