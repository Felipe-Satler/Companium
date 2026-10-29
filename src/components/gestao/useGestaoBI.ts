import * as React from "react";
import type { GestaoCliente } from "@/hooks/useGestaoData";
import { mrrClienteNoMes, mrrTotalNoMes, ticketMedioNoMes } from "./mrrEngine";


export type BIMes = {
  mes: string; // yyyy-MM
  label: string; // jan/26
  novos: number;
  nmrr: number;
  nmrrTicket: number;
  ativos: number;
  mrr: number;
  mrrTicket: number;
  avisos: number;
  cancelados: number;
  mrrPerdido: number;
  churnQtd: number;
  churnFin: number;
  clt: number;
};

export type BIResumo = {
  meses: BIMes[];
  totais: {
    novos: number;
    nmrr: number;
    nmrrTicket: number;
    ativosFim: number;
    ativosMedia: number;
    mrr: number;
    mrrMedia: number;
    mrrTicket: number;
    avisos: number;
    cancelados: number;
    mrrPerdido: number;
    churnQtd: number;
    churnFin: number;
    clt: number;
  };
  motivos: { motivo: string; total: number; mrr: number }[];
  gestores: string[];
};

const MESES_ABREV = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export const mesLabel = (ym: string) => {
  const [y = "", m = "1"] = ym.split("-");
  return `${MESES_ABREV[Number(m) - 1] ?? ""}/${y.slice(2)}`;
};

/** yyyy-MM de uma data ISO (yyyy-MM-dd). */
const ym = (d: string | null | undefined) => (d ? d.slice(0, 7) : null);

export const listarMeses = (inicio: string, fim: string): string[] => {
  const out: string[] = [];
  let [y = 0, m = 1] = inicio.split("-").map(Number) as number[];
  const [fy = 0, fm = 12] = fim.split("-").map(Number) as number[];
  let guard = 0;
  while ((y < fy || (y === fy && m <= fm)) && guard++ < 240) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
};

export const mesAtual = () => new Date().toISOString().slice(0, 7);

/**
 * Intervalo efetivo do BI: usa o período escolhido ou, quando é "todos",
 * o primeiro/último mês presentes nos dados (nunca antes de 2026-08).
 * Compartilhado entre a tabela e os cards para que o mês de referência bata.
 */
export const intervaloBI = (
  rows: GestaoCliente[],
  inicio: string | null,
  fim: string | null
): { inicio: string; fim: string } => {
  if (inicio && fim) return inicio <= fim ? { inicio, fim } : { inicio: fim, fim: inicio };
  const meses = rows
    .flatMap((r) => [
      ym(r.data_inicio_ref) ?? ym(r.data_inicio),
      ym(r.data_fim_ref),
      ym(r.data_aviso_previo_ref) ?? ym(r.data_aviso_previo),
    ])
    .filter((m): m is string => !!m)
    .sort();
  const primeiro = meses[0];
  const ultimo = meses[meses.length - 1];
  if (!primeiro || !ultimo) return { inicio: "2026-01", fim: "2026-08" };
  return { inicio: primeiro, fim: ultimo > "2026-08" ? ultimo : "2026-08" };
};


const inicioDe = (r: GestaoCliente) => ym(r.data_inicio_ref) ?? ym(r.data_inicio);
/** Igual à planilha (BI_v.2): ativos = início <= mês <= fim; cancelados = fim == mês,
 *  sempre a partir de "Data de Fim - Ref Mês", sem olhar o status. */
const fimDe = (r: GestaoCliente) => ym(r.data_fim_ref);
const avisoDe = (r: GestaoCliente) => ym(r.data_aviso_previo_ref) ?? ym(r.data_aviso_previo);

/** Valor atual do contrato (fallback para o nMRR contratado). */
export const mrrCorrente = (r: GestaoCliente) => r.mrr_atual ?? r.nmrr ?? 0;

/**
 * MRR histórico do cliente em um mês, replicando a fórmula oficial da aba
 * `MRR Calculado` (inclui upsell/downsell e o aviso prévio proporcional).
 */
export const mrrNoMes = (r: GestaoCliente, mes: string): number => mrrClienteNoMes(r, mes);


const media = (l: number[]) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : 0);

/** Índice absoluto de meses (ano*12 + mês) a partir de yyyy-MM. */
const idxMes = (m: string | null | undefined): number | null => {
  if (!m) return null;
  const [y, mm] = m.split("-").map(Number);
  return y && mm ? y * 12 + mm : null;
};

/**
 * CLT do mês, porte fiel da aba `Base Cálculo CLT`:
 * - status do mês: "" se "Início Planejado" > mês; "Ativo" se fim ref >= mês; senão "Inativo";
 * - duração: 0 se início ref >= mês; Ativo -> mês - início; Inativo -> fim - início;
 * - CLT = média das durações dos Inativos + dos Ativos cuja duração >= média dos Inativos.
 */
export const cltNoMes = (rows: GestaoCliente[], mes: string): number => {
  const M = idxMes(mes);
  if (!M) return 0;
  const inativos: number[] = [];
  const ativos: number[] = [];
  for (const r of rows) {
    const ini = idxMes(ym(r.data_inicio_planejado) ?? ym(r.data_inicio));
    const j = idxMes(inicioDe(r));
    if (ini === null || j === null || ini > M) continue;
    const k = idxMes(fimDe(r));
    // Fim de referência vazio = contrato em aberto, portanto ativo.
    const ehAtivo = k === null || k >= M;
    const dur = j >= M ? 0 : ehAtivo ? M - j : k !== null ? k - j : 0;

    (ehAtivo ? ativos : inativos).push(dur);
  }
  const mediaInativos = media(inativos);
  const selecionados = inativos.concat(ativos.filter((d) => d >= mediaInativos));
  return media(selecionados);
};

export function useGestaoBI(
  rows: GestaoCliente[],
  opts: {
    inicio: string;
    fim: string;
    gestor: string;
    /** Série oficial da aba `MRR Calculado`, usada quando não há recorte por squad. */
    mrrOficial?: Record<string, { mrr: number | null; ticket: number | null }> | null;
    /** Base sem recorte de datas: o corte do CLT depende de todos os inativos históricos. */
    rowsCLT?: GestaoCliente[] | null;
  }
): BIResumo {
  return React.useMemo(() => {
    const gestores = Array.from(
      new Set(rows.map((r) => r.lider_revops).filter((v): v is string => !!v))
    ).sort((a, b) => a.localeCompare(b, "pt-BR"));

    const base =
      opts.gestor === "todos" ? rows : rows.filter((r) => (r.lider_revops ?? "") === opts.gestor);
    const rowsCltBase = opts.rowsCLT ?? rows;
    const baseCLT =
      opts.gestor === "todos"
        ? rowsCltBase
        : rowsCltBase.filter((r) => (r.lider_revops ?? "") === opts.gestor);
    // A série oficial é global: só vale quando nenhum recorte está ativo.
    const oficial = opts.gestor === "todos" && rows.length ? opts.mrrOficial : null;

    const meses = listarMeses(opts.inicio, opts.fim).map<BIMes>((mes) => {
      const novosRows = base.filter((r) => inicioDe(r) === mes);
      const canceladosRows = base.filter((r) => fimDe(r) === mes);
      // O mês do cancelamento ainda conta como ativo (mesma regra da planilha).
      const ativosRows = base.filter((r) => {
        const i = inicioDe(r);
        if (!i || i > mes) return false;
        const f = fimDe(r);
        return !f || f >= mes;
      });

      const nmrr = novosRows.reduce((a, r) => a + (r.nmrr ?? 0), 0);
      const oficialMes = oficial?.[mes];
      const mrr = oficialMes?.mrr ?? mrrTotalNoMes(base, mes);
      const mrrTicket = oficialMes?.ticket ?? ticketMedioNoMes(base, mes);
      // Planilha: SUMIFS(MRR Atual; Data de Fim - Ref Mês = mês)
      const mrrPerdido = canceladosRows.reduce((a, r) => a + (r.mrr_atual ?? 0), 0);

      return {
        mes,
        label: mesLabel(mes),
        novos: novosRows.length,
        nmrr,
        nmrrTicket: novosRows.length ? nmrr / novosRows.length : 0,
        ativos: ativosRows.length,
        mrr,
        mrrTicket,


        avisos: base.filter((r) => avisoDe(r) === mes).length,
        cancelados: canceladosRows.length,
        mrrPerdido,
        churnQtd: ativosRows.length ? (canceladosRows.length / ativosRows.length) * 100 : 0,
        churnFin: mrr ? (mrrPerdido / mrr) * 100 : 0,
        clt: cltNoMes(baseCLT, mes),
      };
    });

    const soma = (k: keyof BIMes) => meses.reduce((a, m) => a + (m[k] as number), 0);
    const novos = soma("novos");
    const nmrr = soma("nmrr");
    const mrr = soma("mrr");
    const cancelados = soma("cancelados");
    const mrrPerdido = soma("mrrPerdido");
    const ativosMedia = media(meses.map((m) => m.ativos));

    // Motivos de cancelamento dentro da janela analisada
    const motivosMap = new Map<string, { total: number; mrr: number }>();
    for (const r of base) {
      const f = fimDe(r);
      if (!f || f < opts.inicio || f > opts.fim) continue;
      const motivo = r.motivo_cancelamento?.trim() || "Não informado";
      const cur = motivosMap.get(motivo) ?? { total: 0, mrr: 0 };
      cur.total += 1;
      cur.mrr += r.mrr_atual ?? r.nmrr ?? 0;
      motivosMap.set(motivo, cur);
    }
    const motivos = Array.from(motivosMap, ([motivo, v]) => ({ motivo, ...v })).sort(
      (a, b) => b.total - a.total
    );

    return {
      meses,
      motivos,
      gestores,
      totais: {
        novos,
        nmrr,
        nmrrTicket: novos ? nmrr / novos : 0,
        // Clientes DISTINTOS que estiveram ativos em algum mês do período:
        // início <= último mês e (fim vazio ou fim >= primeiro mês).
        ativosFim: base.filter((r) => {
          const i = inicioDe(r);
          if (!i || i > opts.fim) return false;
          const f = fimDe(r);
          return !f || f >= opts.inicio;
        }).length,
        ativosMedia,
        mrr,
        mrrMedia: media(meses.map((m) => m.mrr)),
        mrrTicket: ativosMedia ? media(meses.map((m) => m.mrr)) / ativosMedia : 0,
        avisos: soma("avisos"),
        cancelados,
        mrrPerdido,
        // Planilha: churn qtd = média cancelados / média ativos; churn fin = total perdido / total MRR
        churnQtd: ativosMedia ? (media(meses.map((m) => m.cancelados)) / ativosMedia) * 100 : 0,
        churnFin: mrr ? (mrrPerdido / mrr) * 100 : 0,
        // Planilha: AVERAGE dos meses da janela
        clt: media(meses.map((m) => m.clt)),
      },
    };
  }, [rows, opts.inicio, opts.fim, opts.gestor, opts.mrrOficial, opts.rowsCLT]);
}
