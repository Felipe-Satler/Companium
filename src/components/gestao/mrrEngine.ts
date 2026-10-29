import type { GestaoCliente, UpsellRegistro } from "@/hooks/useGestaoData";

/** yyyy-MM de uma data ISO (yyyy-MM-dd). */
const ym = (d: string | null | undefined) => (d ? d.slice(0, 7) : null);
const num = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Porte fiel da fórmula da aba `MRR Calculado` da planilha oficial.
 *
 * Ordem das regras, para cada cliente e mês (yyyy-MM):
 * 1. nMRR vazio -> 0
 * 2. mês de pagamento do aviso prévio -> MRR Atual x dias / 30
 * 3. mês anterior ao início (ref) -> 0
 * 4. mês exato do início (ref) -> nMRR
 * 5. início < mês < fim, sem "Primeiro Upsell/Downsell" -> nMRR
 * 6. início < mês < fim, com primeiro upsell ainda no futuro -> nMRR
 * 7. início < mês < fim, após o primeiro upsell -> soma dos "Novo MRR"
 *    vigentes na aba `Upsell Downsell` (REF INÍCIO <= mês <= REF FIM)
 * 8. demais casos -> 0
 *
 * Sem a aba `Upsell Downsell` (export publicado só com `Lista`/`DB`), o passo 7
 * é aproximado pelo `MRR Atual` do cliente.
 */
export function mrrClienteNoMes(r: GestaoCliente, mes: string): number {
  // Fonte preferencial: valor já calculado pela própria planilha (`MRR Calculado`).
  const oficial = r.mrr_mensal?.[mes];
  if (typeof oficial === "number" && Number.isFinite(oficial)) return oficial;

  if (r.nmrr === null || r.nmrr === undefined) return 0;

  if (ym(r.aviso_mes_pgto) === mes) return (num(r.mrr_atual) * num(r.aviso_dias_prop)) / 30;

  const inicio = ym(r.data_inicio_ref) ?? ym(r.data_inicio);
  if (!inicio || inicio > mes) return 0;
  if (inicio === mes) return num(r.nmrr);

  // "Data de Fim - Ref Mês" vazia significa contrato em aberto: segue contando.
  const fim = ym(r.data_fim_ref);
  if (fim && fim <= mes) return 0;


  const upsellRef = ym(r.primeiro_upsell_ref);
  if (!upsellRef || upsellRef > mes) return num(r.nmrr);

  const registros: UpsellRegistro[] = r.upsells ?? [];
  if (registros.length) {
    return registros
      .filter((u) => {
        const i = ym(u.inicio_ref);
        const f = ym(u.fim_ref);
        return !!i && !!f && i <= mes && f >= mes;
      })
      .reduce((soma, u) => soma + num(u.valor), 0);
  }
  // Aproximação usada apenas quando a aba `Upsell Downsell` não veio no arquivo.
  return r.mrr_atual !== null && r.mrr_atual !== undefined ? num(r.mrr_atual) : num(r.nmrr);
}

/** Soma do MRR de todos os clientes no mês. */
export const mrrTotalNoMes = (rows: GestaoCliente[], mes: string) =>
  rows.reduce((soma, r) => soma + mrrClienteNoMes(r, mes), 0);

/** Ticket médio do mês: média apenas dos clientes com MRR diferente de zero. */
export const ticketMedioNoMes = (rows: GestaoCliente[], mes: string) => {
  const valores = rows.map((r) => mrrClienteNoMes(r, mes)).filter((v) => Math.abs(v) > 0.000001);
  return valores.length ? valores.reduce((a, b) => a + b, 0) / valores.length : 0;
};
