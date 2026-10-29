/**
 * Sonda de palavras-chave: UMA página por termo, para medir antes de gastar.
 *
 * O erro mais caro da Mineração é escolher mal o termo. A Biblioteca de Anúncios casa o termo com
 * o TEXTO dos anúncios, não com intenção de busca: um termo que soa perfeito ("melhor clínica de
 * transplante capilar") costuma voltar vazio, porque anunciante nenhum escreve isso na copy. E
 * descobrir isso com a busca cheia custa o orçamento inteiro — (N/4)*10 créditos.
 *
 * Então a sonda gasta 1 crédito por termo e devolve o único número que decide a escolha: quantos
 * anúncios daquela página PASSARIAM nos filtros que a busca de verdade aplicaria. Os mesmos
 * filtros, pela mesma função — um placar medido com outra régua não serviria para comparar.
 *
 * Não escreve nada: a sonda não cria run, não guarda anúncio e não mexe no Storage. É uma pergunta,
 * não um começo de busca.
 */

import { probeLaneFor } from "./sources/index.js";
import { isOrganic, makeQualityGate } from "./sources/shared.js";

/** Teto de termos por chamada. Cada termo é 1 crédito por fonte, então isto é um teto de gasto. */
export const MAX_PROBE_TERMS = 5;
/** Teto de páginas por chamada (termos × fontes) — o teto de gasto de verdade com várias fontes. */
export const MAX_PROBE_CALLS = 15;

/** Mediana inteira, ou null quando não há amostra. Mediana e não média: um anúncio de 900 dias
 *  puxaria a média e faria um termo ruim parecer bom. */
function medianaInteira(valores) {
  const ns = valores.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!ns.length) return null;
  const meio = Math.floor(ns.length / 2);
  return ns.length % 2 ? ns[meio] : Math.round((ns[meio - 1] + ns[meio]) / 2);
}

/** Uma página de um termo numa trilha -> uma linha do placar. */
async function sondar({ termo, settings, provider, params, log, signal }) {
  // Contagem de anunciante começa zerada a cada termo: o limite por anunciante é por BUSCA, e
  // carregá-lo entre termos faria o segundo termo parecer pior só por vir depois.
  const gate = makeQualityGate(settings, {});
  const page = await provider.fetchPage({ ...settings, tema: termo, ...params }, null, { log, signal });

  const aprovados = [];
  const motivos = {};
  for (const ad of page.ads) {
    const verdict = gate(ad);
    if (verdict.ok) aprovados.push(ad);
    else motivos[verdict.reason] = (motivos[verdict.reason] || 0) + 1;
  }
  const organicos = aprovados.filter((a) => isOrganic(a.source));
  return {
    retornados: page.ads.length,
    passaram: aprovados.length,
    // Anunciantes DISTINTOS entre os aprovados: 8 anúncios de uma clínica só é um resultado
    // muito mais fraco que 8 de oito clínicas, e a média não mostra essa diferença.
    anunciantes: new Set(aprovados.map((a) => a.pageId || a.pageName || "?")).size,
    // Num post, "dias" é idade, não prova — a mediana de dias só sai dos anúncios pagos.
    medianaDias: medianaInteira(aprovados.filter((a) => !isOrganic(a.source)).map((a) => a.daysRunning)),
    // E a prova do orgânico é visualização.
    medianaViews: organicos.length ? medianaInteira(organicos.map((a) => a.metrics?.views)) : null,
    // Por que os reprovados caíram — é o que diz QUAL filtro relaxar.
    motivos,
    temMais: Boolean(page.cursor),
    erro: null,
    // O que a rota disse ter cobrado, se disse. Sai da linha antes de ir para a tela.
    credits: page.credits,
  };
}

const linhaDeErro = (erro) => ({
  retornados: 0,
  passaram: 0,
  anunciantes: 0,
  medianaDias: null,
  medianaViews: null,
  motivos: {},
  temMais: false,
  erro,
});

/**
 * Testa cada termo com uma página, em cada fonte pedida.
 *
 * `fontes` são ids de `run.sources` (meta, instagram_ads, instagram_reels, instagram_hashtag,
 * tiktok); cada uma resolve para a trilha que a busca usaria (`probeLaneFor`). O placar sai
 * agrupado por fonte, na ordem pedida, e dentro dela na ordem dos termos — compara-se termo com
 * termo DENTRO de uma fonte, que é a decisão a tomar.
 *
 * `provider` direto (sem `fontes`) é o modo de uma fonte só, mantido para os testes e para quem
 * chama sem escolher fonte.
 *
 * @returns {Promise<{ resultados: object[], creditsUsed: number }>}
 */
export async function probeTerms({ termos, settings, provider, fontes, log, signal }) {
  const alvos = provider
    ? [{ fonte: null, lane: { provider, params: {} }, motivo: null }]
    : (fontes?.length ? fontes : ["meta"]).map((fonte) => ({ fonte }));

  if (provider && typeof provider.fetchPage !== "function") {
    throw Object.assign(new Error(SEM_PAGINA), { status: 501 });
  }

  const resultados = [];
  let creditsUsed = 0;

  for (const alvo of alvos) {
    for (const termo of termos) {
      if (signal?.aborted) throw new Error("cancelado");
      const { lane, motivo } = alvo.fonte ? probeLaneFor(alvo.fonte, termo, settings) : alvo;
      const base = {
        termo,
        fonte: alvo.fonte,
        // O que de fato foi consultado, quando difere do termo: a hashtag tira acento e espaço.
        consulta: lane?.params?.hashtag ? `#${lane.params.hashtag}` : null,
      };
      if (!lane || typeof lane.provider.fetchPage !== "function") {
        resultados.push({ ...base, ...linhaDeErro(motivo || SEM_PAGINA) });
        continue;
      }
      try {
        const linha = await sondar({ termo, settings, provider: lane.provider, params: lane.params, log, signal });
        creditsUsed += Number.isFinite(linha.credits) ? linha.credits : creditoDe(lane.provider);
        delete linha.credits;
        resultados.push({ ...base, ...linha });
      } catch (err) {
        // Um termo que falha não derruba os outros: o placar parcial ainda serve para escolher.
        log?.(`sonda "${termo}" em ${alvo.fonte || "fonte única"}: ${err.message}`);
        resultados.push({ ...base, ...linhaDeErro(err.message) });
      }
    }
  }

  return { resultados, creditsUsed };
}

const SEM_PAGINA =
  "A fonte atual não pagina por cursor, então não dá para sondar uma página só. " +
  "A sonda existe para a Scrape Creators, onde uma página é um crédito.";

const creditoDe = (p) =>
  Number.isFinite(p?.creditsPerPage) ? p.creditsPerPage : p?.implName === "scrapecreators" ? 1 : 0;

/** Termos válidos e sem repetição, respeitando o teto. Devolve [] se não sobrar nada. */
export function parseProbeTerms(raw, maxChars) {
  const lista = Array.isArray(raw) ? raw : [];
  const limpos = lista
    .map((t) => String(t ?? "").trim())
    .filter((t) => t.length > 1 && t.length <= maxChars);
  return [...new Set(limpos)].slice(0, MAX_PROBE_TERMS);
}
