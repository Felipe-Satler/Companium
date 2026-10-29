import { useState, useEffect, useCallback } from "react";
import { externalSupabase } from "@/integrations/external-supabase/client";
import { clientMatchKey } from "@/data/clienteAliases";
import { FatBasis, DEFAULT_FAT_BASIS } from "@/utils/crmCalculations";

// Base do Faturamento Bruto escolhida por cliente, persistida em
// `crm_faturamento_config` (projeto companium-db). A escrita acontece como usuário
// autenticado (RLS p/ `authenticated`), então a escolha vale para TODAS as contas:
// qualquer pessoa que puxar o cliente recebe a base salva dele. Sem linha salva →
// DEFAULT_FAT_BASIS (realizadas + realizados), o comportamento histórico.
//
// A chave é clientMatchKey(client) — tolerante a caixa/acento/underscore — para
// casar com o `client` cru que vem de MergedClient em qualquer variação.

interface FatConfigRow {
  client_key: string;
  consulta_basis: FatBasis["consulta"];
  procedimento_basis: FatBasis["procedimento"];
}

export function useFaturamentoConfig() {
  const [map, setMap] = useState<Map<string, FatBasis>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await externalSupabase
        .from("crm_faturamento_config")
        .select("client_key, consulta_basis, procedimento_basis");
      if (cancelled) return;
      if (!error && data) {
        const m = new Map<string, FatBasis>();
        for (const r of data as FatConfigRow[]) {
          m.set(r.client_key, { consulta: r.consulta_basis, procedimento: r.procedimento_basis });
        }
        setMap(m);
      } else if (error) {
        // Tabela ausente / RLS / offline: segue com defaults (faturamento histórico).
        console.warn("[useFaturamentoConfig] não foi possível carregar config:", error.message);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Resolve a base de um cliente (default quando não há escolha salva).
  const resolveBasis = useCallback(
    (client: string): FatBasis => map.get(clientMatchKey(client)) ?? DEFAULT_FAT_BASIS,
    [map]
  );

  // Salva a escolha (upsert) e atualiza o estado local otimisticamente.
  const setBasis = useCallback(async (client: string, basis: FatBasis) => {
    const key = clientMatchKey(client);
    if (!key) return;
    const prevMap = map;
    setMap((prev) => new Map(prev).set(key, basis));
    setSaving(true);
    try {
      const { error } = await externalSupabase
        .from("crm_faturamento_config")
        .upsert(
          {
            client_key: key,
            client,
            consulta_basis: basis.consulta,
            procedimento_basis: basis.procedimento,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "client_key" }
        );
      if (error) throw error;
    } catch (e) {
      // Reverte o otimismo se a escrita falhar.
      setMap(prevMap);
      console.error("[useFaturamentoConfig] falha ao salvar config:", e);
      throw e;
    } finally {
      setSaving(false);
    }
  }, [map]);

  return { resolveBasis, setBasis, loading, saving };
}
