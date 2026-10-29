import { useEffect, useMemo, useState } from "react";
import { externalSupabase } from "@/integrations/external-supabase/client";
import { dedupedFetch, withRetry } from "@/hooks/dataCache";
import type { ClientCanonicalMap } from "@/data/clienteAliases";

/**
 * INÍCIO DO CLIENTE "PELO BANCO" — a maturidade (tempo de casa) do filtro do CRM passa a
 * ser contada a partir do PRIMEIRO dado real do cliente no banco, e não da `data_inicio` da
 * planilha `projetos_lista`. Por decisão do usuário, o início é a data MAIS ANTIGA entre as
 * duas fontes de dados do cliente:
 *   - Ads   → menor `Dia` em `v_meta_google_ads_daily` (todas as contas do cliente);
 *   - CRM   → menor `created_at` em `v_kommo_completa` (todos os leads do cliente).
 *
 * Como só precisamos do MÍNIMO por cliente, não varremos o histórico inteiro (seriam dezenas
 * de milhares de linhas): disparamos UMA query minúscula por cliente/fonte — `order(...asc)`
 * + `limit(1)` — que devolve só a primeira data. São poucas dezenas de clientes, então o
 * custo é baixo e o resultado fica em cache (dedupedFetch, 5 min).
 *
 * Os nomes CRUS das contas vêm do `canonicalMap` já montado pela tela (raw de Ads = valor
 * exato da coluna `Client`; variantes de Kommo = nome do `client`), então o `in(...)` casa
 * todas as contas que pertencem àquele cliente canônico.
 *
 * `enabled` evita o trabalho quando a maturidade não está em uso (o fetch só roda quando a
 * tela realmente precisa classificar clientes por tempo de casa).
 */
export function useClienteInicioBanco(canonicalMap: ClientCanonicalMap, enabled: boolean) {
  const [inicioByCanonical, setInicio] = useState<Map<string, Date>>(new Map());
  const [loading, setLoading] = useState(false);

  // Lista estável de canônicos (chave do cache e da dependência do efeito).
  const canonicals = canonicalMap.canonicalList;
  const cacheKey = useMemo(() => canonicals.join("|"), [canonicals]);

  useEffect(() => {
    if (!enabled || canonicals.length === 0) return;
    let cancelled = false;

    const earliestAds = async (names: string[]): Promise<Date | null> => {
      if (!names.length) return null;
      const { data, error } = await externalSupabase
        .from("v_meta_google_ads_daily")
        .select("Dia")
        .in("Client", names)
        .order("Dia", { ascending: true })
        .limit(1);
      if (error) throw Object.assign(new Error(error.message), error);
      const d = (data?.[0] as { Dia?: string } | undefined)?.Dia;
      if (!d) return null;
      const dt = new Date(`${String(d).slice(0, 10)}T00:00:00`);
      return Number.isNaN(dt.getTime()) ? null : dt;
    };

    const earliestCrm = async (names: string[]): Promise<Date | null> => {
      if (!names.length) return null;
      const { data, error } = await externalSupabase
        .from("v_kommo_completa")
        .select("created_at")
        .in("client", names)
        .order("created_at", { ascending: true })
        .limit(1);
      if (error) throw Object.assign(new Error(error.message), error);
      const d = (data?.[0] as { created_at?: string } | undefined)?.created_at;
      if (!d) return null;
      const dt = new Date(d);
      return Number.isNaN(dt.getTime()) ? null : dt;
    };

    (async () => {
      setLoading(true);
      try {
        const result = await dedupedFetch(`cliente:inicio-banco:${cacheKey}`, async () => {
          const out = new Map<string, Date>();
          const tasks = canonicals.map((canon) => async () => {
            const adsNames = canonicalMap.adsVariantsByCanonical.get(canon) ?? [];
            const kommoNames = canonicalMap.kommoVariantsByCanonical.get(canon) ?? [];
            // Uma falha numa fonte não derruba a outra — pegamos o mínimo do que vier.
            const [ads, crm] = await Promise.all([
              withRetry(() => earliestAds(adsNames)).catch(() => null),
              withRetry(() => earliestCrm(kommoNames)).catch(() => null),
            ]);
            const dates = [ads, crm].filter((d): d is Date => d != null);
            if (dates.length) out.set(canon, new Date(Math.min(...dates.map((d) => d.getTime()))));
          });
          // Concorrência moderada: queries minúsculas (1 linha), mas sem estourar o pool.
          const CONC = 6;
          for (let i = 0; i < tasks.length; i += CONC) {
            await Promise.all(tasks.slice(i, i + CONC).map((t) => t()));
          }
          return out;
        });
        if (!cancelled) setInicio(result);
      } catch (e) {
        // Sem início pelo banco a tela cai no fallback (projetos_lista) — não quebra nada.
        console.warn("[useClienteInicioBanco] falha ao calcular início pelo banco:", (e as Error)?.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // canonicalMap muda junto com cacheKey (mesma origem); cacheKey basta como dep estável.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, cacheKey]);

  return { inicioByCanonical, loading };
}
