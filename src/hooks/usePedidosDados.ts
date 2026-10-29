import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/external-supabase/client";
import type { TipoPedido } from "@/lib/usage/aviso";

/** Pedido sobre os dados de uso (tabela usage_data_requests, formulário da página /privacidade). */
export type PedidoDados = {
  id: string;
  user_id: string;
  tipo: TipoPedido;
  mensagem: string;
  status: "aberto" | "resolvido";
  resposta: string | null;
  created_at: string;
  resolved_at: string | null;
};

const CAMPOS = "id,user_id,tipo,mensagem,status,resposta,created_at,resolved_at";

export const chaveMeusPedidos = (uid: string | null) => ["pedidos-dados", "meus", uid] as const;
export const CHAVE_PEDIDOS_ADMIN = ["pedidos-dados", "admin"] as const;

export function useMeusPedidos(uid: string | null) {
  return useQuery({
    queryKey: chaveMeusPedidos(uid),
    enabled: !!uid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("usage_data_requests")
        .select(CAMPOS)
        .eq("user_id", uid!)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as PedidoDados[];
    },
  });
}

/** A própria pessoa está fora da medição (pediu oposição e o admin desligou)? */
export function useMeuOptout(uid: string | null) {
  return useQuery({
    queryKey: ["uso-optout", uid],
    enabled: !!uid,
    queryFn: async () => {
      const { data, error } = await supabase.from("usage_optout").select("user_id").eq("user_id", uid!).maybeSingle();
      if (error) return false;
      return !!data;
    },
  });
}

export async function criarPedido(uid: string, tipo: TipoPedido, mensagem: string) {
  const { error } = await supabase.from("usage_data_requests").insert({ user_id: uid, tipo, mensagem });
  if (error) throw new Error(error.message);
}

/** Admin: todos os pedidos, abertos primeiro. */
export function usePedidosAdmin(enabled: boolean) {
  return useQuery({
    queryKey: CHAVE_PEDIDOS_ADMIN,
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("usage_data_requests")
        .select(CAMPOS)
        .order("status", { ascending: true })
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as PedidoDados[];
    },
  });
}

export async function resolverPedido(id: string, adminId: string, resposta: string) {
  const { error } = await supabase
    .from("usage_data_requests")
    .update({ status: "resolvido", resposta: resposta.trim() || null, resolved_at: new Date().toISOString(), resolved_by: adminId })
    .eq("id", id);
  if (error) throw new Error(error.message);
}
