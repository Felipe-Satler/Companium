import * as React from "react";
import { createPortal } from "react-dom";
import { TrendingUp } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";


import type { GestaoCliente } from "@/hooks/useGestaoData";
import { mrrClienteNoMes } from "./mrrEngine";
import { listarMeses } from "./useGestaoBI";

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const brlK = (v: number) =>
  Math.abs(v) >= 1000
    ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k`
    : brl(v);

const axis = {
  stroke: "hsl(var(--chart-axis, 50 8% 74%))",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
};

/**
 * Cores das séries — SÓ tons de azul e verde (sem turquesa/ciano, o meio do
 * caminho entre as duas famílias). Atribuídas por índice da série ordenada, então
 * a ordem abaixo é a ordem na legenda: alterna família a cada passo (azul, verde,
 * azul, verde…) e alterna luminosidade (claro/escuro) para que séries vizinhas
 * nunca fiquem parecidas, mesmo com 7–8 séries. Tons escolhidos nos polos
 * (claramente claros ou escuros), evitando luminosidade média ambígua.
 */
const PALETA = [
  "#2563eb", // 0 azul escuro
  "#4ade80", // 1 verde claro
  "#93c5fd", // 2 azul claro
  "#166534", // 3 verde escuro
  "#1e40af", // 4 azul bem escuro
  "#86efac", // 5 verde bem claro
  "#bfdbfe", // 6 azul bem claro
  "#15803d", // 7 verde escuro (variação)
  "#1d4ed8", // 8 azul escuro (variação)
  "#22c55e", // 9 verde vivo
  "#60a5fa", // 10 azul claro (variação)
  "#14532d", // 11 verde bem escuro
];

const PAPEIS = [
  { key: "lider_revops", recorte: "Líder" },
  { key: "responsavel_revops", recorte: "Responsável Rev Ops" },
  { key: "an_performance", recorte: "Responsável Performance" },
  { key: "an_copy", recorte: "Responsável Copy" },
] as const;

type PapelKey = (typeof PAPEIS)[number]["key"];
type Metrica = "nmrr" | "ativo" | "valido";
type Viz = "coluna" | "barra" | "area" | "linha";
type Ordenar = "mrr" | "clientes";

const ROTULO_METRICA: Record<Metrica, string> = {
  nmrr: "nMRR",
  ativo: "MRR Ativo",
  valido: "MRR Válido",
};

const ym = (d: string | null | undefined) => (d ? d.slice(0, 7) : null);
const inicioDe = (r: GestaoCliente) => ym(r.data_inicio_ref) ?? ym(r.data_inicio);
const fimDe = (r: GestaoCliente) => ym(r.data_fim_ref);

/** MRR Válido: o 1º mês do cliente não conta. */
const mrrValidoNoMes = (r: GestaoCliente, mes: string) => {
  const inicio = inicioDe(r);
  if (!inicio || inicio >= mes) return 0;
  return mrrClienteNoMes(r, mes);
};

/** Cliente ativo no mês: iniciado e ainda não encerrado. */
const ativoNoMes = (r: GestaoCliente, mes: string) => {
  const ini = inicioDe(r);
  if (!ini || ini > mes) return false;
  const fim = fimDe(r);
  return !fim || fim >= mes;
};

const rotuloMes = (mes: string) => {
  const [ano, m] = mes.split("-");
  return `${m}/${(ano ?? "").slice(2)}`;
};

type ConsultorSerie = {
  nome: string;
  /** Valor em R$ da métrica ativa, por mês. */
  valores: number[];
  /** Contagem de clientes da métrica ativa, por mês. */
  contagens: number[];
  /** Agregação do período usada para ordenar (soma ou média). */
  agregValor: number;
  agregClientes: number;
};

function EvolucaoChart({
  rows,
  meses,
  papel,
  recorte,
  roster,
}: {
  rows: GestaoCliente[];
  meses: string[];
  papel: PapelKey;
  recorte: string;
  /**
   * Lista de pessoas deste recorte, vinda da MESMA fonte da tabela de ranking.
   * Define exatamente quais séries o gráfico mostra (sem corte de top-N); gráfico e
   * tabela nunca divergem. "Sem definição" já vem de fora.
   */
  roster: string[];
}) {
  const [metrica, setMetrica] = React.useState<Metrica>("valido");
  const [viz, setViz] = React.useState<Viz>("coluna");
  const [ordenar, setOrdenar] = React.useState<Ordenar>("mrr");
  const [rotulos, setRotulos] = React.useState(true);


  const metricasDisponiveis: Metrica[] = ["nmrr", "ativo", "valido"];

  const { data, consultores, cores } = React.useMemo(() => {
    const grupos = new Map<string, GestaoCliente[]>();
    for (const r of rows) {
      const nome = ((r[papel] as string | null) ?? "").trim();
      if (!nome) continue;
      const arr = grupos.get(nome);
      if (arr) arr.push(r);
      else grupos.set(nome, [r]);
    }

    const series: ConsultorSerie[] = Array.from(grupos.entries()).map(([nome, itens]) => {
      const novosPorMes = meses.map((m) => itens.filter((r) => inicioDe(r) === m));
      const ativosPorMes = meses.map((m) => itens.filter((r) => ativoNoMes(r, m)));

      const valores =
        metrica === "nmrr"
          ? novosPorMes.map((lista) => lista.reduce((s, r) => s + (r.nmrr ?? 0), 0))
          : metrica === "valido"
            ? meses.map((m) => itens.reduce((s, r) => s + mrrValidoNoMes(r, m), 0))
            : meses.map((m) => itens.reduce((s, r) => s + mrrClienteNoMes(r, m), 0));
      const contagens =
        metrica === "nmrr"
          ? novosPorMes.map((l) => l.length)
          : ativosPorMes.map((l) => l.length);

      // Agregação do período: soma para nMRR/novos; média para MRR/ativos.
      const ehSoma = metrica === "nmrr";
      const agrega = (arr: number[]) =>
        ehSoma ? arr.reduce((s, v) => s + v, 0) : arr.length
          ? arr.reduce((s, v) => s + v, 0) / arr.length
          : 0;

      return {
        nome,
        valores,
        contagens,
        agregValor: agrega(valores),
        agregClientes: agrega(contagens),
      };
    });

    // A lista de pessoas vem da MESMA fonte da tabela de ranking (prop `roster`),
    // sem corte de top-N: todas as pessoas do recorte entram no gráfico e na legenda.
    const permitido = new Set(roster);
    const exibidos = series.filter((s) => permitido.has(s.nome));

    // Ordem decrescente pela agregação escolhida; vale para o gráfico inteiro.
    exibidos.sort((a, b) =>
      ordenar === "mrr"
        ? b.agregValor - a.agregValor
        : b.agregClientes - a.agregClientes
    );
    const top = exibidos;


    const linhas = meses.map((m, i) => {
      const ponto: Record<string, string | number> = { mes: rotuloMes(m) };
      for (const s of top) {
        ponto[s.nome] = ordenar === "clientes" ? (s.contagens[i] ?? 0) : Math.round(s.valores[i] ?? 0);
        ponto[`${s.nome}__qtd`] = s.contagens[i] ?? 0;
        ponto[`${s.nome}__mrr`] = Math.round(s.valores[i] ?? 0);
      }
      return ponto;
    });

    const mapaCores = new Map(top.map((s, i) => [s.nome, PALETA[i % PALETA.length]!]));
    return { data: linhas, consultores: top.map((s) => s.nome), cores: mapaCores };
  }, [rows, papel, meses, metrica, ordenar, roster]);

  const rotuloClientes = metrica === "nmrr" ? "clientes novos" : "clientes ativos";

  const plotClientes = ordenar === "clientes";
  const fmtEixo = (v: number) => (plotClientes ? String(Math.round(v)) : brlK(v));

  /** Rótulo por extenso: "R$ 59,7 mil", "R$ 12 mil", "R$ 950" ou contagem inteira. */
  const fmtRotulo = React.useCallback(
    (v: number) => {
      if (!Number.isFinite(v) || Math.round(v) === 0) return "";
      if (plotClientes) return String(Math.round(v));
      if (Math.abs(v) >= 1000) {
        const mil = (v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
        return `R$ ${mil} mil`;
      }
      return `R$ ${Math.round(v)}`;
    },
    [plotClientes]
  );

  const { maxTotal, maxVal } = React.useMemo(() => {
    let max = 0;
    let maxVal = 0;
    const pos = new Map<string, "top" | "bottom">();
    data.forEach((linha) => {
      let total = 0;
      for (const n of consultores) {
        const v = Number(linha[n] ?? 0);
        total += v;
        if (v > maxVal) maxVal = v;
      }
      if (total > max) max = total;
    });
    const limite = maxVal * 0.08;
    data.forEach((linha, i) => {
      const ordenados = consultores
        .map((n) => ({ n, v: Number(linha[n] ?? 0) }))
        .sort((a, b) => b.v - a.v);
      let ultimoTopo: number | null = null;
      for (const item of ordenados) {
        if (ultimoTopo !== null && Math.abs(ultimoTopo - item.v) < limite) {
          pos.set(`${i}|${item.n}`, "bottom");
        } else {
          pos.set(`${i}|${item.n}`, "top");
          ultimoTopo = item.v;
        }
      }
    });
    return { maxTotal: max, maxVal, posLinha: pos };
  }, [data, consultores]);

  /** Escala aproximada da Área empilhada, para centralizar o rótulo na faixa. */
  const niceMax = (v: number) => {
    if (v <= 0) return 1;
    const exp = Math.floor(Math.log10(v));
    const base = 10 ** exp;
    const n = v / base;
    const mult = n <= 1 ? 1 : n <= 1.2 ? 1.2 : n <= 1.5 ? 1.5 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 3 ? 3 : n <= 4 ? 4 : n <= 5 ? 5 : n <= 6 ? 6 : n <= 8 ? 8 : 10;
    return mult * base;
  };
  const areaMax = niceMax(maxTotal * 1.02);
  const AREA_PLOT_H = 340 - 8 - 30;

  /**
   * Área: rótulo SEMPRE logo acima do ponto da própria série (topo da faixa),
   * com respiro fixo de 6px. Nada é omitido por colisão; o único ajuste é o
   * limite da área de plotagem — se ficar cortado no topo, desloca o mínimo
   * para dentro.
   */
  const posArea = React.useMemo(() => {
    const pos = new Map<string, number>(); // key -> dy em px
    data.forEach((linha, i) => {
      let cum = 0;
      for (const nome of consultores) {
        const v = Number(linha[nome] ?? 0);
        cum += v;
        if (v <= 0) continue;
        const y = 8 + (1 - cum / areaMax) * AREA_PLOT_H;
        pos.set(`${i}|${nome}`, Math.max(y - 6, 14) - y);
      }
    });
    return pos;
  }, [data, consultores, areaMax, AREA_PLOT_H]);


  /**
   * Regra atual: NENHUM rótulo é omitido por colisão, falta de espaço ou
   * proximidade — sobreposição parcial é aceitável.
   */

  type LabelProps = {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    value?: number | string;
    index?: number;
  };

  const rotuloColuna = (raw: unknown) => {
    const p = raw as LabelProps;
    const v = Number(p.value ?? 0);
    const texto = fmtRotulo(v);
    if (!texto) return null;
    const cx = (p.x ?? 0) + (p.width ?? 0) / 2;
    const cy = (p.y ?? 0) - 6;
    return (
      <text
        x={cx}
        y={cy}
        transform={`rotate(-90 ${cx} ${cy})`}
        textAnchor="start"
        dominantBaseline="central"
        fontSize={10}
        fontWeight={600}
        fill="hsl(var(--chart-label, 40 11% 93%))"
      >
        {texto}
      </text>
    );
  };

  const rotuloBarra = (raw: unknown) => {
    const p = raw as LabelProps;
    const v = Number(p.value ?? 0);
    const texto = fmtRotulo(v);
    if (!texto) return null;
    return (
      <text
        x={(p.x ?? 0) + (p.width ?? 0) + 4}
        y={(p.y ?? 0) + (p.height ?? 0) / 2}
        textAnchor="start"
        dominantBaseline="central"
        fontSize={10}
        fontWeight={600}
        fill="hsl(var(--chart-label, 40 11% 93%))"
      >
        {texto}
      </text>
    );
  };

  const rotuloLinha = (nome: string) => (raw: unknown) => {
    const p = raw as LabelProps;
    const v = Number(p.value ?? 0);
    const texto = fmtRotulo(v);
    if (!texto) return null;
    const idx = p.index ?? 0;
    const primeiro = idx === 0;
    const ultimo = idx === data.length - 1;
    return (
      <text
        x={(p.x ?? 0) + (primeiro ? 4 : ultimo ? -4 : 0)}
        y={(p.y ?? 0) - 8}
        textAnchor={primeiro ? "start" : ultimo ? "end" : "middle"}
        fontSize={10}
        fontWeight={600}
        fill={cores.get(nome)}
        stroke="oklch(0.18 0.02 250)"
        strokeWidth={2.4}
        strokeLinejoin="round"
        paintOrder="stroke"
      >
        {texto}
      </text>
    );
  };

  const rotuloArea = (nome: string) => (raw: unknown) => {
    const p = raw as LabelProps;
    const v = Number(p.value ?? 0);
    const texto = fmtRotulo(v);
    if (!texto) return null;
    const idx = p.index ?? 0;
    const primeiro = idx === 0;
    const ultimo = idx === data.length - 1;
    const dy = posArea.get(`${idx}|${nome}`) ?? -6;
    return (
      <text
        x={(p.x ?? 0) + (primeiro ? 4 : ultimo ? -4 : 0)}
        y={(p.y ?? 0) + dy}
        textAnchor={primeiro ? "start" : ultimo ? "end" : "middle"}
        fontSize={10}
        fontWeight={600}
        fill={cores.get(nome)}
        stroke="oklch(0.18 0.02 250)"
        strokeWidth={2.4}
        strokeLinejoin="round"
        paintOrder="stroke"
      >
        {texto}
      </text>
    );
  };



  const titulo = plotClientes
    ? metrica === "nmrr"
      ? `Evolução de Clientes Novos por ${recorte}`
      : `Evolução de Clientes Ativos por ${recorte}`
    : `Evolução de ${ROTULO_METRICA[metrica]} por ${recorte}`;

  /** Ref do contêiner do gráfico: base para posicionar o tooltip em portal. */
  const grafRef = React.useRef<HTMLDivElement>(null);

  /**
   * Tooltip renderizado em portal no <body>, com z-index acima de qualquer
   * camada do card — cobre os rótulos de dados em todas as visualizações.
   * Posição: coordenada do mouse dentro do gráfico + posição do contêiner.
   */
  const TooltipEquipe = (raw: unknown) => {
    const p = raw as {
      active?: boolean;
      label?: string;
      coordinate?: { x?: number; y?: number };
      payload?: { dataKey?: string; value?: number; payload?: Record<string, number> }[];
    };
    if (!p.active || !p.payload?.length || typeof document === "undefined") return null;
    const rect = grafRef.current?.getBoundingClientRect();
    const cx = (rect?.left ?? 0) + (p.coordinate?.x ?? 0);
    const cy = (rect?.top ?? 0) + (p.coordinate?.y ?? 0);
    const larguraEst = 300;
    const esquerda = Math.max(
      8,
      Math.min(cx + 14, (typeof window !== "undefined" ? window.innerWidth : 9999) - larguraEst - 8)
    );
    return createPortal(
      <div
        className="pointer-events-none fixed rounded-xl border px-3 py-2 text-xs shadow-xl"
        style={{
          left: esquerda,
          top: cy - 16,
          transform: "translateY(-100%)",
          zIndex: 9999,
          background: "hsl(var(--card, 213 45% 15%))",
          borderColor: "hsl(var(--border, 213 35% 22%))",
          color: "hsl(var(--foreground, 210 12% 93%))",
        }}
      >
        <p className="mb-1.5 font-semibold">{p.label}</p>
        <div className="space-y-1">
          {consultores.map((nome) => {
            const item = p.payload!.find((e) => e.dataKey === nome);
            if (!item) return null;
            const qtd = item.payload?.[`${nome}__qtd`] ?? 0;
            const mrr = item.payload?.[`${nome}__mrr`] ?? 0;
            return (
              <div key={nome} className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 shrink-0 rounded-[2px]"
                  style={{ background: cores.get(nome) }}
                />
                <span>
                  {nome} · {qtd} {rotuloClientes} · {brl(Number(mrr))}
                </span>
              </div>
            );
          })}
        </div>
      </div>,
      document.body
    );
  };


  /** Altura da Barra horizontal: ~12px por consultor + respiro entre meses. */
  const alturaBarra = Math.max(320, meses.length * (consultores.length * 12 + 22) + 50);

  return (
    <div className="neu-card h-full space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <TrendingUp className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">{titulo}</h3>
        <span className="neu-inset rounded-full px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
          {consultores.length} consultores
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1">
          {metricasDisponiveis.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMetrica(m)}
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition ${
                metrica === m
                  ? "neu-inset text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {ROTULO_METRICA[m]}
            </button>
          ))}
        </div>
        <div className="neu-inset flex items-center gap-0.5 rounded-full p-0.5">
          {(
            [
              { valor: "coluna", label: "Coluna" },
              { valor: "barra", label: "Barra" },
              { valor: "area", label: "Área" },
              { valor: "linha", label: "Linha" },
            ] as { valor: Viz; label: string }[]
          ).map((t) => (
            <button
              key={t.valor}
              type="button"
              onClick={() => setViz(t.valor)}
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition ${
                viz === t.valor ? "neu-raised text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            Ordenar
          </span>
          {(
            [
              { valor: "clientes", label: "Clientes" },
              { valor: "mrr", label: "MRR" },
            ] as { valor: Ordenar; label: string }[]
          ).map((o) => (
            <button
              key={o.valor}
              type="button"
              onClick={() => setOrdenar(o.valor)}
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition ${
                ordenar === o.valor
                  ? "neu-inset text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setRotulos((v) => !v)}
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition ${
            rotulos ? "neu-inset text-primary" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Rótulos
        </button>
      </div>


      {consultores.length === 0 ? (
        <div className="neu-inset rounded-lg px-4 py-10 text-center text-sm text-muted-foreground">
          Sem dados para os filtros selecionados.
        </div>
      ) : (
        <div className="neu-inset rounded-xl p-3">
          <div
            className={viz === "barra" ? "overflow-y-auto" : undefined}
            style={{ height: 340 }}
          >
            <div
              ref={grafRef}
              className="relative w-full"
              style={{ height: viz === "barra" ? alturaBarra : 340 }}
            >
            <ResponsiveContainer width="100%" height="100%">
              {viz === "coluna" ? (
                <BarChart
                  data={data}
                  margin={{ top: rotulos ? 68 : 8, right: 12, left: 4, bottom: 0 }}
                  barCategoryGap="20%"
                  barGap={2}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border, 213 35% 22%))" vertical={false} />
                  <XAxis dataKey="mes" {...axis} />
                  <YAxis
                    {...axis}
                    tickFormatter={fmtEixo}
                    width={64}
                    allowDecimals={!plotClientes}
                  />
                  <Tooltip cursor={{ fill: "hsl(var(--muted, 213 35% 17%))", opacity: 0.25 }} content={TooltipEquipe} />
                  {consultores.map((nome) => (
                    <Bar
                      key={nome}
                      dataKey={nome}
                      name={nome}
                      fill={cores.get(nome)}
                      radius={[4, 4, 0, 0]}
                      maxBarSize={22}
                      animationDuration={300}
                    />
                  ))}

                </BarChart>
              ) : viz === "barra" ? (
                <BarChart
                  data={[...data].reverse()}
                  layout="vertical"
                  margin={{ top: 8, right: rotulos ? 88 : 12, left: 4, bottom: 0 }}
                  barCategoryGap="30%"
                  barGap={1}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border, 213 35% 22%))" horizontal={false} />
                  <XAxis
                    type="number"
                    {...axis}
                    tickFormatter={fmtEixo}
                    allowDecimals={!plotClientes}
                  />
                  <YAxis
                    type="category"
                    dataKey="mes"
                    width={44}
                    interval={0}
                    tick={{ fontSize: 11, fill: "hsl(var(--chart-axis, 50 8% 74%))", textAnchor: "end" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip cursor={{ fill: "hsl(var(--muted, 213 35% 17%))", opacity: 0.25 }} content={TooltipEquipe} />
                  {consultores.map((nome) => (
                    <Bar
                      key={nome}
                      dataKey={nome}
                      name={nome}
                      fill={cores.get(nome)}
                      radius={[0, 4, 4, 0]}
                      barSize={9}
                      animationDuration={300}
                    />
                  ))}

                </BarChart>
              ) : viz === "area" ? (
                <AreaChart
                  data={data}
                  margin={{ top: rotulos ? 24 : 8, right: 28, left: 4, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border, 213 35% 22%))" vertical={false} />
                  <XAxis
                    dataKey="mes"
                    {...axis}
                    interval={0}
                    padding={{ left: 24, right: 24 }}
                  />
                  <YAxis
                    {...axis}
                    tickFormatter={fmtEixo}
                    width={64}
                    domain={[0, areaMax]}
                    allowDecimals={!plotClientes}
                  />
                  <Tooltip cursor={{ stroke: "hsl(var(--border, 213 35% 22%))" }} content={TooltipEquipe} />
                  {consultores.map((nome) => (
                    <Area
                      key={nome}
                      type="monotone"
                      dataKey={nome}
                      name={nome}
                      stackId="1"
                      stroke={cores.get(nome)}
                      strokeWidth={2}
                      fill={cores.get(nome)}
                      fillOpacity={0.35}
                      dot={{ r: 2.5, fill: cores.get(nome), strokeWidth: 0 }}
                      activeDot={{ r: 4.5, fill: cores.get(nome), strokeWidth: 0 }}
                      animationDuration={300}
                    />
                  ))}

                </AreaChart>
              ) : (
                <LineChart
                  data={data}
                  margin={{ top: rotulos ? 24 : 8, right: 28, left: 4, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border, 213 35% 22%))" vertical={false} />
                  <XAxis
                    dataKey="mes"
                    {...axis}
                    interval={0}
                    padding={{ left: 24, right: 24 }}
                  />
                  <YAxis
                    {...axis}
                    tickFormatter={fmtEixo}
                    width={64}
                    allowDecimals={!plotClientes}
                  />
                  <Tooltip cursor={{ stroke: "hsl(var(--border, 213 35% 22%))" }} content={TooltipEquipe} />
                  {consultores.map((nome) => (
                    <Line
                      key={nome}
                      type="monotone"
                      dataKey={nome}
                      name={nome}
                      stroke={cores.get(nome)}
                      strokeWidth={2}
                      dot={{ r: 2.5, fill: cores.get(nome), strokeWidth: 0 }}
                      activeDot={{ r: 4.5, fill: cores.get(nome), strokeWidth: 0 }}
                      animationDuration={300}
                    />
                  ))}

                </LineChart>
              )}
            </ResponsiveContainer>
            {rotulos ? (
              <div className="pointer-events-none absolute inset-0">
                <ResponsiveContainer width="100%" height="100%">
                  {viz === "coluna" ? (
                    <BarChart
                      data={data}
                      margin={{ top: 68, right: 12, left: 4, bottom: 0 }}
                      barCategoryGap="20%"
                      barGap={2}
                    >
                      <XAxis dataKey="mes" {...axis} />
                      <YAxis
                        {...axis}
                        tickFormatter={fmtEixo}
                        width={64}
                        allowDecimals={!plotClientes}
                      />
                      {consultores.map((nome) => (
                        <Bar
                          key={nome}
                          dataKey={nome}
                          fill="transparent"
                          maxBarSize={22}
                          isAnimationActive={false}
                        >
                          <LabelList dataKey={nome} content={rotuloColuna} />
                        </Bar>
                      ))}
                    </BarChart>
                  ) : viz === "barra" ? (
                    <BarChart
                      data={[...data].reverse()}
                      layout="vertical"
                      margin={{ top: 8, right: 88, left: 4, bottom: 0 }}
                      barCategoryGap="30%"
                      barGap={1}
                    >
                      <XAxis
                        type="number"
                        {...axis}
                        tickFormatter={fmtEixo}
                        allowDecimals={!plotClientes}
                      />
                      <YAxis
                        type="category"
                        dataKey="mes"
                        width={44}
                        interval={0}
                        tick={{ fontSize: 11, fill: "transparent", textAnchor: "end" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      {consultores.map((nome) => (
                        <Bar
                          key={nome}
                          dataKey={nome}
                          fill="transparent"
                          barSize={9}
                          isAnimationActive={false}
                        >
                          <LabelList dataKey={nome} content={rotuloBarra} />
                        </Bar>
                      ))}
                    </BarChart>
                  ) : viz === "area" ? (
                    <AreaChart
                      data={data}
                      margin={{ top: 24, right: 28, left: 4, bottom: 0 }}
                    >
                      <XAxis
                        dataKey="mes"
                        {...axis}
                        interval={0}
                        padding={{ left: 24, right: 24 }}
                      />
                      <YAxis
                        {...axis}
                        tickFormatter={fmtEixo}
                        width={64}
                        domain={[0, areaMax]}
                        allowDecimals={!plotClientes}
                      />
                      {consultores.map((nome) => (
                        <Area
                          key={nome}
                          type="monotone"
                          dataKey={nome}
                          stackId="1"
                          stroke="none"
                          fill="none"
                          dot={false}
                          activeDot={false}
                          isAnimationActive={false}
                        >
                          <LabelList dataKey={nome} content={rotuloArea(nome)} />
                        </Area>
                      ))}
                    </AreaChart>
                  ) : (
                    <LineChart
                      data={data}
                      margin={{ top: 24, right: 28, left: 4, bottom: 0 }}
                    >
                      <XAxis
                        dataKey="mes"
                        {...axis}
                        interval={0}
                        padding={{ left: 24, right: 24 }}
                      />
                      <YAxis
                        {...axis}
                        tickFormatter={fmtEixo}
                        width={64}
                        allowDecimals={!plotClientes}
                      />
                      {consultores.map((nome) => (
                        <Line
                          key={nome}
                          type="monotone"
                          dataKey={nome}
                          stroke="none"
                          dot={false}
                          activeDot={false}
                          isAnimationActive={false}
                        >
                          <LabelList dataKey={nome} content={rotuloLinha(nome)} />
                        </Line>
                      ))}
                    </LineChart>
                  )}
                </ResponsiveContainer>
              </div>
            ) : null}
          </div>
          </div>
          <ul className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5">
            {consultores.map((nome) => (
              <li key={nome} className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                  style={{ background: cores.get(nome) }}
                />
                <span className="text-[11px] text-chart-legend">{nome}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function GestaoEvolucaoMrrEquipes({
  rows,
  inicio,
  fim,
  rosters,
}: {
  rows: GestaoCliente[];
  inicio?: string | null;
  fim?: string | null;
  /** Lista de pessoas por recorte, vinda da mesma base da tabela de ranking. */
  rosters: Record<PapelKey, string[]>;
}) {
  const meses = React.useMemo(() => {
    if (inicio && fim) {
      const a = inicio <= fim ? inicio : fim;
      const b = inicio <= fim ? fim : inicio;
      return listarMeses(a, b);
    }
    const hoje = new Date();
    const lista: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - i, 1));
      lista.push(d.toISOString().slice(0, 7));
    }
    return lista;
  }, [inicio, fim]);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {PAPEIS.map((p) => (
        <EvolucaoChart
          key={p.key}
          rows={rows}
          meses={meses}
          papel={p.key}
          recorte={p.recorte}
          roster={rosters[p.key] ?? []}
        />
      ))}
    </div>
  );
}
