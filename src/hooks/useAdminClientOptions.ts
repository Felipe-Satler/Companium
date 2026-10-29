import { useEffect, useState } from "react";
import { externalSupabase as supabase } from "@/integrations/external-supabase/client";
import {
  buildClientCanonicalMap,
  prettyClientLabel,
  clientMatchKey,
  canonicalizeAdsClient,
  normalizeClientName,
} from "@/data/clienteAliases";
import { withRetry } from "@/hooks/dataCache";

/**
 * Opções de cliente para o seletor de "usuário-cliente" na Administração.
 *
 * Usa a MESMA fonte das telas de /clientes (união canônica de Ads `list_ads_clients` +
 * Kommo `list_kommo_clients` via `buildClientCanonicalMap`) — então mostra TODOS os
 * clientes do Companium, igual ao CRM. O `id` (clientes.id, necessário p/ vincular) vem
 * da view `v_clientes_lookup`, casado por `clientMatchKey`. Qualquer cliente CADASTRADO
 * que não apareça na união (ex.: sem conta de Ads/Kommo listada) é incluído do próprio
 * lookup, pra nada vinculável ficar de fora.
 *
 * Robusto: cada fetch passa por `withRetry` e, em falha, MANTÉM o último estado bom (a
 * lista não zera por um timeout/queda) + reagenda com backoff — carrega igual ao CRM.
 */
export interface AdminClientOption {
  /** clientes.id (uuid) — ausente se o cliente ainda não está cadastrado na base. */
  id?: string;
  /** slug canônico (usado p/ computar o escopo cmpkeys/ads_names). */
  slug: string;
  /** rótulo amigável exibido no seletor. */
  label: string;
}

interface LookupRow {
  id: string;
  nome_identificador: string | null;
  nome_bruto: string | null;
}

async function fetchLookup(): Promise<LookupRow[]> {
  const PAGE = 1000;
  const all: LookupRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("v_clientes_lookup")
      .select("id, nome_identificador, nome_bruto")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw Object.assign(new Error(error.message), error);
    const batch = (data as LookupRow[]) ?? [];
    all.push(...batch);
    if (batch.length < PAGE) break;
  }
  return all;
}

async function fetchClientList(): Promise<string[]> {
  const [adsRes, kommoRes] = await Promise.all([
    supabase.rpc("list_ads_clients"),
    supabase.rpc("list_kommo_clients"),
  ]);
  if (adsRes.error) throw Object.assign(new Error(adsRes.error.message), adsRes.error);
  if (kommoRes.error) throw Object.assign(new Error(kommoRes.error.message), kommoRes.error);
  const adsNames = new Set<string>();
  for (const r of (adsRes.data as { client: string | null }[]) || []) if (r.client) adsNames.add(r.client);
  const kommoNames = new Set<string>();
  for (const r of (kommoRes.data as { client: string | null }[]) || []) if (r.client) kommoNames.add(r.client);
  // Normaliza os nomes de Kommo ANTES de canonicalizar — IGUAL ao CRM (useClientesData) e ao
  // sync-clientes. Sem isto, variantes-título do mesmo cliente no Kommo (ex.: "Ronald" +
  // "Dr._Ronald") viram canônicos/chaves distintos → o mesmo cliente aparece 2× no seletor e,
  // pior, a entrada exibida pode resolver por uma chave que NÃO bate com o cadastro (id undefined
  // → "não está cadastrado") enquanto a entrada cadastrada some no dedup por rótulo.
  const kommoNormalized = [...kommoNames].map((c) => normalizeClientName(c));
  const { canonicalList } = buildClientCanonicalMap({ adsNames: [...adsNames], kommoNames: kommoNormalized });
  return canonicalList;
}

export function useAdminClientOptions(enabled: boolean) {
  const [options, setOptions] = useState<AdminClientOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const build = async (): Promise<boolean> => {
      let lookup: LookupRow[];
      let canonicalList: string[];
      try {
        [lookup, canonicalList] = await Promise.all([withRetry(fetchLookup), withRetry(fetchClientList)]);
      } catch (e) {
        // Mantém a lista atual — não zera por falha transitória.
        console.warn("[useAdminClientOptions] fetch falhou (mantém último estado bom):", (e as Error)?.message);
        return false;
      }

      // matchKey → { id, slug } do cadastro (id p/ vincular; slug canônico p/ o escopo).
      const byKey = new Map<string, { id: string; slug: string }>();
      for (const r of lookup) {
        if (r.nome_identificador) {
          const k = clientMatchKey(r.nome_identificador);
          if (k && !byKey.has(k)) byKey.set(k, { id: r.id, slug: r.nome_identificador });
        }
        if (r.nome_bruto) {
          const c = canonicalizeAdsClient(r.nome_bruto);
          const k = clientMatchKey(c);
          if (k && !byKey.has(k)) byKey.set(k, { id: r.id, slug: c });
        }
      }

      const out: AdminClientOption[] = [];
      const seen = new Set<string>(); // dedup por rótulo (case-insensitive)
      const usedKeys = new Set<string>();
      const push = (slug: string, id?: string) => {
        const label = prettyClientLabel(slug).trim();
        const lk = label.toLowerCase();
        if (!label || seen.has(lk)) return;
        seen.add(lk);
        out.push({ id, slug, label });
      };

      // 1) Lista canônica completa (mesma do CRM) — resolve o id pelo cadastro.
      for (const canonical of canonicalList) {
        const key = clientMatchKey(canonical);
        const hit = byKey.get(key);
        if (key) usedKeys.add(key);
        push(hit?.slug ?? canonical, hit?.id);
      }
      // 2) Cadastrados que não apareceram na união (nada vinculável fica de fora).
      for (const [key, v] of byKey) {
        if (usedKeys.has(key)) continue;
        push(v.slug, v.id);
      }

      out.sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
      if (cancelled) return true;
      setOptions(out);
      return true;
    };

    const run = async () => {
      const ok = await build();
      if (cancelled) return;
      setLoading(false);
      if (!ok && attempt < 8) {
        const delay = Math.min(1500 * 2 ** attempt, 15000) + Math.random() * 400;
        attempt++;
        timer = setTimeout(() => { void run(); }, delay);
      } else {
        attempt = 0;
      }
    };
    void run();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [enabled]);

  return { options, loading };
}
