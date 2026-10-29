import * as React from "react";
import {
  UserCheck,
  DollarSign,
  Receipt,
  TrendingUp,
  Gem,
  Percent,
  UserPlus,
  AlertTriangle,
  XCircle,
  TrendingDown,
  Users,
} from "lucide-react";
import { MetricCard } from "./MetricCard";
import type { GestaoCliente, SerieMrrOficial } from "@/hooks/useGestaoData";
import { mrrClienteNoMes, mrrTotalNoMes, ticketMedioNoMes } from "./mrrEngine";
import { cltNoMes, intervaloBI, mesLabel } from "./useGestaoBI";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";


const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
const pct = (v: number) => `${v.toFixed(2).replace(".", ",")}%`;


const nums = (rows: GestaoCliente[], key: keyof GestaoCliente) =>
  rows.map((r) => r[key]).filter((v): v is number => typeof v === "number");
/** Válido para médias: número finito e não negativo (regra da spec de escopos). */
const okNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;
/** Diferença entre duas datas em meses (dias / 30), como na planilha. */
const diffMeses = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / (30 * 864e5);
const mediaOuNull = (l: number[]) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : null);
const brlN = (v: number | null) => (v === null ? "—" : brl(v));
const mesesN = (v: number | null) => (v === null ? "—" : `${v.toFixed(2).replace(".", ",")} meses`);
const mesesDecN = (v: number | null) => (v === null ? "—" : `${v.toFixed(2).replace(".", ",")} meses`);

/** Quatro médias de um indicador (LTV ou CLT), por escopo de contrato. */
type EscopoValores = {
  realIni: number | null;
  prevIni: number | null;
  realVig: number | null;
  prevVig: number | null;
  /** Clientes ativos fora de ao menos uma das quatro médias. */
  excluidos: number;
};

/**
 * Card de LTV/CLT com os dois escopos (contrato inicial x vigente).
 * Número principal = Real do contrato vigente; abaixo, grade 2x2 com os
 * quatro valores rotulados. Nenhuma comparação cruza escopos.
 */
function EscopoCard({
  titulo,
  icon: Icon,
  loading,
  escopo,
  fmt,
  fmtPrincipal,
  fmtHover,
  description,
  principal,
  realUnico,
}: {
  titulo: string;
  icon: React.ComponentType<{ className?: string }>;
  loading?: boolean | undefined;
  escopo: EscopoValores;
  /** Formato da grade 2x2. */
  fmt: (v: number | null) => string;
  /** Formato do número principal (Real do vigente). */
  fmtPrincipal: (v: number | null) => string;
  /** Formato do hover do número principal (opcional). */
  fmtHover?: ((v: number | null) => string) | undefined;
  description?: string | undefined;
  /** Valor principal alternativo. Quando omitido, usa escopo.realVig. */
  principal?: number | null;
  /** Real único (coorte), centralizado entre Inicial e Vigente — card CLT. */
  realUnico?: number | null;
}) {
  if (loading) {
    return (
      <div className="neu-card p-5 flex items-center justify-between">
        <div className="flex-1 space-y-2">
          <div className="skeleton-loading h-3 w-24 rounded" />
          <div className="skeleton-loading h-6 w-32 rounded" />
          <div className="skeleton-loading h-3 w-20 rounded" />
        </div>
        <div className="skeleton-loading h-10 w-10 rounded-full" />
      </div>
    );
  }
  const valorPrincipal = principal !== undefined ? principal : escopo.realVig;
  return (
    <div className="neu-card p-5 flex items-start justify-between gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-semibold tracking-wider text-muted-foreground">{titulo}</p>
        {fmtHover ? (
          <p className="mt-1">
            <TooltipProvider delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-block text-xl font-bold cursor-help text-foreground leading-tight">
                    {fmtPrincipal(valorPrincipal)}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[220px]">
                  {fmtHover(valorPrincipal)}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </p>
        ) : (
          <p className="mt-1 text-xl font-bold text-foreground leading-tight">{fmtPrincipal(valorPrincipal)}</p>
        )}
        <div className="mt-2 grid grid-cols-[auto_1fr_1fr] items-center gap-x-3 gap-y-0.5 text-[10px]">
          <span className="col-start-1 row-start-1" />
          <span className="col-start-2 row-start-1 text-right font-semibold text-muted-foreground">Real</span>
          <span className="col-start-3 row-start-1 text-right font-semibold text-muted-foreground">
            Previsto
          </span>

          <span className="col-start-1 row-start-2 text-muted-foreground">Inicial</span>
          <span className="col-start-1 row-start-3 text-muted-foreground">Vigente</span>

          {realUnico !== undefined ? (
            <span className="col-start-2 row-start-2 row-span-2 self-center text-right font-medium text-foreground">
              {fmt(realUnico)}
            </span>
          ) : (
            <>
              <span className="col-start-2 row-start-2 text-right font-medium text-foreground">
                {fmt(escopo.realIni)}
              </span>
              <span className="col-start-2 row-start-3 text-right font-medium text-foreground">
                {fmt(escopo.realVig)}
              </span>
            </>
          )}

          <span className="col-start-3 row-start-2 text-right text-muted-foreground">
            {fmt(escopo.prevIni)}
          </span>
          <span className="col-start-3 row-start-3 text-right text-muted-foreground">
            {fmt(escopo.prevVig)}
          </span>
        </div>
        {escopo.excluidos > 0 && (
          <p className="mt-1 text-[10px] text-muted-foreground/80">
            {escopo.excluidos} {escopo.excluidos === 1 ? "cliente fora" : "clientes fora"} das
            médias (dado inválido ou sem ID)
          </p>
        )}
        {description && (
          <p className="mt-0.5 text-[10px] text-muted-foreground/80">{description}</p>
        )}
      </div>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full neu-inset text-primary">
        <Icon className="h-5 w-5" />
      </div>
    </div>
  );
}
/** Lista de meses (yyyy-MM) entre dois limites, inclusive. */
export const mesesEntre = (de: string, ate: string) => {
  const out: string[] = [];
  const [ay, am] = de.split("-").map(Number) as [number, number];
  const [by, bm] = ate.split("-").map(Number) as [number, number];
  for (let y = ay, m = am; y < by || (y === by && m <= bm); m === 12 ? ((y += 1), (m = 1)) : (m += 1))
    out.push(`${y}-${String(m).padStart(2, "0")}`);
  return out;
};

export const isAtivo = (r: GestaoCliente) => (r.status ?? "").toUpperCase() === "ATIVO";
const ymOf = (d: string | null | undefined) => (d ? d.slice(0, 7) : null);
const inicioDe = (r: GestaoCliente) => ymOf(r.data_inicio_ref) ?? ymOf(r.data_inicio);
/** Mesma regra da tabela "Indicadores mês a mês": fim = Data de Fim - Ref Mês, sem olhar status. */
const fimDe = (r: GestaoCliente) => ymOf(r.data_fim_ref);
const avisoDe = (r: GestaoCliente) => ymOf(r.data_aviso_previo_ref) ?? ymOf(r.data_aviso_previo);

/** Ativo no mês (regra de datas, igual à tabela "Indicadores mês a mês"). */
export const ativoNoMes = (r: GestaoCliente, m: string) => {
  const i = inicioDe(r);
  if (!i || i > m) return false;
  const f = fimDe(r);
  return !f || f >= m;
};

export function GestaoKPIs({
  rows,
  rowsCLT,
  loading,
  inicio = null,
  fim = null,
  mrrOficial = null,
}: {
  rows: GestaoCliente[];
  /** Base histórica completa para cálculos de CLT por coorte. */
  rowsCLT?: GestaoCliente[] | null | undefined;
  loading?: boolean | undefined;
  inicio?: string | null | undefined;
  fim?: string | null | undefined;
  mrrOficial?: SerieMrrOficial | null | undefined;
}) {
  const k = React.useMemo(() => {
    const temIntervalo = !!inicio && !!fim;
    const noIntervalo = (m: string | null) =>
      !!m && (!temIntervalo || (m >= (inicio as string) && m <= (fim as string)));

    // Mesma regra da tabela "Indicadores mês a mês", aplicada ao último mês do período.
    const janela = intervaloBI(rows, inicio, fim);
    const mesRef = janela.fim;
    const ativos = rows.filter((r) => ativoNoMes(r, mesRef));
    // "Na base" = quem esteve ativo em algum mês do período.
    const mesesJanela = mesesEntre(janela.inicio, janela.fim);
    const naBase = rows.filter((r) => mesesJanela.some((m) => ativoNoMes(r, m)));

    const novos = rows.filter((r) => noIntervalo(inicioDe(r)));
    const cancelados = rows.filter((r) => noIntervalo(fimDe(r)));
    const avisos = rows.filter((r) => noIntervalo(avisoDe(r)));

    const mrrAtivo = mrrOficial?.[mesRef]?.mrr ?? mrrTotalNoMes(rows, mesRef);
    const nmrrNovos = nums(novos, "nmrr").reduce((a, b) => a + b, 0);
    const mrrPerdido = nums(cancelados, "mrr_atual").reduce((a, b) => a + b, 0);
    // LTV/CLT por escopo (contrato inicial x vigente) — médias sobre os ativos
    // do mês de referência. Inválidos (negativo, vazio, não numérico) ficam
    // fora das médias; o escopo vigente depende da "Data de Fim - Tratada",
    // casada pelo ID do Clickup — cliente sem ID fica fora dessas médias.
    const hoje = new Date().toISOString().slice(0, 10);
    const listas = {
      ltvRealIni: [] as number[], ltvPrevIni: [] as number[],
      ltvRealVig: [] as number[], ltvPrevVig: [] as number[],
      cltRealIni: [] as number[], cltPrevIni: [] as number[],
      cltRealVig: [] as number[], cltPrevVig: [] as number[],
    };
    const exclLtv = new Set<string>();
    const exclClt = new Set<string>();
    for (const r of ativos) {
      const iniVig = r.inicio_tratada ?? r.data_inicio_ref ?? r.data_inicio;
      const fimVig = r.fim_tratada ?? null;
      // CLT
      if (okNum(r.clt_previsto)) listas.cltPrevIni.push(r.clt_previsto);
      else exclClt.add(r.cliente);
      const cltPrevVig = r.id_clickup && iniVig && fimVig ? diffMeses(iniVig, fimVig) : null;
      if (okNum(cltPrevVig)) listas.cltPrevVig.push(cltPrevVig);
      else exclClt.add(r.cliente);
      if (okNum(r.clt_atual)) listas.cltRealVig.push(r.clt_atual);
      else exclClt.add(r.cliente);
      const cltRealIni =
        okNum(r.clt_atual) && okNum(r.clt_previsto)
          ? Math.min(r.clt_atual, r.clt_previsto)
          : null;
      if (okNum(cltRealIni)) listas.cltRealIni.push(cltRealIni);
      else exclClt.add(r.cliente);
      // LTV
      if (okNum(r.ltv_previsto)) listas.ltvPrevIni.push(r.ltv_previsto);
      else exclLtv.add(r.cliente);
      if (okNum(r.ltv_real)) listas.ltvRealVig.push(r.ltv_real);
      else exclLtv.add(r.cliente);
      const ltvPrevVig =
        r.id_clickup && okNum(r.ltv_real) && okNum(r.mrr_atual) && fimVig
          ? r.ltv_real + r.mrr_atual * Math.max(0, diffMeses(hoje, fimVig))
          : null;
      if (okNum(ltvPrevVig)) listas.ltvPrevVig.push(ltvPrevVig);
      else exclLtv.add(r.cliente);
      const iniMes = ymOf(iniVig);
      const limiteIni =
        [ymOf(r.fim_planejado), ymOf(r.data_fim_ref)]
          .filter((x): x is string => !!x)
          .sort()[0] ?? null;
      if (r.mrr_mensal && iniMes && limiteIni) {
        let soma = 0;
        for (const [m, v] of Object.entries(r.mrr_mensal))
          if (m >= iniMes && m <= limiteIni && okNum(v)) soma += v;
        listas.ltvRealIni.push(soma);
      } else exclLtv.add(r.cliente);
    }
    const ltvEscopo: EscopoValores = {
      realIni: mediaOuNull(listas.ltvRealIni),
      prevIni: mediaOuNull(listas.ltvPrevIni),
      realVig: mediaOuNull(listas.ltvRealVig),
      prevVig: mediaOuNull(listas.ltvPrevVig),
      excluidos: exclLtv.size,
    };
    const cltEscopo: EscopoValores = {
      realIni: mediaOuNull(listas.cltRealIni),
      prevIni: mediaOuNull(listas.cltPrevIni),
      realVig: mediaOuNull(listas.cltRealVig),
      prevVig: mediaOuNull(listas.cltPrevVig),
      excluidos: exclClt.size,
    };

    // CLT Real (coorte) do último mês, igual à linha "CLT (meses)" da tabela.
    const cltRealCoorte = cltNoMes(rowsCLT ?? rows, mesRef);

    // Ticket médio do ÚLTIMO mês do período: mesmo valor da coluna
    // correspondente na linha "MRR - Ticket Médio" da tabela (MRR do mês /
    // clientes com MRR diferente de zero no mês).
    const ticket =
      mrrOficial?.[mesRef]?.ticket ?? ticketMedioNoMes(rows, mesRef);
    const clientesComMrrRef = rows.filter(
      (r) => Math.abs(mrrClienteNoMes(r, mesRef)) > 0.000001
    ).length;

    // Churn financeiro do período = MRR perdido / MRR do período (mesma conta do BI).
    // Sem intervalo, cai para a foto atual da base ativa.
    const meses = temIntervalo && inicio && fim ? mesesEntre(inicio, fim) : [];
    const mrrPorMesChurn = meses.map((m) => mrrOficial?.[m]?.mrr ?? mrrTotalNoMes(rows, m));
    const mrrPeriodo = temIntervalo ? mrrPorMesChurn.reduce((s, v) => s + v, 0) : mrrAtivo;

    return {
      // Base
      mesRef,
      total: naBase.length,
      ativos: ativos.length,
      inativos: Math.max(naBase.length - ativos.length, 0),
      mrrAtivo,
      ticket,
      clientesComMrrRef,
      ltvEscopo,
      cltEscopo,
      cltRealCoorte,
      // Ganho
      novos: novos.length,
      mesesPeriodo: mesesJanela.length,
      novosPorMes: mesesJanela.length ? novos.length / mesesJanela.length : 0,
      novasVendas: nmrrNovos,
      ticketMedioNovos: novos.length ? nmrrNovos / novos.length : 0,
      // Perda
      avisos: avisos.length,
      avisosPorMes: mesesJanela.length ? avisos.length / mesesJanela.length : 0,
      cancelados: cancelados.length,
      canceladosPorMes: mesesJanela.length ? cancelados.length / mesesJanela.length : 0,
      mrrPerdido,
      mrrPerdidoPorMes: mesesJanela.length ? mrrPerdido / mesesJanela.length : 0,
      churnFinanceiro: mrrPeriodo ? (mrrPerdido / mrrPeriodo) * 100 : 0,
    };
  }, [rows, inicio, fim, mrrOficial]);


  return (
    <div className="space-y-5">
      {/* Linha 1 — Base */}
      <section>
        <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Base
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="CLIENTES ATIVOS"
            value={String(k.ativos)}
            subtitle={`${k.total} na base (${k.inativos} inativos)`}
            description={`Clientes ativos no mês de referência (${mesLabel(k.mesRef)})`}
            icon={UserCheck}
            loading={loading}
          />
          <MetricCard
            title="MRR ATIVO"
            value={brl(k.mrrAtivo)}
            subtitle={`Soma do MRR atual dos ativos no mês de referência (${mesLabel(k.mesRef)})`}
            icon={DollarSign}
            loading={loading}
          />
          <MetricCard
            title="MRR TICKET MÉDIO"
            value={brl(k.ticket)}
            subtitle={`MRR do mês / clientes com MRR no mês de referência (${mesLabel(k.mesRef)})`}
            icon={Receipt}
            loading={loading}
          />
          <EscopoCard
            titulo="LTV REAL"
            icon={Gem}
            loading={loading}
            escopo={k.ltvEscopo}
            fmt={brlN}
            fmtPrincipal={brlN}
            description={`LTV dos ativos do mês de referência (${mesLabel(k.mesRef)}), por escopo de contrato`}
          />
        </div>
      </section>

      {/* Linha 2 — Ganho */}
      <section>
        <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Ganho
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="NOVOS CLIENTES"
            value={String(k.novos)}
            subtitle={`Média de ${k.novosPorMes.toFixed(1).replace(".", ",")} por mês · ${k.mesesPeriodo} ${k.mesesPeriodo === 1 ? "mês" : "meses"}`}
            description="Clientes com data de início no período selecionado"
            icon={UserPlus}
            loading={loading}
          />
          <MetricCard
            title="nMRR"
            value={brl(k.novasVendas)}
            subtitle="Soma do MRR dos novos clientes"
            description="Total acumulado de nMRR no período selecionado"
            icon={TrendingUp}
            loading={loading}
          />
          <MetricCard
            title="nMRR TICKET MÉDIO"
            value={brl(k.ticketMedioNovos)}
            subtitle="nMRR / novos clientes no período selecionado"
            icon={DollarSign}
            loading={loading}
          />
          <EscopoCard
            titulo="CLT REAL"
            icon={Users}
            loading={loading}
            escopo={k.cltEscopo}
            principal={k.cltRealCoorte}
            realUnico={k.cltRealCoorte}
            fmt={mesesDecN}
            fmtPrincipal={mesesN}
            fmtHover={mesesDecN}
            description={`CLT do mês de referência (${mesLabel(k.mesRef)}) por coorte;  por escopo de contrato`}
          />
        </div>
      </section>


      {/* Linha 3 — Perda */}
      <section>
        <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Perda
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="AVISO PRÉVIO SOLICITADO"
            value={String(k.avisos)}
            subtitle={`Média de ${k.avisosPorMes.toFixed(1).replace(".", ",")} por mês · ${k.mesesPeriodo} ${k.mesesPeriodo === 1 ? "mês" : "meses"}`}
            description="Clientes com solicitação de cancelamento no período selecionado"
            icon={AlertTriangle}
            loading={loading}
          />
          <MetricCard
            title="CLIENTES CANCELADOS"
            value={String(k.cancelados)}
            subtitle={`Média de ${k.canceladosPorMes.toFixed(1).replace(".", ",")} por mês · ${k.mesesPeriodo} ${k.mesesPeriodo === 1 ? "mês" : "meses"}`}
            description="Clientes cancelados no período selecionado"
            icon={XCircle}
            loading={loading}
          />
          <MetricCard
            title="MRR PERDIDO"
            value={brl(k.mrrPerdido)}
            subtitle={`Média de ${brl(k.mrrPerdidoPorMes)} por mês · ${k.mesesPeriodo} ${k.mesesPeriodo === 1 ? "mês" : "meses"}`}
            description="Soma do MRR atual dos clientes cancelados no período selecionado"
            icon={TrendingDown}
            valueColor="text-destructive"
            loading={loading}
          />
          <MetricCard
            title="CHURN FINANCEIRO"
            value={pct(k.churnFinanceiro)}
            subtitle="MRR perdido / MRR ativo"
            description="Percentual de MRR perdido em relação ao MRR ativo no período selecionado"
            icon={Percent}
            valueColor={k.churnFinanceiro > 10 ? "text-destructive" : "text-foreground"}
            loading={loading}
          />
        </div>
      </section>

    </div>

  );
}
