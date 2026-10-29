import { useState, useEffect, useCallback, useRef } from "react";
import { externalSupabase } from "@/integrations/external-supabase/client";

// Fala com o backend whatsapp-admin (nginx: /api/whatsapp/*) usando o JWT do usuário logado.
// Mostra status real do canal e permite conectar (QR por stream), reconectar e reiniciar — tudo
// pela tela. RLS/role é checado no backend (admin OU whatsapp_editor).

const BASE = "/api/whatsapp";

export interface WhatsappStatus {
  pluginInstalled: boolean;
  configured: boolean;
  connected: boolean;
  running: boolean;
  enabledInConfig: boolean;
  active: boolean;
  displayName: string | null;
  account: string;
  lastStartAt: number | null;
  lastStopAt: number | null;
  lastError: string | null;
  ts: number | null;
}

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await externalSupabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function useWhatsappConnection(pollMs = 12000) {
  const [status, setStatus] = useState<WhatsappStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [reachable, setReachable] = useState(true); // backend instalado/alcançável?
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/status`, { headers: await authHeader() });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setStatus(await res.json());
      setReachable(true);
    } catch {
      // Backend ainda não instalado / fora do ar: a tela mostra o estado "não configurado".
      setReachable(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(t);
  }, [refresh, pollMs]);

  // Inicia o login e faz streaming (SSE) dos logs/QR. onEvent recebe ('log'|'done', data).
  const connect = useCallback(
    async (onEvent: (event: string, data: any) => void) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      const res = await fetch(`${BASE}/connect`, {
        method: "POST",
        headers: { ...(await authHeader()) },
        signal: ac.signal,
      });
      if (!res.ok || !res.body) throw new Error(`connect ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let event = "message";
          let dataStr = "";
          for (const line of chunk.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
          }
          let data: any = dataStr;
          try { data = JSON.parse(dataStr); } catch { /* texto cru */ }
          onEvent(event, data);
        }
      }
      void refresh();
    },
    [refresh],
  );

  const cancelConnect = useCallback(() => abortRef.current?.abort(), []);

  const post = useCallback(
    async (path: string) => {
      const res = await fetch(`${BASE}/${path}`, { method: "POST", headers: await authHeader() });
      if (!res.ok) throw new Error(`${path} ${res.status}`);
      await refresh();
      return res.json().catch(() => ({}));
    },
    [refresh],
  );

  return {
    status,
    loading,
    reachable,
    refresh,
    connect,
    cancelConnect,
    reconnect: () => post("reconnect"),
    disconnect: () => post("disconnect"),
    restart: () => post("restart"),
  };
}
