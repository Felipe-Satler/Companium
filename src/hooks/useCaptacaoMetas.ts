import * as React from "react";
import { externalSupabase } from "@/integrations/external-supabase/client";
import {
  INDICADORES,
  type MetaIndicadorKey,
  type MetaVariante,
  campoDe,
  variantesDe,
} from "@/components/meta/metaIndicadores";

/**
 * Metas de captação (Real x Planejado) por mês (AAAA-MM), persistidas na tabela
 * `captacao_metas` do Supabase EXTERNO (companium-db) — mesmo projeto/padrão do
 * `captacao_config`. LEITURA aberta a todo authenticated; ESCRITA só p/ admin ou
 * crm_editor (RLS has_crm_access). Preenchida manualmente pelo diálogo de edição.
 */
export type CaptacaoMetaRow = {
  mes: string; // AAAA-MM
  investimento_plan: number;
  investimento_real: number;
  leads_plan: number;
  leads_real: number;
  cpl_plan: number;
  cpl_real: number;
  leads_inbound_plan: number;
  leads_inbound_real: number;
  // Indicadores com variantes Total / Inbound
  agendamentos_total_plan?: number;
  agendamentos_total_real?: number;
  agendamentos_inbound_plan?: number;
  agendamentos_inbound_real?: number;
  reunioes_total_plan?: number;
  reunioes_total_real?: number;
  reunioes_inbound_plan?: number;
  reunioes_inbound_real?: number;
  vendas_total_plan?: number;
  vendas_total_real?: number;
  vendas_inbound_plan?: number;
  vendas_inbound_real?: number;
  novo_mrr_total_plan?: number;
  novo_mrr_total_real?: number;
  novo_mrr_inbound_plan?: number;
  novo_mrr_inbound_real?: number;
  // Detalhamento do Inbound por canal (Meta / Google) — só valores, sem Atingimento.
  leads_inbound_meta_plan?: number;
  leads_inbound_meta_real?: number;
  leads_inbound_google_plan?: number;
  leads_inbound_google_real?: number;
  agendamentos_meta_plan?: number;
  agendamentos_meta_real?: number;
  agendamentos_google_plan?: number;
  agendamentos_google_real?: number;
  reunioes_meta_plan?: number;
  reunioes_meta_real?: number;
  reunioes_google_plan?: number;
  reunioes_google_real?: number;
  vendas_meta_plan?: number;
  vendas_meta_real?: number;
  vendas_google_plan?: number;
  vendas_google_real?: number;
  novo_mrr_meta_plan?: number;
  novo_mrr_meta_real?: number;
  novo_mrr_google_plan?: number;
  novo_mrr_google_real?: number;
  // Campos legados (mantidos para compatibilidade com registros antigos)
  agendamentos_plan?: number;
  agendamentos_real?: number;
  reunioes_plan?: number;
  reunioes_real?: number;
  vendas_plan?: number;
  vendas_real?: number;
  novo_mrr_plan?: number;
  novo_mrr_real?: number;
  atualizado_em?: string | null;
  atualizado_por?: string | null;
};

/** Todas as colunas numéricas (plan/real), derivadas dos indicadores (variantes + canais). */
const NUM_COLS: string[] = INDICADORES.flatMap((i) =>
  variantesDe(i).flatMap((v) => [campoDe(i.key, "plan", v), campoDe(i.key, "real", v)])
);

/**
 * Colunas do detalhamento por canal (Meta/Google). São NOVAS no schema — só existem depois
 * de rodar a migration `..._captacao_metas_canais_...` no companium-db. Enquanto a migration não
 * roda, o upsert com essas colunas falha; então caímos p/ salvar só as colunas legadas.
 */
const CANAL_COLS = new Set(
  INDICADORES.flatMap((i) =>
    (i.subvariantes ?? []).flatMap((v) => [campoDe(i.key, "plan", v), campoDe(i.key, "real", v)])
  )
);
const LEGACY_NUM_COLS = NUM_COLS.filter((c) => !CANAL_COLS.has(c));

/** PostgREST devolve PGRST204 (ou "column ... does not exist") quando a coluna não existe. */
const isMissingColumn = (err: { code?: string; message?: string } | null) =>
  !!err &&
  (err.code === "PGRST204" ||
    /could not find the .* column|does not exist/i.test(err.message ?? ""));

export const linhaVazia = (mes: string): CaptacaoMetaRow => {
  const base: Record<string, number> = {};
  for (const c of NUM_COLS) base[c] = 0;
  return { mes, ...base } as unknown as CaptacaoMetaRow;
};

export const valorDe = (
  row: CaptacaoMetaRow,
  key: MetaIndicadorKey,
  tipo: "plan" | "real",
  variante?: MetaVariante
) => {
  const r = row as unknown as Record<string, number | null | undefined>;
  const atual = r[campoDe(key, tipo, variante)];
  if (atual !== null && atual !== undefined) return Number(atual);
  // Fallback: registros antigos guardavam o total sem sufixo de variante.
  if (variante === "total") return Number(r[campoDe(key, tipo)] ?? 0);
  return 0;
};

/** Converte a linha crua do PostgREST (numeric vem como string) em CaptacaoMetaRow. */
const fromDb = (raw: Record<string, unknown>): CaptacaoMetaRow => {
  const row: Record<string, unknown> = {
    mes: String(raw.mes),
    atualizado_em: (raw.atualizado_em as string) ?? null,
    atualizado_por: (raw.atualizado_por as string) ?? null,
  };
  for (const c of NUM_COLS) row[c] = raw[c] != null ? Number(raw[c]) : 0;
  return row as unknown as CaptacaoMetaRow;
};

const ordena = (rows: CaptacaoMetaRow[]) =>
  [...rows].sort((a, b) => a.mes.localeCompare(b.mes));

export function useCaptacaoMetas() {
  const [rows, setRows] = React.useState<CaptacaoMetaRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [remoteAvailable, setRemoteAvailable] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    const { data, error } = await externalSupabase.from("captacao_metas").select("*");
    if (error) {
      // Tabela ainda não criada (rode a migration) ou sem permissão → lista vazia.
      console.error("useCaptacaoMetas load:", error.message);
      setRemoteAvailable(false);
      setRows([]);
    } else {
      setRemoteAvailable(true);
      setRows(ordena((data ?? []).map((r) => fromDb(r as Record<string, unknown>))));
    }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  /** Cria ou atualiza a linha do mês informado (upsert por `mes`). */
  const salvarMes = React.useCallback(async (row: CaptacaoMetaRow, email: string | null) => {
    const payload: Record<string, unknown> = {
      mes: row.mes,
      atualizado_em: new Date().toISOString(),
      atualizado_por: email,
    };
    for (const c of NUM_COLS) payload[c] = Number((row as unknown as Record<string, unknown>)[c] ?? 0);

    let { error } = await externalSupabase
      .from("captacao_metas")
      .upsert(payload, { onConflict: "mes" });

    // Fallback: se as colunas de canal (Meta/Google) ainda não existem no banco (migration
    // pendente), reenvia só as colunas legadas para não travar o salvamento dos demais campos.
    if (isMissingColumn(error)) {
      console.warn(
        "useCaptacaoMetas: colunas Meta/Google ausentes (rode a migration captacao_metas_canais). Salvando só os campos legados."
      );
      const legado: Record<string, unknown> = { mes: payload.mes, atualizado_em: payload.atualizado_em, atualizado_por: payload.atualizado_por };
      for (const c of LEGACY_NUM_COLS) legado[c] = payload[c];
      ({ error } = await externalSupabase
        .from("captacao_metas")
        .upsert(legado, { onConflict: "mes" }));
    }
    if (error) throw error;

    // Atualiza o estado local sem recarregar (evita flash de skeleton).
    setRows((prev) => ordena([...prev.filter((r) => r.mes !== row.mes), fromDb(payload)]));
    return { persistido: "banco" as const };
  }, []);

  const removerMes = React.useCallback(async (mes: string) => {
    const { error } = await externalSupabase.from("captacao_metas").delete().eq("mes", mes);
    if (error) throw error;
    setRows((prev) => prev.filter((r) => r.mes !== mes));
  }, []);

  return { rows, loading, remoteAvailable, refresh: load, salvarMes, removerMes };
}
