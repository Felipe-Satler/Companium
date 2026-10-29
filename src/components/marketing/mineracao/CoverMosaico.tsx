import { Image as ImageIcon, Library } from "lucide-react";
import { useSpyMedia } from "@/hooks/useAdSpy";

/**
 * A capa de uma análise salva: até quatro miniaturas dos anúncios analisados, lado a lado.
 *
 * É o que faz uma lista de análises ser reconhecível de relance — "a dos antes e depois", "a dos
 * vídeos de consultório" —, porque o título que alguém escreveu raramente descreve o que se vê.
 * As caixas são separadas por um fio (`gap-px` sobre `bg-border`), não por margem: a separação
 * aparece sem introduzir espaço que desalinharia a grade.
 *
 * Mora aqui, e não dentro de uma tela, porque é usada em duas — a Biblioteca (Análises Salvas) e a
 * escolha de insumos do Composer. Duas cópias do mesmo mosaico divergiriam na primeira mudança.
 */

function Thumb({ adId }: { adId: number }) {
  const url = useSpyMedia(adId, "thumb", true);
  return url ? (
    <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
  ) : (
    <div className="flex h-full w-full items-center justify-center bg-muted">
      <ImageIcon className="h-4 w-4 text-muted-foreground/60" />
    </div>
  );
}

export function CoverMosaico({
  coverAdIds,
  className = "aspect-[16/9]",
}: {
  coverAdIds: number[];
  /** A proporção da capa. O card do Composer é mais baixo que o da Biblioteca. */
  className?: string;
}) {
  const covers = coverAdIds.slice(0, 4);
  return (
    <div className={`grid grid-cols-4 gap-px overflow-hidden bg-border ${className}`}>
      {covers.length ? (
        covers.map((id) => <Thumb key={id} adId={id} />)
      ) : (
        <div className="col-span-4 flex items-center justify-center bg-muted">
          <Library className="h-6 w-6 text-muted-foreground/60" />
        </div>
      )}
    </div>
  );
}
