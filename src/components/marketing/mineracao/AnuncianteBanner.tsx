import { ArrowLeft, ExternalLink, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SpyAdvertiser } from "@/lib/adSpyApi";

type Props = {
  anunciante: SpyAdvertiser;
  /** Tema da busca de onde a pessoa veio. `null` enquanto carrega, ou se ela não existe mais. */
  temaDeOrigem: string | null;
  /** Volta à busca de origem; sem ela, sai do grid do anunciante para uma busca nova. */
  onBack: () => void;
};

/**
 * Cabeçalho do grid de UM anunciante ("minerar este anunciante").
 *
 * Entra NO LUGAR do formulário de busca, de propósito. Este grid é uma visão adicional, aberta a
 * partir de outra busca: com o formulário à vista, buscar dali trocaria o grid por uma busca nova e
 * a pessoa perderia o caminho de volta à original. Aqui o único movimento é voltar.
 */
export function AnuncianteBanner({ anunciante, temaDeOrigem, onBack }: Props) {
  const nome = anunciante.pageName || `Página ${anunciante.pageId}`;
  const temOrigem = Boolean(anunciante.fromRunId);

  return (
    <section
      aria-label={`Grid do anunciante ${nome}`}
      className="rounded-xl border border-primary/30 bg-primary/5 p-4"
    >
      <nav aria-label="Caminho" className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <button type="button" onClick={onBack} className="font-medium text-primary hover:underline">
          {temOrigem ? (temaDeOrigem ? `Busca “${temaDeOrigem}”` : "Busca anterior") : "Nova busca"}
        </button>
        <span aria-hidden>›</span>
        <span className="font-medium text-foreground">{nome}</span>
      </nav>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
            <Layers className="h-3 w-3" />
            Grid do anunciante
          </span>
          <h2 className="truncate text-lg font-semibold">{nome}</h2>
          <p className="max-w-2xl text-xs text-muted-foreground">
            {temOrigem
              ? "Aberto a partir de outra busca, que continua guardada com o que você marcou. "
              : ""}
            {/* Não é "todos os anúncios": a Biblioteca da Meta apaga o anúncio comercial que para de
                rodar, então o histórico do anunciante não está lá para ser buscado. */}
            Mostra o que este anunciante tem no ar hoje, sem filtro de qualidade. Anúncios que já
            pararam quase nunca aparecem: a Biblioteca da Meta deixa de exibi-los.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <a
              href={`https://www.facebook.com/ads/library/?view_all_page_id=${anunciante.pageId}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              Ver na Biblioteca
            </a>
          </Button>
          <Button size="sm" onClick={onBack}>
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            {temOrigem ? "Voltar à busca original" : "Fazer nova busca"}
          </Button>
        </div>
      </div>
    </section>
  );
}
