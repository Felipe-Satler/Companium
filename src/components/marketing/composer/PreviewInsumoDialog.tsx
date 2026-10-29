import { Check, FileWarning, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSanitizedMarkdown } from "@/hooks/useSanitizedMarkdown";

/**
 * O conteúdo de um insumo, antes de decidir se ele entra.
 *
 * É a razão desta revisão existir: escolher análise numa lista de títulos era escolher às cegas, e
 * quem compõe precisava abrir a Biblioteca em outra aba para saber o que tinha dentro.
 *
 * ## Dois modos de mostrar o conteúdo, e o motivo de haver dois
 *
 * `corpo` é o conteúdo já renderizado pelo COMPONENTE da tela onde aquele insumo mora: a análise
 * sai no `AnalysisReport` (com as caixas de seção), o relatório no `RelatorioResultado` (com a
 * prioridade tipada e a tabela de números do snapshot). Markdown cru aqui mostraria menos do que a
 * tela de origem mostra — e decidir se uma análise serve olhando um texto corrido, quando a tela
 * dela separa público, ganchos e dissecação em blocos, é decidir com menos informação do que
 * existe.
 *
 * `conteudoMd` é o caminho simples, para o insumo que não tem componente próprio: o documento do
 * ClickUp, que é markdown e nada mais. Passa por `useSanitizedMarkdown` porque é texto de fora, e
 * as classes `prose` são as mesmas do `AnalysisReport`, para a tipografia não mudar de lugar para
 * lugar.
 */
export type PreviewInsumo = {
  titulo: string;
  subtitulo?: string | null;
  /** Markdown do conteúdo. `null` com `carregando: false` = não há o que mostrar. */
  conteudoMd?: string | null;
  /**
   * O conteúdo já renderizado. Tem precedência sobre `conteudoMd` — quando o insumo tem um
   * componente de origem, é ele que manda.
   */
  corpo?: React.ReactNode;
  carregando: boolean;
  /**
   * Por que não há conteúdo, quando é o caso. Separa "lemos e está vazio" de "não conseguimos
   * ler" — e a tela diz a diferença no rodapé, em vez de achatar as duas em "sem conteúdo".
   */
  motivo?: string | null;
  selecionado: boolean;
  onToggle: () => void;
};

type Props = {
  insumo: PreviewInsumo | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function PreviewInsumoDialog({ insumo, open, onOpenChange }: Props) {
  const html = useSanitizedMarkdown(insumo?.conteudoMd ?? null);
  if (!insumo) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Mais largo do que era: a tabela de dissecação do `AnalysisReport` tem cinco colunas de
          texto (min-w-[760px]) e a de números do relatório tem uma coluna por ponta. Em 3xl as duas
          saíam com rolagem horizontal dentro de um diálogo que já rola na vertical. */}
      <DialogContent className="max-h-[90vh] w-[95vw] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-6 text-base">{insumo.titulo}</DialogTitle>
        </DialogHeader>

        {insumo.subtitulo && (
          <p className="text-[11px] text-muted-foreground">{insumo.subtitulo}</p>
        )}

        {insumo.carregando ? (
          <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> carregando o conteúdo…
          </p>
        ) : insumo.corpo ? (
          <div className="min-w-0">{insumo.corpo}</div>
        ) : html ? (
          <div
            className="prose prose-sm max-w-none dark:prose-invert prose-headings:font-semibold prose-headings:text-foreground prose-p:text-muted-foreground prose-li:text-muted-foreground prose-strong:text-foreground"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <FileWarning className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
            <p className="text-sm font-medium">Conteúdo não encontrado no servidor</p>
            {insumo.motivo && (
              <p className="mx-auto mt-1 max-w-md text-[11px] text-muted-foreground">
                {insumo.motivo}
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end">
          <Button
            variant={insumo.selecionado ? "outline" : "default"}
            size="sm"
            onClick={insumo.onToggle}
          >
            <Check className="mr-1.5 h-3.5 w-3.5" />
            {insumo.selecionado ? "Tirar da composição" : "Usar na composição"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
