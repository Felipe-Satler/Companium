import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { CHAVE_PEDIDOS_ADMIN, resolverPedido, usePedidosAdmin, type PedidoDados } from "@/hooks/usePedidosDados";
import { rotuloTipoPedido } from "@/lib/usage/aviso";

const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

// O que fazer em cada tipo de pedido — o admin não precisa lembrar onde fica cada coisa.
const COMO_ATENDER: Record<string, string> = {
  copia: "Em Uso do Companium, filtre pelo usuário, exporte os CSVs e envie a ele. Depois registre a resposta aqui.",
  oposicao: "Na aba Usuários, ligue \"Não medir uso\" para esta pessoa. A partir daí o uso dela deixa de ser registrado.",
};

/** Pedidos feitos na página /privacidade (cópia dos dados, dúvida, oposição). */
export function AdminPedidosDados({ emailDe }: { emailDe: (id: string) => string }) {
  const { isAdmin } = useAuth();
  const { data: pedidos = [], isLoading, error } = usePedidosAdmin(isAdmin);
  const abertos = pedidos.filter((p) => p.status === "aberto");
  const resolvidos = pedidos.filter((p) => p.status === "resolvido");

  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;
  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (!pedidos.length) return <p className="neu-card p-6 text-sm text-muted-foreground">Nenhum pedido sobre dados de uso.</p>;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Abertos ({abertos.length})</h2>
        {abertos.length ? abertos.map((p) => <Pedido key={p.id} p={p} email={emailDe(p.user_id)} />) : (
          <p className="text-sm text-muted-foreground">Nenhum pedido aberto.</p>
        )}
      </section>
      {resolvidos.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Respondidos ({resolvidos.length})</h2>
          {resolvidos.map((p) => <Pedido key={p.id} p={p} email={emailDe(p.user_id)} />)}
        </section>
      )}
    </div>
  );
}

function Pedido({ p, email }: { p: PedidoDados; email: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [resposta, setResposta] = React.useState("");
  const [salvando, setSalvando] = React.useState(false);
  const aberto = p.status === "aberto";

  const resolver = async () => {
    if (!user) return;
    setSalvando(true);
    try {
      await resolverPedido(p.id, user.id, resposta);
      toast.success("Pedido marcado como respondido.");
      void qc.invalidateQueries({ queryKey: CHAVE_PEDIDOS_ADMIN });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <article className="neu-card space-y-2 p-4 text-sm">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-foreground">{rotuloTipoPedido(p.tipo)}</span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          {aberto ? <Clock className="size-3.5" aria-hidden="true" /> : <CheckCircle2 className="size-3.5 text-primary" aria-hidden="true" />}
          {email} · {dataHora(p.created_at)}
        </span>
      </header>
      <p className="whitespace-pre-wrap text-muted-foreground">{p.mensagem}</p>
      {aberto ? (
        <div className="space-y-2 pt-1">
          {COMO_ATENDER[p.tipo] && <p className="rounded bg-muted/40 px-2 py-1.5 text-xs text-foreground">{COMO_ATENDER[p.tipo]}</p>}
          <Textarea
            value={resposta}
            onChange={(e) => setResposta(e.target.value)}
            maxLength={2000}
            rows={3}
            placeholder="Resposta que a pessoa vai ver na página de privacidade (opcional)."
          />
          <Button size="sm" onClick={() => void resolver()} disabled={salvando}>
            {salvando ? "Salvando…" : "Marcar como respondido"}
          </Button>
        </div>
      ) : (
        p.resposta && (
          <p className="whitespace-pre-wrap rounded bg-muted/40 px-2 py-1.5 text-foreground">
            <span className="text-xs font-semibold uppercase text-muted-foreground">Resposta: </span>
            {p.resposta}
          </p>
        )
      )}
    </article>
  );
}
