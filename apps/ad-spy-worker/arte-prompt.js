/**
 * O agente que destrincha um anúncio PRONTO nos elementos exatos da arte (`artagent`, 27/10/2026):
 * o prompt, a leitura da resposta e a montagem do post renderizável.
 *
 * Sem I/O e sem config, como `composer-prompt.js`, para ser testado em qualquer máquina. O que é
 * estático (persona, regras, contrato) mora em `agent/artagent.md`.
 *
 * ## O agente separa; o código decide o que é regra
 *
 * O agente lê a copy e diz o que vai escrito em cada página — título, apoio, selo, botão —, separando
 * o texto da direção de foto que vem misturada nele ("Capa: 'Seu ronco tem nome' — foto do médico").
 * E escreve o texto alternativo de cada página.
 *
 * O que é REGRA não fica com ele:
 *   - nome, CRM/UF e RQE vêm do Brand kit. O agente os devolve (o contrato pede, para a passagem
 *     sempre levar a identificação), mas o post usa os do kit, e uma divergência vira aviso;
 *   - onde a identificação entra vem de `shared/regras-identificacao.js`;
 *   - o "NÃO ESPECIALISTA" é conferido pelo código sobre o texto final;
 *   - a legenda nunca sai vazia: sem a do agente, fica a do anúncio.
 */

import { createHash } from "node:crypto";
import { extractContractJson } from "./agent-contract.js";
import { getFormato } from "../../shared/ad-formats.js";
import { ELEMENTOS_DA_ARTE, TIPOS_DE_FOTO, kitTemElemento, linhaDeIdentificacao } from "../../shared/brand-kit.js";
import {
  MAX_SLIDES,
  SCHEMA_DO_POST,
  normalizarSlides,
  papeisPermitidos,
  textosDaArte,
  validarSlides,
} from "../../shared/post-templates.js";
import { precisaNaoEspecialista } from "../../shared/regras-identificacao.js";

/** Os formatos do Composer que viram arte estática. */
export const FORMATOS_DE_ARTE = ["instagram_feed", "meta_ads"];

export { TIPOS_DE_FOTO, kitTemElemento };

/**
 * Os anúncios da composição, inclusive a ANTIGA (anterior a 12/10/2026), que tem um anúncio só nas
 * colunas `formato`/`composicao` e `anuncios` vazio — a mesma leitura do `anunciosDe` da tela.
 */
export function anunciosDaLinha(composicao) {
  const lista = Array.isArray(composicao?.anuncios) ? composicao.anuncios : [];
  if (lista.length) return lista;
  if (!composicao?.composicao) return [];
  return [{ formato: composicao.formato, angulo: null, status: "ok", composicao: composicao.composicao }];
}

/** Um hash da copy do anúncio: muda quando alguém edita o anúncio depois de a arte existir. */
export function hashDoAnuncio(anuncio) {
  return createHash("sha256")
    .update(JSON.stringify({ formato: anuncio?.formato ?? null, campos: anuncio?.composicao ?? null }))
    .digest("hex")
    .slice(0, 16);
}

/**
 * Quantas páginas a arte tem: no feed, uma por card do carrossel (lista vazia é post único); no
 * anúncio da Meta, uma.
 */
export function totalDeSlides(anuncio) {
  if (anuncio?.formato === "instagram_feed") {
    const cards = Array.isArray(anuncio.composicao?.carrossel) ? anuncio.composicao.carrossel.filter(Boolean) : [];
    return Math.min(MAX_SLIDES, Math.max(1, cards.length));
  }
  return 1;
}

/** A legenda que o anúncio já tem: a do feed, ou o texto principal do anúncio pago. */
export function legendaDoAnuncio(anuncio) {
  const c = anuncio?.composicao || {};
  return String((anuncio?.formato === "meta_ads" ? c.primary_text : c.legenda) || "").trim();
}

function descreverAnuncio(anuncio) {
  const formato = getFormato(anuncio.formato);
  const linhas = [`Formato de origem: ${formato?.label ?? anuncio.formato}`];
  if (anuncio.angulo) linhas.push(`Ângulo: ${anuncio.angulo}`);
  for (const campo of formato?.campos ?? []) {
    const v = anuncio.composicao?.[campo.id];
    if (Array.isArray(v)) {
      linhas.push("", `## ${campo.label} (\`${campo.id}\`)`, ...(v.length ? v.map((x, i) => `${i + 1}. ${x}`) : ["(vazio)"]));
    } else {
      linhas.push("", `## ${campo.label} (\`${campo.id}\`)`, String(v ?? "").trim() || "(vazio)");
    }
  }
  return linhas.join("\n");
}

/** Os layouts do template, slot a slot, com os limites — o que o agente tem de respeitar. */
export function descreverTemplate(template) {
  return Object.entries(template.layouts)
    .map(([papel, layout]) => {
      const slots = layout.slots
        .map((s) => `  - \`${s.id}\` (${s.label}${s.obrigatorio ? ", obrigatório" : ", opcional"}; até ${s.limite} caracteres): ${s.ajuda}`)
        .join("\n");
      return `- papel \`${papel}\` — ${layout.label}${layout.aceitaFoto ? " (aceita foto)" : " (sem foto)"}\n${slots}`;
    })
    .join("\n");
}

function papeisDoConjunto(total) {
  return Array.from({ length: total }, (_, i) => `${i + 1}: ${papeisPermitidos(i, total).join(" ou ")}`).join("; ");
}

export function esqueletoJsonArte() {
  return [
    "{",
    '  "slides": [',
    '    { "papel": "capa", "destaque": "", "titulo": "…", "apoio": "", "cta": "", "foto": null, "alt": "…" }',
    "  ],",
    '  "legenda": "…",',
    '  "hashtags": [],',
    '  "identificacao": { "nome": "…", "crm": "…", "uf": "…", "rqe": "" }',
    "}",
  ].join("\n");
}

/**
 * A mensagem ao `artagent`.
 *
 * @param {{ anuncio: object, template: object, cliente: string, uso: string, circulaFora: boolean,
 *           elementos: Record<string, boolean>, fotos: { tipo: string, descricao: string }[],
 *           identificacao: object, naLegenda: boolean }} p
 */
export function buildArtePrompt({ anuncio, template, cliente, uso, circulaFora, elementos, fotos, identificacao, naLegenda }) {
  const total = totalDeSlides(anuncio);
  const incluidos = ELEMENTOS_DA_ARTE.filter((e) => elementos?.[e.id] && e.id !== "identificacao").map((e) => e.label);
  const linhaId = linhaDeIdentificacao(identificacao);
  const blocoFotos = fotos.length
    ? fotos.map((f, i) => `- foto ${i}: ${TIPOS_DE_FOTO.find((t) => t.id === f.tipo)?.label ?? f.tipo}${f.descricao ? ` — ${f.descricao}` : ""}`).join("\n")
    : "- nenhuma foto: todo slide vai com `foto: null`.";

  return [
    "## Modo: destrinchar anúncio em arte",
    "",
    `Cliente: ${cliente}`,
    `Uso: ${uso === "pago" ? "anúncio PAGO (aparece para quem não segue o perfil)" : "post ORGÂNICO do feed"}` +
      (circulaFora ? "; a arte também vai circular fora do Instagram (WhatsApp, Telegram)" : ""),
    "",
    "# O anúncio pronto (aprovado — é a fonte de todo texto da arte)",
    descreverAnuncio(anuncio),
    "",
    "# A arte",
    `Template: ${template.label} (${template.id} ${template.versao}). ${template.resumo}`,
    `Páginas: EXATAMENTE ${total}. Papel de cada uma: ${papeisDoConjunto(total)}.`,
    total > 1
      ? "É um carrossel: cada página corresponde a um card do campo `carrossel`, na mesma ordem."
      : "É um post de uma imagem só.",
    "",
    "Layouts e slots:",
    descreverTemplate(template),
    "",
    "# Fotos disponíveis (reais, enviadas pela equipe)",
    blocoFotos,
    "",
    "# Elementos da marca que o template vai desenhar sozinho",
    incluidos.length ? `- ${incluidos.join(", ")}` : "- nenhum",
    "Não escreva telefone, @, site nem endereço nos slots: o template põe o que estiver incluído.",
    "",
    "# Identificação do médico (copie EXATAMENTE para `identificacao`)",
    `- nome: ${identificacao.nome || ""}`,
    `- crm: ${identificacao.crm || ""}`,
    `- uf: ${identificacao.uf || ""}`,
    `- rqe: ${identificacao.rqe || ""}`,
    naLegenda
      ? `A identificação vai na legenda: o sistema acrescenta "${linhaId}" ao fim dela — não a repita.`
      : "Não escreva a identificação nos slots: o sistema a desenha quando a regra pede.",
    "",
    "# Resposta",
    "Uma frase dizendo como você dividiu o anúncio e, por último, UM bloco ```json sem texto depois dele:",
    "```json",
    esqueletoJsonArte(),
    "```",
  ].join("\n");
}

/**
 * A resposta do agente, sem confiar nela: slides normalizados contra o template (papel, slots,
 * foto), legenda e hashtags limpas, a identificação como ele devolveu (para conferir).
 *
 * @returns {{ slides: object[], legenda: string, hashtags: string[], identificacao: object|null, semJson: boolean }}
 */
export function parseArteReply(texto, { template, total, fotos = 0 }) {
  const bruto = extractContractJson(texto);
  if (!bruto || typeof bruto !== "object") {
    return { slides: [], legenda: "", hashtags: [], identificacao: null, semJson: true };
  }
  let slides = Array.isArray(bruto.slides) ? bruto.slides : [];
  // O número de páginas é do anúncio, não do agente: a mais é cortada; a menos, completa-se com
  // páginas vazias (que a validação acusa como título vazio, para alguém preencher).
  slides = slides.slice(0, total);
  while (slides.length < total) slides.push({});
  const hashtags = (Array.isArray(bruto.hashtags) ? bruto.hashtags : [])
    .map((h) => String(h ?? "").trim().replace(/^#*/, "").replace(/\s+/g, ""))
    .filter((h) => /^[\p{L}\p{N}_]{2,40}$/u.test(h))
    .slice(0, 10);
  return {
    slides: normalizarSlides(slides, template, { fotos }),
    legenda: typeof bruto.legenda === "string" ? bruto.legenda.trim() : "",
    hashtags,
    identificacao: bruto.identificacao && typeof bruto.identificacao === "object" ? bruto.identificacao : null,
    semJson: false,
  };
}

const soNumero = (v) => String(v ?? "").replace(/\D/g, "");

/**
 * As regras que dependem do texto FINAL — rodam ao montar o post e de novo a cada edição à mão:
 * "NÃO ESPECIALISTA" onde a pós é citada, e a linha de identificação na legenda quando é lá que
 * ela vai. Devolve o post novo (não muda o recebido) e os avisos do template.
 */
export function aplicarRegrasDoPost(post, template, kitIdentificacao) {
  const id = kitIdentificacao || {};
  const textos = textosDaArte(post.slides);
  // A legenda sem a linha que o sistema acrescentou: senão a regra leria a própria assinatura.
  const linhaAnterior = post.identificacao?.linha || "";
  const legendaBase = linhaAnterior ? post.legenda.split(`\n\n${linhaAnterior}`).join("").trimEnd() : post.legenda;
  const nao = precisaNaoEspecialista(id, { arte: textos, legenda: legendaBase });
  const naoEspecialista = nao.naArte || nao.naLegenda;
  const linha = linhaDeIdentificacao(id, { naoEspecialista });
  // Pós citada na arte: a identificação com "NÃO ESPECIALISTA" vai na arte, mesmo onde seria opcional.
  const naArte = Boolean(post.identificacao?.naArte) || nao.naArte;
  const naLegenda = Boolean(post.identificacao?.naLegenda) || nao.naLegenda;
  const legenda = naLegenda && linha ? `${legendaBase}\n\n${linha}` : legendaBase;

  const proximo = {
    ...post,
    legenda,
    identificacao: {
      nome: id.nome || "",
      crm: id.crm || "",
      uf: id.uf || "",
      rqe: id.rqe || "",
      linha,
      naArte,
      naLegenda,
      naoEspecialista,
    },
  };
  const avisos = validarSlides(proximo.slides, template);
  if (nao.naArte && !post.identificacao?.naArte) {
    avisos.push({
      slide: null,
      campo: "identificacao",
      tipo: "nao_especialista",
      detalhe: 'a arte cita a pós-graduação sem RQE: a identificação entrou na arte com "NÃO ESPECIALISTA"',
    });
  }
  if (!legendaBase.trim()) {
    avisos.push({ slide: null, campo: "legenda", tipo: "vazio", detalhe: "legenda vazia" });
  }
  return { post: proximo, avisos };
}

/**
 * O post renderizável a partir da resposta lida, das opções da pré-etapa e do Brand kit.
 *
 * @returns {{ post: object, avisos: object[] }}
 */
export function montarPost({ lido, anuncio, template, proporcao = "4:5", opcoes, kitIdentificacao, onde }) {
  const avisos = [];
  let legenda = lido.legenda;
  if (!legenda) {
    legenda = legendaDoAnuncio(anuncio);
    avisos.push({
      slide: null,
      campo: "legenda",
      tipo: "legenda_do_anuncio",
      detalhe: "o agente não devolveu a legenda: ficou a do anúncio",
    });
  }
  // A identificação que o agente devolveu tem de bater com a do kit. Não bater é sinal de que ele
  // "corrigiu" um número — e um CRM errado numa peça publicada é o pior erro possível aqui.
  const devolvida = lido.identificacao;
  if (!devolvida) {
    avisos.push({ slide: null, campo: "identificacao", tipo: "identificacao_ausente", detalhe: "o agente não devolveu a identificação; usada a do Brand kit" });
  } else if (soNumero(devolvida.crm) !== soNumero(kitIdentificacao.crm) || soNumero(devolvida.rqe) !== soNumero(kitIdentificacao.rqe)) {
    avisos.push({ slide: null, campo: "identificacao", tipo: "identificacao_divergente", detalhe: "o agente devolveu CRM/RQE diferentes do Brand kit; mantidos os do Brand kit" });
  }

  const elementos = { ...(opcoes.elementos || {}), identificacao: onde.naArte };
  const base = {
    schema: SCHEMA_DO_POST,
    template: { id: template.id, versao: template.versao },
    proporcao,
    slides: lido.slides,
    legenda,
    hashtags: lido.hashtags,
    identificacao: { naArte: onde.naArte, naLegenda: onde.naLegenda },
    elementos,
    uso: opcoes.uso,
    circula_fora: Boolean(opcoes.circula_fora),
  };
  const r = aplicarRegrasDoPost(base, template, kitIdentificacao);
  // O elemento `identificacao` acompanha o que as regras decidiram (a pós pode tê-lo ligado).
  r.post.elementos = { ...r.post.elementos, identificacao: r.post.identificacao.naArte };
  return { post: r.post, avisos: [...avisos, ...r.avisos] };
}

export const MAX_FOTOS = 10;

/**
 * As escolhas da pré-etapa, limpas e conferidas contra o kit e o cliente.
 *
 * As fotos enviadas só valem se estiverem na pasta DESTE cliente no bucket (`artes/{cliente}/fotos/`):
 * o caminho vem do navegador, e aceitar qualquer um deixaria uma arte usar a foto de outro cliente.
 * A foto do médico do Brand kit entra primeiro, quando a chave dela está ligada.
 *
 * @returns {{ opcoes: object, erros: string[] }}
 */
export function normalizarOpcoes(bruto, { kit, cliente, formato }) {
  const b = bruto && typeof bruto === "object" ? bruto : {};
  const erros = [];
  const uso = b.uso === "pago" || b.uso === "organico" ? b.uso : formato === "meta_ads" ? "pago" : "organico";
  const onde = ["arte", "legenda", "nenhum"].includes(b.onde_identificar) ? b.onde_identificar : "arte";

  const elementos = {};
  for (const e of ELEMENTOS_DA_ARTE) {
    if (e.id === "identificacao") continue;
    elementos[e.id] = b.elementos?.[e.id] === true && kitTemElemento(kit, e.id);
  }

  const pasta = `artes/${cliente}/fotos/`;
  const enviadas = (Array.isArray(b.fotos) ? b.fotos : []).filter((f) => {
    const ok = typeof f?.caminho === "string" && f.caminho.startsWith(pasta) && !f.caminho.includes("..");
    if (!ok) erros.push("Uma das fotos não é deste cliente e foi recusada.");
    return ok;
  });
  const tipos = new Set(TIPOS_DE_FOTO.map((t) => t.id));
  const fotos = [
    ...(elementos.foto_medico
      ? [{ caminho: kit.imagens.foto_medico, tipo: "medico", descricao: "foto do médico (Brand kit)" }]
      : []),
    ...enviadas.map((f) => ({
      caminho: f.caminho,
      tipo: tipos.has(f.tipo) ? f.tipo : "outro",
      descricao: String(f.descricao ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
    })),
  ];
  if (fotos.length > MAX_FOTOS) erros.push(`No máximo ${MAX_FOTOS} fotos por arte.`);

  return {
    opcoes: {
      uso,
      circula_fora: b.circula_fora === true,
      onde_identificar: onde,
      elementos,
      fotos: fotos.slice(0, MAX_FOTOS),
    },
    erros: [...new Set(erros)],
  };
}
