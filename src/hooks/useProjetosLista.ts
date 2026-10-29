import { useCallback, useEffect, useMemo, useState } from "react";
import { externalSupabase } from "@/integrations/external-supabase/client";
import { clearCached, dedupedFetch, withRetry } from "@/hooks/dataCache";
import { ProjetoRow, ProjetosIndex, EMPTY_PROJETOS_INDEX, buildProjetosIndex } from "@/data/squads";

const SELECT = "cliente, data_inicio, status, plano, lider_revops, crm";

/**
 * Carrega `projetos_lista` (planilha de projetos sincronizada no Supabase) e devolve o índice
 * de consulta: squad (= líder de RevOps), plano e tempo de casa por cliente.
 *
 * Erro NÃO derruba a tela: o índice fica vazio e a tela de Metas segue listando todos os
 * clientes sem squad/plano — que é exatamente como ela funcionava antes desta tabela existir.
 */
export function useProjetosLista() {
  const [index, setIndex] = useState<ProjetosIndex>(EMPTY_PROJETOS_INDEX);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bump para reexecutar o efeito quando alguém pede a lista de novo (cliente novo na planilha).
  const [versao, setVersao] = useState(0);

  /**
   * Relê a planilha AGORA, furando o cache de 5 min do `dedupedFetch` — senão um cliente que
   * acabou de entrar não apareceria até o cache vencer.
   */
  const reload = useCallback(async () => {
    clearCached("projetos_lista");
    setLoading(true);
    setVersao((v) => v + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await dedupedFetch<ProjetoRow[]>("projetos_lista", () =>
          withRetry(async () => {
            // PostgREST corta em 1000 linhas/resposta; pagina para não truncar em silêncio
            // (um cliente fora da página sumiria do squad dele sem erro nenhum).
            const PAGE = 1000;
            const all: ProjetoRow[] = [];
            for (let from = 0; ; from += PAGE) {
              const { data, error: err } = await externalSupabase
                .from("projetos_lista")
                .select(SELECT)
                .order("id", { ascending: true })
                .range(from, from + PAGE - 1);
              if (err) throw Object.assign(new Error(err.message), err);
              const page = (data ?? []) as ProjetoRow[];
              all.push(...page);
              if (page.length < PAGE) break;
            }
            return all;
          }),
        );
        if (cancelled) return;
        setIndex(buildProjetosIndex(rows));
        setError(null);
      } catch (e) {
        if (cancelled) return;
        // Sem squad a tela continua útil (lista todos os clientes), então só registramos.
        console.warn("[useProjetosLista] falha ao carregar projetos_lista:", (e as Error)?.message);
        setError((e as Error)?.message ?? "erro ao carregar projetos");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [versao]);

  return useMemo(
    () => ({ index, squads: index.squads, loading, error, reload }),
    [index, loading, error, reload],
  );
}
