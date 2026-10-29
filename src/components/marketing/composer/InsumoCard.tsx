import { Check, Eye } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Um insumo da composição: card que se liga ou desliga, e que abre o conteúdo ao ser clicado.
 *
 * Gramática copiada do `AdCard` da Mineração, de propósito — quem já selecionou anúncios lá sabe
 * usar isto aqui sem aprender nada novo:
 *
 *   - `border-2` PERMANENTE trocando só a cor. Borda que aparece ao selecionar empurraria o
 *     layout, e a coluna inteira pularia a cada clique.
 *   - selecionar é um botão `role="checkbox"` com `aria-checked`, SEPARADO do corpo clicável.
 *     Botão dentro de botão não é HTML válido, e clicar em "ver" não pode ligar o insumo.
 */
export type InsumoCardProps = {
  titulo: string;
  /** Linha de apoio: período do relatório, pasta do documento, tema da análise. */
  subtitulo?: string | null;
  /** Etiquetas curtas: especialidade, prioridade, "casado pelo título". */
  chips?: { texto: string; tom?: "neutro" | "alerta" | "primario" }[];
  selecionado: boolean;
  onToggle: () => void;
  onAbrir: () => void;
  /** Teto de seleção atingido: não dá para ligar mais, mas desligar sempre dá. */
  bloqueado?: boolean;
  rodape?: React.ReactNode;
};

const TOM: Record<string, string> = {
  neutro: "bg-muted text-muted-foreground",
  alerta: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  primario: "bg-primary/10 text-primary",
};

export function InsumoCard({
  titulo,
  subtitulo,
  chips = [],
  selecionado,
  onToggle,
  onAbrir,
  bloqueado,
  rodape,
}: InsumoCardProps) {
  return (
    <article
      className={`flex flex-col overflow-hidden rounded-xl border-2 bg-card transition-colors ${
        selecionado ? "border-primary" : "border-border hover:border-primary/40"
      }`}
    >
      <div className="flex items-start gap-2 p-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              role="checkbox"
              aria-checked={selecionado}
              aria-label={selecionado ? `Tirar "${titulo}" da composição` : `Usar "${titulo}" na composição`}
              onClick={onToggle}
              disabled={bloqueado && !selecionado}
              className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                selecionado
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:border-primary hover:text-primary"
              }`}
            >
              <Check className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {selecionado ? "Tirar da composição" : "Usar na composição"}
          </TooltipContent>
        </Tooltip>

        <button type="button" onClick={onAbrir} className="min-w-0 flex-1 text-left">
          <p className="line-clamp-2 text-xs font-semibold">{titulo}</p>
          {subtitulo && (
            <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{subtitulo}</p>
          )}
          {chips.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {chips.map((c) => (
                <span
                  key={c.texto}
                  className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${TOM[c.tom ?? "neutro"]}`}
                >
                  {c.texto}
                </span>
              ))}
            </div>
          )}
          <span className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-medium text-primary">
            <Eye className="h-3 w-3" />
            ver conteúdo
          </span>
        </button>
      </div>
      {rodape && (
        <div className="border-t border-border px-3 py-1 text-[10px] text-muted-foreground">
          {rodape}
        </div>
      )}
    </article>
  );
}
