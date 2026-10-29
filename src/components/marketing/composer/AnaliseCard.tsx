import { Calendar, Check, Eye, User } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CoverMosaico } from "@/components/marketing/mineracao/CoverMosaico";
import type { LibraryEntrySummary } from "@/lib/adSpyApi";

/**
 * Uma análise da Biblioteca na escolha de insumos, com a cara que ela tem em Análises Salvas.
 *
 * O card genérico (`InsumoCard`) servia para tudo e por isso mostrava pouco: título, tema e a
 * contagem de anúncios. Escolher análise assim é escolher por um título que alguém escreveu com
 * pressa. O mosaico de capas é o que torna a lista reconhecível de relance — "a dos antes e
 * depois", "a dos vídeos de consultório" —, e as mesmas etiquetas de especialidade, autoria e data
 * da Biblioteca evitam que a mesma análise pareça duas coisas diferentes em duas telas.
 *
 * A gramática de SELEÇÃO é a desta tela, não a da Biblioteca:
 *
 *   - `border-2` PERMANENTE trocando só a cor, como no `AdCard` e no `InsumoCard`. Borda que
 *     aparece ao selecionar empurraria o layout, e a grade pularia a cada clique.
 *   - o botão de ligar é `role="checkbox"` com `aria-checked`, SEPARADO do corpo clicável que abre
 *     o conteúdo. Botão dentro de botão não é HTML válido, e clicar em "ver" não pode ligar o
 *     insumo.
 *
 * A estrela não vem: favoritar é da Biblioteca, que é onde a decisão "esta é boa" se toma. Aqui o
 * favorito só FILTRA — repetir a ação em duas telas daria dois lugares para o mesmo estado
 * divergir.
 */
export function AnaliseCard({
  entry,
  casaComOCliente,
  selecionado,
  onToggle,
  onAbrir,
}: {
  entry: LibraryEntrySummary;
  /** Alguma especialidade da análise é do cliente. Destaca as etiquetas que explicam a ordem. */
  casaComOCliente: boolean;
  selecionado: boolean;
  onToggle: () => void;
  onAbrir: () => void;
}) {
  const nome = entry.titulo || entry.tema;
  const data = new Date(entry.criado_em).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  return (
    <article
      className={`relative flex flex-col overflow-hidden rounded-xl border-2 bg-card transition-colors ${
        selecionado ? "border-primary" : "border-border hover:border-primary/40"
      }`}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            role="checkbox"
            aria-checked={selecionado}
            aria-label={selecionado ? `Tirar "${nome}" da composição` : `Usar "${nome}" na composição`}
            onClick={onToggle}
            // Sobre a capa, não acima do texto: é o canto que o olho procura depois de reconhecer
            // a imagem, e manter o corpo inteiro clicável deixa o alvo do preview grande.
            className={`absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-lg border backdrop-blur transition-colors ${
              selecionado
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background/80 text-muted-foreground hover:border-primary hover:text-primary"
            }`}
          >
            <Check className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          {selecionado ? "Tirar da composição" : "Usar na composição"}
        </TooltipContent>
      </Tooltip>

      <button type="button" onClick={onAbrir} className="flex flex-1 flex-col text-left">
        {/* Mais baixa que a da Biblioteca: aqui cabem três por linha e a capa é pista, não capa. */}
        <CoverMosaico coverAdIds={entry.coverAdIds} className="aspect-[21/9]" />

        <div className="flex flex-1 flex-col gap-1.5 p-3">
          <h4 className="line-clamp-2 text-xs font-semibold">{nome}</h4>
          {entry.titulo && entry.titulo !== entry.tema && (
            <p className="line-clamp-1 text-[11px] text-muted-foreground">Tema: {entry.tema}</p>
          )}

          <div className="flex flex-wrap gap-1">
            {entry.especialidades.map((e) => (
              <span
                key={e}
                className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
                  // A especialidade que casa com o cliente vem destacada: é o que faz a ordenação
                  // ser visível em vez de só mudar a ordem sem explicar por quê.
                  casaComOCliente
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {e}
              </span>
            ))}
          </div>

          <div className="mt-auto flex flex-wrap items-center gap-x-2.5 gap-y-1 pt-1 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <User className="h-3 w-3" />
              {entry.saved_by_name || "—"}
            </span>
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {data}
            </span>
            <span>
              {entry.adCount} anúncio{entry.adCount === 1 ? "" : "s"}
            </span>
          </div>

          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-primary">
            <Eye className="h-3 w-3" />
            ver conteúdo
          </span>
        </div>
      </button>
    </article>
  );
}
