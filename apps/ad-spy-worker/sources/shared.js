/**
 * Normalization helpers shared by every source adapter.
 *
 * Separate from index.js on purpose: index.js imports the providers and the providers need these
 * helpers, so keeping them here avoids a circular import. (ESM tolerates the cycle for hoisted
 * function declarations, but it breaks the moment someone adds a top-level const that reads
 * across the cycle — not a trap worth leaving behind.)
 */

/** Integer or null. `Number(null)` is 0, so null/undefined/"" must be caught before converting. */
export function intOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** Whole days between a start date and today (UTC). */
export function daysRunningFrom(startedOn) {
  if (!startedOn) return null;
  const t = Date.parse(`${startedOn}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

/**
 * Data em qualquer formato que as fontes mandam -> YYYY-MM-DD. Unix em segundos ou ms (Meta,
 * TikTok, Instagram v1) ou ISO 8601 (Instagram via busca do Google).
 */
export function toIsoDate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" || /^\d+$/.test(String(value))) return unixToIsoDate(value);
  const t = Date.parse(String(value));
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

/**
 * Peça ORGÂNICA (post/reel publicado) e não anúncio pago.
 *
 * A diferença muda o que os números querem dizer: num anúncio, os dias no ar provam que alguém
 * paga por ele; num post, a data é só quando foi publicado — quem prova é o engajamento.
 */
export const isOrganic = (source) =>
  source === "instagram" || source === "youtube" || source === "tiktok_organic";

/**
 * Dias no ar de um anúncio da Biblioteca da Meta.
 *
 * Ativo: do início até hoje. INATIVO: do início até o `end_date` — contar até hoje fazia um anúncio
 * que rodou 3 dias em janeiro aparecer com 270 "dias no ar" em outubro, e passar no filtro de
 * longevidade, que existe justamente para reprovar esse caso.
 */
export function metaDaysRunning(startIso, endIso, isActive) {
  if (!startIso) return null;
  if (isActive === false && endIso) {
    const d = Math.round((Date.parse(`${endIso}T00:00:00Z`) - Date.parse(`${startIso}T00:00:00Z`)) / 86400000);
    return Number.isFinite(d) ? Math.max(0, d) : null;
  }
  return daysRunningFrom(startIso);
}

/**
 * Os sinais de qualidade do conteúdo ORGÂNICO, derivados dos números crus.
 *
 *   engagementRate   (curtidas + comentários) / visualizações — a taxa que o mercado usa
 *                    para Reels e Shorts. Sem visualizações (foto/carrossel do Instagram), sobre
 *                    os seguidores; `engagementBasis` diz qual, porque as duas escalas não se
 *                    comparam.
 *   viewsPerFollower visualizações / seguidores: quanto o post foi além da própria base. É o
 *                    "outlier score" das ferramentas de pesquisa de conteúdo, com a base que a
 *                    resposta traz (seguidores) no lugar da mediana do perfil, que custaria uma
 *                    chamada por perfil.
 */
export function organicSignals({ views, likes, comments, followers }) {
  const interacoes = (Number.isFinite(likes) ? likes : 0) + (Number.isFinite(comments) ? comments : 0);
  const temInteracao = Number.isFinite(likes) || Number.isFinite(comments);
  let engagementRate = null;
  let engagementBasis = null;
  if (temInteracao && Number.isFinite(views) && views > 0) {
    engagementRate = interacoes / views;
    engagementBasis = "views";
  } else if (temInteracao && Number.isFinite(followers) && followers > 0) {
    engagementRate = interacoes / followers;
    engagementBasis = "followers";
  }
  const viewsPerFollower =
    Number.isFinite(views) && Number.isFinite(followers) && followers > 0 ? views / followers : null;
  return {
    engagementRate: engagementRate === null ? null : Math.round(engagementRate * 10000) / 10000,
    engagementBasis,
    viewsPerFollower: viewsPerFollower === null ? null : Math.round(viewsPerFollower * 100) / 100,
  };
}

/** Piso de uma faixa de alcance do TikTok: "10K-100K" -> 10000, "1M+" -> 1000000. */
export function audienceLowerBound(faixa) {
  // "<1K" é MENOS de mil: o piso é zero, não mil.
  if (/^\s*</.test(String(faixa || ""))) return 0;
  const m = /^\s*[<>≥]?\s*([\d.,]+)\s*([KMB])?/i.exec(String(faixa || ""));
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  if (!Number.isFinite(n)) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[String(m[2] || "").toUpperCase()] || 1;
  return Math.round(n * mult);
}

/** Unix seconds (or ms) -> YYYY-MM-DD. Meta uses seconds; be tolerant of both. */
export function unixToIsoDate(value) {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n > 1e11 ? n : n * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Link para o anúncio na Biblioteca de Anúncios.
 *
 * Formato mínimo `?id=<ad_archive_id>`, que é o que o botão "copiar link" da própria Meta gera.
 * NÃO usamos o campo `url` que a fonte devolve por anúncio: é uma URL de busca da Biblioteca, com
 * parâmetros de modo (`search_type`, `sort_data`) que fazem a Meta interpretar o id como consulta
 * em vez de anúncio. Menos parâmetro, menos superfície para errar.
 *
 * Só para id NUMÉRICO: um id perdido ("undefined", "null") vira um link que abre a página de erro,
 * pior que não ter botão nenhum.
 */
export function adLibraryPermalink(adArchiveId) {
  const id = adArchiveId == null ? "" : String(adArchiveId).trim();
  return /^\d{6,}$/.test(id) ? `https://www.facebook.com/ads/library/?id=${id}` : null;
}

/**
 * Faz JSON.parse preservando ids grandes.
 *
 * Ids da Meta têm 15-17 dígitos. Se a API os mandar como NÚMERO, `JSON.parse` arredonda tudo acima
 * de 2^53 (9007199254740992) em silêncio — o id muda de dígito e o link aponta para um anúncio que
 * não existe. Antes do parse, os campos de id numéricos longos viram strings.
 */
export function parseJsonKeepingIds(text) {
  const safe = String(text).replace(
    /("(?:ad_archive_id|adArchiveID|adArchiveId|page_id|pageID|collation_id|collationID|ad_id|id|pk|vid)"\s*:\s*)(-?\d{15,})/g,
    '$1"$2"'
  );
  return JSON.parse(safe);
}

/** O id do anúncio, aceitando as grafias que a Meta e os scrapers usam. */
export function pickAdArchiveId(row) {
  const raw = row?.ad_archive_id ?? row?.adArchiveID ?? row?.adArchiveId ?? row?.snapshot?.ad_archive_id;
  const id = raw == null ? "" : String(raw).trim();
  return /^\d{6,}$/.test(id) ? id : null;
}

/**
 * The quality gate, applied identically to every source — mas cada filtro só vale para a fonte que
 * tem o dado que ele mede.
 *
 * Returns a stateful `accept(ad)` because `maxPerAdvertiser` has to count: without it, one heavy
 * spender running 40 near-identical ads drowns out the variety that makes the analysis worth
 * reading.
 *
 * Por que não aplicar tudo a todos: "desconhecido reprova" é a regra certa DENTRO de uma fonte
 * (o filtro seleciona o comprovado), mas vira veto à fonte inteira quando o dado nem existe nela.
 * Um reel não tem `collation_count`; com o filtro de replicação ligado — e ele vem ligado em 5 —
 * nenhum post do Instagram passaria nunca.
 *
 *   longevidade  -> só anúncio pago (num post, "dias" é idade, não prova de verba)
 *   replicação   -> só Meta (TikTok, Instagram e YouTube não expõem)
 *   visualizações-> só orgânico (é a prova do orgânico, como a longevidade é a do pago)
 *   engajamento  -> só orgânico ((curtidas + comentários) / visualizações)
 *   multiplicador-> só Instagram (visualizações / seguidores; o YouTube não traz inscritos)
 *   alcance      -> só TikTok (piso da faixa `estimated_audience`)
 */
export function makeQualityGate(
  {
    minDaysRunning = 0,
    maxPerAdvertiser = 0,
    minCopyChars = 0,
    minCollationCount = 0,
    minViews = 0,
    minEngagementPct = 0,
    minViewsPerFollower = 0,
    minTikTokAudience = 0,
    mediaType = "all",
  },
  // Contagem por anunciante como objeto simples, para poder ser salva no `search_state` da run e
  // retomada no próximo bloco. Com um Map em memória, cada "carregar mais" zerava o limite.
  perAdvertiser = {}
) {
  return function accept(ad) {
    const organic = isOrganic(ad.source);
    // A Meta filtra o tipo de mídia na própria API; as outras fontes, não. Tipo desconhecido passa:
    // aqui não é filtro de qualidade, é de formato, e "não sei" não é o formato errado.
    if ((mediaType === "video" || mediaType === "image") && ad.mediaType && ad.mediaType !== mediaType) {
      return { ok: false, reason: "tipo de mídia" };
    }
    // Com o título como reserva: o texto de um short é o título, e a descrição costuma vir vazia.
    if (minCopyChars > 0 && (ad.adCopy || ad.title || "").trim().length < minCopyChars) {
      return { ok: false, reason: "copy curta" };
    }
    if (minDaysRunning > 0 && !organic) {
      // Unknown longevity fails a longevity filter: the filter selects for *proven* ads, and
      // "we don't know" is not proof.
      if (!Number.isFinite(ad.daysRunning) || ad.daysRunning < minDaysRunning) {
        return { ok: false, reason: "roda há pouco tempo" };
      }
    }
    if (minCollationCount > 1 && (!ad.source || ad.source === "meta")) {
      // Desconhecido reprova, pelo mesmo motivo da longevidade: o filtro existe para selecionar
      // criativos comprovadamente replicados, e "não sabemos" não é prova.
      if (!Number.isFinite(ad.collationCount) || ad.collationCount < minCollationCount) {
        return { ok: false, reason: "poucos anúncios com o criativo" };
      }
    }
    if (minViews > 0 && organic) {
      const views = ad.metrics?.views;
      if (!Number.isFinite(views) || views < minViews) {
        return { ok: false, reason: "poucas visualizações" };
      }
    }
    if (minEngagementPct > 0 && organic) {
      const er = ad.metrics?.engagementRate;
      if (!Number.isFinite(er) || er * 100 < minEngagementPct) return { ok: false, reason: "engajamento baixo" };
    }
    // Só o Instagram traz os seguidores do autor junto do post; no YouTube a busca não traz os
    // inscritos do canal, e o filtro não pode vetar uma fonte inteira por falta de dado.
    if (minViewsPerFollower > 0 && ad.source === "instagram") {
      const r = ad.metrics?.viewsPerFollower;
      if (!Number.isFinite(r) || r < minViewsPerFollower) {
        return { ok: false, reason: "pouco alcance além dos seguidores" };
      }
    }
    if (minTikTokAudience > 0 && ad.source === "tiktok") {
      const piso = audienceLowerBound(ad.metrics?.estimatedAudience);
      if (!Number.isFinite(piso) || piso < minTikTokAudience) return { ok: false, reason: "alcance estimado baixo" };
    }
    if (maxPerAdvertiser > 0) {
      // Com a fonte na chave: o "@clinica" do Instagram e a página "Clínica" da Meta são contas
      // diferentes, e o page_id de uma fonte pode colidir com o de outra.
      const key = `${ad.source || "meta"}:${ad.pageId || ad.pageName || "?"}`;
      const n = perAdvertiser[key] || 0;
      if (n >= maxPerAdvertiser) return { ok: false, reason: "limite por anunciante" };
      perAdvertiser[key] = n + 1;
    }
    return { ok: true };
  };
}
