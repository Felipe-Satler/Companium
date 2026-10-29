/**
 * Conversão de uma data civil (YYYY-MM-DD) para os limites do dia no fuso de
 * Brasília (America/Sao_Paulo). Brasil aboliu o horário de verão em 2019, então
 * o offset é fixo em -03:00 — sem dependência de tz database.
 *
 * Use para filtros enviados a colunas TIMESTAMP/TIMESTAMPTZ (ex: created_at).
 * Para colunas DATE puras (ex: "Dia"), comparar YYYY-MM-DD diretamente já é
 * suficiente e não precisa destes helpers.
 */

import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const BRT_OFFSET = "-03:00";

/**
 * Rótulo amigável de um período para exibição (ex.: comparação de períodos do CRM).
 * Um mês civil inteiro (dia 1 → último dia do mês) vira "Agosto 2026"; qualquer outra
 * faixa vira "dd/MM/yy – dd/MM/yy". Sem `from` = "Todo o período".
 */
export function periodLabel(from?: Date, to?: Date): string {
  if (!from) return "Todo o período";
  const end = to ?? from;
  const lastDay = new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate();
  const isFullMonth =
    from.getDate() === 1 &&
    from.getMonth() === end.getMonth() &&
    from.getFullYear() === end.getFullYear() &&
    end.getDate() === lastDay;
  if (isFullMonth) {
    const s = format(from, "MMMM yyyy", { locale: ptBR });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  return `${format(from, "dd/MM/yy")} – ${format(end, "dd/MM/yy")}`;
}

/** Aceita "2026-06-15" ou "2026-06-15T..." — extrai só YYYY-MM-DD. */
function dateKey(input: string): string | null {
  const m = input.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * "2026-06-15" → "2026-06-15T00:00:00.000-03:00" (00:00 de Brasília).
 * Retorna undefined se a entrada for vazia/undefined; null se inválida.
 */
export function startOfDayBRT(dateStr: string | undefined | null): string | undefined {
  if (!dateStr) return undefined;
  const key = dateKey(dateStr);
  if (!key) return undefined;
  return `${key}T00:00:00.000${BRT_OFFSET}`;
}

/**
 * "2026-06-15" → "2026-06-15T23:59:59.999-03:00" (último instante de Brasília).
 * Retorna undefined se a entrada for vazia/undefined; null se inválida.
 */
export function endOfDayBRT(dateStr: string | undefined | null): string | undefined {
  if (!dateStr) return undefined;
  const key = dateKey(dateStr);
  if (!key) return undefined;
  return `${key}T23:59:59.999${BRT_OFFSET}`;
}
