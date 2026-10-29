/**
 * O que varia por composição: a ficha do cliente, o resumo, os relatórios, os documentos, a análise
 * da Biblioteca e a spec do formato de destino.
 *
 * Sem I/O e sem import de config, para poder ser testado em qualquer máquina. Tudo que é estático
 * (persona, o que é a Groohub, como se escreve copy que presta, o contrato de saída) mora na
 * definição do agente — `agent/composeragent.md`.
 *
 * ## Por que a spec do formato entra no prompt
 *
 * Os campos e os limites vêm de `shared/ad-formats.js`, o MESMO arquivo que a tela usa para montar
 * o seletor e para renderizar o resultado. Descrever o formato em prosa aqui criaria uma segunda
 * definição que divergiria da primeira na primeira correção — e o sintoma seria o agente devolvendo
 * campos que a tela não sabe mostrar, sem erro nenhum.
 *
 * O limite vai para o prompt E é conferido depois (`validarLimites`). As duas coisas: pedir ajuda a
 * acertar, conferir porque modelo erra contagem de caractere.
 */

import { extractContractJson, stripContractFence } from "./agent-contract.js";
import {
  MAX_ANUNCIOS,
  formatosDisponiveis,
  getFormato,
  validarLimites,
} from "../../shared/ad-formats.js";
import { estruturaParaAgentes } from "../../shared/dissecacao-agentes.js";
import { estudoPriorizado } from "../../shared/estudo-copy.js";


/** Ausente vira "—", nunca 0: "não temos o dado" e "deu zero" contam histórias opostas. */

function corta(texto, max) {
  const s = String(texto ?? "").trim();
  if (!max || s.length <= max) return s;
  return `${s.slice(0, max)}… (cortado)`;
}

/**
 * A spec do formato em texto, campo a campo.
 *
 * O limite rígido é dito com todas as letras ("a plataforma RECUSA"), porque a consequência é
 * diferente: 34 caracteres num headline do Google é um anúncio que não sobe; 130 num texto da Meta
 * é uma frase que corta na exibição. Achatar os dois em "limite" faria o agente tratar o caso grave
 * com o mesmo cuidado do caso leve.
 */
export function descreverFormato(formato) {
  if (!formato) return "";
  const linhas = [`FORMATO DE DESTINO: ${formato.label}`, formato.resumo, "", "Campos a entregar:"];
  for (const campo of formato.campos) {
    const partes = [];
    if (campo.tipo === "lista") {
      partes.push(
        campo.itens
          ? `lista de ${campo.itens.min} a ${campo.itens.max} itens`
          : "lista de textos"
      );
      if (campo.limite) {
        partes.push(
          campo.limiteRigido
            ? `até ${campo.limite} caracteres CADA ITEM — a plataforma RECUSA acima disso`
            : `até ${campo.limite} caracteres por item (recomendado: acima disso corta na exibição)`
        );
      }
    } else {
      partes.push("texto");
      if (campo.limite) {
        partes.push(
          campo.limiteRigido
            ? `até ${campo.limite} caracteres — a plataforma RECUSA acima disso`
            : `até ${campo.limite} caracteres (recomendado: acima disso corta na exibição)`
        );
      }
    }
    linhas.push(`- \`${campo.id}\` (${campo.label}): ${partes.join("; ")}. ${campo.ajuda}`);
  }
  return linhas.join("\n");
}

/**
 * O catálogo inteiro: todos os formatos disponíveis, campo a campo.
 *
 * Vai inteiro no prompt porque QUEM ESCOLHE O FORMATO É O AGENTE. Antes a tela escolhia antes de
 * existir qualquer ideia, e só a spec de um formato entrava aqui. Custa mais prompt (cinco
 * formatos), e é o preço de deixar a decisão com quem leu o material.
 *
 * Formato indisponível não entra: a tela não o oferece e o agente não pode escolhê-lo.
 */
export function descreverCatalogo(formatos = formatosDisponiveis()) {
  return formatos
    .map((f) => `## ${f.id} — ${f.label}\n${descreverFormato(f)}`)
    .join("\n\n");
}

/**
 * O esqueleto do bloco ```json da PRIMEIRA chamada: o conjunto inteiro e o primeiro anúncio.
 *
 * `anuncios` é o plano — quantos são e para que uso é cada um. É por ele que a tela sabe, desde o
 * começo, quantos anúncios esperar. `campos` é só o do PRIMEIRO da lista: os outros são pedidos um
 * a um, cada um com a spec do seu formato.
 *
 * As chaves de `campos` dependem do formato, por isso o esqueleto mostra a forma e manda consultar
 * o catálogo. E o `formato` de cada item é obrigatório: sem ele não há como validar os limites nem
 * como a tela saber o que desenhar.
 */
export function esqueletoJson() {
  return [
    "{",
    '  "anuncios": [',
    "    {",
    '      "formato": "<um dos ids do catálogo acima>",',
    '      "angulo": "em uma frase, o que ESTE anúncio diz e o que o separa dos outros do conjunto",',
    '      "formato_justificativa": "em uma frase, por que este uso serve a este material"',
    "    }",
    "  ],",
    '  "campos": {',
    '    "<id do campo do formato do PRIMEIRO anúncio, conforme o catálogo>": "…"',
    "  }",
    "}",
  ].join("\n");
}

/** O esqueleto das chamadas seguintes: o formato já está decidido, só os campos voltam. */
export function esqueletoJsonAnuncio() {
  return ["{", '  "campos": {', '    "<id do campo, conforme a spec acima>": "…"', "  }", "}"].join(
    "\n"
  );
}

/**
 * O plano em texto, para as chamadas seguintes.
 *
 * Cada chamada escreve UM anúncio numa sessão nova, sem memória das outras. É esta lista que faz o
 * anúncio 3 saber o que o 1 e o 2 dizem — sem ela, oito chamadas independentes devolveriam oito
 * vezes a ideia mais óbvia.
 */
export function descreverPlano(plano, indice) {
  return (Array.isArray(plano) ? plano : [])
    .map((item, i) => {
      const formato = getFormato(item.formato);
      const linha = `${i + 1}. ${formato?.label ?? item.formato}${item.angulo ? ` — ${item.angulo}` : ""}`;
      return i === indice ? `${linha}  <- ESTE` : linha;
    })
    .join("\n");
}


/**
 * Os anúncios que embasaram a análise, dentro de um orçamento de caracteres.
 *
 * A análise diz o que funciona; os anúncios são a matéria-prima — é neles que estão o gancho real e
 * a palavra que o concorrente usou. Mas transcrição é longa, e o corpus inteiro passaria do que
 * cabe num turno. Corta por anúncio e diz que cortou: texto truncado em silêncio faz o agente
 * tratar meia frase como frase inteira.
 */
export function resumirAnuncios(ads, orcamento) {
  const lista = Array.isArray(ads) ? ads : [];
  if (!lista.length || !orcamento || orcamento <= 0) return "";

  // Orçamento por anúncio, com piso: dividir 20 mil por 30 anúncios daria pedaços inúteis.
  const porAnuncio = Math.max(400, Math.floor(orcamento / Math.max(1, lista.length)));
  const blocos = [];
  let usado = 0;

  lista.forEach((ad, i) => {
    if (usado >= orcamento) return;
    const cabecalho = `#${i + 1} — ${ad.page_name || "(anunciante desconhecido)"}${
      Number.isFinite(ad.days_running) ? ` · ${ad.days_running} dias no ar` : ""
    }`;
    const copy = corta(ad.ad_copy, Math.floor(porAnuncio * 0.5));
    const transcricao = corta(ad.transcript, Math.floor(porAnuncio * 0.5));
    const bloco = [
      cabecalho,
      copy ? `Texto: ${copy}` : null,
      transcricao ? `Transcrição: ${transcricao}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    usado += bloco.length;
    blocos.push(bloco);
  });

  return blocos.join("\n\n");
}

/**
 * Os relatórios escolhidos. O conteúdo está no NOSSO banco (`relatorio_md`), então aqui é só cortar.
 */
export function blocoRelatorios(relatorios, orcamento) {
  const lista = (Array.isArray(relatorios) ? relatorios : []).filter((r) => r?.relatorio_md);
  if (!lista.length) return "";
  const porItem = Math.max(1200, Math.floor(orcamento / lista.length));
  const blocos = lista.map((r) => {
    const titulo = r.periodo_label || `${r.periodo_de ?? "?"} a ${r.periodo_ate ?? "?"}`;
    return [`## Relatório — ${titulo}`, corta(r.relatorio_md, porItem)].join("\n");
  });
  return ["# Relatórios deste cliente", ...blocos].join("\n\n");
}

/**
 * Os documentos escolhidos, do ClickUp.
 *
 * Documento SEM corpo entra dizendo que não foi lido. É a diferença entre "o agente sabe que só tem
 * o título" e "o agente trata o título como se fosse o conteúdo" — a segunda produz uma ideia
 * inventada com cara de fundamentada.
 */
export function blocoDocumentos(documentos, orcamento) {
  const lista = Array.isArray(documentos) ? documentos : [];
  if (!lista.length) return "";
  const comCorpo = lista.filter((d) => d?.conteudo_md) || [];
  const porItem = Math.max(1200, Math.floor(orcamento / Math.max(1, comCorpo.length)));
  const blocos = lista.map((d) => {
    const cabecalho = `## ${d.nome || "(documento sem nome)"}${d.local ? ` — ${d.local}` : ""}`;
    const corpo = d.conteudo_md
      ? corta(d.conteudo_md, porItem)
      : "(não foi possível ler o conteúdo deste documento: você tem só o título e a pasta. NÃO " +
        "suponha o que há dentro dele.)";
    return [cabecalho, corpo].join("\n");
  });
  return ["# Documentos do cliente (ClickUp)", ...blocos].join("\n\n");
}

const NIVEL_LABEL = {
  inconsciente: "inconsciente do problema",
  consciente_problema: "consciente do problema",
  consciente_solucao: "consciente da solução",
  consciente_produto: "consciente do produto",
};

/**
 * As análises de criativo escolhidas: a dissecação de UM anúncio de concorrente cada uma, feita pelo
 * spyagent (Mineração › Análises de Criativos).
 *
 * Vão como referência de COMO um anúncio é construído — estrutura, o que ele diz, o que ele faz com
 * quem assiste —, e o cabeçalho diz isso ao agente: é peça de concorrente, não material do cliente,
 * e copiá-la seria o contrário do que o Composer existe para fazer.
 */
export function blocoCriativos(criativos, orcamento) {
  const lista = (Array.isArray(criativos) ? criativos : []).filter((c) => c?.dissecacao || c?.dissecacao_md);
  if (!lista.length) return "";
  const porItem = Math.max(1200, Math.floor(orcamento / lista.length));
  const blocos = lista.map((c) => {
    const ad = c.ad || {};
    const nome = c.titulo || ad.page_name || "(sem nome)";
    const d = c.dissecacao;
    // Versão 2: a estrutura feita para agentes — blocos, movimentos e como cada um funciona, sem
    // as palavras da peça (ver shared/dissecacao-agentes.js). O frase a frase fica só na tela.
    const receita = estruturaParaAgentes(d);
    const corpo =
      receita ||
      (d
        ? [
            d.formato && `Formato: ${d.formato}`,
            d.estrutura && `Estrutura: ${d.estrutura}`,
            d.anatomia_semantica && `Anatomia semântica: ${d.anatomia_semantica}`,
            d.anatomia_psicologica && `Anatomia psicológica: ${d.anatomia_psicologica}`,
            d.nivel_consciencia && `Nível de consciência: ${NIVEL_LABEL[d.nivel_consciencia] || d.nivel_consciencia}`,
          ]
            .filter(Boolean)
            .join("\n")
        : c.dissecacao_md);
    const texto = String(ad.ad_copy || ad.title || "").trim();
    const interno = c.origem === "cliente";
    const linhas = [
      interno ? "Origem: anúncio do PRÓPRIO cliente (da conta de anúncios dele)" : null,
      !interno && ad.page_name ? `Anunciante: ${ad.page_name}` : null,
      // Com a receita, o texto do CONCORRENTE não vai: ela existe justamente para modelar sem as
      // palavras dele. O do próprio cliente vai, para o agente saber o que já foi dito e não repetir.
      texto && (interno || !receita) ? `Texto do anúncio: ${texto}` : null,
      corpo,
      interno && c.numeros ? `Números deste anúncio na conta do cliente (${c.numeros})` : null,
    ].filter(Boolean);
    return [`## ${nome}`, corta(linhas.join("\n"), porItem)].join("\n");
  });
  const soInternos = lista.every((c) => c.origem === "cliente");
  return [
    soInternos ? "# Análise de um criativo do próprio cliente" : "# Análises de criativos de concorrentes",
    soInternos
      ? "(A dissecação de UM anúncio que o próprio cliente já veiculou. Use para saber o que já foi " +
        "dito e como — partir do que funcionou, ou fugir do que já cansou —, sem repetir o texto.)"
      : "(Cada uma disseca UM anúncio de um concorrente. Use como referência de estrutura, ângulo e " +
        "nível de consciência — NÃO copie o texto nem o anunciante, e não as trate como material do cliente.)",
    ...blocos,
  ].join("\n\n");
}

/**
 * O que é igual em toda chamada de uma composição: cliente, resumo, análise, relatórios, documentos.
 *
 * `fixo` é o tamanho do que a chamada vai acrescentar depois (catálogo ou spec, instrução, plano):
 * é ele que diz quanto sobra para os blocos elásticos.
 *
 * @returns {string[]} as partes, na ordem, prontas para `join("\n")`
 */
// O Estudo de Copy tem orçamento PRÓPRIO, fora do dos outros documentos: é dele que saem os
// Conceitos Estratégicos, e o do Dr. Otavio sozinho tem ~15 mil caracteres — dividindo o teto de
// documentos com os outros, seria justamente ele o cortado.
export const MAX_ESTUDO_CHARS = 30000;

function blocoEstudo(estudo) {
  if (!estudo?.conteudo_md) return "";
  // Pelas partes mais úteis primeiro (personas, ângulos, tom de voz…): o Estudo dividido em
  // subpáginas dos clientes mais antigos passa de 100 mil caracteres.
  return [`# Estudo de Copy do cliente: ${estudo.nome || "(sem nome)"}`, estudoPriorizado(estudo.conteudo_md, MAX_ESTUDO_CHARS)].join(
    "\n"
  );
}

function contextoDoPrompt({ ficha, analise, brief, relatorios, documentos: todosDocs, criativos = [], fixo, maxChars }) {
  // O Estudo sai da lista de documentos e vai num bloco próprio (ver MAX_ESTUDO_CHARS).
  const estudo = (Array.isArray(todosDocs) ? todosDocs : []).find((d) => d?.estudo && d.conteudo_md) || null;
  const documentos = (Array.isArray(todosDocs) ? todosDocs : []).filter((d) => d !== estudo);
  const estudoTxt = blocoEstudo(estudo);
  const esp = Array.isArray(ficha.especialidades) ? ficha.especialidades.filter(Boolean) : [];

  const cabecalho = [
    "# Cliente",
    `Nome: ${ficha.nome || "(sem nome)"}`,
    esp.length ? `Especialidade(s): ${esp.join(", ")}` : "Especialidade(s): (não cadastrada)",
    `Plano: ${ficha.plano || "(não informado)"}`,
    `Líder de RevOps: ${ficha.squad || "(não informado)"}`,
  ].join("\n");

  const blocoBrief = brief?.brief_md
    ? ["# Resumo deste cliente (escrito pela equipe/agente)", corta(brief.brief_md, 6000)].join("\n")
    : [
        "# Resumo deste cliente",
        "(não há resumo salvo para este cliente — escreva com o que tem e NÃO invente contexto " +
          "comercial que você não recebeu)",
      ].join("\n");

  // O que sobra depois do que tem tamanho fixo, dividido entre os blocos ELÁSTICOS (análise,
  // relatórios, documentos). Divisão igual com piso: quem é curto cabe inteiro e sobra para os
  // outros; quem é longo é cortado — e `corta()` escreve "(cortado)" no texto, porque insumo
  // truncado em silêncio faz o agente tratar meia frase como frase inteira.
  const tamanhoFixo = [cabecalho, blocoBrief, estudoTxt].join("\n").length + fixo;
  const elasticos =
    1 + (relatorios?.length ? 1 : 0) + (documentos?.length ? 1 : 0) + (criativos?.length ? 1 : 0);
  const sobra = Math.max(2000 * elasticos, maxChars - tamanhoFixo - 2000);
  const orcamentoPorBloco = Math.floor(sobra / elasticos);
  const orcamentoAnalise = orcamentoPorBloco;

  let blocoAnalise;
  if (analise?.analysis_md) {
    const titulo = analise.titulo || analise.tema || "(sem título)";
    const md = corta(analise.analysis_md, Math.floor(orcamentoAnalise * 0.6));
    const anuncios = resumirAnuncios(analise.ads, Math.floor(orcamentoAnalise * 0.4));
    blocoAnalise = [
      `# Análise da Biblioteca: ${titulo}`,
      analise.tema ? `Tema minerado: ${analise.tema}` : null,
      Array.isArray(analise.especialidades) && analise.especialidades.length
        ? `Especialidade(s) da análise: ${analise.especialidades.join(", ")}`
        : null,
      "",
      md,
      anuncios ? "\n## Os anúncios que embasaram essa análise\n" : null,
      anuncios || null,
    ]
      .filter((x) => x !== null)
      .join("\n");
  } else {
    blocoAnalise = [
      "# Análise da Biblioteca",
      "(esta composição foi pedida SEM análise de concorrentes — trabalhe só com o cliente e não " +
        "afirme o que o mercado está fazendo)",
    ].join("\n");
  }

  const partes = [cabecalho, "", blocoBrief, "", blocoAnalise];
  if (estudoTxt) partes.push("", estudoTxt);

  const relatoriosTxt = blocoRelatorios(relatorios, orcamentoPorBloco);
  if (relatoriosTxt) partes.push("", relatoriosTxt);

  const documentosTxt = blocoDocumentos(documentos, orcamentoPorBloco);
  if (documentosTxt) partes.push("", documentosTxt);

  const criativosTxt = blocoCriativos(criativos, orcamentoPorBloco);
  if (criativosTxt) partes.push("", criativosTxt);

  return partes;
}

/** A instrução de quem pediu, com o que ela pode e não pode mudar. Vazia = nada entra no prompt. */
function blocoInstrucao(extraPrompt) {
  if (!String(extraPrompt || "").trim()) return [];
  return [
    "",
    "# Instrução de quem pediu",
    "Ela manda sobre o ângulo, o tema, a quantidade de anúncios e o uso de cada um. NÃO manda " +
      "sobre os limites de caractere nem sobre as regras clínicas — essas continuam valendo.",
    String(extraPrompt).trim(),
  ];
}

/**
 * A PRIMEIRA chamada de uma composição: decide o conjunto e escreve o primeiro anúncio.
 *
 * @param {object} p
 * @param {object} p.ficha        nome, especialidades[], plano, squad, temCRM
 * @param {object} [p.analise]    entrada da Biblioteca: { titulo, tema, especialidades, analysis_md, ads }
 * @param {object} [p.brief]      linha de `marketing_client_briefs`
 * @param {object[]} [p.relatorios] linhas de `marketing_client_reports` (conteúdo no nosso banco)
 * @param {object[]} [p.documentos] { nome, local, conteudo_md|null } do ClickUp
 * @param {object[]} [p.criativos]  linhas de `ad_spy_criativos` (a dissecação de um anúncio cada)
 * @param {string} [p.extraPrompt]
 * @param {number} [p.maxChars]   teto do prompt; os insumos longos são o que encolhe
 *
 * NÃO recebe formato nem quantidade: quem decide os dois é o agente, lendo o material e o pedido
 * no `extraPrompt`. O catálogo inteiro vai no prompt para ele poder escolher.
 *
 * ## Por que o plano e o primeiro anúncio vêm juntos
 *
 * Uma chamada só para planejar custaria o prompt inteiro (até 80 mil caracteres) mais uma vez, e
 * dobraria a espera do caso mais comum, que é pedir UM anúncio. Assim, uma composição de N anúncios
 * são N chamadas — e a de um anúncio continua sendo uma.
 */
export function buildComposerPrompt({
  ficha = {},
  analise = null,
  brief = null,
  relatorios = [],
  documentos = [],
  criativos = [],
  extraPrompt = "",
  maxChars = 80000,
} = {}) {
  const catalogo = descreverCatalogo();
  const partes = contextoDoPrompt({
    ficha,
    analise,
    brief,
    relatorios,
    documentos,
    criativos,
    fixo: [catalogo, extraPrompt].join("\n").length,
    maxChars,
  });

  partes.push(
    "",
    "# O que fazer",
    "Escreva ideias de anúncio para ESTE cliente, em dois passos.",
    "",
    `1. Decida o CONJUNTO: quantos anúncios esta composição terá, de 1 a ${MAX_ANUNCIOS}, e para ` +
      "que uso é cada um — o formato de destino, entre os do catálogo abaixo. A quantidade vem do " +
      "pedido: se a instrução de quem pediu disser um número ou nomear os usos (“um Reels e dois " +
      "Stories”), obedeça. Sem pedido de quantidade, é UM anúncio, no formato que o material que " +
      "você recebeu sustenta. Nunca passe do teto, mesmo que peçam.",
    "2. Escreva SÓ O PRIMEIRO anúncio da lista. Os outros serão pedidos um a um, em mensagens " +
      "seguintes, com este mesmo material e com a sua lista.",
    "",
    "Cada anúncio é escrito para o uso dele, não é o mesmo texto recortado: o que abre um Reels " +
      "não é o que abre uma busca no Google. E cada um tem o seu `angulo` — é por ele que os " +
      "anúncios seguintes vão saber o que os outros já dizem.",
    "",
    "# Catálogo de formatos",
    catalogo
  );

  partes.push(...blocoInstrucao(extraPrompt));

  partes.push(
    "",
    "# Formato da resposta",
    "Primeiro a prosa: qual é a ideia do conjunto, por que ela serve A ESTE cliente e por que " +
      "esses usos, em 3 ou 4 frases. Depois, e por último, UM bloco ```json sem texto depois " +
      "dele. `anuncios` lista TODOS os anúncios do conjunto, na ordem em que serão escritos. As " +
      "chaves de `campos` são as do formato do PRIMEIRO anúncio da lista, exatamente como estão " +
      "no catálogo:",
    "```json",
    esqueletoJson(),
    "```"
  );

  return partes.join("\n");
}

/**
 * As chamadas SEGUINTES: um anúncio do conjunto, com o formato já decidido.
 *
 * Só a spec DAQUELE formato entra, e não o catálogo: o agente não está mais escolhendo, e mostrar
 * os outros quatro formatos é convidar um Stories a sair com os campos de um Reels.
 *
 * @param {object} p              o mesmo material de `buildComposerPrompt`, mais:
 * @param {{formato: string, angulo: string|null}[]} p.plano  o conjunto decidido na primeira chamada
 * @param {number} p.indice       qual deles escrever (base 0)
 */
export function buildAnuncioPrompt({
  ficha = {},
  analise = null,
  brief = null,
  relatorios = [],
  documentos = [],
  criativos = [],
  extraPrompt = "",
  plano = [],
  indice = 0,
  maxChars = 80000,
  conceito = "",
  conjunto: conjuntoDado = null,
} = {}) {
  const item = plano[indice] ?? {};
  const formato = getFormato(item.formato);
  const spec = descreverFormato(formato);
  const conjunto = conjuntoDado || descreverPlano(plano, indice);
  const partes = contextoDoPrompt({
    ficha,
    analise,
    brief,
    relatorios,
    documentos,
    criativos,
    fixo: [spec, conjunto, extraPrompt, conceito].join("\n").length,
    maxChars,
  });

  // Com Conceito Estratégico (desde 20/10/2026), o conceito aprovado é o que este anúncio executa.
  if (conceito) partes.push("", conceito);

  partes.push(
    "",
    "# O conjunto já decidido",
    `Esta composição tem ${plano.length} anúncios. Os outros estão sendo escritos em mensagens ` +
      "separadas; você os conhece só por esta lista:",
    conjunto,
    "",
    "# O que fazer",
    `Escreva SÓ o anúncio ${indice + 1} de ${plano.length}: ${formato?.label ?? item.formato}.` +
      (item.angulo ? ` O ângulo dele: ${item.angulo}` : ""),
    "O formato já está decidido — não troque. Escreva para ESTE uso: cada campo abaixo existe " +
      "por causa de como a peça é consumida ali. Não repita o gancho nem a frase de abertura que " +
      "o ângulo dos outros anúncios da lista sugere.",
    "",
    "# Spec do formato",
    spec
  );

  partes.push(...blocoInstrucao(extraPrompt));
  if (String(extraPrompt || "").trim()) {
    partes.push(
      "(A quantidade e os usos pedidos acima já foram atendidos pela lista. Aqui a instrução vale " +
        "pelo ângulo e pelo tema.)"
    );
  }

  partes.push(
    "",
    "# Formato da resposta",
    "Primeiro a prosa: em 1 ou 2 frases, o que este anúncio faz que os outros do conjunto não " +
      "fazem. Depois, e por último, UM bloco ```json sem texto depois dele, com os campos da " +
      "spec acima, todos eles:",
    "```json",
    esqueletoJsonAnuncio(),
    "```"
  );

  return partes.join("\n");
}

/**
 * Revisão de UM anúncio já escrito, a pedido de quem está revisando a composição.
 *
 * Leva o mesmo material da composição (o agente precisa dele para não revisar no vazio), o conjunto
 * (para a revisão não fazer este anúncio repetir outro), a versão ATUAL do anúncio — que pode ter
 * sido editada à mão — e o pedido. O formato não muda: é revisão, não um anúncio novo.
 *
 * @param {object} p              o mesmo material de `buildComposerPrompt`, mais:
 * @param {object[]} p.plano      o conjunto: { formato, angulo }
 * @param {number} p.indice
 * @param {object} p.atual        os campos atuais do anúncio, como estão na tela
 * @param {string} p.pedido       o que a pessoa quer que mude
 */
export function buildRevisaoPrompt({
  ficha = {},
  analise = null,
  brief = null,
  relatorios = [],
  documentos = [],
  criativos = [],
  plano = [],
  indice = 0,
  atual = {},
  pedido = "",
  maxChars = 80000,
  conceito = "",
  conjunto: conjuntoDado = null,
} = {}) {
  const item = plano[indice] ?? {};
  const formato = getFormato(item.formato);
  const spec = descreverFormato(formato);
  const conjunto = conjuntoDado || descreverPlano(plano, indice);
  const atualJson = JSON.stringify({ campos: atual ?? {} }, null, 2);
  const partes = contextoDoPrompt({
    ficha,
    analise,
    brief,
    relatorios,
    documentos,
    criativos,
    fixo: [spec, conjunto, atualJson, pedido, conceito].join("\n").length,
    maxChars,
  });

  // A revisão não sai do conceito aprovado: é ele que torna este anúncio diferente dos outros.
  if (conceito) partes.push("", conceito);

  partes.push(
    "",
    "# O conjunto",
    `Esta composição tem ${plano.length} anúncio(s):`,
    conjunto,
    "",
    `# A versão atual do anúncio ${indice + 1} (${formato?.label ?? item.formato})`,
    "Pode ter sido editada à mão por quem está revisando: o que está aqui é o que vale como ponto " +
      "de partida, mesmo que seja diferente do que você escreveu antes.",
    "```json",
    atualJson,
    "```",
    "",
    "# O que fazer",
    "REVISE este anúncio conforme o pedido abaixo. Mude o que o pedido pede e preserve o resto: " +
      "quem pediu já aprovou o que não mencionou. O formato não muda. As regras de sempre (limites " +
      "de caractere, regras do CFM) continuam valendo, mesmo que o pedido diga o contrário.",
    "",
    "# O pedido de revisão",
    String(pedido || "").trim() || "(sem pedido — melhore o que achar mais fraco e diga o quê)",
    "",
    "# Spec do formato",
    spec,
    "",
    "# Formato da resposta",
    "Primeiro a prosa: em 1 ou 2 frases, o que você mudou e por quê. Depois, e por último, UM bloco " +
      "```json sem texto depois dele, com TODOS os campos da spec — inclusive os que não mudaram:",
    "```json",
    esqueletoJsonAnuncio(),
    "```"
  );

  return partes.join("\n");
}

/** Um item de lista vira texto. Objeto ({tela, fala}) é achatado em vez de virar "[object Object]". */
function textoDeItem(item) {
  if (typeof item === "string") return item.trim();
  if (item && typeof item === "object" && !Array.isArray(item)) {
    return Object.values(item)
      .filter((v) => typeof v === "string" && v.trim())
      .map((v) => v.trim())
      .join(" — ");
  }
  return "";
}

/**
 * A resposta do agente: prosa + bloco estruturado, conferido contra a spec do formato QUE ELE
 * ESCOLHEU.
 *
 * Deixou de receber o formato por fora porque quem escolhe agora é o agente. Ele declara em
 * `formato`, e é por essa declaração que os limites são validados — validar contra outro formato
 * aprovaria um headline de 80 caracteres por ter medido contra o campo errado.
 *
 * Nada aqui é erro:
 *   - bloco ausente ou JSON malformado -> prosa inteira, sem campos separados;
 *   - `formato` ausente ou desconhecido -> prosa inteira + aviso dizendo isso.
 * Perder uma composição boa por causa de uma vírgula no JSON seria o pior negócio possível.
 *
 * `formatoFixo` é o formato que o PLANO já decidiu para este anúncio. Quando ele vem, o que o agente
 * declarar (ou deixar de declarar) na resposta não importa: os campos são lidos e conferidos contra
 * o formato do plano, que é o que a tela já está mostrando.
 *
 * @param {string} finalText
 * @param {{ formatoFixo?: string|null }} [opcoes]
 * @returns {{ composicaoMd: string, formato: string|null, justificativa: string|null,
 *             composicao: object|null, avisos: object[] }}
 */
export function parseComposerReply(finalText, { formatoFixo = null } = {}) {
  const composicaoMd = stripContractFence(finalText || "") || "";
  const bruto = extractContractJson(finalText);
  if (!bruto) {
    return {
      composicaoMd,
      formato: getFormato(formatoFixo)?.id ?? null,
      justificativa: null,
      composicao: null,
      avisos: [],
    };
  }

  const declarado =
    formatoFixo || (typeof bruto.formato === "string" ? bruto.formato.trim() : "");
  const formato = getFormato(declarado);
  const justificativa =
    typeof bruto.formato_justificativa === "string" ? bruto.formato_justificativa.trim() : null;

  if (!formato) {
    return {
      composicaoMd,
      formato: null,
      justificativa,
      composicao: null,
      avisos: [
        {
          campo: "formato",
          indice: null,
          tipo: "formato_desconhecido",
          detalhe: declarado
            ? `o agente declarou "${declarado}", que não está no catálogo`
            : "o agente não declarou o formato",
        },
      ],
    };
  }

  // Os campos vêm em `campos`. Aceita também na raiz, porque é onde o contrato ANTERIOR os punha e
  // o agente no servidor pode ainda não ter sido reaplicado — sem isso, a primeira composição
  // depois do deploy voltaria vazia sem explicar por quê.
  const fonte =
    bruto.campos && typeof bruto.campos === "object" && !Array.isArray(bruto.campos)
      ? bruto.campos
      : bruto;

  const composicao = {};
  for (const campo of formato.campos) {
    const valor = fonte[campo.id];
    if (campo.tipo === "lista") {
      composicao[campo.id] = (Array.isArray(valor) ? valor : []).map(textoDeItem).filter(Boolean);
      continue;
    }
    composicao[campo.id] = typeof valor === "string" ? valor.trim() : "";
  }

  // Campo que o formato não pede é descartado em silêncio: a tela só sabe desenhar a spec, e um
  // campo extra renderizado em lugar nenhum é pior do que um campo ausente.
  return {
    composicaoMd,
    formato: formato.id,
    justificativa,
    composicao,
    avisos: validarLimites(formato.id, composicao),
  };
}

function fraseOuNull(valor) {
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

/**
 * O conjunto que o agente decidiu na primeira chamada.
 *
 * Tolerante no formato, rígido no conteúdo: item sem formato do catálogo é descartado (não há spec
 * para escrevê-lo nem para desenhá-lo), e o que passar de `MAX_ANUNCIOS` é cortado — o teto é do
 * worker, não do agente. Os dois casos voltam contados, para o log dizer o que aconteceu.
 *
 * Lista vazia NÃO é erro: é a resposta de um agente ainda não reaplicado no servidor, que devolve o
 * contrato anterior (`formato` + `campos`, um anúncio só). Quem chama cai para esse caminho.
 *
 * @returns {{ plano: {formato: string, angulo: string|null, justificativa: string|null}[],
 *             descartados: number, cortados: number }}
 */
export function parsePlano(finalText) {
  const bruto = extractContractJson(finalText);
  const lista = Array.isArray(bruto?.anuncios) ? bruto.anuncios : [];
  const validos = [];
  for (const item of lista) {
    const formato = getFormato(typeof item?.formato === "string" ? item.formato.trim() : "");
    if (!formato?.disponivel) continue;
    validos.push({
      formato: formato.id,
      angulo: fraseOuNull(item.angulo),
      justificativa: fraseOuNull(item.formato_justificativa),
    });
  }
  return {
    plano: validos.slice(0, MAX_ANUNCIOS),
    descartados: lista.length - validos.length,
    cortados: Math.max(0, validos.length - MAX_ANUNCIOS),
  };
}
