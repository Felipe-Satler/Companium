import { ChevronsUpDown, Download, ExternalLink, Loader2, Pickaxe } from "lucide-react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDownloadVideo } from "@/hooks/useAdSpy";
import { adOpenLinks, advertiserOf, type SpyAd } from "@/lib/adSpyApi";

/**
 * As duas ações que o anúncio oferece: abrir em outro lugar e baixar o vídeo.
 *
 * Moram aqui, e não no card, porque aparecem no card E no detalhe. Duplicar a marcação já tinha
 * feito os dois divergirem — no detalhe eram botões largos empilhados, no card um menu e um ícone.
 * Componente único é o que mantém os dois iguais sem ninguém precisar lembrar.
 */

const BOTAO =
  "flex h-8 items-center justify-center rounded-lg border border-border text-muted-foreground " +
  "transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed " +
  "disabled:opacity-40";

/** Menu com os destinos que EXISTEM para este anúncio. Sem nenhum, não se desenha. */
export function AbrirMenu({ ad }: { ad: SpyAd }) {
  const destinos = adOpenLinks(ad);
  if (!destinos.length) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Abrir o anúncio em outro lugar"
          className={`${BOTAO} gap-1 px-2 text-xs font-medium`}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Abrir
          <ChevronsUpDown className="h-3 w-3 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {destinos.map((item) => (
          <DropdownMenuItem key={item.key} asChild>
            <a href={item.href} target="_blank" rel="noopener noreferrer">
              {item.label}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Baixar o vídeo. `media_url` é o link da CDN (expira) e `media_path` é a cópia no bucket
 * (durável): basta um dos dois para valer a pena oferecer, e qual deles serviu é problema do
 * worker.
 */
export function BaixarVideoButton({ ad }: { ad: SpyAd }) {
  const download = useDownloadVideo();
  if (ad.media_type !== "video" || !(ad.media_url || ad.media_path)) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() =>
            download.mutate(ad.id, {
              onError: (err) =>
                toast.error(err instanceof Error ? err.message : "Não foi possível baixar o vídeo"),
            })
          }
          disabled={download.isPending}
          aria-label="Baixar o vídeo do anúncio"
          className={`${BOTAO} w-8`}
        >
          {download.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>Baixar o vídeo</TooltipContent>
    </Tooltip>
  );
}

/**
 * "Minerar este anunciante": abre uma busca só com os anúncios da página que publicou este.
 *
 * Só se desenha quando há o que fazer — anúncio da Meta com o id da página, e uma tela que saiba
 * começar a busca (`onMine`). Na Biblioteca de análises salvas, por exemplo, não aparece.
 */
export function MinerarAnuncianteButton({
  ad,
  onMine,
  disabled,
}: {
  ad: SpyAd;
  onMine?: (ad: SpyAd) => void;
  disabled?: boolean;
}) {
  if (!onMine || !advertiserOf(ad)) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onMine(ad)}
          disabled={disabled}
          aria-label={`Minerar os anúncios de ${ad.page_name || "este anunciante"}`}
          className={`${BOTAO} w-8`}
        >
          <Pickaxe className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent>Minerar este anunciante</TooltipContent>
    </Tooltip>
  );
}
