import { useState, useEffect } from "react";
import { externalSupabase } from "@/integrations/external-supabase/client";

// Análise diária da IA por anúncio (tabela `meta_ads_ad_analysis`, projeto companium-db). É gerada
// 1x/dia pelo robô analysis.ts (meta-ads-bot) ao virar o dia e SOBRESCRITA por Ad_ID — sempre a
// leitura mais recente. Aqui é SÓ leitura (RLS `authenticated`; o robô escreve com service_role).
export type Tendencia = "melhorando" | "estavel" | "piorando";

export interface AdAnalysis {
  adId: string;
  resumo: string;
  tendencia: Tendencia | null;
  pontosPositivos: string[];
  pontosMelhorar: string[];
  pontosAjustar: string[];
  modelo: string | null;
  diaAnalisado: string | null;
  atualizadoEm: string | null;
}

// jsonb pode voltar como array (ideal), string JSON ou null — normaliza defensivamente.
function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter((s) => s.trim().length > 0);
  if (typeof v === "string" && v.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed.map((x) => String(x)).filter((s) => s.trim().length > 0) : [];
    } catch {
      return [];
    }
  }
  return [];
}

interface State {
  loading: boolean;
  error: string | null;
  data: AdAnalysis | null;
}

/**
 * Busca a análise de VÁRIOS anúncios de uma vez (para o Relatório de Marketing) e devolve um mapa por
 * Ad_ID no formato que o snapshot espera (`CriativoAnalise`). Falha silenciosa: a análise é opcional,
 * então erro/ausência viram mapa vazio — o relatório sai sem o "porquê", nunca quebra por causa disso.
 */
export type CriativoAnaliseLite = {
  resumo: string;
  tendencia: Tendencia | null;
  positivos: string[];
  melhorar: string[];
  ajustar: string[];
};

export async function fetchAdAnalyses(
  adIds: (string | null | undefined)[],
): Promise<Record<string, CriativoAnaliseLite>> {
  const ids = [...new Set(adIds.map((s) => (s ?? "").trim()).filter((s) => s.length > 0))];
  if (!ids.length) return {};

  const { data, error } = await externalSupabase
    .from("meta_ads_ad_analysis")
    .select("ad_id,resumo,tendencia,pontos_positivos,pontos_melhorar,pontos_ajustar")
    .in("ad_id", ids);

  if (error || !data) return {};

  const out: Record<string, CriativoAnaliseLite> = {};
  for (const row of data as Record<string, unknown>[]) {
    const id = String(row.ad_id ?? "").trim();
    if (!id) continue;
    const t = String(row.tendencia ?? "");
    out[id] = {
      resumo: String(row.resumo ?? "").trim(),
      tendencia: t === "melhorando" || t === "estavel" || t === "piorando" ? t : null,
      positivos: toStringArray(row.pontos_positivos),
      melhorar: toStringArray(row.pontos_melhorar),
      ajustar: toStringArray(row.pontos_ajustar),
    };
  }
  return out;
}

// Busca a análise de UM anúncio pelo Ad_ID. `enabled` evita a query enquanto o modal está
// fechado (ou quando o anúncio não tem Ad_ID numérico — anúncios legados sem id).
export function useAdAnalysis(adId: string | null | undefined, enabled: boolean): State {
  const [state, setState] = useState<State>({ loading: false, error: null, data: null });

  useEffect(() => {
    const id = (adId ?? "").trim();
    if (!enabled || !id) {
      setState({ loading: false, error: null, data: null });
      return;
    }

    let cancelled = false;
    setState({ loading: true, error: null, data: null });

    (async () => {
      const { data, error } = await externalSupabase
        .from("meta_ads_ad_analysis")
        .select(
          "ad_id,resumo,tendencia,pontos_positivos,pontos_melhorar,pontos_ajustar,modelo,dia_analisado,updated_at",
        )
        .eq("ad_id", id)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        setState({ loading: false, error: error.message, data: null });
        return;
      }
      if (!data) {
        setState({ loading: false, error: null, data: null });
        return;
      }

      const t = String((data as { tendencia?: string }).tendencia ?? "");
      setState({
        loading: false,
        error: null,
        data: {
          adId: id,
          resumo: String((data as { resumo?: string }).resumo ?? "").trim(),
          tendencia: t === "melhorando" || t === "estavel" || t === "piorando" ? t : null,
          pontosPositivos: toStringArray((data as { pontos_positivos?: unknown }).pontos_positivos),
          pontosMelhorar: toStringArray((data as { pontos_melhorar?: unknown }).pontos_melhorar),
          pontosAjustar: toStringArray((data as { pontos_ajustar?: unknown }).pontos_ajustar),
          modelo: (data as { modelo?: string }).modelo ?? null,
          diaAnalisado: (data as { dia_analisado?: string }).dia_analisado ?? null,
          atualizadoEm: (data as { updated_at?: string }).updated_at ?? null,
        },
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [adId, enabled]);

  return state;
}
