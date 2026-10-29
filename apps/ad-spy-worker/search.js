/**
 * Busca em BLOCOS: cada chamada entrega até N anúncios que passam nos filtros, onde N é o que a
 * pessoa pediu no formulário (múltiplo de 4).
 *
 * O problema que isto resolve é dinheiro. A Scrape Creators cobra por REQUISIÇÃO (~30 anúncios por
 * página), e os filtros que mais importam — longevidade e quantos anúncios usam o criativo — não
 * existem na API: só dá para aplicá-los depois que a página chegou. Então:
 *
 *   - o que passa nos filtros mas não cabe no bloco vai para `buffer` e sai no PRÓXIMO bloco sem
 *     gastar crédito nenhum;
 *   - o cursor da API fica salvo na run, e o próximo bloco continua de onde parou;
 *   - `seen` impede o mesmo anúncio de aparecer duas vezes (a busca repete anúncios entre páginas);
 *   - `advertisers` mantém a contagem do "máximo por anunciante" entre blocos;
 *   - o ORÇAMENTO limita o gasto de cada busca: quem pede N anúncios libera (N/4)*10 créditos. Com
 *     filtro apertado uma página pode não trazer nada que preste, e sem teto a busca drenaria o
 *     saldo em silêncio — estourado o orçamento, a busca volta incompleta com uma nota dizendo
 *     quanto custou, quantos foram descartados e o que relaxar.
 *
 * Fontes sem paginação por cursor (o Playwright) caem no modo "reabre e pula os vistos": grátis,
 * só mais lento.
 *
 * VÁRIAS FONTES NA MESMA BUSCA. Cada fonte (ou modo do Instagram, ou perfil) é uma TRILHA com cursor
 * e fim próprios em `state.lanes`; o excedente, os vistos, a contagem por anunciante e o orçamento
 * são da busca inteira. Duas regras de justiça, porque as fontes rendem muito diferente — a Meta
 * devolve ~30 por página, a busca de reels ~10, um perfil o que ele tiver:
 *
 *   - COTA: cada trilha viva busca páginas até ter ceil(N / trilhas) aprovados guardados. Sem isso a
 *     primeira trilha da lista enchia o bloco e as outras nunca eram consultadas.
 *   - INTERCALAÇÃO: o bloco sai alternando as trilhas (um de cada, de novo um de cada…), e quem tem
 *     menos simplesmente acaba antes. O grid mostra as fontes misturadas, não em fatias.
 *
 * Uma trilha que dá erro (perfil privado, 4xx de uma rota) NÃO derruba a busca: vira nota, e as
 * outras seguem. Só quando todas falham e nada veio é que o erro sobe.
 */

import { BLOCK_SIZE, CREDITS_PER_4_ADS, MAX_MEDIA_BYTES, TARGET_MAX, TARGET_MIN } from "./config.js";
import { patchAd, storageUpload, upsertAds } from "./db.js";
import { makeQualityGate } from "./sources/shared.js";

/** Quantos anúncios esta busca persegue: múltiplo de 4, dentro dos limites. */
export function targetAds(settings) {
  const pedido = Number(settings?.targetAds);
  if (!Number.isFinite(pedido) || pedido <= 0) return BLOCK_SIZE;
  const passos = Math.round(pedido / 4);
  return Math.min(TARGET_MAX, Math.max(TARGET_MIN, passos * 4));
}

/** Teto de créditos desta busca: (N/4) * 10. */
export function creditBudget(target) {
  return Math.max(1, Math.ceil(target / 4) * CREDITS_PER_4_ADS);
}

export function emptySearchState() {
  return {
    // trilha -> { cursor, exhausted, pages }
    lanes: {},
    buffer: [],
    seen: [],
    advertisers: {},
    creditsUsed: 0,
    pagesUsed: 0,
    // Acumulados da run inteira, para o resumo do fim: quantos passaram e quantos foram descartados.
    totalFound: 0,
    totalRejected: 0,
    lastNote: null,
  };
}

const novaTrilha = () => ({ cursor: null, exhausted: false, pages: 0 });

/**
 * Normaliza um search_state vindo do banco (runs antigas têm `{}`).
 *
 * Runs de antes das trilhas guardavam UM cursor na raiz (`cursor`, `exhausted`), sempre da primeira
 * fonte, e os vistos sem prefixo de fonte. Elas são convertidas aqui, para o "carregar mais" de uma
 * busca antiga continuar de onde parou em vez de recomeçar e repetir os anúncios.
 */
export function loadState(raw, laneIds = []) {
  const src = raw && typeof raw === "object" ? raw : {};
  const state = { ...emptySearchState(), ...src, lanes: { ...(src.lanes || {}) } };
  const legado = !src.lanes && ("cursor" in src || "exhausted" in src);
  if (legado) {
    const primeira = laneIds[0] || "meta";
    state.lanes[primeira] = {
      cursor: src.cursor ?? null,
      exhausted: Boolean(src.exhausted),
      pages: src.pagesUsed || 0,
    };
    state.seen = (src.seen || []).map((k) => (String(k).includes(":") ? k : `meta:${k}`));
    state.buffer = (src.buffer || []).map((a) => ({ ...a, lane: a.lane || primeira }));
  }
  delete state.cursor;
  delete state.exhausted;
  for (const id of laneIds) state.lanes[id] = { ...novaTrilha(), ...(state.lanes[id] || {}) };
  return state;
}

/** A busca acabou: toda trilha esgotada e nada guardado. */
export function isExhausted(state, laneIds) {
  const ids = laneIds.length ? laneIds : Object.keys(state.lanes);
  return state.buffer.length === 0 && ids.every((id) => state.lanes[id]?.exhausted);
}

/** Chave de "já vi": o mesmo id pode existir em duas plataformas. */
const seenKey = (ad) => `${ad.source || "meta"}:${ad.externalId}`;

/** Crédito por página: o que o provider declara; os antigos só diziam `implName`. */
const creditsPerPage = (provider) =>
  Number.isFinite(provider?.creditsPerPage)
    ? provider.creditsPerPage
    : provider?.implName === "scrapecreators"
      ? 1
      : 0;

export const MEDIA_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/** Baixa uma mídia com teto de tamanho. A CDN da Meta não pede auth, mas implica sem User-Agent. */
export async function fetchMedia(url, signal) {
  const res = await fetch(url, { signal, headers: { "User-Agent": MEDIA_UA, Accept: "*/*" } });
  if (!res.ok) {
    const err = new Error(`download ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared && declared > MAX_MEDIA_BYTES) {
    throw new Error(`arquivo grande demais (${Math.round(declared / 1048576)} MB)`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_MEDIA_BYTES) {
    throw new Error(`arquivo grande demais (${Math.round(buf.length / 1048576)} MB)`);
  }
  return buf;
}

/**
 * Rehospeda thumbnail e avatar dos anúncios recém-mostrados. Best-effort: um card sem imagem é
 * aceitável, um bloco que falha por causa de uma imagem não é.
 */
async function rehostImages(rows, mined, { userId, runId, log, signal }) {
  const chave = (source, id) => `${source || "meta"}:${id}`;
  const byExternal = new Map(mined.map((a) => [chave(a.source, a.externalId), a]));
  await Promise.all(
    rows.map(async (row) => {
      const ad = byExternal.get(chave(row.source, row.external_id));
      if (!ad) return;
      const patch = {};
      if (ad.thumbUrl) {
        try {
          const bytes = await fetchMedia(ad.thumbUrl, signal);
          patch.thumb_path = await storageUpload(`${userId}/${runId}/${row.id}.jpg`, bytes, "image/jpeg");
        } catch (err) {
          log?.(`thumb do anúncio ${row.id}: ${err.message}`);
        }
      }
      if (ad.pageProfilePictureUrl) {
        try {
          const bytes = await fetchMedia(ad.pageProfilePictureUrl, signal);
          patch.avatar_path = await storageUpload(
            `${userId}/${runId}/${row.id}-avatar.jpg`,
            bytes,
            "image/jpeg"
          );
        } catch (err) {
          log?.(`avatar do anúncio ${row.id}: ${err.message}`);
        }
      }
      if (Object.keys(patch).length) await patchAd(row.id, patch).catch(() => {});
    })
  );
}

/**
 * Busca o próximo bloco e o persiste como anúncios da run.
 *
 * `lanes` vem de `lanesFor(run)`. Para uma fonte só (e para os testes antigos), `provider` basta:
 * vira uma trilha com o id da primeira fonte da run.
 *
 * @returns {Promise<{ added: number, state: object, note: string|null }>}
 *   `state` é o novo search_state a gravar; `note` explica bloco incompleto, fim da busca ou trilha
 *   que falhou.
 */
export async function fetchNextBlock({
  run,
  lanes,
  provider,
  skippedNotes = [],
  userId,
  log,
  signal,
  // Injetável para testar a lógica de bloco/excedente/teto de créditos sem banco nem Storage.
  deps = { upsertAds, rehostImages },
}) {
  const trilhas = lanes?.length
    ? lanes
    : [{ id: run.sources?.[0] || "meta", label: run.sources?.[0] || "meta", provider, params: {} }];
  const laneIds = trilhas.map((l) => l.id);
  const state = loadState(run.search_state, laneIds);
  const settings = run.settings || {};
  const seen = new Set(state.seen);
  const gate = makeQualityGate(settings, state.advertisers);

  const target = targetAds(settings);
  // O orçamento é POR BUSCA: cada "carregar mais" tem direito ao seu. O gasto acumulado da run
  // continua somando em `state.creditsUsed`, que é o número mostrado na tela.
  const budget = creditBudget(target);

  let rejected = 0;
  let pagesThisBlock = 0;
  let creditsThisBlock = 0;
  let orcamentoEstourado = false;
  const falhas = [];

  const naFila = (laneId) => state.buffer.reduce((n, a) => n + (a.lane === laneId ? 1 : 0), 0);

  const consider = (ad, laneId) => {
    // Sem id válido o anúncio não tem link nem como ser deduplicado — `String(null)` viraria "null"
    // e todos os inválidos colapsariam num só.
    if (!ad?.externalId) return;
    const key = seenKey(ad);
    if (seen.has(key)) return;
    seen.add(key);
    const verdict = gate(ad);
    if (!verdict.ok) {
      rejected += 1;
      return;
    }
    // Tudo que passa vai para a fila; o bloco é montado no fim, intercalando as trilhas.
    state.buffer.push({ ...ad, lane: laneId });
  };

  // Trilhas que ainda podem render alguma coisa: vivas, ou com aprovados guardados.
  const ativas = trilhas.filter((l) => !state.lanes[l.id].exhausted || naFila(l.id) > 0);
  let cota = Math.ceil(target / Math.max(1, ativas.length));
  // Trilha que já respondeu neste bloco sem cursor (Playwright): uma passada por bloco basta.
  const geradorRodou = new Set();

  const podeBuscar = (l) =>
    !state.lanes[l.id].exhausted && !falhas.some((f) => f.id === l.id) && !geradorRodou.has(l.id);

  // Rodadas: uma página de cada trilha que ainda está abaixo da cota, até todas baterem a cota,
  // se esgotarem ou o orçamento acabar. Quando uma trilha se esgota antes da cota (um perfil com
  // dois posts), a cota das que seguem vivas SOBE para cobrir o que faltou — senão o bloco voltava
  // curto com crédito sobrando. O teto de rodadas só protege de um provider que devolva cursor
  // para sempre sem custo.
  for (let rodada = 0; rodada < 200; rodada += 1) {
    const daVez = trilhas.filter((l) => podeBuscar(l) && naFila(l.id) < cota);
    if (!daVez.length) {
      const vivas = trilhas.filter(podeBuscar);
      if (state.buffer.length >= target || !vivas.length) break;
      cota += Math.ceil((target - state.buffer.length) / vivas.length);
      continue;
    }
    let andou = false;
    for (const lane of daVez) {
      if (signal?.aborted) throw new Error("cancelado");
      const ls = state.lanes[lane.id];
      const custo = creditsPerPage(lane.provider);
      if (custo > 0 && creditsThisBlock + custo > budget) {
        orcamentoEstourado = true;
        continue;
      }
      const params = { ...settings, tema: run.tema, ...lane.params };
      let custoReal = custo;
      try {
        if (typeof lane.provider.fetchPage === "function") {
          // Fonte paginada (Scrape Creators): uma página = um crédito.
          const page = await lane.provider.fetchPage(params, ls.cursor, { log, signal });
          for (const ad of page.ads) consider(ad, lane.id);
          ls.cursor = page.cursor ?? null;
          if (!page.cursor) ls.exhausted = true;
          // Quando a rota diz quanto cobrou (`credits_charged`), vale o dito, não a estimativa: há
          // parâmetro com custo não documentado (o `includeExtras` da busca do YouTube).
          if (Number.isFinite(page.credits)) custoReal = page.credits;
        } else {
          // Fonte sem cursor (Playwright): reabre a busca e pula o que já viu. Sem custo em crédito.
          let ended = true;
          for await (const ad of lane.provider.search({ ...params, limit: 10_000 }, { log, signal })) {
            consider(ad, lane.id);
            if (naFila(lane.id) >= cota) {
              ended = false;
              break;
            }
          }
          if (ended) ls.exhausted = true;
          geradorRodou.add(lane.id);
        }
      } catch (err) {
        if (signal?.aborted || err?.message === "cancelado") throw err;
        // Uma trilha que falha sai DESTE bloco, mas não da busca: um 5xx passageiro não pode
        // condenar a fonte para sempre. O "carregar mais" tenta de novo.
        falhas.push({ id: lane.id, label: lane.label, message: String(err?.message || err) });
        log?.(`trilha ${lane.id}: ${err?.message || err}`);
        continue;
      }
      ls.pages = (ls.pages || 0) + 1;
      pagesThisBlock += 1;
      state.pagesUsed += 1;
      creditsThisBlock += custoReal;
      state.creditsUsed += custoReal;
      andou = true;
    }
    if (!andou) break;
  }

  // Monta o bloco intercalando as trilhas, na ordem em que foram pedidas.
  const block = [];
  const filas = new Map(laneIds.map((id) => [id, []]));
  for (const ad of state.buffer) {
    if (!filas.has(ad.lane)) filas.set(ad.lane, []);
    filas.get(ad.lane).push(ad);
  }
  for (let algum = true; algum && block.length < target; ) {
    algum = false;
    for (const fila of filas.values()) {
      if (block.length >= target) break;
      if (fila.length) {
        block.push(fila.shift());
        algum = true;
      }
    }
  }
  state.buffer = [...filas.values()].flat();

  // Todas as trilhas consultadas falharam e não há nada para mostrar: aí sim é erro da busca.
  if (!block.length && falhas.length && falhas.length >= trilhas.filter((l) => !state.lanes[l.id].exhausted).length) {
    throw new Error(falhas.map((f) => `${f.label}: ${f.message}`).join(" · "));
  }

  state.seen = [...seen];
  const exhausted = isExhausted(state, laneIds);

  // Nota para a UI. Distingue as situações que a pessoa precisa saber tratar.
  const notas = [];
  if (block.length < target) {
    if (exhausted) {
      notas.push(
        block.length
          ? "Fim da busca: não há mais anúncios que atendam aos filtros."
          : "Não há mais anúncios que atendam aos filtros."
      );
    } else if (orcamentoEstourado || creditsThisBlock >= budget) {
      notas.push(
        `Orçamento desta busca gasto (${creditsThisBlock} de ${budget} crédito(s) para ${target} ` +
          `anúncio(s) pedidos): vieram ${block.length}` +
          (rejected ? `, com ${rejected} descartado(s) pelos filtros` : "") +
          ". Carregue mais para continuar, ou relaxe a longevidade mínima e o mínimo de anúncios " +
          "usando o criativo."
      );
    }
  }
  for (const f of falhas) notas.push(`${f.label} falhou nesta busca (${f.message.slice(0, 160)}).`);
  // Só na primeira busca: depois disso a pessoa já leu, e repetir a cada bloco vira ruído.
  if (!run.search_state || !Object.keys(run.search_state).length) notas.push(...skippedNotes);
  const note = notas.length ? notas.join(" ") : null;
  state.lastNote = note;

  state.totalRejected = (state.totalRejected || 0) + rejected;

  let added = 0;
  if (block.length) {
    const rows = await deps.upsertAds(run.id, block);
    added = rows.length;
    state.totalFound = (state.totalFound || 0) + added;
    await deps.rehostImages(rows, block, { userId, runId: run.id, log, signal });
  }

  log?.(
    `bloco: +${added} anúncio(s), ${rejected} descartado(s), ${pagesThisBlock} página(s), ` +
      `buffer=${state.buffer.length}, créditos na run=${state.creditsUsed}` +
      (falhas.length ? `, ${falhas.length} trilha(s) com erro` : "")
  );
  return { added, state, note };
}
