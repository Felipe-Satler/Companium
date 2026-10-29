import type { ReactNode } from "react";
import {
  FILTRO_FONTES,
  TAG_LABEL,
  TODAS,
  type TagFonte,
} from "@/components/marketing/mineracao/filtroFontes";
import type { SpySettings } from "@/lib/adSpyApi";

/**
 * As tags "vale para: Meta · TikTok" de cada filtro do formulário.
 *
 * Com várias fontes na mesma busca, cada filtro vale para um subconjunto delas — e um filtro que
 * parece valer para todas mas não vale é exatamente o que faz alguém apertar a longevidade
 * esperando filtrar reels. A tag diz a que fonte o campo se refere; a fonte que vale mas não está
 * marcada aparece apagada, para a pessoa saber que o campo acordaria se ela a marcasse.
 */

const COR: Record<TagFonte, string> = {
  meta: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  google: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  instagram_ads: "bg-pink-500/10 text-pink-700 dark:text-pink-300",
  instagram: "bg-pink-500/10 text-pink-700 dark:text-pink-300",
  tiktok: "bg-slate-500/15 text-slate-800 dark:text-slate-200",
  tiktok_organic: "bg-slate-500/15 text-slate-800 dark:text-slate-200",
  youtube: "bg-red-500/10 text-red-700 dark:text-red-300",
};

export function FonteTags({ fontes, ativas }: { fontes: TagFonte[]; ativas: Set<TagFonte> }) {
  if (fontes.length === TODAS.length) {
    return (
      <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">
        todas as fontes
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap gap-1" aria-label={`Vale para: ${fontes.map((f) => TAG_LABEL[f]).join(", ")}`}>
      {fontes.map((f) => (
        <span
          key={f}
          title={ativas.has(f) ? undefined : `${TAG_LABEL[f]} não está marcada nesta busca`}
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${COR[f]} ${ativas.has(f) ? "" : "opacity-40"}`}
        >
          {TAG_LABEL[f]}
        </span>
      ))}
    </span>
  );
}

/**
 * Um campo de filtro com as tags das fontes a que se aplica. Sem nenhuma dessas fontes marcada,
 * o campo apaga e diz por quê — continua editável, porque marcar a fonte o faz valer de novo.
 */
export function CampoFiltro({
  filtro,
  ativas,
  rotulo,
  children,
  className = "",
}: {
  filtro: keyof SpySettings;
  ativas: Set<TagFonte>;
  rotulo: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const fontes = FILTRO_FONTES[filtro] ?? TODAS;
  const vale = fontes.some((f) => ativas.has(f));
  return (
    <div className={`space-y-2 ${className}`} data-filtro={filtro} data-aplica={vale ? "sim" : "nao"}>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        {rotulo}
        <FonteTags fontes={fontes} ativas={ativas} />
      </div>
      <div className={vale ? "space-y-2" : "space-y-2 opacity-50"}>{children}</div>
      {!vale && (
        <p className="text-[11px] italic text-muted-foreground">Nenhuma fonte marcada usa este filtro.</p>
      )}
    </div>
  );
}

/** Cabeçalho de um bloco de filtros: o tipo de fonte e o que é "qualidade" para ele. */
export function BlocoFiltros({ titulo, descricao, children }: { titulo: string; descricao: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-xs font-semibold">{titulo}</h3>
        <p className="text-[11px] text-muted-foreground">{descricao}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}
