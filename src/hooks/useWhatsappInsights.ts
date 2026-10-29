import { useState, useEffect, useCallback } from "react";
import { externalSupabase } from "@/integrations/external-supabase/client";
import { WHATSAPP_ACCOUNT_ID } from "@/hooks/useWhatsappAgent";

// Acompanhamento por grupo do agente de WhatsApp: andamento do grupo, sentimento da conversa
// e andamento do atendimento. Lê `whatsapp_group_insights` (projeto companium-db), RLS admin-only.
// A tabela é populada pelo serviço de análise no servidor (service_role); a tela só lê.
// Nasce vazia: até o número conectar e o job rodar, não há linhas.

export type WhatsappSentiment = "positivo" | "neutro" | "negativo" | "misto" | "sem_dados";
export type WhatsappAttendanceStatus =
  | "sem_atividade"
  | "aguardando"
  | "em_andamento"
  | "resolvido";
export type WhatsappLeadTemperature = "quente" | "morno" | "frio" | "sem_dados";

export interface WhatsappGroupHighlight {
  tipo?: string;
  texto: string;
}

export interface WhatsappGroupInsight {
  account_id: string;
  group_id: string;
  group_name: string | null;
  window_start: string | null;
  window_end: string | null;
  message_count: number;
  participant_count: number;
  last_message_at: string | null;
  sentiment: WhatsappSentiment;
  sentiment_score: number | null;
  attendance_status: WhatsappAttendanceStatus;
  summary: string | null;
  highlights: WhatsappGroupHighlight[];
  analyzed_by: string | null;
  updated_at: string;
  // --- engajamento (migration 20261026c; ausentes = defaults) ---
  lead_temperature: WhatsappLeadTemperature;
  result_score: number | null;
  awaiting_reply: boolean;
  agent_reply_count: number;
  client_message_count: number;
  first_contact_at: string | null;
  intro_summary: string | null;
}

const TEMPERATURES: ReadonlySet<string> = new Set(["quente", "morno", "frio", "sem_dados"]);

const toNum = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function useWhatsappInsights(accountId: string = WHATSAPP_ACCOUNT_ID) {
  const [insights, setInsights] = useState<WhatsappGroupInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // select("*") para tolerar ambientes onde a migration de engajamento (20261026c)
      // ainda não rodou: as colunas novas apenas chegam como undefined (mapeadas p/ default).
      const { data, error: err } = await externalSupabase
        .from("whatsapp_group_insights")
        .select("*")
        .eq("account_id", accountId)
        .order("updated_at", { ascending: false });
      if (err) throw err;
      const rows: WhatsappGroupInsight[] = (data ?? []).map((r) => {
        const temp = String(r.lead_temperature ?? "");
        return {
          account_id: r.account_id,
          group_id: r.group_id,
          group_name: r.group_name ?? null,
          window_start: r.window_start ?? null,
          window_end: r.window_end ?? null,
          message_count: toNum(r.message_count),
          participant_count: toNum(r.participant_count),
          last_message_at: r.last_message_at ?? null,
          sentiment: (r.sentiment as WhatsappSentiment) ?? "sem_dados",
          sentiment_score: r.sentiment_score == null ? null : toNum(r.sentiment_score),
          attendance_status: (r.attendance_status as WhatsappAttendanceStatus) ?? "sem_atividade",
          summary: r.summary ?? null,
          highlights: Array.isArray(r.highlights) ? (r.highlights as WhatsappGroupHighlight[]) : [],
          analyzed_by: r.analyzed_by ?? null,
          updated_at: r.updated_at,
          lead_temperature: (TEMPERATURES.has(temp) ? temp : "sem_dados") as WhatsappLeadTemperature,
          result_score: r.result_score == null ? null : toNum(r.result_score),
          awaiting_reply: !!r.awaiting_reply,
          agent_reply_count: toNum(r.agent_reply_count),
          client_message_count: toNum(r.client_message_count),
          first_contact_at: r.first_contact_at ?? null,
          intro_summary: r.intro_summary ?? null,
        };
      });
      setInsights(rows);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // RLS (não-admin), tabela ausente (migration não aplicada) ou offline: segue vazio, mas sinaliza.
      console.warn("[useWhatsappInsights] não foi possível carregar:", msg);
      setError(msg);
      setInsights([]);
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { insights, loading, error, reload: load };
}
