import { useState } from "react";
import { Loader2, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useCancelComposition } from "@/hooks/useAdComposer";
import type { Composicao } from "@/lib/adComposerApi";

/**
 * O botão de parar uma composição em andamento, com a confirmação.
 *
 * Fora de `ComposicaoResultado` de propósito: aquele componente só desenha a composição e é usado
 * em lugares sem cliente de requisição (testes, o orquestrador). Quem tem a ação é a tela.
 *
 * Só aparece para quem pode cancelar — quem pediu, ou admin; o worker confere de novo. Depois do
 * clique fica em "Cancelando…" até a linha deixar de estar `running`: o pedido volta na hora, mas a
 * composição só para quando a chamada de agente em curso morre.
 */
export function CancelarComposicao({ composicao }: { composicao: Composicao }) {
  const cancelar = useCancelComposition();
  const [confirmando, setConfirmando] = useState(false);
  if (composicao.status !== "running" || !composicao.canDelete) return null;

  const pedido = cancelar.isPending || (cancelar.isSuccess && cancelar.variables === composicao.id);
  const parar = () => {
    setConfirmando(false);
    cancelar.mutate(composicao.id, {
      onSuccess: () => toast.success("Cancelando — os anúncios que já ficaram prontos são mantidos."),
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : "Não foi possível cancelar"),
    });
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setConfirmando(true)} disabled={pedido}>
        {pedido ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Square className="mr-1.5 h-3.5 w-3.5" />
        )}
        {pedido ? "Cancelando…" : "Cancelar composição"}
      </Button>
      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent className="neu-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar a composição?</AlertDialogTitle>
            <AlertDialogDescription>
              Ela para no anúncio em que está. Os que já ficaram prontos continuam salvos; os que
              faltam não são escritos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar compondo</AlertDialogCancel>
            <AlertDialogAction onClick={parar}>Cancelar composição</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
