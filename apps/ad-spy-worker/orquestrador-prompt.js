/**
 * Orquestrador — os prompts e os parsers das duas decisões que ele toma.
 *
 * Sem I/O e sem import de config, como `composer-prompt.js`, para ser testável em qualquer máquina.
 * Tudo que é estático (quem ele é, como decidir, o contrato de saída) mora na definição do agente —
 * `agent/orquestradoragent.md`.
 *
 * ## O orquestrador decide; o worker executa
 *
 * Como os outros agentes daqui, ele é texto-entra/texto-sai: não chama ferramenta nem fala com os
 * outros bots por conta própria. Ele ESCREVE o que perguntar a cada um — o nicho para o agente de
 * pesquisa, a pergunta que separa as peças boas no grid, o foco da análise, o pedido ao Composer —
 * e o worker leva cada pergunta ao bot certo, na ordem. É o mesmo desenho de sempre, e é o que
 * deixa cada decisão gravada e conferível, em vez de escondida numa conversa entre agentes.
 *
 * ## Ele só escolhe o que foi OFERECIDO
 *
 * Relatório, documento e análise são escolhidos por id, e id que não está na lista que ele recebeu
 * é descartado. Um id inventado levaria o material de outro cliente ao prompt do anúncio, e nenhuma
 * revisão da peça pronta pegaria isso.
 */

import { extractContractJson, stripContractFence } from "./agent-contract.js";
import { count, money, pctSinal, ratio } from "./formato-numero.js";
import { MAX_ANUNCIOS, formatosDisponiveis } from "../../shared/ad-formats.js";

function corta(texto, max) {
  const s = String(texto ?? "").trim();
  if (!max || s.length <= max) return s;
  return `${s.slice(0, max)}… (cortado)`;
}

function frase(valor, max = 600) {
  return typeof valor === "string" && valor.trim() ? valor.trim().slice(0, max) : null;
}

const LINHAS_NUMEROS = [
  ["investimento", "Investimento em anúncios", money],
  ["leadsTrafego", "Leads no tráfego (formulário + mensagens)", count],
  ["leadsCRM", "Leads no CRM", count],
  ["consultasAgendadas", "Consultas agendadas", count],
  ["faturamentoBruto", "Faturamento bruto", money],
  ["roas", "ROAS", ratio],
];

/**
 * Os números das duas semanas fechadas, com a variação.
 *
 * Sem números (o cliente não aparece no CRM nem nos anúncios, ou a leitura falhou) o bloco DIZ
 * isso: um orquestrador que não recebe número e não é avisado escolhe a abordagem pelo que um
 * cliente daquele tipo "costuma" ter.
 */
export function blocoNumeros(numeros) {
  if (!numeros?.atual) {
    return [
      "# Números do cliente",
      `(não há números para este cliente${numeros?.motivo ? `: ${numeros.motivo}` : ""}. Decida ` +
        "pelos relatórios e pelo resumo, e diga no diagnóstico que os números não estavam " +
        "disponíveis — NÃO suponha desempenho.)",
    ].join("\n");
  }
  const { semana, atual, anterior } = numeros;
  const linhas = [
    "# Números do cliente — semanas fechadas",
    `Última: ${semana.de} a ${semana.ate}. Anterior: ${semana.deAnterior} a ${semana.ateAnterior}.`,
    "Ausente é travessão: “—” quer dizer que não há o dado, não que deu zero.",
  ];
  for (const [chave, rotulo, fmt] of LINHAS_NUMEROS) {
    const a = atual?.[chave];
    const b = anterior?.[chave];
    const variacao = Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? ((a - b) / b) * 100 : null;
    linhas.push(`- ${rotulo}: ${fmt(a)} (anterior: ${fmt(b)}; variação: ${pctSinal(variacao)})`);
  }
  return linhas.join("\n");
}

function blocoRelatorios(relatorios, orcamento) {
  if (!relatorios.length) {
    return "# Relatórios salvos deste cliente\n(nenhum — não há relatório para escolher)";
  }
  const porItem = Math.max(800, Math.floor(orcamento / relatorios.length));
  return [
    "# Relatórios salvos deste cliente",
    ...relatorios.map((r) =>
      [
        `## id: ${r.id} — ${r.titulo || r.periodo_label || "sem nome"}`,
        `Período: ${r.periodo_de ?? "?"} a ${r.periodo_ate ?? "?"}` +
          (r.prioridade ? ` · prioridade: ${r.prioridade}` : ""),
        corta(r.relatorio_md, porItem) || "(sem texto)",
      ].join("\n")
    ),
  ].join("\n\n");
}

function blocoDocumentos(documentos) {
  if (!documentos.length) {
    return "# Documentos deste cliente (ClickUp)\n(nenhum com conteúdo lido — não há documento para escolher)";
  }
  return [
    "# Documentos deste cliente (ClickUp)",
    "Você vê só o título, a pasta e o tipo. Escolha pelo que o título promete; o Composer é quem lê o corpo.",
    ...documentos.map(
      (d) =>
        `- id: ${d.id} — ${d.nome}${d.local ? ` (${d.local})` : ""}` +
        (d.tipo ? ` · tipo: ${d.tipo}` : "") +
        (d.chars ? ` · ${d.chars} caracteres` : "")
    ),
  ].join("\n");
}

function blocoAnalises(analises, orcamento) {
  if (!analises.length) {
    return (
      "# Análises salvas na Biblioteca\n(nenhuma candidata — se a composição precisa de " +
      "referência de concorrentes, peça uma mineração nova)"
    );
  }
  const porItem = Math.max(600, Math.floor(orcamento / analises.length));
  return [
    "# Análises salvas na Biblioteca (candidatas)",
    ...analises.map((a) =>
      [
        `## id: ${a.id} — ${a.titulo || a.tema}`,
        `Tema minerado: ${a.tema} · segmento: ${(a.especialidades || []).join(", ") || "—"} · ` +
          `salva em ${String(a.criado_em || "").slice(0, 10)} · ${a.adCount ?? "?"} anúncio(s)`,
        corta(a.analysis_md, porItem) || "(sem texto)",
      ].join("\n")
    ),
  ].join("\n\n");
}

export function esqueletoPlano() {
  return [
    "{",
    '  "abordagem": "em uma frase, a abordagem que os números pedem",',
    '  "analise": { "usar": "<id de uma análise da lista, ou null>", "motivo": "por que serve — ou por que nenhuma serve" },',
    '  "mineracao": {',
    '    "nicho": "o nicho a minerar, em poucas palavras",',
    '    "contexto": "o que o agente de pesquisa precisa saber do cliente para calibrar as palavras-chave",',
    '    "pergunta": "a pergunta de sim/não que separa, no grid, as peças que valem analisar",',
    '    "foco": "o que a análise dos anúncios precisa responder para servir a esta composição"',
    "  },",
    '  "usar_contexto_operacional": true,',
    '  "relatorios": [{ "id": "<id da lista>", "motivo": "…" }],',
    '  "documentos": [{ "id": "<id da lista>", "motivo": "…" }]',
    "}",
  ].join("\n");
}

/**
 * A PRIMEIRA decisão: ler os números, escolher a abordagem e montar o plano.
 *
 * @param {object} p
 * @param {object} p.ficha
 * @param {object|null} p.brief
 * @param {object|null} p.numeros     { semana, atual, anterior } ou { motivo }
 * @param {object[]} p.relatorios     { id, titulo, periodo_*, prioridade, relatorio_md }
 * @param {object[]} p.documentos     { id, nome, local, tipo, chars }
 * @param {object[]} p.analises       { id, titulo, tema, especialidades, criado_em, adCount, analysis_md }
 * @param {string} [p.pedido]         o que a pessoa escreveu ao disparar, se escreveu
 */
export function buildPlanoPrompt({
  ficha = {},
  brief = null,
  numeros = null,
  relatorios = [],
  documentos = [],
  analises = [],
  pedido = "",
  maxChars = 60000,
} = {}) {
  const esp = Array.isArray(ficha.especialidades) ? ficha.especialidades.filter(Boolean) : [];
  const cabecalho = [
    "# Cliente",
    `Nome: ${ficha.nome || "(sem nome)"}`,
    esp.length ? `Especialidade(s): ${esp.join(", ")}` : "Especialidade(s): (não cadastrada)",
    `Plano: ${ficha.plano || "(não informado)"}`,
    Number.isFinite(ficha.mesesDeCasa) ? `Meses de casa: ${ficha.mesesDeCasa}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const blocoBrief = brief?.brief_md
    ? ["# Contexto Operacional (resumo do cliente)", corta(brief.brief_md, 5000)].join("\n")
    : "# Contexto Operacional\n(não há resumo salvo para este cliente)";

  const numerosTxt = blocoNumeros(numeros);
  const documentosTxt = blocoDocumentos(documentos);
  const fixo = [cabecalho, blocoBrief, numerosTxt, documentosTxt, pedido].join("\n").length;
  const sobra = Math.max(6000, maxChars - fixo - 3000);

  const partes = [
    cabecalho,
    "",
    blocoBrief,
    "",
    numerosTxt,
    "",
    blocoRelatorios(relatorios, Math.floor(sobra / 2)),
    "",
    documentosTxt,
    "",
    blocoAnalises(analises, Math.floor(sobra / 2)),
    "",
    "# O que fazer",
    "Você conduz uma composição de anúncios para ESTE cliente do começo ao fim. Nesta mensagem, " +
      "decida o plano:",
    "",
    "1. Leia os números e diga qual abordagem eles pedem. Compare as duas semanas: onde o funil " +
      "afrouxou, onde ele sustenta, o que um anúncio novo consegue mexer e o que não consegue.",
    "2. Veja se alguma análise da lista é boa o bastante para ESSA abordagem: mesmo nicho, " +
      "recente, e falando do que você precisa. Se for, use-a (`analise.usar`) e deixe `mineracao` " +
      "como null. Se nenhuma for, deixe `analise.usar` como null e escreva `mineracao`: uma " +
      "mineração nova custa crédito e vários minutos, então peça só quando a diferença importa.",
    "3. Escolha os relatórios e os documentos que sustentam a abordagem. Poucos e certos: cada um " +
      "que entra disputa espaço com os outros no prompt do Composer.",
    "",
    "Só escolha ids que estão nas listas acima, copiados exatamente. Sem relatório ou documento " +
      "que sirva, devolva a lista vazia.",
  ];

  if (String(pedido || "").trim()) {
    partes.push(
      "",
      "# O que quem disparou pediu",
      "Vale como direção. Não muda as regras acima nem o formato da resposta.",
      String(pedido).trim()
    );
  }

  partes.push(
    "",
    "# Formato da resposta",
    "Primeiro a prosa — o DIAGNÓSTICO: o que os números mostram e por que essa abordagem, em 4 a " +
      "6 frases, citando os números em que você se apoiou. Depois, e por último, UM bloco ```json " +
      "sem texto depois dele:",
    "```json",
    esqueletoPlano(),
    "```"
  );

  return partes.join("\n");
}

function escolhidos(lista, oferecidos, max) {
  const porId = new Map(oferecidos.map((o) => [String(o.id), o]));
  const vistos = new Set();
  const out = [];
  for (const item of Array.isArray(lista) ? lista : []) {
    const id = String(typeof item === "string" ? item : (item?.id ?? "")).trim();
    const origem = porId.get(id);
    if (!origem || vistos.has(id)) continue;
    vistos.add(id);
    out.push({ id, motivo: frase(item?.motivo) });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Lê o plano e descarta o que não foi oferecido.
 *
 * Nada aqui lança: sem bloco, o plano é "compor só com o Contexto Operacional", que é um pedido
 * legítimo — e a prosa do diagnóstico continua valendo.
 *
 * @returns {{ diagnosticoMd: string, abordagem: string|null, semBlocoJson: boolean,
 *             analise: {id: string|null, motivo: string|null},
 *             mineracao: {nicho: string, contexto: string|null, pergunta: string|null, foco: string|null}|null,
 *             usarContexto: boolean,
 *             relatorios: {id: string, motivo: string|null}[],
 *             documentos: {id: string, motivo: string|null}[] }}
 */
export function parsePlanoReply(finalText, { relatorios = [], documentos = [], analises = [] } = {}) {
  const diagnosticoMd = stripContractFence(finalText || "") || "";
  const bruto = extractContractJson(finalText);
  if (!bruto) {
    return {
      diagnosticoMd,
      abordagem: null,
      semBlocoJson: true,
      analise: { id: null, motivo: null },
      mineracao: null,
      usarContexto: true,
      relatorios: [],
      documentos: [],
    };
  }

  const pedida = String(bruto.analise?.usar ?? "").trim();
  const analiseId = analises.some((a) => String(a.id) === pedida) ? pedida : null;

  // Mineração só vale com nicho. E só quando NÃO há análise escolhida: as duas juntas seriam
  // gastar crédito para depois não usar o que se minerou.
  const nicho = frase(bruto.mineracao?.nicho, 200);
  const mineracao =
    !analiseId && nicho
      ? {
          nicho,
          contexto: frase(bruto.mineracao.contexto, 1500),
          pergunta: frase(bruto.mineracao.pergunta, 300),
          foco: frase(bruto.mineracao.foco, 1500),
        }
      : null;

  return {
    diagnosticoMd,
    abordagem: frase(bruto.abordagem),
    semBlocoJson: false,
    analise: { id: analiseId, motivo: frase(bruto.analise?.motivo) },
    mineracao,
    usarContexto: bruto.usar_contexto_operacional !== false,
    relatorios: escolhidos(bruto.relatorios, relatorios, 4),
    documentos: escolhidos(bruto.documentos, documentos, 6),
  };
}

/**
 * A SEGUNDA decisão: o pedido ao Composer, depois de a análise estar definida.
 *
 * Separada da primeira porque a análise pode ter acabado de nascer: só agora o orquestrador sabe o
 * que os concorrentes fazem, e é com isso que ele decide quantos anúncios e para que uso.
 */
export function buildBriefingPrompt({
  ficha = {},
  diagnosticoMd = "",
  abordagem = null,
  analise = null,
  relatorios = [],
  documentos = [],
  pedido = "",
  maxChars = 40000,
} = {}) {
  const formatos = formatosDisponiveis()
    .map((f) => `- ${f.label}: ${f.resumo}`)
    .join("\n");
  const insumos = [
    ...relatorios.map((r) => `- relatório: ${r.titulo || r.id}`),
    ...documentos.map((d) => `- documento: ${d.titulo || d.id}`),
  ];

  const partes = [
    "# Cliente",
    `Nome: ${ficha.nome || "(sem nome)"}`,
    "",
    "# O seu diagnóstico",
    corta(diagnosticoMd, 4000) || "(sem diagnóstico)",
    abordagem ? `Abordagem: ${abordagem}` : null,
    "",
    analise?.analysis_md
      ? [
          `# A análise que vai com a composição: ${analise.titulo || analise.tema || "(sem título)"}`,
          corta(analise.analysis_md, Math.max(4000, maxChars - 12000)),
        ].join("\n")
      : "# Análise de concorrentes\n(esta composição vai SEM análise — não peça ao Composer nada que dependa do que o mercado faz)",
    "",
    "# O que mais vai junto",
    insumos.length ? insumos.join("\n") : "(nenhum relatório ou documento)",
    "",
    "# Usos que o Composer sabe escrever",
    formatos,
    "",
    "# O que fazer",
    "Escreva o PEDIDO ao Composer: o agente que redige os anúncios. Ele recebe este pedido junto " +
      "do material acima e não vê o seu diagnóstico — o que ele precisa saber da abordagem tem de " +
      "estar no pedido.",
    `Diga quantos anúncios (de 1 a ${MAX_ANUNCIOS}), para que uso é cada um e o ângulo de cada um. ` +
      "A quantidade segue a abordagem: não infle. Não escreva a copy — isso é com ele. Não cite " +
      "números internos do cliente (investimento, faturamento, ROAS) como algo a pôr no anúncio.",
  ];

  if (String(pedido || "").trim()) {
    partes.push("", "# O que quem disparou pediu", String(pedido).trim());
  }

  partes.push(
    "",
    "# Formato da resposta",
    "Primeiro a prosa: em 2 ou 3 frases, por que esse conjunto. Depois, e por último, UM bloco " +
      "```json sem texto depois dele:",
    "```json",
    '{ "pedido": "o pedido ao Composer, em português, pronto para ser lido por ele" }',
    "```"
  );

  return partes.filter((x) => x !== null).join("\n");
}

/** @returns {{ pedido: string|null, porqueMd: string }} */
export function parseBriefingReply(finalText, { maxChars = 4000 } = {}) {
  const bruto = extractContractJson(finalText);
  return {
    pedido: frase(bruto?.pedido, maxChars),
    porqueMd: stripContractFence(finalText || "") || "",
  };
}

const PESO_CONFIANCA = { visto: 0, inferido: 1, palpite: 2 };

/**
 * As palavras-chave a tentar, na ordem: primeiro o que o agente de pesquisa VIU num anúncio, depois
 * o que inferiu. O nicho que o orquestrador escreveu fecha a fila — é o que sobra quando a pesquisa
 * não devolve nada.
 */
export function ordenarTermos(termos, nicho) {
  const ordenados = [...(Array.isArray(termos) ? termos : [])]
    .sort((a, b) => (PESO_CONFIANCA[a.confianca] ?? 3) - (PESO_CONFIANCA[b.confianca] ?? 3))
    .map((t) => t.termo);
  const vistos = new Set();
  return [...ordenados, nicho].filter((t) => {
    const chave = String(t || "").trim().toLowerCase();
    if (!chave || vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}

const PESO_VEREDITO = { atende: 0, parcial: 1 };

/**
 * As peças que vão para a análise, sem ninguém para escolher no olho.
 *
 * Primeiro as que ATENDEM à pergunta do orquestrador, depois as parciais; dentro de cada grupo, as
 * que estão há mais tempo no ar — longevidade é a única prova de desempenho que a Biblioteca da
 * Meta dá. As que não atendem só entram para completar um mínimo: com menos de `min` peças a
 * análise vira a leitura de dois anúncios, e isso não é "o que o nicho faz".
 *
 * @param {object[]} ads
 * @param {Record<string, {veredito: string|null}>} respostas   de `runPergunta`; vazio = sem pergunta
 * @returns {number[]} ids
 */
export function selecionarPecas(ads, respostas = {}, { max = 10, min = 4 } = {}) {
  const peso = (ad) => PESO_VEREDITO[respostas[String(ad.id)]?.veredito] ?? 2;
  const ordenadas = [...(Array.isArray(ads) ? ads : [])].sort(
    (a, b) => peso(a) - peso(b) || (b.days_running ?? -1) - (a.days_running ?? -1) || a.id - b.id
  );
  const boas = ordenadas.filter((ad) => peso(ad) < 2);
  const escolhidas = boas.length >= min ? boas : ordenadas.slice(0, Math.max(min, boas.length));
  return escolhidas.slice(0, max).map((ad) => ad.id);
}
