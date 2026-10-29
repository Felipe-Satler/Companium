import { AlertTriangle, Loader2 } from "lucide-react";
import { useImagensDaArte } from "@/hooks/useArtes";
import type { Arte } from "@/lib/artesApi";
import { PreviewDoSlide } from "@/posts/SlideDaArte";
import { getFormato } from "../../../../shared/ad-formats";

/**
 * Um card da grade de Artes Salvas: a primeira página em miniatura (o mesmo componente do arquivo),
 * de quem é, quantas páginas, orgânico ou pago, e quando.
 *
 * A miniatura busca só o logo e a foto da PRIMEIRA página — a grade pode ter dezenas de cards.
 */

export const LARGURA_MINIATURA = 220;

function data(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

export function ArteCard({ arte, onAbrir }: { arte: Arte; onAbrir: () => void }) {
  const imagens = useImagensDaArte(arte.status === "pronta" ? arte : null, { soDoSlide: 0 });
  const post = arte.post;
  const formato = arte.formato_origem ? getFormato(arte.formato_origem) : null;
  const titulo = post?.slides[0]?.titulo || (arte.status === "running" ? "Gerando…" : "Sem título");
  return (
    <button
      type="button"
      onClick={onAbrir}
      className="group flex w-full flex-col overflow-hidden rounded-xl border border-border bg-card text-left shadow-sm transition-colors hover:border-primary/50"
    >
      <div className="flex justify-center bg-muted/40" style={{ minHeight: (LARGURA_MINIATURA * 5) / 4 }}>
        {arte.status === "pronta" && post ? (
          <PreviewDoSlide post={post} indice={0} marca={arte.marca} imagens={imagens} largura={LARGURA_MINIATURA} />
        ) : arte.status === "running" ? (
          <span className="flex items-center gap-1.5 self-center text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> o agente está dividindo o anúncio…
          </span>
        ) : (
          <span className="flex items-center gap-1.5 self-center px-4 text-center text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {arte.error || "A arte falhou."}
          </span>
        )}
      </div>
      <div className="space-y-1 p-3">
        <p className="line-clamp-2 text-[13px] font-semibold leading-snug">{titulo}</p>
        <p className="truncate text-xs text-muted-foreground">{arte.nome_exibicao || arte.cliente}</p>
        <div className="flex flex-wrap gap-1 pt-0.5 text-[10px] font-medium">
          <span className="rounded bg-muted px-1.5 py-0.5">{formato?.label ?? arte.formato_origem ?? "—"}</span>
          {post && (
            <span className="rounded bg-muted px-1.5 py-0.5">
              {post.slides.length === 1 ? "post único" : `carrossel · ${post.slides.length}`}
            </span>
          )}
          <span className={`rounded px-1.5 py-0.5 ${arte.opcoes?.uso === "pago" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-primary/10 text-primary"}`}>
            {arte.opcoes?.uso === "pago" ? "pago" : "orgânico"}
          </span>
          <span className="ml-auto text-muted-foreground">{data(arte.criado_em)}</span>
        </div>
      </div>
    </button>
  );
}
