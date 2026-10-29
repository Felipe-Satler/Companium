import { CalendarDays, Eye, Facebook, Heart, Instagram, MessageCircle, Music2, Search, Users, Youtube } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { compactNumber, isOrganicAd, PLATFORM_LABEL, type SpyAd } from "@/lib/adSpyApi";

/**
 * O que muda no card conforme a fonte da peça — e só isso.
 *
 * O card é o mesmo para as três fontes, de propósito: numa busca misturada a pessoa compara peça
 * com peça, e três layouts diferentes fariam comparar layout. O que muda é o SINAL de desempenho,
 * porque ele é de natureza diferente: anúncio pago se prova por tempo no ar e replicação; post
 * orgânico, por visualização e engajamento. Mora aqui, e não duplicado no card e no detalhe, pelo
 * mesmo motivo do AdActions.
 */

const BADGE: Record<string, { icon: typeof Facebook; className: string }> = {
  meta: { icon: Facebook, className: "bg-blue-500/10 text-blue-700 dark:text-blue-300" },
  google: { icon: Search, className: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  instagram: { icon: Instagram, className: "bg-pink-500/10 text-pink-700 dark:text-pink-300" },
  tiktok: { icon: Music2, className: "bg-slate-500/15 text-slate-800 dark:text-slate-200" },
  tiktok_organic: { icon: Music2, className: "bg-slate-500/15 text-slate-800 dark:text-slate-200" },
  youtube: { icon: Youtube, className: "bg-red-500/10 text-red-700 dark:text-red-300" },
};

/** Fonte da peça, com "orgânico" escrito quando não é anúncio. */
export function SourceBadge({ ad }: { ad: SpyAd }) {
  // Anúncio da Biblioteca da Meta achado pela trilha "Instagram › Anúncios": é anúncio Meta (link,
  // id e replicação de lá), mas a pessoa pediu Instagram, e é isso que o selo diz.
  const igAds = ad.source === "meta" && ad.found_via === "instagram_ads";
  const b = igAds ? BADGE.instagram : (BADGE[ad.source] ?? BADGE.meta);
  const Icon = b.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${b.className}`}
    >
      <Icon className="h-3 w-3" />
      {igAds ? "Instagram Ads" : (PLATFORM_LABEL[ad.source] ?? ad.source)}
      {isOrganicAd(ad) && <span className="font-normal opacity-80">· orgânico</span>}
    </span>
  );
}

const PILL =
  "inline-flex items-center gap-1 rounded-full bg-slate-800 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white dark:bg-slate-700";

/**
 * O selo do canto: o número que mais pesa. Anúncio: dias no ar. Post: visualizações — a idade de
 * um post não prova nada, e mostrá-la no mesmo selo escuro dos "dias no ar" a faria parecer prova.
 */
export function HeadlinePill({ ad }: { ad: SpyAd }) {
  if (isOrganicAd(ad)) {
    const views = compactNumber(ad.metrics?.views);
    if (!views) return null;
    return (
      <span className={PILL}>
        <Eye className="h-3.5 w-3.5" />
        {views}
      </span>
    );
  }
  if (typeof ad.days_running !== "number") return null;
  return (
    <span className={PILL}>
      <CalendarDays className="h-3.5 w-3.5" />
      {ad.days_running} {ad.days_running === 1 ? "dia" : "dias"}
    </span>
  );
}

/**
 * A linha de destaque verde: o sinal de "isto está funcionando" no vocabulário da fonte.
 *
 *   Meta      -> N anúncios usam esse criativo (replicação)
 *   Instagram -> visualizações · curtidas · comentários (+ seguidores no tooltip)
 *   YouTube   -> o mesmo do Instagram (+ inscritos no tooltip)
 *   TikTok    -> alcance estimado / CTR / curtidas, o que a biblioteca informar
 */
export function PerformanceLine({ ad, compact = false }: { ad: SpyAd; compact?: boolean }) {
  const m = ad.metrics ?? {};
  const destaque = compact ? "text-sm font-bold" : "text-lg font-bold";

  if (isOrganicAd(ad)) {
    const partes = [
      { icon: Eye, v: compactNumber(m.views), rotulo: "visualizações" },
      { icon: Heart, v: compactNumber(m.likes), rotulo: "curtidas" },
      { icon: MessageCircle, v: compactNumber(m.comments), rotulo: "comentários" },
    ].filter((p) => p.v);
    if (!partes.length) return null;
    const seguidores = compactNumber(m.followers);
    // Os sinais RELATIVOS — os que não dependem do tamanho da conta. São eles que os filtros de
    // engajamento e de multiplicador usam, então aparecem com o mesmo nome que o filtro.
    const er =
      typeof m.engagementRate === "number"
        ? `${(m.engagementRate * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% engajamento${
            m.engagementBasis === "followers" ? " (s/ seguidores)" : ""
          }`
        : null;
    const mult =
      typeof m.viewsPerFollower === "number"
        ? `${m.viewsPerFollower.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}× os seguidores`
        : null;
    const linha = (
      <div className="space-y-1">
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm leading-snug">
          {partes.map(({ icon: Icon, v, rotulo }) => (
            <span key={rotulo} className="inline-flex items-baseline gap-1" aria-label={`${v} ${rotulo}`}>
              <Icon className="h-3.5 w-3.5 self-center text-muted-foreground" />
              <span className={`${destaque} text-emerald-600 dark:text-emerald-400`}>{v}</span>
              {!compact && <span className="text-xs text-muted-foreground">{rotulo}</span>}
            </span>
          ))}
        </p>
        {(er || mult) && (
          <p className="flex flex-wrap gap-1.5">
            {[er, mult].filter(Boolean).map((t) => (
              <span key={t} className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                {t}
              </span>
            ))}
          </p>
        )}
      </div>
    );
    if (!seguidores) return linha;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div>{linha}</div>
        </TooltipTrigger>
        <TooltipContent className="flex items-center gap-1">
          <Users className="h-3 w-3" />{" "}
          {ad.source === "youtube" ? `Canal com ${seguidores} inscritos` : `Perfil com ${seguidores} seguidores`}
        </TooltipContent>
      </Tooltip>
    );
  }

  if (ad.source === "google") {
    const r = m.impressionsRange;
    const faixa =
      r && (r.min != null || r.max != null)
        ? [compactNumber(r.min), compactNumber(r.max)].filter(Boolean).join(" a ")
        : null;
    if (!faixa) return null;
    return (
      <p className="text-sm leading-snug">
        <span className={`${destaque} text-emerald-600 dark:text-emerald-400`}>{faixa}</span> impressões
      </p>
    );
  }

  if (ad.source === "tiktok") {
    const partes: string[] = [];
    if (typeof m.ctr === "number") partes.push(`CTR ${m.ctr}`);
    const likes = compactNumber(m.likes);
    if (likes) partes.push(`${likes} curtidas`);
    if (!m.estimatedAudience && !partes.length) return null;
    return (
      <p className="text-sm leading-snug">
        {m.estimatedAudience && (
          <>
            <span className={`${destaque} text-emerald-600 dark:text-emerald-400`}>{m.estimatedAudience}</span>{" "}
            de alcance estimado
          </>
        )}
        {partes.length > 0 && (
          <span className="block text-xs text-muted-foreground">{partes.join(" · ")}</span>
        )}
      </p>
    );
  }

  const collation = ad.collation_count;
  if (typeof collation !== "number" || collation <= 1) return null;
  return (
    <p className="text-sm leading-snug">
      <span className={`${destaque} text-emerald-600 dark:text-emerald-400`}>{collation} anúncios</span> usam
      esse criativo e esse texto
    </p>
  );
}
