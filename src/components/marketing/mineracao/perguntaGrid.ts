import type { SpyAd, SpyQuestion, SpyQuestionGuardada, SpyResposta, SpyVeredito } from "@/lib/adSpyApi";

/**
 * A parte pura do "perguntar ao grid": perguntas prontas, ordenação e contagem. Fora do componente
 * para ser testável sem tela, e porque arquivo de componente que exporta função quebra o Fast
 * Refresh.
 */

/**
 * Perguntas prontas. Saíram do experimento em apps/ad-spy-worker/experimentos/jev/perguntas.json:
 * as seis de sim/não vão como estão lá; as três de escolha/nota viraram a pergunta de sim/não mais
 * útil de cada uma, porque aqui a resposta é "atende ou não", e não uma categoria.
 */
export const PERGUNTAS_PRONTAS: { rotulo: string; pergunta: string }[] = [
  {
    rotulo: "Abre com uma dor",
    pergunta: "O anúncio abre apontando um problema, incômodo ou erro de quem assiste?",
  },
  {
    rotulo: "É específico",
    pergunta: "O texto é específico: traz número, prazo, situação reconhecível ou caso concreto?",
  },
  {
    rotulo: "Traz prova concreta",
    pergunta:
      "O anúncio traz prova concreta: número, caso real de paciente, antes e depois descrito ou depoimento?",
  },
  {
    rotulo: "Mostra o resultado",
    pergunta: "O anúncio descreve o resultado acontecendo, em vez de só prometer?",
  },
  {
    rotulo: "Cita autoridade",
    pergunta:
      "O anúncio cita formação, registro profissional (CRM, CRO), especialização ou anos de experiência?",
  },
  {
    rotulo: "Trata uma objeção",
    pergunta:
      "O anúncio responde a uma objeção: dor, medo, preço, tempo de recuperação ou resultado artificial?",
  },
  {
    rotulo: "Fala de preço ou oferta",
    pergunta:
      "O anúncio menciona preço, parcelamento, desconto, condição especial ou avaliação gratuita?",
  },
  {
    rotulo: "Pede uma ação",
    pergunta: "O anúncio pede uma ação clara, como agendar, chamar no WhatsApp ou clicar no link?",
  },
  {
    rotulo: "Fala com quem já decidiu tratar",
    pergunta:
      "O anúncio fala com quem já conhece o tipo de tratamento e ainda está escolhendo onde fazer?",
  },
];

/** Nome curto de uma pergunta: o rótulo da pronta, ou o começo do texto. */
export function rotuloDaPergunta(texto: string): string {
  const pronta = PERGUNTAS_PRONTAS.find((p) => p.pergunta === texto);
  if (pronta) return pronta.rotulo;
  return texto.length > 42 ? `${texto.slice(0, 40).trimEnd()}…` : texto;
}

/** As outras perguntas já respondidas nesta busca: trocar para uma delas não relê o grid. */
export const perguntasGuardadas = (q: SpyQuestion | null | undefined): SpyQuestionGuardada[] =>
  (q?.outras ?? []).filter((o) => o.texto && Object.keys(o.respostas ?? {}).length > 0);

/**
 * Biblioteca: as perguntas que vieram dentro dos anúncios salvos, na ordem em que aparecem.
 * Lá não há run nem `question` — cada anúncio carrega as próprias respostas.
 */
export function perguntasSalvas(ads: SpyAd[]): string[] {
  const vistas = new Set<string>();
  for (const ad of ads) for (const p of ad.perguntas ?? []) vistas.add(p.texto);
  return [...vistas];
}

/**
 * Biblioteca: remonta, a partir dos anúncios salvos, a pergunta no formato que o grid entende —
 * para a ordenação e o card serem os mesmos da Mineração, sem uma segunda implementação.
 */
export function perguntaSalva(ads: SpyAd[], texto: string): SpyQuestion {
  const respostas: Record<string, SpyResposta> = {};
  for (const ad of ads) {
    const p = ad.perguntas?.find((x) => x.texto === texto);
    if (p) respostas[String(ad.id)] = { veredito: p.veredito, trecho: p.trecho, base: p.base };
  }
  const n = Object.keys(respostas).length;
  return {
    id: null, texto, status: "done", error: null, pedido_em: null, concluido_em: null,
    total: n, feito: n, respostas,
  };
}

/** Grupos do grid, na ordem em que aparecem. "sem" = sem resposta ou sem texto para ler. */
export type GrupoResposta = SpyVeredito | "sem";
const ORDEM: Record<GrupoResposta, number> = { atende: 0, parcial: 1, nao: 2, sem: 3 };

export const respostaDe = (q: SpyQuestion | null | undefined, ad: SpyAd): SpyResposta | null =>
  q?.respostas?.[String(ad.id)] ?? null;

export const grupoDe = (q: SpyQuestion | null | undefined, ad: SpyAd): GrupoResposta =>
  respostaDe(q, ad)?.veredito ?? "sem";

/** Há o que mostrar: a pergunta terminou, ou está rodando e já tem respostas (de uma rodada anterior). */
export const temRespostas = (q: SpyQuestion | null | undefined): q is SpyQuestion =>
  Boolean(q && q.status !== "error" && Object.keys(q.respostas ?? {}).length > 0);

/**
 * O grid na ordem da pergunta: atende, atende em parte, não atende, sem resposta.
 *
 * DENTRO de cada grupo a ordem de chegada é mantida — é a ordem da busca, que já vem por desempenho
 * (impressões na Meta). A pergunta diz QUAIS olhar primeiro; não desfaz o que a busca ordenou.
 */
export function ordenarPorResposta(ads: SpyAd[], q: SpyQuestion | null | undefined): SpyAd[] {
  if (!temRespostas(q)) return ads;
  return ads
    .map((ad, i) => ({ ad, i, g: ORDEM[grupoDe(q, ad)] }))
    .sort((a, b) => a.g - b.g || a.i - b.i)
    .map((x) => x.ad);
}

export function contarRespostas(ads: SpyAd[], q: SpyQuestion | null | undefined): Record<GrupoResposta, number> {
  const n: Record<GrupoResposta, number> = { atende: 0, parcial: 0, nao: 0, sem: 0 };
  for (const ad of ads) n[grupoDe(q, ad)] += 1;
  return n;
}

/**
 * Peças que uma nova rodada da MESMA pergunta leria: as que chegaram depois ("buscar mais") e as
 * respondidas só pelo texto que agora têm transcrição. Espelha `pecasPendentes` do worker.
 */
export function pendentes(ads: SpyAd[], q: SpyQuestion | null | undefined): number {
  if (!q) return 0;
  return ads.filter((ad) => {
    const r = respostaDe(q, ad);
    if (!r) return true;
    return r.base !== "transcricao" && Boolean(ad.transcript?.trim());
  }).length;
}
