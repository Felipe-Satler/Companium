import * as React from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, Target } from "lucide-react";

import type { BIMes } from "@/components/gestao/useGestaoBI";
import type { IndicadorMarco, MetasMarcos } from "@/lib/marcosMetas";
import { INDICADORES_MARCOS, type FormatoMarco } from "@/components/marcos/indicadores";

type Formato = FormatoMarco;
type Viz = "coluna" | "barra" | "area" | "linha";

type Def = {
  chave: IndicadorMarco;
  nome: string;
  formato: Formato;
  padrao: Viz;
  taxa?: boolean;
  menorMelhor?: boolean;
  real: (m: BIMes) => number;
};

const DEFS: Def[] = INDICADORES_MARCOS.map((indicador) => ({
  ...indicador,
  padrao: "coluna",
  taxa: indicador.chave === "nmrrTicket" || indicador.chave === "revChurn",
  real: indicador.realizado,
}));

/* Cores: tokens do tema do Companium (HSL em var), resolvidos em claro e escuro. */
const COR = {
  bom: "hsl(var(--primary))",
  ruim: "hsl(var(--destructive))",
  neutro: "hsl(var(--success))",
  meta: "hsl(var(--foreground))",
  rotulo: "hsl(var(--foreground))",
  eixo: "hsl(var(--muted-foreground))",
  legenda: "hsl(var(--muted-foreground))",
  grade: "hsl(var(--border))",
  card: "hsl(var(--card))",
  // Halo de legibilidade dos rótulos: a cor do próprio card, para destacar em claro e escuro.
  contorno: "hsl(var(--card))",
};

const ALTURA_PLOT = 260;
const DURACAO_SERIE = 300;
const FONTE_ROTULO_BASE = 12;
const FONTE_ROTULO_MIN = 9;
const FONTE_EIXO = 12;

const fmtCurto = (v: number, f: Formato) => {
  if (f === "percentual") return `${v.toFixed(1).replace(".", ",")}%`;
  if (f === "inteiro") return Math.round(v).toLocaleString("pt-BR");
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1).replace(".", ",")} mi`;
  if (abs >= 1_000) return `R$ ${(v / 1_000).toFixed(1).replace(".", ",")} mil`;
  return `R$ ${v.toFixed(0)}`;
};

const fmtCompleto = (v: number, f: Formato) => {
  if (f === "moeda") return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
  if (f === "percentual") return `${v.toFixed(2).replace(".", ",")}%`;
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
};

const bateu = (real: number, meta: number, menorMelhor?: boolean) => (menorMelhor ? real <= meta : real >= meta);

/** Largura observada do contêiner, para dimensionar a fonte dos rótulos. */
function useLargura() {
  const ref = React.useRef<HTMLDivElement>(null);
  const [w, setW] = React.useState(600);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function useReduzirMovimento() {
  const [reduzir, setReduzir] = React.useState(false);
  React.useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const atualizar = () => setReduzir(media.matches);
    atualizar();
    media.addEventListener("change", atualizar);
    return () => media.removeEventListener("change", atualizar);
  }, []);
  return reduzir;
}

function SeletorViz<T extends string>({ valor, opcoes, onChange }: { valor: T; opcoes: { valor: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="neu-inset flex items-center gap-0.5 rounded-full p-0.5">
      {opcoes.map((t) => (
        <button
          key={t.valor}
          type="button"
          onClick={() => onChange(t.valor)}
          className={`marcos-viz-pill rounded-full px-2 py-0.5 text-[10px] font-semibold transition-[color,background-color,box-shadow] ${
            valor === t.valor ? "neu-raised text-primary" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

type Ponto = { label: string; real: number | null; meta: number | null; cor: string; futuro: boolean };

const gerar = (lo: number, hi: number, p: number) => {
  const out: number[] = [];
  for (let v = lo; v <= hi + p / 1000 && out.length < 12; v += p) out.push(Number(v.toFixed(6)));
  return out;
};

/** Mês em duas linhas (Jan / 26) para caber sem pular nenhum. */
const tickMes = (compacto: boolean) => (raw: unknown) => {
  const p = raw as { x?: number; y?: number; payload?: { value?: string } };
  const [m = "", a = ""] = String(p.payload?.value ?? "").split("/");
  if (compacto) {
    return <text x={p.x} y={(p.y ?? 0) + 14} textAnchor="middle" fontSize={10} fill={COR.eixo}>{m}</text>;
  }
  return (
    <text x={p.x} y={(p.y ?? 0) + 10} textAnchor="middle" fontSize={FONTE_EIXO} fill={COR.eixo}>
      <tspan x={p.x} dy={0}>{m}</tspan>
      <tspan x={p.x} dy={13}>{a}</tspan>
    </text>
  );
};

/** Escala "bonita" para enquadrar real e meta juntos. */
function escala(valores: number[], taxa: boolean, inteiro: boolean): { dominio: [number, number]; naoZero: boolean; ticks: number[] } {
  if (!valores.length) return { dominio: [0, 1], naoZero: false, ticks: [0, 1] };
  const max = Math.max(...valores);
  const min = Math.min(...valores);
  const passo = (v: number) => {
    if (v <= 0) return 1;
    const e = 10 ** Math.floor(Math.log10(v));
    const n = v / e;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * e;
  };
  if (taxa && min > 0 && max > 0) {
    const amp = Math.max(max - min, max * 0.1);
    const p = passo(amp / 4);
    const lo = Math.max(0, Math.floor((min - amp * 0.15) / p) * p);
    const hi = Math.ceil((max + amp * 0.2) / p) * p;
    return { dominio: [lo, hi], naoZero: lo > 0, ticks: gerar(lo, hi, p) };
  }
  const p = Math.max(inteiro ? 1 : 0, passo((max * 1.15) / 4));
  const hi = Math.max(inteiro ? 4 : p, Math.ceil((max * 1.15) / p) * p);
  return { dominio: [0, hi], naoZero: false, ticks: gerar(0, hi, p) };
}

/** Tick numérico sempre em uma linha (o padrão do recharts quebra texto longo). */
const tickNum = (f: Formato, eixo: "x" | "y") => (raw: unknown) => {
  const p = raw as { x?: number; y?: number; payload?: { value?: number } };
  return (
    <text x={p.x} y={p.y} dy={eixo === "x" ? 14 : 0} textAnchor={eixo === "x" ? "middle" : "end"} dominantBaseline={eixo === "x" ? "auto" : "central"} fontSize={FONTE_EIXO} fill={COR.eixo}>
      {fmtCurto(Number(p.payload?.value ?? 0), f)}
    </text>
  );
};

type LP = { x?: number; y?: number; width?: number; height?: number; value?: number | string | null; index?: number; payload?: Ponto };

function CardEvolucao({ def, meses, metas, atual }: { def: Def; meses: BIMes[]; metas: MetasMarcos; atual: string }) {
  const [viz, setViz] = React.useState<Viz>(def.padrao);
  const [vizAnterior, setVizAnterior] = React.useState<Viz | null>(null);
  const [entrando, setEntrando] = React.useState(false);
  const [saindo, setSaindo] = React.useState(false);
  const [mostrarRotulos, setMostrarRotulos] = React.useState(true);
  const [ref, largura] = useLargura();
  const reduzirMovimento = useReduzirMovimento();
  const timers = React.useRef<number[]>([]);
  const frame = React.useRef<number | null>(null);

  const limparTransicao = React.useCallback(() => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
    if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);

  React.useEffect(() => limparTransicao, [limparTransicao]);

  const trocarViz = React.useCallback((proxima: Viz) => {
    if (proxima === viz) return;
    limparTransicao();
    if (reduzirMovimento || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVizAnterior(null);
      setViz(proxima);
      setEntrando(false);
      setSaindo(false);
      setMostrarRotulos(true);
      return;
    }
    setVizAnterior(viz);
    setViz(proxima);
    setEntrando(true);
    setSaindo(false);
    setMostrarRotulos(false);
    frame.current = window.requestAnimationFrame(() => {
      setEntrando(false);
      setSaindo(true);
      frame.current = null;
    });
    timers.current.push(window.setTimeout(() => setMostrarRotulos(true), DURACAO_SERIE));
  }, [limparTransicao, reduzirMovimento, viz]);

  const dados: Ponto[] = meses.map((m) => {
    const futuro = m.mes > atual;
    const real = futuro ? null : def.real(m);
    const meta = metas[def.chave]?.[m.mes] ?? null;
    const cor = real === null || meta === null ? COR.neutro : bateu(real, meta, def.menorMelhor) ? COR.bom : COR.ruim;
    return { label: m.mes === atual ? `${m.label}*` : m.label, real, meta, cor, futuro };
  });

  const valores = dados.flatMap((d) => [d.real, d.meta]).filter((v): v is number => v !== null);
  const { dominio, naoZero, ticks } = escala(valores, !!def.taxa, def.formato === "inteiro");

  // Fonte única do gráfico: começa maior e reduz apenas quando os rótulos não cabem.
  const n = Math.max(1, dados.length);
  const maiorRotulo = Math.max(4, ...dados.flatMap((d) => [d.real, d.meta].map((v) => (v ? fmtCurto(v, def.formato).length : 0))));
  const fatia = (largura - 70) / n;
  const fonte = viz === "barra" ? FONTE_ROTULO_BASE : Math.max(FONTE_ROTULO_MIN, Math.min(FONTE_ROTULO_BASE, Math.floor((fatia - 6) / (maiorRotulo * 0.62))));

  const rotulo = (raw: unknown) => {
    const p = raw as LP;
    const v = typeof p.value === "number" ? p.value : null;
    if (v === null || v === 0) return null;
    const texto = fmtCurto(v, def.formato);
    if (viz === "barra") {
      return (
        <text x={(p.x ?? 0) + (p.width ?? 0) + 5} y={(p.y ?? 0) + (p.height ?? 0) / 2} dominantBaseline="central" fontSize={fonte} fontWeight={600} fill={p.payload?.cor ?? COR.rotulo} stroke={COR.contorno} strokeWidth={2.4} strokeLinejoin="round" paintOrder="stroke" style={{ whiteSpace: "nowrap" }}>
          {texto}
        </text>
      );
    }
    const cx = viz === "coluna" ? (p.x ?? 0) + (p.width ?? 0) / 2 : p.x ?? 0;
    const idx = p.index ?? 0;
    const anchor = viz !== "coluna" && idx === 0 ? "start" : viz !== "coluna" && idx === n - 1 ? "end" : "middle";
    return (
      <text x={cx} y={(p.y ?? 0) - 7} textAnchor={anchor} fontSize={fonte} fontWeight={600} fill={p.payload?.cor ?? COR.rotulo} stroke={COR.contorno} strokeWidth={2.4} strokeLinejoin="round" paintOrder="stroke">
        {texto}
      </text>
    );
  };

  /** Rótulo da meta: logo abaixo do ponto, centralizado nele, sem fundo. */
  const textoMeta = (x: number, y: number, texto: string) => (
    <text x={x} y={y + 2} textAnchor="middle" fontSize={fonte} fontWeight={600} fill={COR.meta} stroke={COR.contorno} strokeWidth={2.4} strokeLinejoin="round" paintOrder="stroke">
      {texto}
    </text>
  );
  const limiteInferior = ALTURA_PLOT - (largura < 440 ? 27 : 39) - 4;

  const rotuloMeta = (raw: unknown) => {
    const p = raw as LP;
    const index = p.index ?? 0;
    const d = dados[index];
    if (!d || d.meta === null) return null;
    const y = Math.min((p.y ?? 0) + fonte + 6, limiteInferior);
    return textoMeta(p.x ?? 0, y, fmtCurto(d.meta, def.formato));
  };

  const pontoReal = (raw: unknown) => {
    const p = raw as { cx?: number; cy?: number; payload?: Ponto; index?: number };
    if (p.payload?.real === null || p.cx === undefined || p.cy === undefined) return <g key={`d${p.index}`} />;
    return <circle key={`d${p.index}`} cx={p.cx} cy={p.cy} r={4} fill={p.payload?.cor} stroke={COR.card} strokeWidth={1.5} />;
  };

  /** Barra horizontal: meta como marca vertical no próprio mês. */
  const marcaMeta = (raw: unknown, mostrarTexto = true) => {
    const p = raw as { x?: number; y?: number; width?: number; height?: number; payload?: Ponto; index?: number };
    if (p.payload?.meta === null || p.payload?.meta === undefined) return <g />;
    const x = (p.x ?? 0) + (p.width ?? 0);
    return (
      <g>
        <line x1={x} x2={x} y1={(p.y ?? 0) - 2} y2={(p.y ?? 0) + (p.height ?? 0) + 2} stroke={COR.meta} strokeWidth={2} strokeDasharray="3 2" />
        {mostrarTexto && textoMeta(x, (p.y ?? 0) + (p.height ?? 0) + fonte * 0.5, fmtCurto(p.payload.meta, def.formato))}
      </g>
    );
  };

  const eixoNum = (
    <YAxis
      type="number"
      domain={dominio}
      ticks={ticks}
      allowDecimals={def.formato !== "inteiro"}
      tick={tickNum(def.formato, "y")}
      axisLine={false}
      tickLine={false}
      width={def.formato === "moeda" ? 78 : 44}
    />
  );
  const compacto = largura < 440;

  const tooltip = (
    <Tooltip
      cursor={{ fill: "oklch(1 0 0 / 0.04)" }}
      wrapperStyle={{ zIndex: 9999, outline: "none" }}
      content={(raw: unknown) => {
        const t = raw as { active?: boolean; payload?: { payload?: Ponto }[] };
        const d = t.payload?.[0]?.payload;
        if (!t.active || !d) return null;
        return (
          <div className="rounded-xl border px-3 py-2 text-sm shadow-xl" style={{ background: COR.card, borderColor: COR.grade, color: "var(--foreground, white)" }}>
            <p className="mb-1 font-semibold">{d.label.replace("*", " (parcial)")}</p>
            <p>Real: {d.real === null ? "—" : fmtCompleto(d.real, def.formato)}</p>
            <p>Meta: {d.meta === null ? "sem meta" : fmtCompleto(d.meta, def.formato)}</p>
          </div>
        );
      }}
    />
  );

  const linhaMeta = (
    <Line type="linear" dataKey="meta" stroke={COR.meta} strokeWidth={1.75} strokeDasharray="5 4" dot={{ r: 2.5, fill: COR.meta, strokeWidth: 0 }} connectNulls={false} isAnimationActive={false}>
    </Line>
  );
  const renderizarGrafico = (tipo: Viz, rotulosVisiveis: boolean, animarSerie: boolean) => {
    const vertical = tipo === "barra";
    const margem = { top: vertical ? 8 : fonte * 2 + 18, right: vertical ? 104 : 16, bottom: 0, left: 0 };
    const eixoCat = <XAxis dataKey="label" interval={0} height={compacto ? 27 : 39} tick={tickMes(compacto)} axisLine={{ stroke: COR.grade }} tickLine={false} padding={tipo === "coluna" ? undefined : { left: compacto ? 18 : 34, right: compacto ? 18 : 34 }} />;
    const animacao = animarSerie && !reduzirMovimento;

    return (
      <ResponsiveContainer width="100%" height="100%">
        {vertical ? (
          <ComposedChart data={dados} layout="vertical" margin={margem} barCategoryGap="16%">
            <CartesianGrid horizontal={false} stroke={COR.grade} strokeOpacity={0.5} />
            <XAxis type="number" domain={dominio} ticks={ticks} allowDecimals={def.formato !== "inteiro"} tick={tickNum(def.formato, "x")} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="label" interval={0} tick={{ fill: COR.eixo, fontSize: FONTE_EIXO }} axisLine={{ stroke: COR.grade }} tickLine={false} width={60} />
            {tooltip}
            <Bar dataKey="real" isAnimationActive={animacao} animationDuration={DURACAO_SERIE} animationEasing="ease-out" radius={[0, 3, 3, 0]}>
              {dados.map((d, i) => <Cell key={i} fill={d.cor} />)}
              {rotulosVisiveis && <LabelList dataKey="real" content={rotulo} />}
            </Bar>
            <Bar dataKey="meta" fill="transparent" shape={(props: unknown) => marcaMeta(props, rotulosVisiveis)} isAnimationActive={false} />
          </ComposedChart>
        ) : (
          <ComposedChart data={dados} margin={margem}>
            <CartesianGrid vertical={false} stroke={COR.grade} strokeOpacity={0.5} />
            {eixoCat}
            {eixoNum}
            {tooltip}
            {tipo === "coluna" && (
              <Bar dataKey="real" isAnimationActive={animacao} animationDuration={DURACAO_SERIE} animationEasing="ease-out" radius={[3, 3, 0, 0]} maxBarSize={40}>
                {dados.map((d, i) => <Cell key={i} fill={d.cor} />)}
              </Bar>
            )}
            {tipo === "area" && (
              <Area type="linear" dataKey="real" stroke={COR.neutro} fill={COR.neutro} fillOpacity={0.18} strokeWidth={2} connectNulls={false} dot={pontoReal} activeDot={false} isAnimationActive={animacao} animationDuration={DURACAO_SERIE} animationEasing="ease-out" />
            )}
            {tipo === "linha" && (
              <Line type="linear" dataKey="real" stroke={COR.neutro} strokeWidth={2} connectNulls={false} dot={pontoReal} activeDot={false} isAnimationActive={animacao} animationDuration={DURACAO_SERIE} animationEasing="ease-out" />
            )}
            {linhaMeta}
            {rotulosVisiveis && (
              <Line dataKey="real" stroke="none" dot={false} activeDot={false} isAnimationActive={false} legendType="none">
                <LabelList dataKey="real" content={rotulo} />
              </Line>
            )}
            {rotulosVisiveis && (
              <Line dataKey="meta" stroke="none" dot={false} activeDot={false} isAnimationActive={false} legendType="none">
                <LabelList dataKey="meta" content={rotuloMeta} />
              </Line>
            )}
          </ComposedChart>
        )}
      </ResponsiveContainer>
    );
  };

  return (
    <div className="neu-card flex h-full flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-foreground">
          {def.nome}
          {def.menorMelhor && <span className="ml-2 text-[9px] font-semibold uppercase text-primary">menor é melhor</span>}
        </h3>
        <SeletorViz<Viz>
          valor={viz}
          onChange={trocarViz}
          opcoes={[
            { valor: "coluna", label: "Coluna" },
            { valor: "barra", label: "Barra" },
            { valor: "area", label: "Área" },
            { valor: "linha", label: "Linha" },
          ]}
        />
      </div>
      <div ref={ref} className="relative min-w-0" style={{ height: ALTURA_PLOT }}>
        {vizAnterior && (
          <div
            key={`saindo-${vizAnterior}`}
            className="marcos-chart-layer marcos-chart-layer-exit"
            data-exiting={saindo}
            aria-hidden="true"
            onTransitionEnd={(event) => {
              if (event.propertyName === "opacity") setVizAnterior(null);
            }}
          >
            {renderizarGrafico(vizAnterior, true, false)}
          </div>
        )}
        <div key={`entrando-${viz}`} className="marcos-chart-layer marcos-chart-layer-enter" data-entering={entrando}>
          {renderizarGrafico(viz, mostrarRotulos, vizAnterior !== null)}
        </div>
      </div>
      <div className="mt-auto flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-[2px]" style={{ background: COR.bom }} />Bateu a meta</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-[2px]" style={{ background: COR.ruim }} />Não bateu a meta</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-[2px]" style={{ background: COR.neutro }} />Sem meta</span>
        <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed" style={{ borderColor: COR.meta }} />Meta</span>
      </div>
      {(naoZero || dados.some((d) => d.label.endsWith("*"))) && (
        <p className="text-center text-xs text-muted-foreground">
          {naoZero && "Eixo não começa em zero para evidenciar a variação. "}
          {dados.some((d) => d.label.endsWith("*")) && "* mês parcial."}
        </p>
      )}
    </div>
  );
}

type Desvio = { nome: string; desvio: number; preenchidos: number; total: number; real: number; meta: number; formato: Formato };

function calcularDesvios(meses: BIMes[], metas: MetasMarcos, atual: string): Desvio[] {
  const total = meses.length;
  const media = (l: number[]) => l.reduce((a, b) => a + b, 0) / l.length;
  const soma = (l: number[]) => l.reduce((a, b) => a + b, 0);
  return DEFS.flatMap<Desvio>((def) => {
    const porMes = metas[def.chave] ?? {};
    const sel = meses.filter((m) => m.mes <= atual && porMes[m.mes] !== undefined);
    if (!sel.length) return [];
    const metasSel = sel.map((m) => porMes[m.mes] as number);
    let real: number;
    let meta: number;
    switch (def.chave) {
      case "nmrr":
      case "novos":
        real = soma(sel.map(def.real));
        meta = soma(metasSel);
        break;
      case "mrr":
      case "ativos":
        real = media(sel.map(def.real));
        meta = media(metasSel);
        break;
      case "nmrrTicket": {
        const nv = soma(sel.map((m) => m.novos));
        real = nv ? soma(sel.map((m) => m.nmrr)) / nv : 0;
        meta = media(metasSel);
        break;
      }
      case "revChurn": {
        const mrr = soma(sel.map((m) => m.mrr));
        real = mrr ? (soma(sel.map((m) => m.mrrPerdido)) / mrr) * 100 : 0;
        meta = media(metasSel);
        break;
      }
    }
    if (!meta) return [];
    const desvio = def.menorMelhor ? 1 - real / meta : real / meta - 1;
    return [{ nome: def.nome, desvio: desvio * 100, preenchidos: sel.length, total, real, meta, formato: def.formato }];
  });
}

function CardDesvio({ meses, metas, atual }: { meses: BIMes[]; metas: MetasMarcos; atual: string }) {
  const [viz, setViz] = React.useState<"barra" | "coluna">("barra");
  const [ref, largura] = useLargura();
  const dados = calcularDesvios(meses, metas, atual);
  const lim = Math.max(10, ...dados.map((d) => Math.abs(d.desvio)));
  const passo = lim <= 20 ? 5 : lim <= 50 ? 10 : lim <= 100 ? 25 : 50;
  const M = Math.ceil((lim * 1.25) / passo) * passo;
  const fmtPct = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1).replace(".", ",")}%`;
  const vertical = viz === "barra";
  const compacto = largura < 520;

  const rotulo = (raw: unknown) => {
    const p = raw as LP;
    const d = dados[p.index ?? 0];
    if (!d) return null;
    const pos = d.desvio >= 0;
    const texto = `${fmtPct(d.desvio)} · ${d.preenchidos} de ${d.total} meses`;
    if (vertical) {
      if (compacto) {
        return <text x={Math.max(1, largura - 8)} y={(p.y ?? 0) + (p.height ?? 0) / 2} textAnchor="end" dominantBaseline="central" fontSize={11} fontWeight={600} fill={COR.rotulo}>{texto}</text>;
      }
      const x = (p.x ?? 0) + (pos ? (p.width ?? 0) + 6 : (p.width ?? 0) - 6);
      return <text x={x} y={(p.y ?? 0) + (p.height ?? 0) / 2} textAnchor={pos ? "start" : "end"} dominantBaseline="central" fontSize={12} fontWeight={600} fill={COR.rotulo}>{texto}</text>;
    }
    const cx = (p.x ?? 0) + (p.width ?? 0) / 2;
    const yTop = Math.min(p.y ?? 0, (p.y ?? 0) + (p.height ?? 0));
    const yBot = Math.max(p.y ?? 0, (p.y ?? 0) + (p.height ?? 0));
    return (
      <text x={cx} y={pos ? yTop - 17 : yBot + 14} textAnchor="middle" fontSize={12} fontWeight={600} fill={COR.rotulo}>
        <tspan x={cx} dy={0}>{fmtPct(d.desvio)}</tspan>
        <tspan x={cx} dy={14} fontSize={11} fill={COR.legenda}>{d.preenchidos} de {d.total} meses</tspan>
      </text>
    );
  };

  const tooltip = (
    <Tooltip
      cursor={{ fill: "oklch(1 0 0 / 0.04)" }}
      wrapperStyle={{ zIndex: 9999, outline: "none" }}
      content={(raw: unknown) => {
        const t = raw as { active?: boolean; payload?: { payload?: Desvio }[] };
        const d = t.payload?.[0]?.payload;
        if (!t.active || !d) return null;
        return (
          <div className="rounded-xl border px-3 py-2 text-sm shadow-xl" style={{ background: COR.card, borderColor: COR.grade, color: "var(--foreground, white)" }}>
            <p className="mb-1 font-semibold">{d.nome}</p>
            <p>Real: {fmtCompleto(d.real, d.formato)}</p>
            <p>Meta: {fmtCompleto(d.meta, d.formato)}</p>
            <p>Desvio: {fmtPct(d.desvio)}</p>
            <p className="text-muted-foreground">{d.preenchidos} de {d.total} meses com meta</p>
          </div>
        );
      }}
    />
  );

  const varia = new Set(dados.map((d) => d.preenchidos)).size > 1;

  return (
    <div className="neu-card flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Target className="size-4 text-primary" />
          <h3 className="text-base font-semibold text-foreground">Desvio em relação à meta</h3>
        </div>
        <SeletorViz<"barra" | "coluna"> valor={viz} onChange={setViz} opcoes={[{ valor: "barra", label: "Barra" }, { valor: "coluna", label: "Coluna" }]} />
      </div>
      {dados.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Nenhum indicador com meta preenchida em meses já realizados do período.</p>
      ) : (
        <div ref={ref} style={{ height: ALTURA_PLOT }}>
          <ResponsiveContainer width="100%" height="100%">
            {vertical ? (
              <ComposedChart data={dados} layout="vertical" margin={compacto ? { top: 4, right: 116, bottom: 0, left: 72 } : { top: 4, right: 150, bottom: 0, left: 150 }} barCategoryGap="28%">
                <CartesianGrid horizontal={false} stroke={COR.grade} strokeOpacity={0.5} />
                <XAxis type="number" domain={[-M, M]} ticks={Array.from({ length: (2 * M) / passo + 1 }, (_, i) => -M + i * passo)} tickFormatter={(v: number) => `${v}%`} tick={{ fill: COR.eixo, fontSize: FONTE_EIXO }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="nome" hide />
                <ReferenceLine x={0} stroke={COR.eixo} strokeWidth={1.5} />
                {tooltip}
                <Bar dataKey="desvio" isAnimationActive={false} maxBarSize={26}>
                  {dados.map((d, i) => <Cell key={i} fill={d.desvio >= 0 ? COR.bom : COR.ruim} />)}
                  <LabelList dataKey="desvio" content={rotulo} />
                  <LabelList
                    dataKey="nome"
                    content={(raw: unknown) => {
                      const p = raw as LP;
                       const nome = compacto ? String(p.value).replace("Clientes Ativos", "Ativos").replace("Novos Clientes", "Novos").replace("nMRR Ticket Médio", "Ticket").replace("RevChurn", "Churn") : String(p.value);
                       return <text x={4} y={(p.y ?? 0) + (p.height ?? 0) / 2} dominantBaseline="central" fontSize={compacto ? 11 : 13} fontWeight={600} fill={COR.eixo}>{nome}</text>;
                    }}
                  />
                </Bar>
              </ComposedChart>
            ) : (
              <ComposedChart data={dados} margin={{ top: 38, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke={COR.grade} strokeOpacity={0.5} />
                <XAxis dataKey="nome" interval={0} tick={{ fill: COR.eixo, fontSize: FONTE_EIXO }} axisLine={false} tickLine={false} />
                <YAxis domain={[-M, M]} ticks={Array.from({ length: (2 * M) / passo + 1 }, (_, i) => -M + i * passo)} tickFormatter={(v: number) => `${v}%`} tick={{ fill: COR.eixo, fontSize: FONTE_EIXO }} axisLine={false} tickLine={false} width={52} />
                <ReferenceLine y={0} stroke={COR.eixo} strokeWidth={1.5} />
                {tooltip}
                <Bar dataKey="desvio" isAnimationActive={false} maxBarSize={48}>
                  {dados.map((d, i) => <Cell key={i} fill={d.desvio >= 0 ? COR.bom : COR.ruim} />)}
                  <LabelList dataKey="desvio" content={rotulo} />
                </Bar>
              </ComposedChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-[2px]" style={{ background: COR.bom }} />Melhor que a meta</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-[2px]" style={{ background: COR.ruim }} />Pior que a meta</span>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        Considera só os meses com meta preenchida de cada indicador. RevChurn invertido: abaixo da meta aparece à direita.
        {varia && " Indicadores com quantidades diferentes de meses não são comparáveis entre si."}
      </p>
    </div>
  );
}

export function MarcosGraficos({ meses, metas, atual }: { meses: BIMes[]; metas: MetasMarcos; atual: string }) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <BarChart3 className="size-4 text-primary" />
        <h2 className="text-base font-bold uppercase text-foreground">Meta x Real</h2>
        <span className="text-sm text-muted-foreground">Evolução mês a mês e desvio do período</span>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {DEFS.map((def) => (
          <CardEvolucao key={def.chave} def={def} meses={meses} metas={metas} atual={atual} />
        ))}
      </div>
      <CardDesvio meses={meses} metas={metas} atual={atual} />
    </section>
  );
}
