import { useState, useEffect, useCallback } from "react";
import { format, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import { externalSupabase } from "@/integrations/external-supabase/client";

export type CaptacaoCanal = "meta" | "google";

/**
 * Meta de investimento da captação (card "Pacing mensal"), persistida na tabela
 * `captacao_config` (uma linha por mês, no 1º dia). Vazia até ser preenchida por
 * dentro do sistema — mesma ideia do "planejado" do CRM.
 *
 * A meta é SEPARADA por canal (`canal` = 'meta' | 'google'): a página "Meta Ads" e a
 * "Google Ads" têm metas independentes — mexer numa NÃO mexe na outra. (Requer a coluna
 * `canal` da migration 20260915; enquanto ela não roda, cai no modo legado por-mês.)
 *
 * O card respeita o filtro de DATA da aba Captação: `target` é a SOMA das metas dos meses
 * tocados pelo período selecionado (mês corrente quando não há filtro). Sem nenhuma linha
 * (ou todas zeradas) nos meses do período → target = null (indefinida).
 *
 * A EDIÇÃO continua sendo por mês (não dá pra editar uma soma): edita o 1º mês do
 * período (`editMonth`), cujo valor atual é `monthTarget`. Escrita liberada por RLS
 * só p/ admin ou crm_editor (has_crm_access); leitura aberta a todo authenticated.
 * REMOVER a meta ZERA a linha (upsert investimento_meta=0), não apaga — a RLS não tinha
 * policy de DELETE, então o delete era silenciosamente negado e a meta persistia.
 */
export function useCaptacaoMeta(canal: CaptacaoCanal, dateFrom?: Date, dateTo?: Date) {
  const now = new Date();
  const from = dateFrom ?? dateTo ?? startOfMonth(now);
  const to = dateTo ?? dateFrom ?? now;

  // Janela de meses tocada pelo período (1º dia de cada mês, formato do banco).
  const firstMonth = format(startOfMonth(from), "yyyy-MM-01");
  const lastMonth = format(startOfMonth(to), "yyyy-MM-01");
  // Mês editável = 1º mês do período (default: mês corrente).
  const editMonth = firstMonth;
  const editMonthLabel = format(new Date(`${editMonth}T00:00:00`), "MMMM 'de' yyyy", { locale: ptBR });

  // mes (yyyy-MM-01) -> investimento_meta
  const [rows, setRows] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    // Tenta filtrar por canal (schema novo). Se a coluna `canal` ainda não existir
    // (migration 20260915 não aplicada), refaz a consulta legada por-mês para não quebrar.
    let { data, error } = await externalSupabase
      .from("captacao_config")
      .select("mes, investimento_meta")
      .eq("canal", canal)
      .gte("mes", firstMonth)
      .lte("mes", lastMonth);
    if (error && isMissingCanalColumn(error)) {
      ({ data, error } = await externalSupabase
        .from("captacao_config")
        .select("mes, investimento_meta")
        .gte("mes", firstMonth)
        .lte("mes", lastMonth));
    }
    if (!error) {
      const map: Record<string, number> = {};
      for (const r of data ?? []) {
        // PostgREST devolve numeric como string → Number(); ignora linha sem meta.
        if (r.investimento_meta != null) map[String(r.mes).slice(0, 10)] = Number(r.investimento_meta);
      }
      setRows(map);
    }
    setLoading(false);
  }, [canal, firstMonth, lastMonth]);

  useEffect(() => {
    load();
  }, [load]);

  // Soma das metas dos meses do período. null quando NENHUM mês do período tem meta.
  const keys = Object.keys(rows);
  const target = keys.length ? keys.reduce((s, k) => s + rows[k], 0) : null;
  // Valor do mês editável (para pré-preencher o editor). null quando indefinido.
  const monthTarget = editMonth in rows ? rows[editMonth] : null;

  // value === null → ZERA a meta do mês editável (upsert investimento_meta=0, NÃO apaga a
  // linha: a RLS não tem policy de DELETE). número → grava (upsert). Sempre por canal.
  const save = useCallback(
    async (value: number | null) => {
      setSaving(true);
      const payload = {
        mes: editMonth,
        canal,
        investimento_meta: value ?? 0,
        updated_at: new Date().toISOString(),
      };
      let { error } = await externalSupabase
        .from("captacao_config")
        .upsert(payload, { onConflict: "mes,canal" });
      // Fallback legado (sem coluna `canal`): grava só por mês.
      if (error && isMissingCanalColumn(error)) {
        const { canal: _omit, ...legacy } = payload;
        ({ error } = await externalSupabase
          .from("captacao_config")
          .upsert(legacy, { onConflict: "mes" }));
      }
      setSaving(false);
      if (error) throw error;
      await load(); // recarrega o período p/ a soma refletir a edição
    },
    [canal, editMonth, load],
  );

  return { target, monthTarget, editMonth, editMonthLabel, loading, saving, save };
}

// PostgREST/Postgres sinalizam coluna inexistente com 42703 (undefined_column) ou PGRST204,
// e a mensagem menciona a coluna. Usado só p/ o fallback pré-migration.
function isMissingCanalColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    /canal/i.test(error.message ?? "")
  );
}
