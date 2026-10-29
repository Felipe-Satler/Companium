import { useState, useEffect, useCallback } from "react";
import { externalSupabase } from "@/integrations/external-supabase/client";

// Config do agente de IA conectado ao WhatsApp que responde em grupos.
// Persistida em `whatsapp_group_agents` (projeto companium-db), RLS ADMIN-ONLY (leitura inclusa).
// A escrita é feita como usuário autenticado admin; um serviço de sync no servidor lê essa
// config (via service_role) e aplica no gateway OpenClaw (prompt do agente + allowlist/gatilho
// do canal WhatsApp). A tela NÃO fala direto com o gateway — tudo passa pelo banco.
//
// SEGURANÇA: nasce desabilitado e sem grupos; require_mention default true. Nada responde até
// um admin conectar o WhatsApp (QR) e habilitar aqui.

export const WHATSAPP_ACCOUNT_ID = "whatsapp-groobot";

export interface WhatsappGroup {
  id: string;
  name: string;
}

export type GroupScope = "allowlist" | "all";

export interface WhatsappAgentConfig {
  account_id: string;
  display_name: string;
  enabled: boolean;
  system_prompt: string;
  require_mention: boolean;
  trigger_prefix: string;
  group_scope: GroupScope;
  group_allowlist: WhatsappGroup[];
  tools_enabled: boolean;
  model: string;
  updated_at?: string;
}

export interface KnownGroup {
  group_id: string;
  group_name: string | null;
  last_seen: string;
}

const DEFAULT_CONFIG: WhatsappAgentConfig = {
  account_id: WHATSAPP_ACCOUNT_ID,
  display_name: "Agente WhatsApp (Grupos)",
  enabled: false,
  system_prompt: "",
  require_mention: true,
  trigger_prefix: "",
  group_scope: "allowlist",
  group_allowlist: [],
  tools_enabled: false,
  model: "gpt-6-astra",
};

export function useWhatsappAgent(accountId: string = WHATSAPP_ACCOUNT_ID) {
  const [config, setConfig] = useState<WhatsappAgentConfig>(DEFAULT_CONFIG);
  const [knownGroups, setKnownGroups] = useState<KnownGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ data: cfg, error: cfgErr }, { data: grps }] = await Promise.all([
        externalSupabase
          .from("whatsapp_group_agents")
          .select(
            "account_id, display_name, enabled, system_prompt, require_mention, trigger_prefix, group_scope, group_allowlist, tools_enabled, model, updated_at",
          )
          .eq("account_id", accountId)
          .maybeSingle(),
        externalSupabase
          .from("whatsapp_known_groups")
          .select("group_id, group_name, last_seen")
          .eq("account_id", accountId)
          .order("group_name", { ascending: true }),
      ]);
      if (cfgErr) throw cfgErr;
      if (cfg) {
        setConfig({
          account_id: cfg.account_id,
          display_name: cfg.display_name ?? DEFAULT_CONFIG.display_name,
          enabled: !!cfg.enabled,
          system_prompt: cfg.system_prompt ?? "",
          require_mention: cfg.require_mention ?? true,
          trigger_prefix: cfg.trigger_prefix ?? "",
          group_scope: (cfg.group_scope as GroupScope) ?? "allowlist",
          group_allowlist: Array.isArray(cfg.group_allowlist)
            ? (cfg.group_allowlist as WhatsappGroup[])
            : [],
          tools_enabled: !!cfg.tools_enabled,
          model: cfg.model ?? DEFAULT_CONFIG.model,
          updated_at: cfg.updated_at ?? undefined,
        });
      } else {
        setConfig({ ...DEFAULT_CONFIG, account_id: accountId });
      }
      setKnownGroups((grps as KnownGroup[]) ?? []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // RLS (não-admin), tabela ausente ou offline: segue com default, mas sinaliza.
      console.warn("[useWhatsappAgent] não foi possível carregar config:", msg);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Salva (upsert por account_id). Recebe os campos editáveis; o servidor de sync aplica no gateway.
  const save = useCallback(
    async (patch: Partial<WhatsappAgentConfig>) => {
      setSaving(true);
      setError(null);
      const next = { ...config, ...patch };
      try {
        const { error: upErr } = await externalSupabase
          .from("whatsapp_group_agents")
          .upsert(
            {
              account_id: next.account_id,
              display_name: next.display_name,
              enabled: next.enabled,
              system_prompt: next.system_prompt,
              require_mention: next.require_mention,
              trigger_prefix: next.trigger_prefix,
              group_scope: next.group_scope,
              group_allowlist: next.group_allowlist,
              tools_enabled: next.tools_enabled,
              model: next.model,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "account_id" },
          );
        if (upErr) throw upErr;
        setConfig(next);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        throw e;
      } finally {
        setSaving(false);
      }
    },
    [config],
  );

  return { config, setConfig, knownGroups, loading, saving, error, reload: load, save };
}
