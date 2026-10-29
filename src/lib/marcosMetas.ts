import { externalSupabase } from "@/integrations/external-supabase/client";

export type IndicadorMarco =
  | "mrr"
  | "ativos"
  | "nmrr"
  | "novos"
  | "nmrrTicket"
  | "revChurn";

export type MetasMarcos = Partial<Record<IndicadorMarco, Record<string, number>>>;

const STORAGE_KEY = "companium.marcos.metas";
const TABELA = "marcos_metas";

const INDICADORES_VALIDOS: IndicadorMarco[] = ["mrr", "ativos", "nmrr", "novos", "nmrrTicket", "revChurn"];
const ehIndicador = (v: string): v is IndicadorMarco => (INDICADORES_VALIDOS as string[]).includes(v);

/** Lê o cache local (fallback offline / primeira pintura instantânea). */
export function lerMetas(): MetasMarcos {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as MetasMarcos;
  } catch {
    return {};
  }
}

const gravarCacheLocal = (metas: MetasMarcos) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(metas));
  } catch {
    // ignore (quota / modo privado)
  }
};

/**
 * Atualiza o estado em memória (puro) e espelha no cache local. O realizado NUNCA
 * vem daqui — só a meta. A persistência compartilhada (banco) é feita por
 * `salvarMetaRemoto`, chamada pela tela a cada edição.
 */
export function gravarMeta(
  metas: MetasMarcos,
  indicador: IndicadorMarco,
  mes: string,
  valor: number | null,
): MetasMarcos {
  const atualizadas: MetasMarcos = {
    ...metas,
    [indicador]: { ...(metas[indicador] ?? {}) },
  };

  if (valor === null) {
    delete atualizadas[indicador]?.[mes];
    if (Object.keys(atualizadas[indicador] ?? {}).length === 0) delete atualizadas[indicador];
  } else {
    const porMes = atualizadas[indicador];
    if (porMes) porMes[mes] = valor;
  }

  gravarCacheLocal(atualizadas);
  return atualizadas;
}

/**
 * Carrega as metas da tabela `marcos_metas` (Supabase EXTERNO / companium-db) — fonte
 * compartilhada entre usuários e aparelhos. Em falha (tabela ainda não criada, sem
 * rede ou sem permissão) cai no cache local para a tela não abrir vazia. Quando o
 * banco responde, o resultado também atualiza o cache local.
 */
export async function carregarMetas(): Promise<{ metas: MetasMarcos; remoto: boolean }> {
  try {
    const { data, error } = await externalSupabase.from(TABELA).select("indicador,mes,valor");
    if (error) throw error;
    const metas: MetasMarcos = {};
    for (const row of data ?? []) {
      const ind = String((row as { indicador: string }).indicador);
      const mes = String((row as { mes: string }).mes);
      const valorBruto = (row as { valor: number | string | null }).valor;
      if (!ehIndicador(ind) || valorBruto === null || valorBruto === undefined) continue;
      // PostgREST devolve numeric como string.
      const valor = Number(valorBruto);
      if (!Number.isFinite(valor)) continue;
      (metas[ind] ??= {})[mes] = valor;
    }
    gravarCacheLocal(metas);
    return { metas, remoto: true };
  } catch (err) {
    console.error("carregarMetas (marcos_metas):", err instanceof Error ? err.message : err);
    return { metas: lerMetas(), remoto: false };
  }
}

/**
 * Persiste UMA meta no banco: upsert quando há valor, delete quando `valor` é null
 * (campo vazio remove a meta — nunca grava zero). Chamada a cada edição na tela.
 * Lança em erro para a tela avisar (e manter o cache local como rede de segurança).
 */
export async function salvarMetaRemoto(
  indicador: IndicadorMarco,
  mes: string,
  valor: number | null,
  email: string | null,
): Promise<void> {
  if (valor === null) {
    const { error } = await externalSupabase
      .from(TABELA)
      .delete()
      .eq("indicador", indicador)
      .eq("mes", mes);
    if (error) throw error;
    return;
  }
  const { error } = await externalSupabase.from(TABELA).upsert(
    {
      indicador,
      mes,
      valor,
      atualizado_por: email,
      atualizado_em: new Date().toISOString(),
    },
    { onConflict: "indicador,mes" },
  );
  if (error) throw error;
}

// ===== TEMPORÁRIO: limpeza das metas de exemplo antigas =====
// O antigo botão "Dados de exemplo" gravou metas no navegador de quem clicou.
// Na abertura da tela, se a marca antiga existir, apaga só as metas que ainda
// têm exatamente o valor de exemplo (preserva as digitadas/alteradas) e a marca.
// Pode ser removido quando ninguém mais tiver essa marca guardada.
const LEGADO_MARCA = "companium.marcos.mock";
const LEGADO_MESES = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
const LEGADO_VALORES: Record<IndicadorMarco, number[]> = {
  mrr: [120000, 125000, 131000, 136500, 142000, 148000, 154500, 160000, 166000],
  ativos: [40, 42, 44, 46, 48, 50, 52, 54, 56],
  nmrr: [8000, 8800, 9500, 10200, 11000, 11800, 12500, 13200, 14000],
  novos: [4, 5, 4, 6, 5, 6, 5, 7, 6],
  nmrrTicket: [2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000],
  revChurn: [3.5, 3.4, 3.3, 3.2, 3.1, 3.0, 2.9, 2.8, 2.7],
};

export function limparMetasExemploLegado(metas: MetasMarcos): MetasMarcos {
  try {
    if (localStorage.getItem(LEGADO_MARCA) === null) return metas;
    let atualizadas = metas;
    LEGADO_MESES.forEach((mes, i) => {
      (Object.keys(LEGADO_VALORES) as IndicadorMarco[]).forEach((ind) => {
        if (atualizadas[ind]?.[mes] === LEGADO_VALORES[ind][i]) atualizadas = gravarMeta(atualizadas, ind, mes, null);
      });
    });
    localStorage.removeItem(LEGADO_MARCA);
    return atualizadas;
  } catch {
    return metas;
  }
}
// ===== fim do trecho temporário =====
