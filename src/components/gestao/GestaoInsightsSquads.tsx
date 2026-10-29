import * as React from "react";
import { AlertTriangle, Users, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import type { GestaoCliente } from "@/hooks/useGestaoData";
import { listarMeses, mesLabel } from "./useGestaoBI";
import { mrrClienteNoMes } from "./mrrEngine";
import { GestaoEvolucaoMrrEquipes } from "./GestaoEvolucaoMrrEquipes";
import { titleCase, normalizarNome } from "@/lib/utils";

/** Opções de mês do filtro de período próprio da seção (mesmo padrão da barra global). */
const ANO_REF = 2026;
const MESES_SECAO = listarMeses(`${ANO_REF - 3}-01`, `${ANO_REF + 1}-12`);
const OPCOES_MES_SECAO = MESES_SECAO.slice()
  .reverse()
  .map((m) => ({ value: m, label: mesLabel(m) }));

const brl = (v: number | null | undefined) =>
  v === null || v === undefined
    ? "—"
    : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

// CLT sempre em MESES nesta tabela (padronização de unidade).
const meses = (v: number | null | undefined) => {
  if (v === null || v === undefined) return "—";
  return `${v.toFixed(1)} meses`;
};

const isAtivo = (r: GestaoCliente) => (r.status ?? "").toUpperCase() === "ATIVO";
const temAviso = (r: GestaoCliente) => !!(r.data_aviso_previo_ref ?? r.data_aviso_previo);

const num = (v: number | null | undefined) => (typeof v === "number" ? v : 0);

const ymOf = (d: string | null | undefined) => (d ? d.slice(0, 7) : null);
/** Regra única de datas: ativo no mês se início <= mês e (sem fim ou fim >= mês). */
const ativoNoMes = (r: GestaoCliente, mes: string) => {
  const inicio = ymOf(r.data_inicio_ref) ?? ymOf(r.data_inicio);
  if (!inicio || inicio > mes) return false;
  const fim = ymOf(r.data_fim_ref);
  return !fim || fim >= mes;
};
/** MRR Válido: o 1º mês do cliente não conta; usa o valor oficial do mês. */
const mrrValidoNoMes = (r: GestaoCliente, mes: string) => {
  const inicio = ymOf(r.data_inicio_ref) ?? ymOf(r.data_inicio);
  if (!inicio || inicio >= mes) return 0;
  return mrrClienteNoMes(r, mes);
};
const avg = (arr: number[]) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);

/**
 * Proteção de CLT/LTV: valor inválido = negativo, vazio, nulo ou não numérico.
 * Tempo de casa/LTV negativo é sempre erro de dado (ex.: cruzamento sem ID que
 * devolve data de 1899). O cliente sai apenas da média e é sinalizado na tela.
 * Retorna null quando nenhum valor válido sobra (a célula exibe "—", nunca 0).
 */
const mediaValida = (
  itens: GestaoCliente[],
  campo: "clt_atual" | "ltv_real" | "clt_previsto" | "ltv_previsto"
): {
  media: number | null;
  excluidos: string[];
  detalhes: { nome: string; valor: number | null | undefined }[];
} => {
  const validos: number[] = [];
  const detalhes: { nome: string; valor: number | null | undefined }[] = [];
  for (const r of itens) {
    const v = r[campo];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) validos.push(v);
    else detalhes.push({ nome: r.cliente, valor: v });
  }
  return {
    media: validos.length ? avg(validos) : null,
    excluidos: detalhes.map((d) => d.nome),
    detalhes,
  };
};

/** Papéis que contam como "responsável" (colaborador/integrante) de um cliente. */
const PAPEIS = [
  { key: "responsavel_revops", label: "Por Responsável Rev Ops", titulo: "Responsável Rev Ops" },
  { key: "an_dados", label: "Por Dados", titulo: "Dados" },
  { key: "an_performance", label: "Por Responsável Performance", titulo: "Performance" },
  { key: "an_design", label: "Por Design", titulo: "Design" },
  { key: "an_copy", label: "Por Responsável Copy", titulo: "Copy" },
  { key: "an_edicao", label: "Por Edição", titulo: "Edição" },
] as const satisfies readonly { key: keyof GestaoCliente; label: string; titulo: string }[];

type AgrupKey = "lider_revops" | "responsavel_revops" | "an_performance" | "an_copy" | "colaborador";

/**
 * Recortes que têm gráfico de evolução (mesmas keys/ordem do componente de gráficos).
 * Usado para derivar a lista de pessoas de cada gráfico a partir da MESMA base que
 * alimenta a tabela de ranking — assim os dois nunca divergem.
 */
const PAPEIS_GRAFICOS = [
  "lider_revops",
  "responsavel_revops",
  "an_performance",
  "an_copy",
] as const satisfies readonly (keyof GestaoCliente)[];

const AGRUPAMENTOS: { value: AgrupKey; label: string; titulo: string }[] = [
  { value: "lider_revops", label: "Por Equipe (Líder)", titulo: "Equipe" },
  ...PAPEIS.filter((p) => ["responsavel_revops", "an_performance", "an_copy"].includes(p.key))
    .map((p) => ({ value: p.key as AgrupKey, label: p.label, titulo: p.titulo })),
  { value: "colaborador", label: "Por Colaborador", titulo: "Colaborador" },
];

type OrdemKey =
  | "clientes"
  | "mrr_total"
  | "mrr_total_bruto"
  | "mrr_medio"
  | "nmrr_total"
  | "ltv_medio"
  | "ltv_previsto_medio"
  | "clt_medio"
  | "clt_previsto_medio"
  | "retencao";

type SortState = { key: OrdemKey; dir: "asc" | "desc" } | null;

type Grupo = {
  nome: string;
  clientes: number;
  ativos: number;
  aviso: number;
  cancelados: number;
  mrr_total: number;
  mrr_total_bruto: number;
  mrr_medio: number;
  nmrr_total: number;
  ltv_medio: number | null;
  ltv_previsto_medio: number | null;
  clt_medio: number | null;
  clt_previsto_medio: number | null;
  /** Nomes excluídos da média por valor inválido (negativo/vazio/nulo) na planilha. */
  ltv_excluidos: string[];
  ltv_previsto_excluidos: string[];
  clt_excluidos: string[];
  clt_previsto_excluidos: string[];
  clt_detalhes: { nome: string; valor: number | null | undefined }[];
  clt_previsto_detalhes: { nome: string; valor: number | null | undefined }[];
  retencao: number;
  nrr: number;
  topCliente: GestaoCliente | null;
};

/** Mesmo critério da barra global: o cliente "aparece" no período se iniciou,
 *  encerrou, avisou ou esteve ativo dentro do intervalo. */
const dentroDoPeriodo = (r: GestaoCliente, ini: string, fim: string) => {
  const inicioRow = ymOf(r.data_inicio_ref) ?? ymOf(r.data_inicio);
  const fimRow = ymOf(r.data_fim_ref);
  const avisoRow = ymOf(r.data_aviso_previo_ref) ?? ymOf(r.data_aviso_previo);
  if (inicioRow && inicioRow >= ini && inicioRow <= fim) return true;
  if (fimRow && fimRow >= ini && fimRow <= fim) return true;
  if (avisoRow && avisoRow >= ini && avisoRow <= fim) return true;
  if (isAtivo(r) && (!inicioRow || inicioRow <= fim) && (!fimRow || fimRow >= ini)) return true;
  return false;
};

const inicializarMes = (v: string, fallback: string) => (v && v !== "todos" ? v : fallback);

export function GestaoInsightsSquads({
  rows,
  inicioGlobal,
  fimGlobal,
  pessoasAtivas,
}: {
  rows: GestaoCliente[];
  /** Período da barra global no carregamento — valor inicial e destino do "Limpar". */
  inicioGlobal: string;
  fimGlobal: string;
  /**
   * Pessoas com Status = Ativo na aba `Cadastro e Configuracoes`.
   * Quando presente, o recorte "Por Colaborador" lista apenas essas pessoas.
   * Null/ausente => comportamento antigo (nomes distintos do DB).
   */
  pessoasAtivas?: string[] | null;
}) {
  const [agrupKey, setAgrupKey] = React.useState<AgrupKey>("lider_revops");
  const [statusFiltro, setStatusFiltro] = React.useState("todos");
  const [crmFiltro, setCrmFiltro] = React.useState("todos");
  const [fonteFiltro, setFonteFiltro] = React.useState("todos");
  const [sort, setSort] = React.useState<SortState>({ key: "mrr_total", dir: "desc" });
  // Período PRÓPRIO da seção: nasce igual ao global e depois é independente.
  const [eqInicio, setEqInicio] = React.useState(() =>
    inicializarMes(inicioGlobal, MESES_SECAO[0]!)
  );
  const [eqFim, setEqFim] = React.useState(() =>
    inicializarMes(fimGlobal, MESES_SECAO[MESES_SECAO.length - 1]!)
  );

  const eqIni = eqInicio <= eqFim ? eqInicio : eqFim;
  const eqFimN = eqInicio <= eqFim ? eqFim : eqInicio;

  const handleEqInicio = (v: string) => {
    setEqInicio(v);
    if (v > eqFim) setEqFim(v);
  };
  const handleEqFim = (v: string) => {
    setEqFim(v);
    if (v < eqInicio) setEqInicio(v);
  };

  const resetFiltros = () => {
    setAgrupKey("lider_revops");
    setStatusFiltro("todos");
    setCrmFiltro("todos");
    setFonteFiltro("todos");
    setSort({ key: "mrr_total", dir: "desc" });
    setEqInicio(inicializarMes(inicioGlobal, MESES_SECAO[0]!));
    setEqFim(inicializarMes(fimGlobal, MESES_SECAO[MESES_SECAO.length - 1]!));
  };

  const toggleSort = (key: OrdemKey) => {
    setSort((prev) => {
      if (prev?.key === key) {
        return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      }
      return { key, dir: "desc" };
    });
  };

  const SortIcon = ({ col }: { col: OrdemKey }) => {
    if (sort?.key !== col) return <span className="inline-block w-3 text-muted-foreground/40">↕</span>;
    return <span className="inline-block w-3 text-primary">{sort.dir === "asc" ? "↑" : "↓"}</span>;
  };


  // CRMs únicos presentes na base.
  const crms = React.useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      const v = (r.tipo_crm ?? "").trim();
      if (v && v !== "-") set.add(v);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [rows]);
  const fontes = React.useMemo(
    () => Array.from(new Set(rows.map((r) => r.fonte_trafego).filter((v): v is string => !!v))).sort(),
    [rows]
  );

  const agrup = AGRUPAMENTOS.find((a) => a.value === agrupKey) ?? AGRUPAMENTOS[0]!;

  /** Base filtrada pelos filtros da seção (status/CRM/fonte), SEM recorte de data
   *  e SEM o agrupamento — é a base dos 4 gráficos de evolução. */
  const rowsGraficos = React.useMemo(
    () =>
      rows
        .filter((r) => {
          // Status deriva da regra única de datas no último mês do período da seção.
          if (statusFiltro === "ativos") return ativoNoMes(r, eqFimN);
          if (statusFiltro === "inativos") return !ativoNoMes(r, eqFimN);
          return true;
        })
        .filter((r) => {
          if (crmFiltro !== "todos") {
            const v = (r.tipo_crm ?? "").trim();
            if (crmFiltro === "nao-possui") {
              if (v && v !== "-") return false;
            } else if (!v || v === "-" || v !== crmFiltro) {
              return false;
            }
          }
          if (fonteFiltro !== "todos" && r.fonte_trafego !== fonteFiltro) return false;
          return true;
        }),
    [rows, statusFiltro, crmFiltro, fonteFiltro, eqFimN]
  );

  /** Todos os clientes do recorte de período (sem agrupamento) — base da linha TOTAL / MÉDIA. */
  const basePeriodo = React.useMemo(
    () => rowsGraficos.filter((r) => dentroDoPeriodo(r, eqIni, eqFimN)),
    [rowsGraficos, eqIni, eqFimN]
  );

  /**
   * Lista de pessoas de cada gráfico de evolução, por recorte.
   * Deriva da MESMA base da tabela de ranking (`basePeriodo`) com a mesma regra de
   * agrupamento, para que gráfico e tabela nunca divirjam — sem corte de top-N.
   * "Sem definição" (nome vazio) fica de fora dos gráficos.
   */
  const rostersGraficos = React.useMemo(() => {
    const out = {} as Record<(typeof PAPEIS_GRAFICOS)[number], string[]>;
    for (const key of PAPEIS_GRAFICOS) {
      const nomes = new Set<string>();
      for (const r of basePeriodo) {
        const nome = ((r[key] as string | null) ?? "").trim();
        if (!nome) continue; // "Sem definição" não entra nos gráficos
        nomes.add(nome);
      }
      out[key] = Array.from(nomes);
    }
    return out;
  }, [basePeriodo]);

  const grupos = React.useMemo<Grupo[]>(() => {
    const base = basePeriodo;

    // Recorte "Por Colaborador": com o cadastro carregado, só entram pessoas
    // com Status = Ativo (comparação normalizada por nome).
    const ativasSet =
      agrupKey === "colaborador" && pessoasAtivas?.length
        ? new Set(pessoasAtivas.map((n) => normalizarNome(n)))
        : null;

    const mapa = new Map<string, GestaoCliente[]>();
    const push = (nome: string, r: GestaoCliente) => {
      const arr = mapa.get(nome);
      if (arr) arr.push(r);
      else mapa.set(nome, [r]);
    };
    if (agrupKey === "colaborador") {
      for (const r of base)
        for (const p of PAPEIS) {
          const nome = ((r[p.key] as string | null) ?? "").trim() || "Sem definição";
          if (ativasSet && !ativasSet.has(normalizarNome(nome))) continue;
          push(nome, r);
        }
    } else {
      for (const r of base) {
        const nome = ((r[agrupKey] as string | null) ?? "").trim() || "Sem definição";
        push(nome, r);
      }
    }

    const lista: Grupo[] = Array.from(mapa.entries()).map(([nome, itens]) => {
      // Regra única de datas no último mês do período (mesma dos KPIs/tabela mensal).
      const ativos = itens.filter((r) => ativoNoMes(r, eqFimN));
      const cancelados = itens.filter((r) => !ativoNoMes(r, eqFimN));
      const aviso = ativos.filter(temAviso);
      // MRRs vêm da matriz "MRR Calculado" do mês de referência (via mrrEngine).
      const mrrTotal = itens.reduce((s, r) => s + mrrValidoNoMes(r, eqFimN), 0);
      const mrrTotalBruto = itens.reduce((s, r) => s + mrrClienteNoMes(r, eqFimN), 0);
      const topCliente = itens.reduce<GestaoCliente | null>(
        (best, r) => (num(r.mrr_atual) > num(best?.mrr_atual) ? r : best),
        null
      );
      // NRR = (MRR início + expansão − contração − churn) / MRR início.
      // MRR início = soma do MRR contratado (nMRR) de todos os clientes do grupo.
      // MRR final = MRR do mês apenas dos clientes ativos (cancelados = churn).
      const mrrInicio = itens.reduce((s, r) => s + num(r.nmrr), 0);
      const mrrFinal = ativos.reduce((s, r) => s + mrrClienteNoMes(r, eqFimN), 0);
      return {
        nome,
        clientes: itens.length,
        ativos: ativos.length,
        aviso: aviso.length,
        cancelados: cancelados.length,
        mrr_total: mrrTotal,
        mrr_total_bruto: mrrTotalBruto,
        mrr_medio: itens.length ? mrrTotal / itens.length : 0,
        nmrr_total: itens.reduce((s, r) => s + num(r.nmrr), 0),
        // Clientes sem "Fim Planejado" têm LTV/CLT previsto inexistente na planilha
        // (vêm null do parser) e valores inválidos (negativo/vazio) são erro de dado:
        // todos ficam fora apenas destas médias, com sinalização na célula.
        ...((): Pick<
          Grupo,
          | "ltv_medio"
          | "ltv_previsto_medio"
          | "clt_medio"
          | "clt_previsto_medio"
          | "ltv_excluidos"
          | "ltv_previsto_excluidos"
          | "clt_excluidos"
          | "clt_previsto_excluidos"
          | "clt_detalhes"
          | "clt_previsto_detalhes"
        > => {
          const ltv = mediaValida(itens, "ltv_real");
          const ltvPrev = mediaValida(itens, "ltv_previsto");
          const clt = mediaValida(itens, "clt_atual");
          const cltPrev = mediaValida(itens, "clt_previsto");
          for (const [campo, r] of [
            ["LTV", ltv],
            ["LTV Previsto", ltvPrev],
            ["CLT", clt],
            ["CLT Previsto", cltPrev],
          ] as const) {
            if (r.excluidos.length)
              console.warn(
                `[Insights Equipes] ${campo} inválido excluído da média de "${nome}":`,
                r.detalhes.map((d) => `${d.nome} (valor: ${d.valor})`)
              );
          }
          return {
            ltv_medio: ltv.media,
            ltv_previsto_medio: ltvPrev.media,
            clt_medio: clt.media,
            clt_previsto_medio: cltPrev.media,
            ltv_excluidos: ltv.excluidos,
            ltv_previsto_excluidos: ltvPrev.excluidos,
            clt_excluidos: clt.excluidos,
            clt_previsto_excluidos: cltPrev.excluidos,
            clt_detalhes: clt.detalhes,
            clt_previsto_detalhes: cltPrev.detalhes,
          };
        })(),

        retencao: itens.length ? ativos.length / itens.length : 0,
        nrr: mrrInicio > 0 ? mrrFinal / mrrInicio : 0,
        topCliente,
      };
    });

    if (sort) {
      const k = sort.key;
      lista.sort((a, b) => {
        const av = num(a[k]);
        const bv = num(b[k]);
        return sort.dir === "asc" ? av - bv : bv - av;
      });
    }
    return lista;
  }, [basePeriodo, agrupKey, sort, eqFimN, pessoasAtivas]);

  /**
   * Linha de fechamento "TOTAL / MÉDIA" — cada coluna com sua regra:
   * - Clientes, MRR Válido e MRR Ativo: SOMA das equipes (bate com os chips do cabeçalho).
   * - LTV Real, LTV Previsto e CLT Previsto: recalculados sobre TODOS os clientes do
   *   recorte de uma vez (equivale à média ponderada pelo nº de clientes).
   * - CLT Médio: recalculado sobre todos os clientes com o mesmo método das linhas —
   *   nunca derivado das linhas (não é somável nem ponderável).
   * Valores inválidos ficam fora das médias com o mesmo aviso das linhas de equipe.
   */
  const totais = React.useMemo(() => {
    const ltv = mediaValida(basePeriodo, "ltv_real");
    const ltvPrev = mediaValida(basePeriodo, "ltv_previsto");
    const clt = mediaValida(basePeriodo, "clt_atual");
    const cltPrev = mediaValida(basePeriodo, "clt_previsto");
    return {
      clientes: grupos.reduce((s, g) => s + g.clientes, 0),
      mrr_total: grupos.reduce((s, g) => s + g.mrr_total, 0),
      mrr_total_bruto: grupos.reduce((s, g) => s + g.mrr_total_bruto, 0),
      ltv_medio: ltv.media,
      ltv_excluidos: ltv.excluidos,
      ltv_previsto_medio: ltvPrev.media,
      ltv_previsto_excluidos: ltvPrev.excluidos,
      clt_medio: clt.media,
      clt_excluidos: clt.excluidos,
      clt_previsto_medio: cltPrev.media,
      clt_previsto_excluidos: cltPrev.excluidos,
    };
  }, [grupos, basePeriodo]);

  const destaques = React.useMemo(() => {
    const by = (k: OrdemKey) =>
      grupos.reduce<Grupo | null>((best, g) => (!best || num(g[k]) > num(best[k]) ? g : best), null);
    const melhorNrr = grupos.reduce<Grupo | null>(
      (best, g) => (!best || g.nrr > best.nrr ? g : best),
      null
    );
    const nrrInicio = grupos.reduce((s, g) => s + g.nmrr_total, 0);
    const nrrGeral = nrrInicio > 0
      ? grupos.reduce((s, g) => s + g.nrr * g.nmrr_total, 0) / nrrInicio
      : 0;
    return {
      maisClientes: by("clientes"),
      maiorMrr: by("mrr_total"),
      maiorTicket: by("mrr_medio"),
      melhorNrr,
      nrrGeral,
      totalMrr: grupos.reduce((s, g) => s + g.mrr_total, 0),
      totalMrrBruto: grupos.reduce((s, g) => s + g.mrr_total_bruto, 0),
      totalClientes: grupos.reduce((s, g) => s + g.clientes, 0),
    };
  }, [grupos]);

  const maxMrr = grupos.reduce((m, g) => Math.max(m, g.mrr_total), 0) || 1;

  return (
    <div className="neu-card space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Users className="h-5 w-5 text-primary" />
        <h3 className="text-base font-semibold text-foreground">Insights Equipes</h3>
        <span className="neu-inset rounded-full px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
          {grupos.length} {agrup.titulo.toLowerCase()}
          {grupos.length === 1 ? "" : "s"}
        </span>
        <span className="neu-inset rounded-full px-2 py-0.5 text-[11px] font-semibold text-primary">
          MRR Válido: {brl(destaques.totalMrr)}
        </span>
        <span className="neu-inset rounded-full px-2 py-0.5 text-[11px] font-semibold text-primary">
          MRR Ativo: {brl(destaques.totalMrrBruto)}
        </span>
        <span className="neu-inset rounded-full px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
          {destaques.totalClientes} clientes
        </span>
      </div>

      <div className="flex flex-nowrap items-end gap-2 overflow-x-auto pb-1">
        <div className="shrink-0">
          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
            Mês de Início
          </label>
          <SearchableSelect
            value={eqInicio}
            onValueChange={handleEqInicio}
            options={OPCOES_MES_SECAO.filter((o) => o.value <= eqFim)}
            allOption={null}
            placeholder="Mês de Início"
            triggerClassName="h-8 text-[11px]"
          />
        </div>
        <div className="shrink-0">
          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
            Mês de Fim
          </label>
          <SearchableSelect
            value={eqFim}
            onValueChange={handleEqFim}
            options={OPCOES_MES_SECAO.filter((o) => o.value >= eqInicio)}
            allOption={null}
            placeholder="Mês de Fim"
            triggerClassName="h-8 text-[11px]"
          />
        </div>
        <span
          className="shrink-0 pb-2 text-[10px] italic text-muted-foreground/70"
          title="Este período vale apenas para o Insights Equipes e é independente da barra de filtros global."
        >
          Período próprio desta seção
        </span>
        <div className="mx-1 h-8 w-px shrink-0 self-center bg-border/60" aria-hidden="true" />
        <SearchableSelect
          value={agrupKey}
          onValueChange={(v) => setAgrupKey(v as AgrupKey)}
          options={AGRUPAMENTOS.map((a) => ({ value: a.value, label: a.label }))}
          allOption={null}
          placeholder="Agrupar Por"
          triggerClassName="h-8 text-[11px]"
        />
        <SearchableSelect
          value={statusFiltro}
          onValueChange={setStatusFiltro}
          options={[
            { value: "ativos", label: "Ativos" },
            { value: "inativos", label: "Inativos" },
          ]}
          allOption={{ value: "todos", label: "Todos os Status" }}
          placeholder="Status"
          triggerClassName="h-8 text-[11px]"
        />
        <SearchableSelect
          value={crmFiltro}
          onValueChange={setCrmFiltro}
          options={[
            ...crms.map((v) => ({ value: v, label: titleCase(v) })),
            { value: "nao-possui", label: "Não Possui" },
          ]}
          allOption={{ value: "todos", label: "Todos os CRM" }}
          placeholder="CRM"
          triggerClassName="h-8 text-[11px]"
        />
        <SearchableSelect
          value={fonteFiltro}
          onValueChange={setFonteFiltro}
          options={fontes.map((v) => ({ value: v, label: titleCase(v) }))}
          allOption={{ value: "todos", label: "Todas as Fontes" }}
          placeholder="Fonte"
          triggerClassName="h-8 text-[11px]"
        />
        <div className="h-8 w-px shrink-0 bg-border/60" aria-hidden="true" />
        <Button
          variant="ghost"
          onClick={resetFiltros}
          className="neu-button h-8 shrink-0 gap-1.5 px-3 text-[11px]"
          title="Limpar filtros das equipes"
        >
          <X className="h-3.5 w-3.5" />
          Limpar
        </Button>
      </div>

      

      {grupos.length === 0 ? (
        <div className="neu-inset rounded-lg px-4 py-10 text-center text-sm text-muted-foreground">
          Nenhum dado disponível para este agrupamento.
        </div>
      ) : (
        <div className="neu-inset overflow-hidden rounded-xl">
          <div className="insights-scroll max-h-[560px] overflow-auto">
            <table className="w-full text-left text-[11px]">
              <thead className="sticky top-0 z-10 bg-background">
                <tr className="border-b border-border/40">
                  <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-muted-foreground">
                    Rank
                  </th>
                  <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-muted-foreground">
                    {agrup.titulo}
                  </th>
                  <th
                    onClick={() => toggleSort("clientes")}
                    className="cursor-pointer px-3 py-2.5 text-right font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                  >
                    <span className="inline-flex items-center justify-end gap-1">
                      {statusFiltro === "ativos"
                        ? "Clientes Ativos"
                        : statusFiltro === "inativos"
                          ? "Clientes Inativos"
                          : "Clientes"}
                      <SortIcon col="clientes" />
                    </span>
                  </th>
                  <th
                    onClick={() => toggleSort("mrr_total")}
                    className="cursor-pointer px-3 py-2.5 text-right font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                  >
                    <span className="inline-flex items-center justify-end gap-1">
                      MRR Válido
                      <SortIcon col="mrr_total" />
                    </span>
                  </th>
                  <th
                    onClick={() => toggleSort("mrr_total_bruto")}
                    className="cursor-pointer px-3 py-2.5 text-right font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                  >
                    <span className="inline-flex items-center justify-end gap-1">
                      MRR ATIVO
                      <SortIcon col="mrr_total_bruto" />
                    </span>
                  </th>
                  <th
                    onClick={() => toggleSort("ltv_medio")}
                    className="cursor-pointer px-3 py-2.5 text-right font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                  >
                    <span className="inline-flex items-center justify-end gap-1">
                      LTV REAL
                      <SortIcon col="ltv_medio" />
                    </span>
                  </th>
                  <th
                    onClick={() => toggleSort("ltv_previsto_medio")}
                    className="cursor-pointer px-3 py-2.5 text-right font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                  >
                    <span className="inline-flex items-center justify-end gap-1">
                      LTV Previsto
                      <SortIcon col="ltv_previsto_medio" />
                    </span>
                  </th>
                  <th
                    onClick={() => toggleSort("clt_medio")}
                    className="cursor-pointer px-3 py-2.5 text-right font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                  >
                    <span className="inline-flex items-center justify-end gap-1">
                      CLT MÉDIO
                      <SortIcon col="clt_medio" />
                    </span>
                  </th>
                  <th
                    onClick={() => toggleSort("clt_previsto_medio")}
                    className="cursor-pointer px-3 py-2.5 text-right font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                  >
                    <span className="inline-flex items-center justify-end gap-1">
                      CLT PREVISTO
                      <SortIcon col="clt_previsto_medio" />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {grupos.map((g, i) => (
                  <tr key={g.nome} className="transition-colors hover:bg-primary/[0.03]">
                    <td className="px-3 py-2 font-semibold tabular-nums text-primary">{i + 1}.</td>
                    <td className="px-3 py-2 font-medium text-foreground">
                      <span className="block max-w-[200px] truncate" title={g.nome}>
                        {g.nome}
                      </span>
                      <span
                        className="mt-1 block h-1 rounded-full bg-primary/60"
                        style={{ width: `${Math.max(6, (g.mrr_total / maxMrr) * 100)}%` }}
                        aria-hidden="true"
                      />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">{g.clientes}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-foreground">
                      {brl(g.mrr_total)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-foreground">
                      {brl(g.mrr_total_bruto)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">
                      <span className="inline-flex items-center justify-end gap-1">
                        {brl(g.ltv_medio)}
                        {g.ltv_excluidos.length > 0 && (
                          <span
                            className="inline-flex cursor-help items-center text-amber-500"
                            title={`${g.ltv_excluidos.length} cliente(s) excluído(s) da média por dado inválido na planilha:\n${g.ltv_excluidos.join("\n")}`}
                          >
                            <AlertTriangle className="h-3.5 w-3.5" />
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">
                      <span className="inline-flex items-center justify-end gap-1">
                        {brl(g.ltv_previsto_medio)}
                        {g.ltv_previsto_excluidos.length > 0 && (
                          <span
                            className="inline-flex cursor-help items-center text-amber-500"
                            title={`${g.ltv_previsto_excluidos.length} cliente(s) excluído(s) da média por dado inválido na planilha:\n${g.ltv_previsto_excluidos.join("\n")}`}
                          >
                            <AlertTriangle className="h-3.5 w-3.5" />
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-primary">
                      <span className="inline-flex items-center justify-end gap-1">
                        {g.clt_medio === null ? "—" : meses(g.clt_medio)}
                        {g.clt_excluidos.length > 0 && (
                          <TooltipProvider delayDuration={0}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex cursor-help items-center text-amber-500">
                                  <AlertTriangle className="h-3.5 w-3.5" />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top" align="end" className="max-w-[260px]">
                                <div className="mb-2 border-b border-border/60 pb-1.5 text-[11px] font-bold text-foreground">
                                  {g.clt_excluidos.length} cliente{g.clt_excluidos.length === 1 ? "" : "s"} excluído{g.clt_excluidos.length === 1 ? "" : "s"} da média
                                </div>
                                <div className="space-y-1">
                                  {g.clt_detalhes.map((d) => {
                                    const valor =
                                      d.valor === null || d.valor === undefined
                                        ? "vazio"
                                        : Number.isFinite(d.valor)
                                          ? d.valor.toLocaleString("pt-BR")
                                          : String(d.valor);
                                    return (
                                      <div key={d.nome} className="flex items-center justify-between gap-4 text-[10px]">
                                        <span className="max-w-[150px] truncate text-muted-foreground" title={d.nome}>
                                          {d.nome}
                                        </span>
                                        <span className="shrink-0 font-semibold tabular-nums text-foreground">{valor}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-primary">
                      <span className="inline-flex items-center justify-end gap-1">
                        {g.clt_previsto_medio === null ? "—" : meses(g.clt_previsto_medio)}
                        {g.clt_previsto_excluidos.length > 0 && (
                          <TooltipProvider delayDuration={0}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex cursor-help items-center text-amber-500">
                                  <AlertTriangle className="h-3.5 w-3.5" />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top" align="end" className="max-w-[260px]">
                                <div className="mb-2 border-b border-border/60 pb-1.5 text-[11px] font-bold text-foreground">
                                  {g.clt_previsto_excluidos.length} cliente{g.clt_previsto_excluidos.length === 1 ? "" : "s"} excluído{g.clt_previsto_excluidos.length === 1 ? "" : "s"} da média
                                </div>
                                <div className="space-y-1">
                                  {g.clt_previsto_detalhes.map((d) => {
                                    const valor =
                                      d.valor === null || d.valor === undefined
                                        ? "vazio"
                                        : Number.isFinite(d.valor)
                                          ? d.valor.toLocaleString("pt-BR")
                                          : String(d.valor);
                                    return (
                                      <div key={d.nome} className="flex items-center justify-between gap-4 text-[10px]">
                                        <span className="max-w-[150px] truncate text-muted-foreground" title={d.nome}>
                                          {d.nome}
                                        </span>
                                        <span className="shrink-0 font-semibold tabular-nums text-foreground">{valor}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="sticky bottom-0 z-10 bg-background">
                <tr className="border-t-2 border-border/70 bg-primary/[0.04] font-semibold">
                  <td className="px-3 py-2.5" aria-hidden="true" />
                  <td className="px-3 py-2.5 text-foreground">
                    <span
                      className="cursor-help"
                      title="Volume somado; LTV e CLT Previsto em média ponderada por cliente; CLT Médio recalculado sobre todos os clientes."
                    >
                      TOTAL / MÉDIA
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
                    {totais.clientes}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
                    {brl(totais.mrr_total)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
                    {brl(totais.mrr_total_bruto)}
                  </td>
                  {(
                    [
                      {
                        valor: brl(totais.ltv_medio),
                        excluidos: totais.ltv_excluidos,
                        marca: "Média ponderada por cliente",
                      },
                      {
                        valor: brl(totais.ltv_previsto_medio),
                        excluidos: totais.ltv_previsto_excluidos,
                        marca: "Média ponderada por cliente",
                      },
                      {
                        valor: totais.clt_medio === null ? "—" : meses(totais.clt_medio),
                        excluidos: totais.clt_excluidos,
                        marca: "Recalculado sobre todos os clientes do recorte",
                      },
                      {
                        valor:
                          totais.clt_previsto_medio === null ? "—" : meses(totais.clt_previsto_medio),
                        excluidos: totais.clt_previsto_excluidos,
                        marca: "Média ponderada por cliente",
                      },
                    ] as const
                  ).map((c, i) => (
                    <td key={i} className="px-3 py-2.5 text-right tabular-nums text-foreground">
                      <span className="inline-flex items-center justify-end gap-1">
                        <span
                          className="cursor-help text-[9px] text-muted-foreground/60"
                          title={c.marca}
                          aria-label={c.marca}
                        >
                          ≈
                        </span>
                        {c.valor}
                        {c.excluidos.length > 0 && (
                          <span
                            className="inline-flex cursor-help items-center text-amber-500"
                            title={`${c.excluidos.length} cliente(s) excluído(s) da média por dado inválido na planilha:\n${c.excluidos.join("\n")}`}
                          >
                            <AlertTriangle className="h-3.5 w-3.5" />
                          </span>
                        )}
                      </span>
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      <GestaoEvolucaoMrrEquipes
        rows={rowsGraficos}
        inicio={eqIni}
        fim={eqFimN}
        rosters={rostersGraficos}
      />
    </div>
  );
}
