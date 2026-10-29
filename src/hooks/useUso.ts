import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/external-supabase/client";
import type { EscopoTelas, UsoAgenteRow, UsoDiaRow, UsoUsuario } from "@/lib/usage/agregar";

/** Parâmetros comuns das RPCs usage_* (datas yyyy-MM-dd no fuso de SP; null = todos). */
export type UsoParams = {
  from: string;
  to: string;
  users: string[] | null;
  screens: EscopoTelas;
};

export type UsoTransicao = { de: string; para: string; n: number; usuarios: number };
export type UsoClique = { screen_key: string; target_key: string; label: string | null; n: number; usuarios: number };
export type UsoSequencia = {
  a: string;
  b: string;
  c: string;
  la: string | null;
  lb: string | null;
  lc: string | null;
  n: number;
  usuarios: number;
};
export type UsoNavegacao = {
  transicoes: UsoTransicao[];
  cliques: UsoClique[];
  sequencias: UsoSequencia[];
  saidas: Array<{ screen_key: string; n: number }>;
};
export type UsoHorario = { dow: number; hora: number; active_ms: number; usuarios: number };
export type UsoSessao = {
  visitas: Array<{ id: string; session_id: string; screen_key: string; started_at: string; ended_at: string; active_ms: number }>;
  cliques: Array<{ visit_id: string | null; session_id: string; screen_key: string; seq: number; target_key: string; label: string | null; ts: string }>;
};
export type UsoCliqueBruto = {
  ts: string;
  user_id: string;
  session_id: string;
  seq: number;
  screen_key: string;
  target_key: string;
  label: string | null;
};

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

const rpcArgs = (p: UsoParams) => ({ p_from: p.from, p_to: p.to, p_users: p.users, p_screens: p.screens });

export function useUsoUsuarios() {
  return useQuery({
    queryKey: ["uso", "usuarios"],
    queryFn: () => rpc<UsoUsuario[]>("usage_usuarios", {}),
    staleTime: 10 * 60 * 1000,
  });
}

export function useUsoDiario(p: UsoParams, enabled: boolean) {
  return useQuery({
    queryKey: ["uso", "diario", p],
    queryFn: () => rpc<UsoDiaRow[]>("usage_diario", rpcArgs(p)),
    enabled,
    staleTime: 60 * 1000,
  });
}

export function useUsoHorarios(p: UsoParams, enabled: boolean) {
  return useQuery({
    queryKey: ["uso", "horarios", p],
    queryFn: () => rpc<UsoHorario[]>("usage_horarios", rpcArgs(p)),
    enabled,
    staleTime: 60 * 1000,
  });
}

export function useUsoNavegacao(p: UsoParams, enabled: boolean) {
  return useQuery({
    queryKey: ["uso", "navegacao", p],
    queryFn: () => rpc<UsoNavegacao>("usage_navegacao", rpcArgs(p)),
    enabled,
    staleTime: 60 * 1000,
  });
}

export function useUsoSessao(userId: string | null, dia: string | null) {
  return useQuery({
    queryKey: ["uso", "sessao", userId, dia],
    queryFn: () => rpc<UsoSessao>("usage_sessao", { p_user: userId, p_dia: dia }),
    enabled: !!userId && !!dia,
    staleTime: 60 * 1000,
  });
}

export type UsoAgentes = { bots: Array<{ id: string; label: string }>; linhas: UsoAgenteRow[] };

/** Agentes de IA: o filtro de telas não se aplica (agente não é tela). */
export function useUsoAgentes(p: UsoParams, enabled: boolean) {
  return useQuery({
    queryKey: ["uso", "agentes", p.from, p.to, p.users],
    queryFn: () => rpc<UsoAgentes>("usage_agentes", { p_from: p.from, p_to: p.to, p_users: p.users }),
    enabled,
    staleTime: 60 * 1000,
  });
}

export const buscarAgentes = (p: UsoParams) =>
  rpc<UsoAgentes>("usage_agentes", { p_from: p.from, p_to: p.to, p_users: p.users });

export const buscarNavegacao = (p: UsoParams) => rpc<UsoNavegacao>("usage_navegacao", rpcArgs(p));
export const buscarCliquesBrutos = (p: UsoParams) => rpc<UsoCliqueBruto[]>("usage_cliques_export", rpcArgs(p));
