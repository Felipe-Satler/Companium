import { useState } from "react";
import { CheckCircle2, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useRevisaoComposicao } from "@/hooks/useAdComposer";
import {
  estaTrabalhando,
  temVersaoAnterior,
  type Composicao,
} from "@/lib/adComposerApi";
import { ComposicaoResultado, type AcoesRevisao } from "./ComposicaoResultado";

/**
 * Uma composição com a revisão: o resultado, as ações em cada anúncio e o "Salvar composição".
 *
 * É o que as três telas que mostram uma composição usam (Nova Composição, Composições Salvas e o
 * Orquestrador), para a revisão ser a mesma nas três. `ComposicaoResultado` continua só desenhando;
 * as ações vêm daqui, que é quem tem o cliente de requisição.
 *
 * Só quem pediu (ou admin) revisa e salva — o mesmo `canDelete` do resto; o worker confere de novo.
 * Os outros veem a composição com o selo "em revisão", sem os botões.
 */
export function RevisaoComposicao({ composicao }: { composicao: Composicao }) {
  const { editar, revisar, desfazer, salvar } = useRevisaoComposicao(composicao.id);
  const [salvando, setSalvando] = useState(false);
  const emRevisao = composicao.status === "revisao";
  const podeRevisar = emRevisao && composicao.canDelete;
  const revisandoAlgum = emRevisao && estaTrabalhando(composicao);

  const acoes: AcoesRevisao | undefined = podeRevisar
    ? {
        editar: (indice, campos) => editar.mutateAsync({ indice, campos }),
        revisar: (indice, pedido) => revisar.mutateAsync({ indice, pedido }),
        desfazer: (indice) => desfazer.mutateAsync(indice),
        podeDesfazer: (indice) => temVersaoAnterior(composicao, indice),
      }
    : undefined;

  const salvarTudo = async () => {
    setSalvando(true);
    try {
      await salvar.mutateAsync();
      toast.success("Composição salva.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="space-y-4">
      {emRevisao && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">Em revisão — ainda não foi salva</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {podeRevisar
                ? "Edite à mão ou peça ao agente que revise um anúncio. Quando estiver bom, salve."
                : "Quem pediu esta composição ainda está revisando."}
            </p>
          </div>
          {podeRevisar && (
            <Button
              size="sm"
              onClick={() => void salvarTudo()}
              disabled={salvando || revisandoAlgum}
              title={revisandoAlgum ? "Espere o agente terminar a revisão em curso" : undefined}
            >
              {salvando ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="mr-1.5 h-3.5 w-3.5" />
              )}
              Salvar composição
            </Button>
          )}
        </div>
      )}

      {composicao.status === "ok" && salvar.isSuccess && (
        <p className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
          <CheckCircle2 className="h-3.5 w-3.5" /> Salva em Composições Salvas.
        </p>
      )}

      <ComposicaoResultado composicao={composicao} acoes={acoes} />
    </div>
  );
}
