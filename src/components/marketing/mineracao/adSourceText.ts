import { isOrganicAd, type SpyAd } from "@/lib/adSpyApi";

/**
 * Os textos do card que mudam conforme a fonte da peça. Fora de AdSourceBits.tsx porque arquivo de
 * componente que exporta função quebra o Fast Refresh.
 */

function formatDate(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" });
}

/** "Veiculação iniciada em…" / "Publicado em…" / "Veiculado de… a…", conforme a fonte. */
export function dateLine(ad: SpyAd): string | null {
  const inicio = formatDate(ad.started_running_on);
  if (!inicio) return null;
  if (isOrganicAd(ad)) return `Publicado em ${inicio}`;
  const fim = ad.source === "tiktok" || ad.source === "google" ? formatDate(ad.metrics?.lastShownOn) : null;
  return fim && fim !== inicio ? `Veiculado de ${inicio} a ${fim}` : `Veiculação iniciada em ${inicio}`;
}

/** Rótulo do id: "Identificação da biblioteca" só faz sentido onde há biblioteca. */
export function idLabel(ad: SpyAd): string {
  if (ad.source === "youtube" || ad.source === "tiktok_organic") return "ID do vídeo";
  if (ad.source === "google") return "ID do criativo";
  return isOrganicAd(ad) ? "Código do post" : "Identificação da biblioteca";
}

/** O que vai sob o nome no bloco "como aparece": no orgânico, o @, não "Patrocinado". */
export function sublabel(ad: SpyAd): string {
  if (isOrganicAd(ad)) {
    const handle = ad.page_id
      ? `@${ad.page_id.replace(/^@/, "")}`
      : ad.source === "youtube"
        ? "YouTube Shorts"
        : ad.source === "tiktok_organic"
          ? "TikTok"
          : "Instagram";
    return ad.metrics?.paidPartnership ? `${handle} · Parceria paga` : handle;
  }
  return "Patrocinado";
}

/** "via #tag" / "via @perfil" / "via busca de reels" — de onde a peça veio, numa busca com várias trilhas. */
export function foundViaLabel(foundVia: string | null | undefined): string | null {
  if (!foundVia) return null;
  if (foundVia === "reels") return "via busca de reels";
  if (foundVia === "shorts") return "via busca de shorts";
  if (foundVia === "videos") return "via busca de vídeos";
  if (foundVia.startsWith("canal:")) return `via ${foundVia.slice(6)}`;
  if (foundVia === "link") return "via link colado";
  if (foundVia.startsWith("hashtag:")) return `via #${foundVia.slice(8)}`;
  if (foundVia.startsWith("perfil:")) return `via ${foundVia.slice(7)}`;
  return null;
}
