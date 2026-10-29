import * as React from "react";
import {
  Sparkles,
  Hourglass,
  Search,
  X,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart as RePieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Tooltip as UiTooltip,
  TooltipContent as UiTooltipContent,
  TooltipProvider as UiTooltipProvider,
  TooltipTrigger as UiTooltipTrigger,
} from "@/components/ui/tooltip";
import type { GestaoCliente } from "@/hooks/useGestaoData";
import { titleCase } from "@/lib/utils";
import { cltNoMes, intervaloBI } from "./useGestaoBI";
import { mrrTotalNoMes } from "./mrrEngine";

/** Série de Clientes; "Outros" em cinza para diferenciar. */
const COR_SERIE = "#2A78D6";
const COR_OUTROS = "#898781";
/** Cor da série de MRR quando as duas métricas aparecem juntas. */
const COR_MRR = "#1BAF7A";
/** Cor dos rótulos de dados — segue o token do tema (claro no escuro, escuro no claro). */
const COR_ROTULO = "hsl(var(--chart-label, 40 11% 93%))";
/** Cor dos nomes de categoria (eixo/legenda) — um degrau abaixo, também por token do tema. */
const COR_EIXO = "hsl(var(--chart-axis, 50 8% 74%))";
/**
 * Rampa azul -> verde (metade clara) das fatias; todas aceitam texto escuro.
 * As cores são distribuídas ao longo de TODA a rampa conforme o nº de fatias.
 */
const PALETA_FATIA = [
  "#042C53",
  "#0C447C",
  "#185FA5",
  "#2A78D6",
  "#378ADD",
  "#5B9FE4",
  "#85B7EB",
];
/** "Outros" nas fatias: cinza escuro, fora da rampa. */
const COR_OUTROS_FATIA = "#5F5E5A";

/**
 * Texto sobre a fatia: adapta ao brilho da fatia (independe do tema) — texto
 * escuro sobre fatia clara, branco sobre fatia escura — para nunca sair de baixo
 * contraste (ex.: rótulo branco sobre as fatias claras da rampa no modo claro).
 */
const corTextoFatia = (fill: string): string => {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(fill.trim());
  if (!m) return "#FFFFFF";
  const int = parseInt(m[1], 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  const luminancia = 0.299 * r + 0.587 * g + 0.114 * b; // 0..255
  return luminancia > 150 ? "#0B1E33" : "#FFFFFF";
};



const tooltipStyle = {
  background: "hsl(var(--card, 213 45% 15%))",
  border: "1px solid hsl(var(--border, 213 35% 22%))",
  borderRadius: 12,
  fontSize: 12,
  color: "hsl(var(--foreground, 210 12% 93%))",
};

/** Tooltip customizado do gráfico "Clientes por X" (mostra sempre as duas métricas). */
function BarTooltip({
  active,
  payload,
  rotulo = "Clientes ativos",
  metrica = "clientes",
  rotuloMrr = "MRR Ativo",
}: {
  active?: boolean;
  payload?: readonly {
    name?: string;
    value?: number;
    color?: string;
    payload?: {
      nome?: string;
      qtd: number;
      mrr: number;
      mrrValido?: number;
      itens?: { nome: string; qtd: number; mrr: number; mrrValido?: number }[];
    };
  }[];
  rotulo?: string;
  metrica?: "clientes" | "mrr";
  rotuloMrr?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0];
  const nome = p?.payload?.nome ?? p?.name ?? "—";
  const qtd = p?.payload?.qtd ?? 0;
  const mrr = p?.payload?.mrr ?? 0;
  const mrrValido = p?.payload?.mrrValido ?? 0;
  const itens = p?.payload?.itens;
  // Ordem fixa: MRR Ativo, MRR Válido, Clientes.
  const linhas = [
    { label: rotuloMrr, valor: brlK(mrr), destaque: metrica === "mrr" },
    { label: "MRR Válido", valor: brlK(mrrValido), destaque: false },
    { label: rotulo, valor: String(qtd), destaque: metrica === "clientes" },
  ];
  const lista = itens
    ? [...itens].sort((a, b) => (metrica === "mrr" ? b.mrr - a.mrr : b.qtd - a.qtd))
    : null;
  const cor = p?.color ?? "hsl(var(--primary, 214 85% 60%))";
  return (
    <div className="neu-raised min-w-[190px] max-w-[280px] rounded-xl px-3.5 py-2.5 shadow-2xl">
      <div className="mb-2 flex items-center gap-2 border-b border-border/60 pb-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full shadow-sm" style={{ background: cor }} />
        <p className="max-w-[220px] truncate text-[12px] font-bold leading-tight text-foreground">
          {nome}
        </p>
      </div>
      <div className="space-y-1.5">
        {linhas.map((l) => (
          <div key={l.label} className="flex items-center justify-between gap-6">
            <span
              className={
                l.destaque
                  ? "text-[11px] font-medium text-foreground"
                  : "text-[11px] text-muted-foreground"
              }
            >
              {l.label}
            </span>
            <span
              className={
                l.destaque
                  ? "text-[13px] font-bold tabular-nums text-primary"
                  : "text-[12px] font-semibold tabular-nums text-muted-foreground"
              }
            >
              {l.valor}
            </span>
          </div>
        ))}
      </div>
      {lista && lista.length > 0 && (
        <div className="mt-2.5 space-y-0.5 border-t border-border/60 pt-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
            Clientes ({Math.min(lista.length, 8)} de {lista.length})
          </p>
          {lista.slice(0, 8).map((it) => (
            <div
              key={it.nome}
              className="flex items-center justify-between gap-4 rounded-md px-1 py-0.5 hover:bg-muted/40"
            >
              <span className="max-w-[150px] truncate text-[10px] text-muted-foreground">
                {it.nome}
              </span>
              <span className="text-[10px] font-semibold tabular-nums text-foreground">
                {metrica === "mrr" ? brlK(it.mrr) : String(it.qtd)}
              </span>
            </div>
          ))}
          {lista.length > 8 && (
            <p className="pt-1 text-[10px] italic text-muted-foreground">
              +{lista.length - 8} outros
            </p>
          )}
        </div>
      )}
    </div>
  );
}






const brl = (v: number | null | undefined) =>
  v === null || v === undefined
    ? "—"
    : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const brlK = (v: number) =>
  Math.abs(v) >= 1000
    ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`
    : brl(v);

const tempo = (v: number | null | undefined) => {
  if (v === null || v === undefined) return "—";
  return `${v.toFixed(2).replace(".", ",")} meses`;
};

const num = (v: number | null | undefined) => (typeof v === "number" ? v : 0);
/** Tempo de casa plausível: a planilha traz alguns registros com valor impossível. */
const cltValido = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 600;
const avg = (arr: number[]) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);
/** Diferença entre duas datas em meses (dias / 30), como na planilha. */
const diffMeses = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / (30 * 864e5);

const temAviso = (r: GestaoCliente) => !!(r.data_aviso_previo_ref ?? r.data_aviso_previo);
const temCrm = (r: GestaoCliente) => {
  const t = (r.tipo_crm ?? "").trim();
  return !!t && t !== "-";
};
const crmNome = (r: GestaoCliente) => {
  const t = (r.tipo_crm ?? "").trim();
  return !t || t === "-" ? "Sem CRM" : titleCase(t);
};

const parseDate = (v: string | null | undefined) => (v ? new Date(`${v}T00:00:00`) : null);
const diasAte = (v: string | null | undefined, hoje: Date) => {
  const d = parseDate(v);
  if (!d || Number.isNaN(d.getTime())) return null;
  return Math.round((d.getTime() - hoje.getTime()) / 86_400_000);
};

/** yyyy-MM de uma data ISO (yyyy-MM-dd). */
const ym = (v: string | null | undefined) => (v ? v.slice(0, 7) : null);

const inicioMesDe = (r: GestaoCliente) => ym(r.data_inicio_ref) ?? ym(r.data_inicio);
const fimMesDe = (r: GestaoCliente) => ym(r.data_fim_ref);
/**
 * Regra única de "cliente ativo" da página (mesma da tabela Indicadores mês a mês):
 * início <= mês E (fim vazio OU fim >= mês). A coluna "Status" do DB não entra na conta.
 */
const ativoNoMes = (r: GestaoCliente, mes: string) => {
  const i = inicioMesDe(r);
  if (!i || i > mes) return false;
  const f = fimMesDe(r);
  return !f || f >= mes;
};
/**
 * MRR do cliente no mês vindo da matriz da aba "MRR Calculado" — sem recalcular
 * a partir do DB. Cliente sem ID cruzado fica com 0 (diferença exibida no rodapé).
 */
const mrrMatrizNoMes = (r: GestaoCliente, mes: string) => {
  const v = r.mrr_mensal?.[mes];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
};

/**
 * MRR do cliente para os gráficos: ativo usa o mês de referência; inativo usa o
 * último mês com valor até a referência (o MRR que ele tinha ao sair).
 */
const mrrDoCliente = (r: GestaoCliente, mes: string) => {
  if (ativoNoMes(r, mes)) return mrrMatrizNoMes(r, mes);
  const serie = r.mrr_mensal;
  if (serie) {
    const meses = Object.keys(serie)
      .filter((m) => m <= mes)
      .sort();
    for (let i = meses.length - 1; i >= 0; i--) {
      const v = serie[meses[i]!];
      if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
    }
  }
  const atual = r.mrr_atual;
  return typeof atual === "number" && Number.isFinite(atual) ? atual : 0;
};

/**
 * MRR Válido: mesmo MRR do cliente, mas o primeiro mês de contrato é excluído.
 * Usa a mesma regra temporal de Insights Equipes.
 */
const mrrValidoDoCliente = (r: GestaoCliente, mes: string) => {
  const inicio = inicioMesDe(r);
  if (!inicio || inicio >= mes) return 0;
  return mrrDoCliente(r, mes);
};


const SEM_CRM = "__sem_crm__";

const optionsFrom = (rows: GestaoCliente[], key: keyof GestaoCliente) =>
  Array.from(
    new Set(rows.map((r) => ((r[key] as string | null) ?? "").trim()).filter((v) => !!v))
  )
    .sort((a, b) => a.localeCompare(b, "pt-BR"))
    .map((v) => ({ value: v, label: titleCase(v) }));

type Linha = {
  label: string;
  valor: string;
  tone?: "muted" | "primary" | "danger";
  /** Texto exibido no hover da linha (lista de clientes na situação). */
  hover?: string;
};

/** Monta o texto de hover com a lista de clientes de uma situação. */
const listaClientes = (nomes: string[]) =>
  nomes.length ? nomes.map((n, i) => `${i + 1}. ${n}`).join("\n") : "Nenhum cliente nesta situação";

function ClientesTooltip({ titulo, texto, children }: {
  titulo: string;
  texto: string;
  children: React.ReactElement;
}) {
  const itens = texto
    .split(/\n|,\s+/)
    .map((item) => item.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean);
  const vazio = itens.length === 1 && itens[0] === "Nenhum cliente nesta situação";

  return (
    <UiTooltipProvider delayDuration={120} skipDelayDuration={80}>
      <UiTooltip>
        <UiTooltipTrigger asChild>{children}</UiTooltipTrigger>
        <UiTooltipContent
          side="top"
          align="start"
          className="w-[300px] max-w-[calc(100vw-2rem)] overflow-hidden p-0"
        >
          <div className="border-b border-border/60 bg-muted/35 px-3.5 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Clientes nesta situação
            </p>
            <div className="mt-1 flex items-center justify-between gap-3">
              <p className="min-w-0 text-sm font-semibold leading-snug text-foreground">{titulo}</p>
              <span className="shrink-0 rounded-full bg-primary/12 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-primary">
                {vazio ? 0 : itens.length}
              </span>
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto px-2 py-2">
            {vazio ? (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">Nenhum cliente nesta situação</p>
            ) : (
              <ol className="space-y-0.5">
                {itens.map((item, index) => (
                  <li
                    key={`${item}-${index}`}
                    className="flex gap-2 rounded-md px-2 py-1.5 text-xs leading-relaxed text-foreground hover:bg-muted/50"
                  >
                    <span className="w-4 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
                      {index + 1}
                    </span>
                    <span className="min-w-0 break-words">{item}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </UiTooltipContent>
      </UiTooltip>
    </UiTooltipProvider>
  );
}

function Card({
  icon: Icon,
  titulo,
  destaque,
  sub,
  linhas,
  tone = "primary",
  nota,
  notaHover,
  acao,
}: {
  icon: React.ElementType;
  titulo: string;
  destaque: string;
  sub?: string;
  linhas?: Linha[];
  tone?: "primary" | "warning";
  nota?: string;
  notaHover?: string;
  acao?: React.ReactNode;
}) {
  return (
    <div className="neu-inset flex flex-col gap-2 rounded-xl px-3 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <div
            className={`neu-icon shrink-0 ${tone === "warning" ? "text-destructive" : "text-primary"}`}
          >
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {titulo}
            </p>
            <p className="truncate text-sm font-semibold text-foreground">{destaque}</p>
            {sub ? <p className="truncate text-xs text-primary">{sub}</p> : null}
          </div>
        </div>
        {acao ? <div className="shrink-0">{acao}</div> : null}
      </div>
      {linhas?.length ? (
        <div className="space-y-1 border-t border-border/40 pt-2">
          {linhas.map((l) => {
            const linha = (
              <div
                className={`flex items-baseline justify-between gap-2 rounded-md px-1 py-0.5 text-[11px] transition-colors ${
                  l.hover ? "cursor-help hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" : ""
                }`}
                {...(l.hover ? { tabIndex: 0 } : {})}
              >
                <span className="truncate text-muted-foreground">{l.label}</span>
                <span
                  className={`shrink-0 tabular-nums font-medium ${
                    l.tone === "danger"
                      ? "text-destructive"
                      : l.tone === "muted"
                        ? "text-muted-foreground"
                        : l.tone === "primary"
                          ? "text-primary"
                          : "text-foreground"
                  }`}
                >
                  {l.valor}
                </span>
              </div>
            );

            return l.hover ? (
              <ClientesTooltip key={l.label} titulo={l.label} texto={l.hover}>
                {linha}
              </ClientesTooltip>
            ) : (
              <React.Fragment key={l.label}>{linha}</React.Fragment>
            );
          })}
        </div>
      ) : null}
      {nota ? (
        notaHover ? (
          <ClientesTooltip titulo="Fora do cálculo" texto={notaHover}>
            <p className="cursor-help rounded-md px-1 py-0.5 text-[10px] leading-snug text-chart-legend transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" tabIndex={0}>
              {nota}
            </p>
          </ClientesTooltip>
        ) : (
          <p className="text-[10px] leading-snug text-chart-legend">{nota}</p>
        )
      ) : null}
    </div>
  );
}

type DimensaoDef = {
  valor: string;
  label: string;
  plural: string;
  key: (r: GestaoCliente) => string;
  /** Chave que depende do mês de referência (ex.: Status pela regra de datas). */
  keyMes?: (r: GestaoCliente, mes: string) => string;
  base?: "todos";

  limite?: number;
};

type ModoBase = "todos" | "ativa" | "inativa";

/** Gráfico independente de uma dimensão (Clientes + MRR), com ordenação e tipo próprios. */
function DimensaoChart({
  dim,
  base,
  baseTodos,
  modo,
  mesRef,
}: {
  dim: DimensaoDef;
  /** Base de análise do bloco (segue o filtro de Status). */
  base: GestaoCliente[];
  /** Base completa (ativos + inativos) — usada pelas dimensões com base fixa. */
  baseTodos: GestaoCliente[];
  modo: ModoBase;
  /** Último mês do período global — referência da regra de ativo e do MRR. */
  mesRef: string;
}) {
  const [metricaDim, setMetricaDim] = React.useState<"clientes" | "mrr">("clientes");
  const [tipoGrafico, setTipoGrafico] = React.useState<
    "barh" | "barv" | "rosca" | "pizza" | "area"
  >("barh");
  const ehFatia = tipoGrafico === "rosca" || tipoGrafico === "pizza";
  const gradId = React.useId().replace(/:/g, "");
  /** Modo efetivo: dimensões com base fixa ignoram o filtro de Status. */
  const modoEf: ModoBase = dim.base === "todos" ? "todos" : modo;
  /** Métrica única exibida nas barras/área (segue o seletor "Ordenar"). */
  const chaveMetrica = metricaDim === "clientes" ? "qtd" : "mrr";
  const corMetrica = metricaDim === "clientes" ? COR_SERIE : COR_MRR;

  /** Quando a base inclui inativos, o MRR não é "ativo". */
  const rotuloMrr =
    modoEf === "ativa" ? "MRR Ativo" : modoEf === "inativa" ? "MRR na saída" : "MRR";
  const rotuloMetrica = metricaDim === "mrr" ? rotuloMrr : "Clientes";

  const rotuloClientes =
    modoEf === "ativa" ? "Clientes ativos" : modoEf === "inativa" ? "Clientes inativos" : "Clientes";


  const dadosEsp = React.useMemo(() => {
    const lista = dim.base === "todos" ? baseTodos : base;
    const mapa = new Map<string, { qtd: number; mrr: number; mrrValido: number }>();
    for (const r of lista) {
      const nome = (dim.keyMes ? dim.keyMes(r, mesRef) : dim.key(r)) || "Não informado";
      const cur = mapa.get(nome) ?? { qtd: 0, mrr: 0, mrrValido: 0 };
      cur.qtd += 1;
      cur.mrr += mrrDoCliente(r, mesRef);
      cur.mrrValido += mrrValidoDoCliente(r, mesRef);
      mapa.set(nome, cur);
    }
    return Array.from(mapa.entries())
      .map(([nome, v]) => ({
        nome,
        qtd: v.qtd,
        mrr: v.mrr,
        mrrValido: v.mrrValido,
        valor: metricaDim === "mrr" ? v.mrr : v.qtd,
      }))
      .sort((a, b) => b.valor - a.valor || b.mrr - a.mrr || a.nome.localeCompare(b.nome, "pt-BR"));
  }, [base, baseTodos, dim, metricaDim, mesRef]);


  /** Categorias do topo (sempre no eixo) e a cauda agrupada em "Outros". */
  const { dadosTopo, cauda } = React.useMemo(() => {
    const limite = dim.limite ?? 6;
    const topo = dadosEsp.slice(0, limite);
    let resto = dadosEsp.slice(limite);
    // Uma única categoria fora do topo aparece pelo nome real.
    if (resto.length === 1) {
      topo.push(resto[0]!);
      resto = [];
    }
    return {
      dadosTopo: topo.map((x) => ({ ...x, outros: false, itens: undefined })),
      cauda: resto,
    };
  }, [dadosEsp, dim.limite]);

  const outrosItem = React.useMemo(() => {
    if (cauda.length === 0) return null;
    const soma = cauda.reduce(
      (a, x) => ({
        qtd: a.qtd + x.qtd,
        mrr: a.mrr + x.mrr,
        mrrValido: a.mrrValido + x.mrrValido,
        valor: a.valor + x.valor,
      }),
      { qtd: 0, mrr: 0, mrrValido: 0, valor: 0 }
    );
    return {
      nome: "Outros",
      ...soma,
      outros: true,
      itens: cauda.map((x) => ({ nome: x.nome, qtd: x.qtd, mrr: x.mrr, mrrValido: x.mrrValido })),
    };
  }, [cauda]);

  /** Nas fatias o agrupado entra no gráfico; nas demais visualizações, não. */
  const dadosGrafico = React.useMemo(
    () => (ehFatia && outrosItem ? [...dadosTopo, outrosItem] : dadosTopo),
    [ehFatia, outrosItem, dadosTopo]
  );

  const [outrosAberto, setOutrosAberto] = React.useState(false);
  React.useEffect(() => {
    setOutrosAberto(false);
  }, [tipoGrafico]);

  const caudaOrdenada = React.useMemo(
    () =>
      [...cauda].sort((a, b) => (metricaDim === "mrr" ? b.mrr - a.mrr : b.qtd - a.qtd)),
    [cauda, metricaDim]
  );


  /**
   * Cores das fatias distribuídas ao longo da rampa azul (escuro -> claro),
   * do maior valor ao menor. Os dois tons mais claros só entram com 6+ fatias.
   * "Outros" fica sempre fora da distribuição, em cinza escuro.
   */
  const coresFatia = React.useMemo(() => {
    const principais = dadosGrafico.filter((x) => !x.outros);
    const n = principais.length;
    let idxs: number[];
    if (n === 3) idxs = [1, 3, 5];
    else if (n === 4) idxs = [0, 2, 4, 6];
    else if (n === 2) idxs = [1, 3];
    else if (n <= 1) idxs = [2];
    else {
      const ultimo = n >= 6 ? PALETA_FATIA.length - 1 : 4;
      idxs = Array.from({ length: n }, (_, i) => Math.round((i * ultimo) / (n - 1)));
    }
    const mapa = new Map<string, string>();
    principais.forEach((x, i) => mapa.set(x.nome, PALETA_FATIA[idxs[i]!]!));
    return mapa;
  }, [dadosGrafico]);

  const corDe = React.useCallback(
    (nome: string, outros: boolean) =>
      outros ? COR_OUTROS_FATIA : (coresFatia.get(nome) ?? COR_SERIE),
    [coresFatia]
  );


  const totalBase = dadosEsp.reduce((a, x) => a + x.qtd, 0);
  const totalMrr = dadosEsp.reduce((a, x) => a + x.mrr, 0);

  /**
   * MRR Ativo do mês de referência (regra do motor) x soma atribuída às
   * categorias pela matriz. A diferença = clientes sem ID cruzado na planilha.
   */
  const mrrNaoAtribuido = React.useMemo(() => {
    if (modoEf !== "ativa") return 0;
    return mrrTotalNoMes(base, mesRef) - totalMrr;
  }, [modoEf, base, mesRef, totalMrr]);


  /** Altura proporcional ao número de categorias (evita área vazia). */
  const alturaBarh = dadosGrafico.length * 46 + 60;
  /** Teto da área de gráfico: estabiliza Rosca/Pizza e barras em viewports altas. */
  const ALTURA_MAX_GRAFICO = 460;

  /**
   * Rótulo posicionado logo após o fim da própria barra (10px de respiro),
   * centrado verticalmente na barra — sem alinhamento em coluna.
   */
  const rotuloBarra =
    (serie: "qtd" | "mrr") =>
    (raw: unknown) => {
      const props = raw as {
        x?: number | string;
        y?: number | string;
        width?: number | string;
        height?: number | string;
        index?: number;
      };
      const item = dadosGrafico[props.index ?? -1];
      if (!item) return null;
      const n = (v: number | string | undefined) => (typeof v === "number" ? v : Number(v) || 0);
      return (
        <text
          x={n(props.x) + n(props.width) + 10}
          y={n(props.y) + n(props.height) / 2}
          fill={COR_ROTULO}
          fontSize={13}
          fontWeight={500}
          dominantBaseline="central"
        >
          {serie === "qtd" ? String(item.qtd) : brlK(item.mrr)}
        </text>
      );
    };

  /**
   * Rótulo no topo da coluna/ponto: sempre em UMA linha (nowrap), transbordando
   * horizontalmente centralizado quando a coluna é mais estreita que o texto.
   */
  const rotuloTopo = (raw: unknown) => {
    const props = raw as {
      x?: number | string;
      y?: number | string;
      width?: number | string;
      value?: number | string;
    };
    const n = (v: number | string | undefined) => (typeof v === "number" ? v : Number(v) || 0);
    const valor = n(props.value);
    return (
      <text
        x={n(props.x) + n(props.width) / 2}
        y={n(props.y) - 8}
        textAnchor="middle"
        fill={COR_ROTULO}
        fontSize={11}
        fontWeight={500}
        style={{ whiteSpace: "nowrap" }}
      >
        {metricaDim === "clientes" ? String(valor) : brlK(valor)}
      </text>
    );
  };

  /**
   * Rótulo dentro da fatia: clientes (15px/500) + MRR abreviado (12px/400).
   * Exibe ambos os valores em todas as fatias, mesmo quando o espaço é pequeno.
   */
  const renderFatiaLabel = (props: {
    cx?: number;
    cy?: number;
    midAngle?: number;
    innerRadius?: number;
    outerRadius?: number;
    percent?: number;
    value?: number;
    name?: string;
  }) => {
    const pct = props.percent ?? 0;
    const RAD = Math.PI / 180;
    const ri = props.innerRadius ?? 0;
    const ro = props.outerRadius ?? 0;
    const raio = ri + (ro - ri) * 0.55;
    const ang = -(props.midAngle ?? 0) * RAD;
    const x = (props.cx ?? 0) + raio * Math.cos(ang);
    const y = (props.cy ?? 0) + raio * Math.sin(ang);
    const nome = props.name ?? "";
    const item = dadosGrafico.find((z) => z.nome === nome);
    const cor = corTextoFatia(corDe(nome, Boolean(item?.outros)));
    const textoMrr = brlK(item?.mrr ?? 0);

    return (
      <text x={x} y={y} fill={cor} textAnchor="middle" dominantBaseline="central">
        <tspan x={x} dy="-0.6em" fontSize={15} fontWeight={500}>
          {String(item?.qtd ?? props.value ?? 0)}
        </tspan>
        <tspan x={x} dy="1.25em" fontSize={12} fontWeight={400}>
          {textoMrr}
        </tspan>
      </text>
    );
  };

  const TIPOS: { valor: typeof tipoGrafico; label: string }[] = [
    { valor: "barh", label: "Barras" },
    { valor: "barv", label: "Colunas" },
    { valor: "rosca", label: "Rosca" },
    { valor: "pizza", label: "Pizza" },
    { valor: "area", label: "Área" },
  ];

  const rotuloBase =
    modoEf === "ativa" ? "Base ativa" : modoEf === "inativa" ? "Base inativa" : "Base completa";
  const subtitulo = `${rotuloBase} · ${totalBase} clientes · ${brlK(totalMrr)}`;


  return (
    <div className="neu-inset flex h-full flex-col rounded-xl p-4">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Clientes e MRR por {dim.label}
          </p>
          <p className="text-xs text-muted-foreground">{subtitulo}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex items-center gap-1">
            <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
              Ordenar
            </span>
            {(["clientes", "mrr"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMetricaDim(m)}
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition ${
                  metricaDim === m
                    ? "neu-inset text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {m === "clientes" ? "Clientes" : "MRR Ativo"}
              </button>
            ))}
          </div>
          <div className="neu-inset flex items-center gap-0.5 rounded-full p-0.5">
            {TIPOS.map((t) => (
              <button
                key={t.valor}
                type="button"
                onClick={() => setTipoGrafico(t.valor)}
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition ${
                  tipoGrafico === t.valor
                    ? "neu-raised text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {!ehFatia && (tipoGrafico === "barh" || tipoGrafico === "area") && (
        <div className="mb-1 flex items-center gap-4">
          <span className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground">
            <span
              className="h-2.5 w-2.5 rounded-[3px]"
              style={{ background: corMetrica }}
            />
            {rotuloMetrica}
          </span>
        </div>
      )}
      {/* Teto de altura: o gráfico pode encolher, mas nunca cresce além do
          necessário — o espaço que sobra vira margem do card. */}
      <div
        className="relative w-full flex-1"
        style={{
          minHeight: tipoGrafico === "barh" ? Math.min(alturaBarh, ALTURA_MAX_GRAFICO) : 300,
          maxHeight: tipoGrafico === "barh" ? alturaBarh : ALTURA_MAX_GRAFICO,
        }}
      >
        {tipoGrafico === "rosca" && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span
              className="text-[32px] font-medium leading-none tabular-nums"
              style={{ color: COR_ROTULO }}
            >
              {totalBase}
            </span>
            <span className="mt-1 text-xs" style={{ color: COR_EIXO }}>
              clientes
            </span>
            <span
              className="mt-2.5 text-lg font-medium leading-none tabular-nums"
              style={{ color: COR_ROTULO }}
            >
              {brlK(totalMrr)}
            </span>
            <span className="mt-1 text-xs" style={{ color: COR_EIXO }}>
              MRR
            </span>
          </div>
        )}
        <ResponsiveContainer width="100%" height="100%">
          {ehFatia ? (
            <RePieChart margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <RechartsTooltip content={<BarTooltip rotulo={rotuloClientes} metrica={metricaDim} rotuloMrr={rotuloMrr} />} />
              <Pie
                data={dadosGrafico}
                dataKey="qtd"
                nameKey="nome"
                innerRadius={tipoGrafico === "rosca" ? "50%" : 0}
                outerRadius="80%"
                paddingAngle={1}
                label={renderFatiaLabel}
                labelLine={false}
                onClick={(_: unknown, index: number) => {
                  if (dadosGrafico[index]?.outros) setOutrosAberto((v) => !v);
                }}

              >
                {dadosGrafico.map((e) => (
                  <Cell key={e.nome} fill={corDe(e.nome, e.outros)} />
                ))}
              </Pie>
            </RePieChart>
          ) : tipoGrafico === "barh" ? (
            <BarChart
              data={dadosGrafico}
              layout="vertical"
              margin={{ top: 8, right: 70, left: 8, bottom: 6 }}
              barCategoryGap="18%"
              barSize={18}
            >
              <XAxis type="number" hide domain={[0, (max: number) => Math.ceil(max * 1.05)]} />
              <YAxis
                type="category"
                dataKey="nome"
                width={140}
                interval={0}
                tick={{ fontSize: 10, fill: COR_EIXO }}
                tickLine={false}
                axisLine={false}
              />
              <RechartsTooltip
                cursor={{ fill: "transparent" }}
                content={<BarTooltip rotulo={rotuloClientes} metrica={metricaDim} rotuloMrr={rotuloMrr} />}
              />
              <Bar dataKey={chaveMetrica} name={rotuloMetrica} radius={[0, 6, 6, 0]} animationDuration={300}>
                <LabelList dataKey={chaveMetrica} content={rotuloBarra(chaveMetrica)} />
                {dadosGrafico.map((e) => (
                  <Cell key={e.nome} fill={e.outros ? COR_OUTROS : corMetrica} />
                ))}
              </Bar>
            </BarChart>
          ) : tipoGrafico === "barv" ? (
            <BarChart
              data={dadosGrafico}
              margin={{ top: 34, right: 8, left: 8, bottom: 0 }}
              barCategoryGap="33%"
              barSize={22}
            >
              <XAxis
                type="category"
                dataKey="nome"
                height={40}
                interval={0}
                tick={<TickCategoria />}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                type="number"
                hide
                domain={[0, (max: number) => Math.ceil(max * 1.08)]}
              />
              <RechartsTooltip
                cursor={{ fill: "transparent" }}
                content={<BarTooltip rotulo={rotuloClientes} metrica={metricaDim} rotuloMrr={rotuloMrr} />}
              />
              <Bar dataKey={chaveMetrica} name={rotuloMetrica} radius={[6, 6, 0, 0]} animationDuration={300}>
                <LabelList dataKey={chaveMetrica} content={rotuloTopo} />
                {dadosGrafico.map((e) => (
                  <Cell key={e.nome} fill={e.outros ? COR_OUTROS : corMetrica} />
                ))}
              </Bar>
            </BarChart>
          ) : (
            <AreaChart
              data={dadosGrafico}
              margin={{ top: 34, right: 28, left: 4, bottom: 0 }}
            >
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={corMetrica} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={corMetrica} stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border, 213 35% 22%))" vertical={false} />
              <XAxis
                type="category"
                dataKey="nome"
                height={dadosGrafico.length > 4 ? 64 : 40}
                interval={0}
                padding={{ left: 28, right: 28 }}
                tick={
                  <TickArea total={dadosGrafico.length} rotate={dadosGrafico.length > 4} />
                }
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                type="number"
                width={48}
                tickCount={4}
                tick={{ fontSize: 10, fill: COR_EIXO }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) =>
                  metricaDim === "clientes" ? String(Math.round(v)) : brlK(v)
                }
                domain={[0, (max: number) => Math.ceil(max * 1.08)]}
              />
              <RechartsTooltip
                cursor={{ stroke: "hsl(var(--border, 213 35% 22%))" }}
                content={<BarTooltip rotulo={rotuloClientes} metrica={metricaDim} rotuloMrr={rotuloMrr} />}
              />
              <Area
                type="monotone"
                dataKey={chaveMetrica}
                name={rotuloMetrica}
                stroke={corMetrica}
                strokeWidth={2}
                fill={`url(#${gradId})`}
                dot={{ r: 3, fill: corMetrica, strokeWidth: 0 }}
                activeDot={{ r: 5, fill: corMetrica, strokeWidth: 0 }}
                animationDuration={300}
              >
                <LabelList dataKey={chaveMetrica} content={rotuloTopo} />
              </Area>
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
      {tipoGrafico === "barv" && (
        <div className="mt-1 flex items-center justify-center gap-4">
          <span className="flex items-center gap-1.5 text-xs" style={{ color: "#C3C2B7" }}>
            <span
              className="h-2.5 w-2.5 rounded-[2px]"
              style={{ background: corMetrica }}
            />
            {rotuloMetrica}
          </span>
        </div>
      )}
      {!ehFatia && outrosItem ? (
        <div className="group relative mt-2">
          <button
            type="button"
            onClick={() => setOutrosAberto((v) => !v)}
            className="flex w-full items-center justify-between gap-3 rounded-lg px-1.5 py-1.5 text-left transition hover:bg-foreground/5"
          >
            <span className="text-[11px]" style={{ color: COR_EIXO }}>
              Outros —{" "}
              {metricaDim === "mrr"
                ? `${brlK(outrosItem.mrr)} em ${cauda.filter((c) => c.mrr > 0).length} ${dim.plural}`
                : `${outrosItem.qtd} clientes em ${cauda.length} ${dim.plural}`}
            </span>
            <span className="shrink-0 text-[10px] font-semibold text-muted-foreground">
              {outrosAberto ? "ocultar ▲" : "ver todas ▼"}
            </span>
          </button>
          {!outrosAberto && (
            <div className="pointer-events-none absolute bottom-full left-2 z-20 mb-1 hidden min-w-[200px] rounded-xl px-3 py-2 shadow-lg group-hover:block neu-raised">
              {caudaOrdenada.slice(0, 4).map((it) => (
                <div key={it.nome} className="flex items-center justify-between gap-6">
                  <span className="text-[10px] text-muted-foreground">{it.nome}</span>
                  <span className="text-[10px] font-semibold tabular-nums text-foreground">
                    {it.qtd} · {brlK(it.mrr)}
                  </span>
                </div>
              ))}
              {caudaOrdenada.length > 4 && (
                <p className="mt-1 text-[10px] italic text-muted-foreground">
                  e mais {caudaOrdenada.length - 4}
                </p>
              )}
            </div>
          )}
        </div>
      ) : null}
      {mrrNaoAtribuido >= 0.5 ? (

        <p className="mt-2 text-[10px] italic text-chart-legend">
          {brl(mrrNaoAtribuido)} não atribuídos — cliente sem ID na planilha
        </p>
      ) : null}
      {outrosAberto && outrosItem ? (
        <ul className="mt-1 max-h-[220px] space-y-0.5 overflow-y-auto pr-1">
          {caudaOrdenada.map((it) => (
            <li key={it.nome} className="flex items-center justify-between gap-4 px-1.5 py-0.5">
              <span className="truncate text-[11px]" style={{ color: COR_EIXO }}>
                {it.nome}
              </span>
              <span className="shrink-0 text-[11px] font-semibold tabular-nums text-foreground">
                {it.qtd} · {brlK(it.mrr)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {ehFatia ? (
        <>
          {tipoGrafico === "pizza" && (
            <div className="mt-3 flex flex-wrap items-baseline justify-center gap-x-1.5">

              <span
                className="text-base font-medium tabular-nums"
                style={{ color: COR_ROTULO }}
              >
                {totalBase}
              </span>
              <span className="text-xs" style={{ color: COR_EIXO }}>
                clientes
              </span>
              <span
                className="ml-2 text-sm font-medium tabular-nums"
                style={{ color: COR_ROTULO }}
              >
                {brlK(totalMrr)}
              </span>
              <span className="text-xs" style={{ color: COR_EIXO }}>
                MRR
              </span>
            </div>
          )}
          <ul className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            {dadosGrafico.map((e) => {
              const pct = totalBase > 0 ? e.qtd / totalBase : 0;
              return (
                <li key={e.nome} className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                    style={{ background: corDe(e.nome, e.outros) }}
                  />
                  <span className="text-[11px]" style={{ color: COR_EIXO }}>
                    {e.nome}
                  </span>
                  {pct < 0.05 && (
                    <span className="text-[11px] font-semibold tabular-nums text-foreground">
                      {e.qtd} · {brlK(e.mrr)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </div>
  );
}

/**
 * Tick do eixo X do gráfico de Área: primeiro rótulo ancorado à esquerda,
 * último à direita, demais centralizados; trunca acima de ~14 caracteres.
 */
function TickArea(props: {
  x?: number | string;
  y?: number | string;
  index?: number;
  payload?: { value: string };
  total: number;
  rotate?: boolean;
}) {
  const x = Number(props.x ?? 0);
  const y = Number(props.y ?? 0);
  const i = props.index ?? 0;
  const anchor = props.rotate
    ? "end"
    : i === 0
      ? "start"
      : i === props.total - 1
        ? "end"
        : "middle";
  const bruto = String(props.payload?.value ?? "");
  const nome = bruto.length > 14 ? `${bruto.slice(0, 12)}...` : bruto;
  return (
    <text
      x={x}
      y={y + 10}
      textAnchor={anchor}
      fontSize={10}
      fill={COR_EIXO}
      transform={props.rotate ? `rotate(-30 ${x} ${y + 10})` : undefined}
    >
      {nome}
    </text>
  );
}

/** Tick do eixo X (Colunas): nome completo, quebrando em até duas linhas. */
function TickCategoria(props: {
  x?: number | string;
  y?: number | string;
  payload?: { value: string };
}) {
  const x = Number(props.x ?? 0);
  const y = Number(props.y ?? 0);
  const nome = String(props.payload?.value ?? "");
  const palavras = nome.split(" ");
  const linhas: string[] =
    nome.length > 12 && palavras.length > 1
      ? [palavras.slice(0, -1).join(" "), palavras[palavras.length - 1] ?? ""]
      : [nome];
  return (
    <text
      x={x}
      y={y + 10}
      textAnchor="middle"
      fontSize={9}
      fill={COR_EIXO}
      style={{ whiteSpace: "nowrap" }}
    >
      {linhas.map((l, i) => (
        <tspan key={i} x={x} dy={i === 0 ? 0 : 11}>
          {l}
        </tspan>
      ))}
    </text>
  );
}

const DIMENSOES: DimensaoDef[] = [
  {
    valor: "especialidade",
    label: "Especialidade",
    plural: "especialidades",
    key: (r) => (r.especialidade ?? "").trim(),
    limite: 7,
  },
  { valor: "plano", label: "Plano", plural: "planos", key: (r) => (r.plano ?? "").trim() },
  {
    valor: "fonte",
    label: "Fonte de tráfego",
    plural: "fontes",
    key: (r) => (r.fonte_trafego ?? "").trim(),
  },
  { valor: "crm", label: "CRM", plural: "CRMs", key: (r) => crmNome(r) },
  {
    valor: "status",
    label: "Status",
    plural: "status",
    key: (r) => {
      const status = (r.status ?? "").trim().toUpperCase();
      return status === "ATIVO" ? "Ativo" : "Inativo";
    },
    // Dentro do gráfico, Ativo/Inativo segue a regra única de datas (não a coluna Status).
    keyMes: (r, mes) => (ativoNoMes(r, mes) ? "Ativo" : "Inativo"),
    base: "todos",
  },
];

export function GestaoInsightsClientes({
  rows,
  rowsCLT = null,
  inicio = null,
  fim = null,
}: {
  rows: GestaoCliente[];
  /** Base sem recorte de datas (mesma da tabela "Indicadores mês a mês"). */
  rowsCLT?: GestaoCliente[] | null;
  inicio?: string | null;
  fim?: string | null;
}) {
  const [busca, setBusca] = React.useState("");
  const [status, setStatus] = React.useState("ATIVO");
  const [plano, setPlano] = React.useState("all");
  const [especialidade, setEspecialidade] = React.useState("all");
  const [trafego, setTrafego] = React.useState("all");
  const [crm, setCrm] = React.useState("all");

  const resetFiltros = () => {
    setBusca("");
    setStatus("all");
    setPlano("all");
    setEspecialidade("all");
    setTrafego("all");
    setCrm("all");
  };

  const crmOptions = React.useMemo(
    () =>
      Array.from(new Set(rows.filter(temCrm).map((r) => (r.tipo_crm ?? "").trim())))
        .sort((a, b) => a.localeCompare(b, "pt-BR"))
        .map((v) => ({ value: v, label: titleCase(v) })),
    [rows]
  );

  // Mês de referência = último mês do período global (mesma janela da tabela).
  const mesRef = React.useMemo(
    () => intervaloBI(rowsCLT ?? rows, inicio, fim).fim,
    [rowsCLT, rows, inicio, fim]
  );

  const filtered = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !r.cliente.toLowerCase().includes(q)) return false;
      // Status segue a regra única de datas no mês de referência (mesma dos KPIs),
      // não a coluna "Status" da planilha.
      if (status !== "all" && ativoNoMes(r, mesRef) !== (status === "ATIVO")) return false;
      if (plano !== "all" && (r.plano ?? "") !== plano) return false;
      if (especialidade !== "all" && (r.especialidade ?? "") !== especialidade) return false;
      if (trafego !== "all" && (r.fonte_trafego ?? "") !== trafego) return false;
      if (crm !== "all") {
        if (crm === SEM_CRM) {
          if (temCrm(r)) return false;
        } else if ((r.tipo_crm ?? "").trim() !== crm) return false;
      }
      return true;
    });
  }, [rows, busca, status, plano, especialidade, trafego, crm, mesRef]);

  const d = React.useMemo(() => {
    const hoje = new Date();
    // Regra única: ativo pela regra de datas no mês de referência, não pela coluna Status.
    const ativos = filtered.filter((r) => ativoNoMes(r, mesRef));
    const inativos = filtered.filter((r) => !ativoNoMes(r, mesRef));
    // Base de análise dos gráficos e cards: segue o filtro de Status do bloco.
    const baseAnalise = status === "ATIVO" ? ativos : status === "INATIVO" ? inativos : filtered;
    const mrrAtivo = mrrTotalNoMes(ativos, mesRef);


    // Risco: ativos em aviso prévio ou com fim de contrato já vencido/próximo.
    const risco = ativos.filter(temAviso);
    const mrrRisco = risco.reduce((s, r) => s + num(r.mrr_atual), 0);

    // Vencimentos em 90 dias.
    const vencendo = ativos.filter((r) => {
      const dias = diasAte(r.data_fim_ref, hoje);
      return dias !== null && dias >= 0 && dias <= 90;
    });
    const mrrVencendo = vencendo.reduce((s, r) => s + num(r.mrr_atual), 0);

    // Entradas x saídas nos últimos 90 dias.
    const entradas = filtered.filter((r) => {
      const dias = diasAte(r.data_inicio_ref ?? r.data_inicio, hoje);
      return dias !== null && dias <= 0 && dias >= -90;
    });
    const saidas = filtered.filter((r) => {
      if (ativoNoMes(r, mesRef)) return false;
      const dias = diasAte(r.data_fim_ref, hoje);
      return dias !== null && dias <= 0 && dias >= -90;
    });
    const mrrEntradas = entradas.reduce((s, r) => s + num(r.nmrr ?? r.mrr_atual), 0);
    const mrrSaidas = saidas.reduce((s, r) => s + num(r.mrr_atual), 0);

    const porFonte = (nome: string) => {
      const g = ativos.filter((r) => (r.fonte_trafego ?? "").toLowerCase().includes(nome));
      const mrr = g.reduce((s, r) => s + num(r.mrr_atual), 0);
      return {
        qtd: g.length,
        mrr,
        ticket: g.length ? mrr / g.length : 0,
        clt: avg(g.map((r) => num(r.clt_atual))),
      };
    };
    const meta = porFonte("meta");
    const google = porFonte("google");

    const grupo = (arr: GestaoCliente[]) => {
      const mrr = arr.reduce((s, r) => s + num(r.mrr_atual), 0);
      return {
        qtd: arr.length,
        mrr,
        ticket: arr.length ? mrr / arr.length : 0,
        clt: avg(arr.map((r) => num(r.clt_atual))),
      };
    };
    const comCrm = grupo(ativos.filter(temCrm));
    const semCrm = grupo(ativos.filter((r) => !temCrm(r)));
    const ganhoCrm = semCrm.ticket > 0 ? comCrm.ticket / semCrm.ticket - 1 : 0;

    const rank = (key: (r: GestaoCliente) => string) => {
      const mapa = new Map<string, GestaoCliente[]>();
      for (const r of ativos) {
        const k = key(r) || "Sem definição";
        const arr = mapa.get(k);
        if (arr) arr.push(r);
        else mapa.set(k, [r]);
      }
      return Array.from(mapa.entries())
        .map(([nome, itens]) => ({ nome, ...grupo(itens) }))
        .sort((a, b) => b.mrr - a.mrr);
    };
    const crms = rank(crmNome);
    const planos = rank((r) => (r.plano ?? "").trim());
    const especialidades = rank((r) => (r.especialidade ?? "").trim());
    const fontes = rank((r) => (r.fonte_trafego ?? "").trim());

    // Top 10 clientes / concentração.
    const ordenados = [...ativos].sort((a, b) => num(b.mrr_atual) - num(a.mrr_atual));
    const top10 = ordenados.slice(0, 10);
    const mrrTop10 = top10.reduce((s, r) => s + num(r.mrr_atual), 0);

    // Perfil dominante: fonte + CRM.
    const perfilMapa = new Map<string, { mrr: number; qtd: number }>();
    for (const r of ativos) {
      const k = `${titleCase((r.fonte_trafego ?? "Sem fonte").trim() || "Sem fonte")} + ${crmNome(r)}`;
      const cur = perfilMapa.get(k) ?? { mrr: 0, qtd: 0 };
      cur.mrr += num(r.mrr_atual);
      cur.qtd += 1;
      perfilMapa.set(k, cur);
    }
    const perfil = Array.from(perfilMapa.entries())
      .map(([nome, v]) => ({ nome, ...v }))
      .sort((a, b) => b.mrr - a.mrr)[0];

    // Maturidade da carteira (base de análise).
    const faixa = (min: number, max: number) =>
      baseAnalise.filter((r) => {
        if (!cltValido(r.clt_atual)) return false;
        const m = r.clt_atual;
        return m >= min && m < max;
      });
    const maturidade = [
      { label: "0–3 meses", itens: faixa(0, 4) },
      { label: "4–6 meses", itens: faixa(4, 7) },
      { label: "7–12 meses", itens: faixa(7, 13) },
      { label: "13+ meses", itens: faixa(13, Infinity) },
    ].map((f) => ({
      label: f.label,
      qtd: f.itens.length,
      mrr: grupo(f.itens).mrr,
      nomes: f.itens.map((r) => r.cliente).sort((a, b) => a.localeCompare(b, "pt-BR")),
    }));
    const novos6m = maturidade[0]!.qtd + maturidade[1]!.qtd;

    // Sem responsável.
    const semResp = ativos.filter(
      (r) => !((r.responsavel_revops ?? "").trim() || (r.lider_revops ?? "").trim())
    );
    const mrrSemResp = semResp.reduce((s, r) => s + num(r.mrr_atual), 0);

    // CLT real x previsto — na base de análise (ativos, inativos ou completa).
    // Clientes sem "Fim Planejado" têm CLT previsto inexistente e ficam fora deste comparativo.
    // Valores de tempo de casa impossíveis (negativos/absurdos) ficam de fora.
    const comPrevistoBruto = baseAnalise.filter(
      (r) => r.clt_previsto !== null && r.clt_previsto !== undefined
    );
    const comPrevisto = comPrevistoBruto.filter(
      (r) => cltValido(r.clt_previsto) && cltValido(r.clt_atual)
    );
    const cltInvalidos = comPrevistoBruto.length - comPrevisto.length;
    const cltPrev = avg(comPrevisto.map((r) => num(r.clt_previsto)));
    const cltReal = avg(comPrevisto.map((r) => num(r.clt_atual)));

    // Mediana: a média de tempo de casa é puxada para baixo pelos clientes novos.
    const med = (list: number[]) => {
      const s = [...list].sort((a, b) => a - b);
      const n = s.length;
      return n ? (n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2) : 0;
    };
    const cltPrevMed = med(comPrevisto.map((r) => num(r.clt_previsto)));
    const cltRealMed = med(comPrevisto.map((r) => num(r.clt_atual)));
    /** Nome do cliente com o real e o previsto, para as listas de hover. */
    const rotuloClt = (nome: string, real: number, prev: number) =>
      `${nome} (${real.toFixed(1).replace(".", ",")} vs ${prev.toFixed(1).replace(".", ",")} meses)`;
    const acimaCltPrevItens = comPrevisto.filter(
      (r) => num(r.clt_atual) >= num(r.clt_previsto)
    );
    const abaixoCltPrevItens = comPrevisto.filter(
      (r) => num(r.clt_atual) < num(r.clt_previsto)
    );
    const acimaCltPrev = acimaCltPrevItens.length;
    const abaixoCltPrev = abaixoCltPrevItens.length;
    const nomesClt = (list: GestaoCliente[]) =>
      list
        .map((r) => rotuloClt(r.cliente, num(r.clt_atual), num(r.clt_previsto)))
        .sort((a, b) => a.localeCompare(b, "pt-BR"));
    const acimaCltPrevNomes = nomesClt(acimaCltPrevItens);
    const abaixoCltPrevNomes = nomesClt(abaixoCltPrevItens);
    const foraInicialNomes = comPrevistoBruto
      .filter((r) => !(cltValido(r.clt_previsto) && cltValido(r.clt_atual)))
      .map((r) => r.cliente);

    // Escopo VIGENTE: previsto = (Data de Fim - Tratada − Data de Início - Tratada) / 30 dias.
    // Depende do ID do Clickup; quem não tem as duas datas fica fora deste escopo.
    const previstoVigenteDe = (r: GestaoCliente) => {
      const ini = r.inicio_tratada;
      const fim = r.fim_tratada;
      if (!ini || !fim) return null;
      const v = diffMeses(ini, fim);
      return cltValido(v) ? v : null;
    };
    const vigenteItens = baseAnalise
      .map((r) => ({ r, prev: previstoVigenteDe(r) }))
      .filter(
        (x): x is { r: GestaoCliente; prev: number } =>
          x.prev !== null && cltValido(x.r.clt_atual)
      );
    const foraVigenteNomes = baseAnalise
      .filter((r) => !(previstoVigenteDe(r) !== null && cltValido(r.clt_atual)))
      .map((r) => r.cliente);
    const cltPrevVigente = avg(vigenteItens.map((x) => x.prev));
    const acimaVigenteItens = vigenteItens.filter((x) => num(x.r.clt_atual) >= x.prev);
    const abaixoVigenteItens = vigenteItens.filter((x) => num(x.r.clt_atual) < x.prev);
    const acimaCltPrevVigente = acimaVigenteItens.length;
    const abaixoCltPrevVigente = abaixoVigenteItens.length;
    const nomesVigente = (list: { r: GestaoCliente; prev: number }[]) =>
      list
        .map((x) => rotuloClt(x.r.cliente, num(x.r.clt_atual), x.prev))
        .sort((a, b) => a.localeCompare(b, "pt-BR"));
    const acimaCltPrevVigenteNomes = nomesVigente(acimaVigenteItens);
    const abaixoCltPrevVigenteNomes = nomesVigente(abaixoVigenteItens);




    return {
      total: filtered.length,
      ativos,
      inativos,
      baseAnalise,

      mrrAtivo,
      mrrHistorico: filtered.reduce((s, r) => s + num(r.mrr_atual), 0),
      ticketAtivo: ativos.length ? mrrAtivo / ativos.length : 0,
      risco,
      mrrRisco,
      vencendo,
      mrrVencendo,
      entradas,
      saidas,
      mrrEntradas,
      mrrSaidas,
      meta,
      google,
      comCrm,
      semCrm,
      ganhoCrm,
      crms,
      planos,
      especialidades,
      fontes,
      top10,
      mrrTop10,
      perfil,
      maturidade,
      novos6m,
      semResp,
      mrrSemResp,
      cltPrev,
      cltReal,
      cltPrevMed,
      cltRealMed,
      acimaCltPrev,
      abaixoCltPrev,
      acimaCltPrevNomes,
      abaixoCltPrevNomes,
      acimaCltPrevVigenteNomes,
      abaixoCltPrevVigenteNomes,
      cltInvalidos,
      foraInicialNomes,
      cltPrevVigente,
      acimaCltPrevVigente,
      abaixoCltPrevVigente,
      foraVigenteNomes,
    };
  }, [filtered, mesRef, status]);

  // Registro em console dos ativos sem ID cruzado com a matriz de MRR.
  React.useEffect(() => {
    const semCruzamento = d.ativos.filter(
      (r) => mrrMatrizNoMes(r, mesRef) === 0 && mrrTotalNoMes([r], mesRef) > 0
    );
    if (semCruzamento.length) {
      console.warn(
        "[Insights Clientes] Ativos sem ID cruzado com a matriz MRR Calculado:",
        semCruzamento.map((r) => r.cliente)
      );
    }
  }, [d.ativos, mesRef]);

  const share = (v: number) => (d.mrrAtivo > 0 ? v / d.mrrAtivo : 0);

  /** CLT Real na mesma regra/base da tabela "Indicadores mês a mês" e do card do topo. */
  const cltRealBI = React.useMemo(() => {
    const base = rowsCLT ?? rows;
    return cltNoMes(base, intervaloBI(base, inicio, fim).fim);
  }, [rowsCLT, rows, inicio, fim]);

  /** Modo da base de análise, derivado do filtro de Status do bloco. */
  const modoBase: ModoBase = status === "ATIVO" ? "ativa" : status === "INATIVO" ? "inativa" : "todos";
  /** CLT real exibido: nos ativos segue a tabela; nas demais bases, a média da base. */
  const cltRealCard = modoBase === "ativa" ? cltRealBI : d.cltReal;
  /** Escopo do CLT previsto exibido no card (local ao card). */
  const [escopoClt, setEscopoClt] = React.useState<"inicial" | "vigente">("inicial");
  const cltPrevCard = escopoClt === "vigente" ? d.cltPrevVigente : d.cltPrev;
  const acimaCard = escopoClt === "vigente" ? d.acimaCltPrevVigente : d.acimaCltPrev;
  const abaixoCard = escopoClt === "vigente" ? d.abaixoCltPrevVigente : d.abaixoCltPrev;
  const foraNomes = escopoClt === "vigente" ? d.foraVigenteNomes : d.foraInicialNomes;
  const acimaNomes =
    escopoClt === "vigente" ? d.acimaCltPrevVigenteNomes : d.acimaCltPrevNomes;
  const abaixoNomes =
    escopoClt === "vigente" ? d.abaixoCltPrevVigenteNomes : d.abaixoCltPrevNomes;
  /** MRR somado da base de análise (ativo no mês, ou o MRR de saída dos inativos). */
  const mrrBase = React.useMemo(
    () => d.baseAnalise.reduce((s, r) => s + mrrDoCliente(r, mesRef), 0),
    [d.baseAnalise, mesRef]
  );
  /** MRR Válido somado da base de análise (exclui o mês de início de cada cliente). */
  const mrrValidoBase = React.useMemo(
    () => d.baseAnalise.reduce((s, r) => s + mrrValidoDoCliente(r, mesRef), 0),
    [d.baseAnalise, mesRef]
  );
  const rotuloMrrBase =
    modoBase === "ativa" ? "MRR ativo" : modoBase === "inativa" ? "MRR na saída" : "MRR da base";

  return (
    <div className="neu-card space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="h-5 w-5 text-primary" />
        <h3 className="text-base font-semibold text-foreground">Insights Clientes</h3>
        <span className="neu-inset rounded-full px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
          Base {d.total} · Ativos {d.ativos.length} · Inativos {d.inativos.length}
        </span>
        <span className="neu-inset rounded-full px-2 py-0.5 text-[11px] font-semibold text-primary">
          {rotuloMrrBase}: {brl(mrrBase)}
        </span>
        <span className="neu-inset rounded-full px-2 py-0.5 text-[11px] font-semibold text-primary">
          MRR válido: {brl(mrrValidoBase)}
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
        <div className="h-5 w-px self-center bg-border/60" aria-hidden="true" />
        <SearchableSelect
          value={status}
          onValueChange={setStatus}
          options={[
            { value: "ATIVO", label: "Ativo" },
            { value: "INATIVO", label: "Inativo" },
          ]}
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
          placeholder="Fonte"
          allOption={{ value: "all", label: "Todas as Fontes" }}
          triggerClassName="h-8"
        />
        <SearchableSelect
          value={crm}
          onValueChange={setCrm}
          options={[{ value: SEM_CRM, label: "Não Possui" }, ...crmOptions]}
          placeholder="CRM"
          allOption={{ value: "all", label: "Todos os CRM" }}
          triggerClassName="h-8"
        />
        <div className="h-5 w-px self-center bg-border/60" aria-hidden="true" />
        <Button
          variant="ghost"
          onClick={resetFiltros}
          className="neu-button h-8 gap-1.5 px-3 text-[11px]"
          title="Limpar filtros dos insights"
        >
          <X className="h-3.5 w-3.5" />
          Limpar
        </Button>
      </div>

      {/* Cards de indicadores */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
        <Card
          icon={Hourglass}
          titulo={escopoClt === "inicial" ? "CLT REAL X PREVISTO (INICIAL)" : "CLT REAL X PREVISTO (VIGENTE)"}
          destaque={`${tempo(cltRealCard)} vs ${tempo(cltPrevCard)}`}
          tone={cltRealCard < cltPrevCard ? "warning" : "primary"}
          sub={`Gap médio ${(cltRealCard - cltPrevCard).toFixed(2)} meses`}
          acao={
            <div className="neu-inset flex items-center gap-0.5 rounded-full p-0.5">
              {(["inicial", "vigente"] as const).map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setEscopoClt(e)}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition ${
                    escopoClt === e
                      ? "neu-raised text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {e === "inicial" ? "Inicial" : "Vigente"}
                </button>
              ))}
            </div>
          }
          linhas={[
            {
              label: "no/acima do CLT previsto",
              valor: `${acimaCard} clientes`,
              tone: "primary",
              hover: listaClientes(acimaNomes),
            },
            {
              label: "abaixo do CLT Previsto",
              valor: `${abaixoCard} clientes`,
              tone: "danger",
              hover: listaClientes(abaixoNomes),
            },
          ]}
          {...(foraNomes.length
            ? {
                nota: `${foraNomes.length} ${foraNomes.length === 1 ? "cliente fora" : "clientes fora"} do cálculo por dado incompleto na planilha`,
                notaHover: foraNomes.join(", "),
              }
            : {})}
        />
        <Card
          icon={Hourglass}
          titulo="Maturidade"
          destaque={`${d.novos6m} de ${d.baseAnalise.length} ≤ 6 meses`}
          sub={`Tempo médio ${tempo(cltRealCard)}`}
          linhas={d.maturidade.map((m) => ({
            label: m.label,
            valor: `${m.qtd} clientes`,
            hover: listaClientes(m.nomes),
          }))}
        />
      </div>



      {/* Gráficos: um por dimensão, 2 por linha */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {DIMENSOES.map((dim, i) => (
          <div key={dim.valor} className={i === 0 ? "h-full xl:col-span-2" : "h-full"}>
            <DimensaoChart
              dim={dim}
              base={d.baseAnalise}
              baseTodos={filtered}
              modo={modoBase}
              mesRef={mesRef}
            />
          </div>
        ))}

      </div>


      {filtered.length === 0 && (
        <div className="neu-inset rounded-lg px-4 py-10 text-center text-sm text-muted-foreground">
          Nenhum cliente atende aos filtros selecionados.
        </div>
      )}
    </div>
  );
}
