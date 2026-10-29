import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/external-supabase/client";
import type { Equipe, Pertencimento } from "@/lib/usage/equipes";

/* Equipes (cadastro na Administração; comparação na aba Equipes de /uso). Pertencimento só muda
 * pelas RPCs equipe_atribuir / equipe_arquivar, que guardam o histórico. */

export type EquipeAdmin = { id: string; nome: string; arquivada_em: string | null };
export type MembroAdmin = { user_id: string; equipe_id: string; fim: string | null };

export const CHAVE_EQUIPES_ADMIN = ["equipes", "admin"] as const;

export function useEquipesAdmin(enabled: boolean) {
  return useQuery({
    queryKey: CHAVE_EQUIPES_ADMIN,
    enabled,
    queryFn: async () => {
      const [eq, mb] = await Promise.all([
        supabase.from("equipes").select("id,nome,arquivada_em").order("nome"),
        supabase.from("equipe_membros").select("user_id,equipe_id,fim"),
      ]);
      if (eq.error) throw new Error(eq.error.message);
      if (mb.error) throw new Error(mb.error.message);
      const equipes = (eq.data ?? []) as EquipeAdmin[];
      const membros = (mb.data ?? []) as MembroAdmin[];
      // Equipe atual de cada usuário (pertencimento aberto) e quais equipes já tiveram alguém.
      const atual = new Map(membros.filter((m) => m.fim === null).map((m) => [m.user_id, m.equipe_id]));
      const comHistorico = new Set(membros.map((m) => m.equipe_id));
      return { equipes, atual, comHistorico };
    },
  });
}

const falhou = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};

export async function criarEquipe(nome: string) {
  const { error } = await supabase.from("equipes").insert({ nome: nome.trim() });
  if (error?.message.includes("duplicate") || error?.message.includes("ux_equipes_nome")) throw new Error("Já existe uma equipe com esse nome.");
  falhou(error);
}

export async function renomearEquipe(id: string, nome: string) {
  const { error } = await supabase.from("equipes").update({ nome: nome.trim() }).eq("id", id);
  if (error?.message.includes("duplicate") || error?.message.includes("ux_equipes_nome")) throw new Error("Já existe uma equipe com esse nome.");
  falhou(error);
}

/** Só para equipe que nunca teve membro; com histórico, use arquivarEquipe. */
export async function excluirEquipe(id: string) {
  const { error } = await supabase.from("equipes").delete().eq("id", id);
  falhou(error);
}

export async function arquivarEquipe(id: string) {
  const { error } = await supabase.rpc("equipe_arquivar", { p_equipe: id });
  falhou(error);
}

export async function reativarEquipe(id: string) {
  const { error } = await supabase.from("equipes").update({ arquivada_em: null }).eq("id", id);
  falhou(error);
}

/** Muda a equipe do usuário (null = tira de qualquer equipe). */
export async function atribuirEquipe(userId: string, equipeId: string | null) {
  const { error } = await supabase.rpc("equipe_atribuir", { p_user: userId, p_equipe: equipeId });
  falhou(error);
}

export type UsoEquipesDados = { equipes: Equipe[]; membros: Pertencimento[] };

export const buscarUsoEquipes = async (): Promise<UsoEquipesDados> => {
  const { data, error } = await supabase.rpc("usage_equipes", {});
  falhou(error);
  return data as UsoEquipesDados;
};

export function useUsoEquipes(enabled: boolean) {
  return useQuery({ queryKey: ["uso", "equipes"], queryFn: buscarUsoEquipes, enabled, staleTime: 60 * 1000 });
}
