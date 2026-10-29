/**
 * Conceitos Estratégicos do Composer (20/10/2026) — a lógica, sem I/O.
 *
 * Cada anúncio de uma composição nasce de um Conceito Estratégico:
 *
 *   Avatar + Nível de consciência + Ângulo + Formato
 *
 * O avatar vem do Estudo de Copy do cliente (lido pelo código, `shared/estudo-copy.js`); o ângulo,
 * o agente deriva do Estudo e dos outros documentos escolhidos, citando os trechos; o formato é uma
 * análise de criativo (a estrutura de persuasão dissecada de um anúncio). O formato de SAÍDA
 * (Reels, Stories…) não faz parte do conceito: é o uso do anúncio.
 *
 * ## Por que a unicidade é conferida aqui, e não pelo agente
 *
 * Meta Ads trata conceito idêntico como o MESMO anúncio, mesmo em peças diferentes — então ao menos
 * uma das quatro partes tem de mudar entre os anúncios de uma composição. Pedir isso ao modelo é
 * torcer; conferir é certeza. Por isso o agente nunca escreve um conceito em texto livre: ele aponta
 * para ids de um CATÁLOGO (A1 = avatar, G2 = ângulo, C3 = análise de criativo), e a chave do conceito
 * é a combinação desses ids. Chave repetida é recusada antes de chegar à tela.
 *
 * A única exceção é a RECICLAGEM, que só existe quando quem pediu escolheu "seguir assim mesmo"
 * diante de insumos insuficientes: aí a mesma chave pode voltar, desde que em outro formato de
 * saída — nunca duas vezes no mesmo.
 *
 * ## Por que os trechos são conferidos
 *
 * O ângulo é a parte que o agente cria. Para ele não inventar uma dor ou uma vantagem que o cliente
 * não tem, cada ângulo cita os trechos dos documentos que o sustentam, e o worker confere que os
 * trechos EXISTEM no texto. Ângulo sem trecho verificável é descartado.
 */

import { extractContractJson, stripContractFence } from "./agent-contract.js";
import { formatosDisponiveis, getFormato, MAX_ANUNCIOS } from "../../shared/ad-formats.js";
import { assinaturaDoEstudo, estudoPriorizado, lerEstudoDeCopy, nivelDoEstudo } from "../../shared/estudo-copy.js";
import { estruturaParaAgentes } from "../../shared/dissecacao-agentes.js";

export const NIVEIS = ["inconsciente", "consciente_problema", "consciente_solucao", "consciente_produto"];

export const NIVEL_LABEL = {
  inconsciente: "inconsciente do problema",
  consciente_problema: "consciente do problema",
  consciente_solucao: "consciente da solução",
  consciente_produto: "consciente do produto",
};

/**
 * O funil de cada nível e quanto o corpo falado pode durar nele (do prompt de copy que a equipe
 * usava antes do Composer): topo até 60s, meio até 40s, fundo até 25s.
 */
export const FUNIL = {
  inconsciente: { etapa: "topo", segundos: 60 },
  consciente_problema: { etapa: "topo", segundos: 60 },
  consciente_solucao: { etapa: "meio", segundos: 40 },
  consciente_produto: { etapa: "fundo", segundos: 25 },
};

/** Os estados de um conceito (um por anúncio). */
export const ESTADOS = ["pendente", "gerando", "sugerido", "aprovado", "erro"];

const MAX_ANGULOS = 30;
const MAX_TEXTO = 1500;
// Um trecho curto demais ("o paciente") casa em qualquer documento e não prova nada.
const MIN_PALAVRAS_TRECHO = 4;

const str = (v, max = MAX_TEXTO) => String(v ?? "").trim().slice(0, max);

/** minúsculas, sem acento, só letras e dígitos separados por um espaço. */
export function normalizarTexto(s) {
  return ` ${String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

/**
 * O trecho está no texto? Reticências separam pedaços (o agente corta citação longa assim): todo
 * pedaço com palavras suficientes tem de estar lá, e ao menos um pedaço tem de ter.
 */
export function trechoExiste(trecho, textoNormalizado) {
  const pedacos = String(trecho ?? "")
    .split(/\.\.\.|…|\[\.\.\.\]/)
    .map((p) => normalizarTexto(p))
    .filter((p) => p.trim().split(" ").length >= MIN_PALAVRAS_TRECHO);
  return pedacos.length > 0 && pedacos.every((p) => textoNormalizado.includes(p));
}

// ---------------------------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------------------------

/** O nome de uma análise de criativo para o agente e para a tela. */
function nomeDoCriativo(c) {
  return str(c.titulo || c.ad?.page_name || "Análise de criativo", 200);
}

/**
 * O catálogo de uma composição: o que foi lido do Estudo, os formatos (análises de criativo) e,
 * depois da primeira chamada, os ângulos.
 *
 * @param {object} p
 * @param {{ page_id: string, nome: string, conteudo_md: string }} p.estudo
 * @param {object[]} p.criativos  linhas de `ad_spy_criativos` já prontas
 */
export function catalogoInicial({ estudo, criativos = [] }) {
  const lido = lerEstudoDeCopy(estudo?.conteudo_md || "");
  return {
    estudo: { page_id: estudo?.page_id ?? null, nome: estudo?.nome ?? null },
    identificacao: lido.identificacao,
    assinatura: assinaturaDoEstudo(lido.identificacao),
    tem_rqe: Boolean(lido.identificacao.rqe),
    // O Estudo traz preço ou condição de pagamento? Desde 20/10/2026 preço pode entrar na copy
    // QUANDO o Estudo traz (a responsabilidade regulatória fica com quem aprova a peça).
    estudo_tem_preco: /R\$\s?\d|parcel|\b\d{1,2}\s?x\b/i.test(estudo?.conteudo_md || ""),
    avatares: lido.avatares,
    // "estudo" = lidos pelo código no modelo padrão; "agente" = o Estudo não segue o modelo e os
    // avatares foram achados pelo agente (`catalogoComLeitura`); null = nenhum, ainda.
    avatares_origem: lido.avatares.length ? "estudo" : null,
    faltando: lido.faltando,
    angulos: [],
    criativos: criativos.map((c, i) => ({
      id: `C${i + 1}`,
      criativo_id: c.id,
      nome: nomeDoCriativo(c),
      nivel: c.dissecacao?.nivel_consciencia || "",
    })),
  };
}

/**
 * Acrescenta ao catálogo os ângulos que o agente propôs, conferindo os trechos.
 *
 * O id que o agente deu pode colidir com um que já existe, ou vir torto: o worker dá o próximo `G`
 * livre e devolve o mapa (id do agente -> id final), para os conceitos da MESMA resposta apontarem
 * certo. Ângulo com o mesmo nome de um que já existe é o mesmo ângulo — vira referência a ele, em
 * vez de um segundo id para a mesma ideia, o que furaria a unicidade.
 *
 * @param {object} catalogo
 * @param {unknown[]} brutos
 * @param {string} textoFontes  o texto do Estudo e dos outros documentos escolhidos
 * @returns {{ catalogo: object, mapa: Map<string, string>, descartados: number }}
 */
export function incorporarAngulos(catalogo, brutos, textoFontes) {
  const fontes = normalizarTexto(textoFontes);
  const angulos = [...(catalogo.angulos || [])];
  const mapa = new Map(angulos.map((a) => [a.id, a.id]));
  const porNome = new Map(angulos.map((a) => [normalizarTexto(a.nome), a.id]));
  let proximo = angulos.reduce((m, a) => Math.max(m, Number(String(a.id).slice(1)) || 0), 0) + 1;
  let descartados = 0;

  for (const b of Array.isArray(brutos) ? brutos : []) {
    if (angulos.length >= MAX_ANGULOS) break;
    const nome = str(b?.nome, 200);
    const idAgente = str(b?.id, 20);
    const trechos = (Array.isArray(b?.trechos) ? b.trechos : [])
      .map((t) => str(t, 600))
      .filter((t) => t && trechoExiste(t, fontes));
    if (!nome || !trechos.length) {
      descartados += 1;
      continue;
    }
    const mesmo = porNome.get(normalizarTexto(nome));
    if (mesmo) {
      if (idAgente) mapa.set(idAgente, mesmo);
      continue;
    }
    const id = `G${proximo}`;
    proximo += 1;
    angulos.push({ id, nome, descricao: str(b?.descricao), trechos: trechos.slice(0, 4) });
    porNome.set(normalizarTexto(nome), id);
    if (idAgente) mapa.set(idAgente, id);
  }
  return { catalogo: { ...catalogo, angulos }, mapa, descartados };
}

// ---------------------------------------------------------------------------------------------
// Conceito, chave e validação
// ---------------------------------------------------------------------------------------------

/** Um conceito como o agente o mandou -> só os campos conhecidos, com o id de ângulo já mapeado. */
export function normalizarConceito(bruto, mapaAngulos = new Map()) {
  const angulo = str(bruto?.angulo, 20);
  return {
    avatar_id: str(bruto?.avatar, 20).toUpperCase(),
    nivel: str(bruto?.nivel, 40).toLowerCase(),
    angulo_id: mapaAngulos.get(angulo) || angulo.toUpperCase(),
    criativo_ref: str(bruto?.criativo, 20).toUpperCase(),
    justificativa: str(bruto?.justificativa),
  };
}

/** A identidade do conceito para a Meta: as quatro partes. O formato de saída NÃO entra. */
export const chaveDoConceito = (c) => [c.avatar_id, c.nivel, c.angulo_id, c.criativo_ref].join("|");

/**
 * O conceito pode ocupar este anúncio? Devolve o motivo da recusa, ou null.
 *
 * @param {object} c                  conceito normalizado
 * @param {object} ctx
 * @param {object} ctx.catalogo
 * @param {{ n: number, chave: string, formato_saida: string }[]} ctx.ocupados  os OUTROS anúncios
 * @param {Set<string>} ctx.rejeitadas  chaves já rejeitadas em qualquer anúncio da composição
 * @param {string} ctx.formatoSaida     o formato de saída deste anúncio
 * @param {boolean} ctx.reciclar        quem pediu escolheu "seguir assim mesmo"
 * @returns {{ motivo: string|null, reciclado: boolean }}
 */
export function validarConceito(c, { catalogo, ocupados = [], rejeitadas = new Set(), formatoSaida, reciclar = false }) {
  const nao = (motivo) => ({ motivo, reciclado: false });
  if (!catalogo.avatares.some((a) => a.id === c.avatar_id)) return nao(`avatar "${c.avatar_id}" não existe no Estudo`);
  if (!NIVEIS.includes(c.nivel)) return nao(`nível "${c.nivel}" não é um dos quatro`);
  if (!catalogo.angulos.some((a) => a.id === c.angulo_id)) return nao(`ângulo "${c.angulo_id}" não existe no catálogo`);
  if (!catalogo.criativos.some((x) => x.id === c.criativo_ref)) {
    return nao(`formato "${c.criativo_ref}" não é uma das análises de criativo escolhidas`);
  }
  const chave = chaveDoConceito(c);
  if (rejeitadas.has(chave)) return nao("repete um conceito que já foi rejeitado");
  const iguais = ocupados.filter((o) => o.chave === chave);
  if (!iguais.length) return { motivo: null, reciclado: false };
  if (!reciclar) return nao(`repete o conceito do anúncio ${iguais[0].n + 1}`);
  const mesmoUso = iguais.find((o) => o.formato_saida === formatoSaida);
  if (mesmoUso) return nao(`repete o conceito do anúncio ${mesmoUso.n + 1} no mesmo formato de saída`);
  return { motivo: null, reciclado: true };
}

/** Os outros anúncios que têm conceito (sugerido ou aprovado), para a conferência de unicidade. */
export function ocupadosExceto(slots, n) {
  return (Array.isArray(slots) ? slots : [])
    .filter((s) => s.n !== n && s.conceito && (s.status === "sugerido" || s.status === "aprovado"))
    .map((s) => ({ n: s.n, chave: chaveDoConceito(s.conceito), formato_saida: s.formato_saida }));
}

/** Todas as chaves rejeitadas na composição. Rejeitado num anúncio não volta em outro. */
export function chavesRejeitadas(slots) {
  return new Set(
    (Array.isArray(slots) ? slots : []).flatMap((s) => (s.rejeitados || []).map((r) => chaveDoConceito(r)))
  );
}

/** A composição pode ser escrita: todos os anúncios têm conceito aprovado. */
export const todosAprovados = (slots) =>
  Array.isArray(slots) && slots.length > 0 && slots.every((s) => s.status === "aprovado" && s.conceito);

// ---------------------------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------------------------

const corta = (texto, max) => {
  const s = String(texto ?? "").trim();
  return !max || s.length <= max ? s : `${s.slice(0, max)}… (cortado)`;
};

/** A estrutura de uma análise de criativo para o agente: a receita da v2, ou os campos da v1. */
export function estruturaDoCriativo(c) {
  const d = c?.dissecacao;
  const receita = estruturaParaAgentes(d);
  if (receita) return receita;
  if (d) {
    return [
      d.formato && `Formato: ${d.formato}`,
      d.estrutura && `Estrutura: ${d.estrutura}`,
      d.anatomia_psicologica && `Anatomia psicológica: ${d.anatomia_psicologica}`,
      d.nivel_consciencia && `Nível de consciência: ${NIVEL_LABEL[d.nivel_consciencia] || d.nivel_consciencia}`,
    ]
      .filter(Boolean)
      .join("\n");
  }
  return corta(c?.dissecacao_md, 3000);
}

function blocoAvatares(catalogo) {
  return catalogo.avatares
    .map((a) =>
      [
        `## ${a.id} — ${a.nome}`,
        a.nivel_inferido
          ? `Nível: ${a.nivel ? NIVEL_LABEL[a.nivel] : "(não informado)"} (inferido na leitura: o Estudo não o diz)`
          : `Nível no Estudo: ${a.nivel ? NIVEL_LABEL[a.nivel] : "(não informado)"}${
              a.nivel_original ? ` (o Estudo diz: "${a.nivel_original}")` : ""
            }`,
        // O resumo vai junto porque o Estudo pode não caber inteiro no prompt (ver estudoPriorizado).
        a.perfil ? `Perfil: ${corta(a.perfil, 600)}` : null,
        a.dor ? `Dor: ${corta(a.dor, 600)}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n");
}

function blocoFormatos(catalogo, criativosPorId) {
  return catalogo.criativos
    .map((x) => {
      const c = criativosPorId.get(x.criativo_id);
      return [
        `## ${x.id} — ${x.nome}`,
        x.nivel ? `Nível de consciência da peça original: ${NIVEL_LABEL[x.nivel]}` : null,
        estruturaDoCriativo(c),
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

function blocoAngulos(catalogo) {
  if (!catalogo.angulos.length) return "(nenhum ainda)";
  return catalogo.angulos
    .map((g) => `- ${g.id} — ${g.nome}${g.descricao ? `: ${g.descricao}` : ""}`)
    .join("\n");
}

function blocoFormatosDeSaida() {
  return formatosDisponiveis()
    .map((f) => `- \`${f.id}\` — ${f.label}: ${f.resumo}`)
    .join("\n");
}

/** O Estudo e os outros documentos escolhidos, com orçamento. O Estudo vai inteiro até o teto. */
function blocoFontes({ estudo, documentos = [], maxEstudo = 60000, maxOutros = 20000 }) {
  // Pelas partes mais úteis primeiro: o Estudo dividido em subpáginas passa de 100 mil caracteres.
  const partes = [`# Estudo de Copy: ${estudo.nome || "(sem nome)"}`, estudoPriorizado(estudo.conteudo_md, maxEstudo)];
  const outros = documentos.filter((d) => d?.conteudo_md);
  if (outros.length) {
    const porItem = Math.max(1500, Math.floor(maxOutros / outros.length));
    partes.push("", "# Outros documentos escolhidos");
    for (const d of outros) partes.push("", `## ${d.nome}`, corta(d.conteudo_md, porItem));
  }
  return partes.join("\n");
}

const REGRAS_DE_CONCEITO = [
  "Regras do conceito:",
  "- Avatar: um dos avatares acima, pelo id (A1, A2…). Não invente avatar.",
  "- Nível: o do avatar no Estudo por padrão. Pode usar outro nível para o mesmo avatar se a " +
    "justificativa disser por quê.",
  "- Ângulo: um ângulo do catálogo, pelo id. Um ângulo é UMA dor, objeção ou desejo do avatar " +
    "cruzado com a vantagem do cliente que responde a ela. Cada ângulo novo cita, em `trechos`, de 1 a " +
    "3 trechos LITERAIS dos documentos acima que o sustentam (copie as palavras exatas; corte com " +
    "reticências se for longo). Ângulo sem trecho literal é descartado.",
  "- Formato: uma das análises de criativo acima, pelo id (C1, C2…). Prefira a de nível de " +
    "consciência igual ao do conceito.",
  "- Dois anúncios NUNCA têm o mesmo conceito: a Meta trata conceito idêntico como o mesmo anúncio. " +
    "Entre dois conceitos, ao menos uma das quatro partes (avatar, nível, ângulo, formato) muda.",
];

/**
 * A primeira chamada: decide quantos anúncios e para que uso (do pedido), deriva os ângulos e
 * sugere um conceito por anúncio — ou diz que o material não basta.
 */
export function buildConceitosPrompt({ ficha = {}, estudo, documentos = [], criativos = [], catalogo, extraPrompt = "" }) {
  const criativosPorId = new Map(criativos.map((c) => [c.id, c]));
  const partes = [
    "## Modo: conceitos estratégicos",
    "",
    "# Cliente",
    `Nome: ${ficha.nome || "(sem nome)"}`,
    `Especialidade(s): ${(ficha.especialidades || []).join(", ") || "(não cadastrada)"}`,
    "",
    blocoFontes({ estudo, documentos }),
    "",
    "# Avatares (lidos do Estudo de Copy)",
    blocoAvatares(catalogo),
    "",
    "# Formatos: as análises de criativo escolhidas",
    "Cada uma é a estrutura de persuasão de um anúncio dissecado. É o FORMATO do conceito.",
    "",
    blocoFormatos(catalogo, criativosPorId),
    "",
    "# Formatos de saída (o uso de cada anúncio)",
    blocoFormatosDeSaida(),
  ];
  if (String(extraPrompt || "").trim()) {
    partes.push(
      "",
      "# Pedido de quem compõe",
      "Ele manda sobre a quantidade de anúncios, o uso de cada um e o foco. Não muda as regras.",
      String(extraPrompt).trim()
    );
  }
  partes.push(
    "",
    "# O que fazer",
    `1. Decida quantos anúncios (de 1 a ${MAX_ANUNCIOS}) e o formato de saída de cada um, pelo pedido. ` +
      "Sem pedido de quantidade, é UM, no formato de saída que o material sustenta.",
    "2. Derive os ângulos do Estudo de Copy e dos outros documentos.",
    "3. Sugira UM conceito por anúncio, todos diferentes entre si.",
    "4. Se o material não der conceitos diferentes para TODOS os anúncios, diga isso: `suficiente` " +
      "false, `falta` explicando o que falta e `sugestao` dizendo que insumo escolher (um documento, " +
      "outra análise de criativo). Entregue mesmo assim os conceitos diferentes que conseguir — " +
      "nunca repita um para completar.",
    "",
    ...REGRAS_DE_CONCEITO,
    "",
    "# Formato da resposta",
    "Primeiro, em 2 ou 3 frases, a ideia do conjunto. Depois, e por último, UM bloco ```json sem texto " +
      "depois dele. `anuncio` é a posição do anúncio na lista `anuncios` (1, 2…):",
    "```json",
    JSON.stringify(
      {
        anuncios: [{ formato: "<id do formato de saída>" }],
        angulos: [{ id: "G1", nome: "", descricao: "", trechos: ["<trecho literal>"] }],
        conceitos: [{ anuncio: 1, avatar: "A1", nivel: "consciente_solucao", angulo: "G1", criativo: "C1", justificativa: "" }],
        suficiente: true,
        falta: "",
        sugestao: "",
      },
      null,
      2
    ),
    "```"
  );
  return partes.join("\n");
}

/** Um conceito em uma linha legível, com os nomes do catálogo. */
export function descreverConceito(c, catalogo) {
  const avatar = catalogo.avatares.find((a) => a.id === c.avatar_id);
  const angulo = catalogo.angulos.find((a) => a.id === c.angulo_id);
  const formato = catalogo.criativos.find((x) => x.id === c.criativo_ref);
  return (
    `${c.avatar_id} (${avatar?.nome ?? "?"}) · ${NIVEL_LABEL[c.nivel] ?? c.nivel} · ` +
    `${c.angulo_id} (${angulo?.nome ?? "?"}) · ${c.criativo_ref} (${formato?.nome ?? "?"})`
  );
}

/**
 * Um conceito novo para UM anúncio: depois de uma rejeição, de uma sugestão recusada pela
 * conferência, ou para completar o conjunto quando quem pediu escolheu seguir com reciclagem.
 */
export function buildNovoConceitoPrompt({
  ficha = {},
  estudo,
  documentos = [],
  criativos = [],
  catalogo,
  slots,
  n,
  reciclar = false,
  extraPrompt = "",
}) {
  const criativosPorId = new Map(criativos.map((c) => [c.id, c]));
  const slot = slots.find((s) => s.n === n);
  const formato = getFormato(slot?.formato_saida);
  const outros = slots
    .filter((s) => s.n !== n && s.conceito && (s.status === "sugerido" || s.status === "aprovado"))
    .map(
      (s) =>
        `- Anúncio ${s.n + 1} (${getFormato(s.formato_saida)?.label ?? s.formato_saida}, ${s.status}): ` +
        descreverConceito(s.conceito, catalogo)
    );
  const rejeitados = slots.flatMap((s) =>
    (s.rejeitados || []).map(
      (r) => `- ${descreverConceito(r, catalogo)}${r.motivo ? ` — motivo: ${r.motivo}` : " — sem motivo informado"}`
    )
  );

  const partes = [
    "## Modo: novo conceito",
    "",
    "# Cliente",
    `Nome: ${ficha.nome || "(sem nome)"}`,
    "",
    blocoFontes({ estudo, documentos }),
    "",
    "# Avatares (lidos do Estudo de Copy)",
    blocoAvatares(catalogo),
    "",
    "# Ângulos já no catálogo",
    blocoAngulos(catalogo),
    "",
    "# Formatos: as análises de criativo escolhidas",
    blocoFormatos(catalogo, criativosPorId),
    "",
    "# Os outros anúncios da composição",
    outros.length ? outros.join("\n") : "(nenhum outro com conceito)",
    "",
    "# Conceitos rejeitados por quem compõe (não volte a eles)",
    rejeitados.length ? rejeitados.join("\n") : "(nenhum)",
  ];
  if (String(extraPrompt || "").trim()) {
    partes.push("", "# Pedido de quem compõe", String(extraPrompt).trim());
  }
  partes.push(
    "",
    "# O que fazer",
    `Sugira UM conceito para o anúncio ${n + 1} (${formato?.label ?? slot?.formato_saida}), diferente ` +
      "de todos os outros anúncios e de todos os rejeitados. Leia os motivos das rejeições: eles " +
      "dizem o que quem compõe NÃO quer.",
    reciclar
      ? "Quem compõe escolheu seguir mesmo com insumos insuficientes: se não houver conceito novo, " +
          "você PODE repetir o conceito de outro anúncio, desde que ele tenha OUTRO formato de saída. " +
          "Prefira sempre um conceito novo."
      : "Se não houver como montar um conceito diferente com este material, não force: deixe " +
          "`conceito` null e explique em `impossivel` o que falta.",
    "Pode criar ângulos novos, em `angulos_novos`, com os trechos literais que os sustentam.",
    "",
    ...REGRAS_DE_CONCEITO,
    "",
    "# Formato da resposta",
    "Uma frase dizendo por que este conceito, e por último UM bloco ```json sem texto depois dele:",
    "```json",
    JSON.stringify(
      {
        angulos_novos: [{ id: "G9", nome: "", descricao: "", trechos: ["<trecho literal>"] }],
        conceito: { avatar: "A1", nivel: "consciente_solucao", angulo: "G1", criativo: "C1", justificativa: "" },
        impossivel: "",
      },
      null,
      2
    ),
    "```"
  );
  return partes.join("\n");
}

// ---------------------------------------------------------------------------------------------
// Estudo fora do modelo padrão: a leitura pelo agente
// ---------------------------------------------------------------------------------------------

/** Quanto do Estudo vai à leitura, pelas partes mais úteis primeiro. */
const MAX_ESTUDO_LEITURA = 120000;

/**
 * Os clientes mais antigos não têm o Estudo no modelo padrão: os elementos estão espalhados em
 * subpáginas ("Buyer Personas", "Briefing de Copy"…), e o leitor do código não acha os avatares.
 * Aqui o agente os procura — e o worker confere o que ele trouxer (`catalogoComLeitura`).
 */
export function buildLeituraEstudoPrompt({ ficha = {}, estudo }) {
  return [
    "## Modo: leitura do Estudo de Copy",
    "",
    "# Cliente",
    `Nome: ${ficha.nome || "(sem nome)"}`,
    "",
    `# Estudo de Copy: ${estudo.nome || "(sem nome)"}`,
    "Este Estudo NÃO segue o modelo padrão (não tem a seção \"Avatares Base\"): os elementos estão " +
      "espalhados, em geral em subpáginas como \"Buyer Personas\" e \"Briefing\".",
    "",
    estudoPriorizado(estudo.conteudo_md, MAX_ESTUDO_LEITURA),
    "",
    "# O que fazer",
    "Encontre os AVATARES — as personas ou públicos que o Estudo descreve — e a identificação do " +
      "médico. Só o que o texto diz: não invente avatar, nível, CRM nem RQE.",
    "- Um avatar por persona/público descrito. `nome`: o rótulo que o Estudo dá a ele.",
    "- `nivel_original`: as palavras EXATAS do Estudo sobre o nível de consciência dele (ex.: " +
      "\"Consciente do Problema (CP)\"), ou \"\" quando o Estudo não diz. `nivel`: um dos quatro — " +
      "\"Consciente do Mecanismo\" conta como consciente_solucao; sem nível no Estudo, escolha pelo " +
      "perfil e explique em `nivel_justificativa`.",
    "- `perfil`: de 2 a 4 frases — quem é e em que momento está. `dor`: a dor raiz e as objeções, " +
      "nas palavras do Estudo quando possível.",
    "- `trechos`: de 1 a 3 trechos LITERAIS do Estudo que descrevem esse avatar (copie as palavras " +
      "exatas). O worker confere; avatar sem trecho que exista no texto é descartado.",
    "- `identificacao`: nome do médico, CRM e RQE exatamente como aparecem; \"\" no que o Estudo não traz.",
    "",
    "# Formato da resposta",
    "Uma frase e, por último, UM bloco ```json sem texto depois dele:",
    "```json",
    JSON.stringify(
      {
        identificacao: { nome: "", crm: "", rqe: "" },
        avatares: [
          {
            nome: "",
            nivel: "consciente_problema",
            nivel_original: "",
            nivel_justificativa: "",
            perfil: "",
            dor: "",
            trechos: ["<trecho literal>"],
          },
        ],
      },
      null,
      2
    ),
    "```",
  ].join("\n");
}

export function parseLeituraEstudoReply(finalText) {
  const bruto = extractContractJson(finalText);
  if (!bruto) return { identificacao: {}, avatares: [], semJson: true };
  return {
    identificacao: bruto.identificacao && typeof bruto.identificacao === "object" ? bruto.identificacao : {},
    avatares: (Array.isArray(bruto.avatares) ? bruto.avatares : []).filter((a) => a && typeof a === "object"),
    semJson: false,
  };
}

const MAX_AVATARES = 8;

/**
 * O catálogo com o que o agente leu do Estudo, conferido contra o texto:
 *   - avatar sem trecho que exista no Estudo é descartado;
 *   - o nível vem das palavras do Estudo (`nivel_original`) quando elas existem no texto; senão é o
 *     que o agente escolheu, marcado `nivel_inferido`;
 *   - nome do médico, CRM e RQE só entram se aparecem literalmente — um CRM inventado iria para a
 *     assinatura do vídeo. O que o código já tinha lido do modelo padrão prevalece.
 *
 * @returns {{ catalogo: object, descartados: number }}
 */
export function catalogoComLeitura(catalogo, leitura, textoEstudo) {
  const fontes = normalizarTexto(textoEstudo);
  const existe = (v) => {
    const n = normalizarTexto(v);
    return n.trim() ? fontes.includes(n) : false;
  };
  const avatares = [];
  let descartados = 0;
  for (const a of (leitura?.avatares || []).slice(0, MAX_AVATARES)) {
    const nome = str(a?.nome, 200);
    const trechos = (Array.isArray(a?.trechos) ? a.trechos : [])
      .map((t) => str(t, 600))
      .filter((t) => t && trechoExiste(t, fontes));
    if (!nome || !trechos.length) {
      descartados += 1;
      continue;
    }
    const original = str(a?.nivel_original, 160);
    const doTexto = original && existe(original) ? nivelDoEstudo(original) : "";
    const escolhido = NIVEIS.includes(str(a?.nivel, 40)) ? str(a?.nivel, 40) : "";
    const n = avatares.length + 1;
    avatares.push({
      id: `A${n}`,
      n,
      nome,
      nivel: doTexto || escolhido,
      nivel_original: doTexto ? original : "",
      nivel_inferido: !doTexto,
      perfil: str(a?.perfil),
      dor: str(a?.dor),
      trechos: trechos.slice(0, 3),
    });
  }
  const lida = leitura?.identificacao || {};
  const atual = catalogo.identificacao || {};
  const campo = (k) => atual[k] || (existe(lida[k]) ? str(lida[k], 120) : null);
  const identificacao = { ...atual, nome: campo("nome"), crm: campo("crm"), rqe: campo("rqe") };
  return {
    catalogo: {
      ...catalogo,
      identificacao,
      assinatura: assinaturaDoEstudo(identificacao),
      tem_rqe: Boolean(identificacao.rqe),
      avatares,
      avatares_origem: avatares.length ? "agente" : catalogo.avatares_origem,
      faltando: avatares.length ? [] : catalogo.faltando,
    },
    descartados,
  };
}

// ---------------------------------------------------------------------------------------------
// Respostas
// ---------------------------------------------------------------------------------------------

/**
 * A resposta da primeira chamada.
 *
 * @returns {{ prosa: string, formatos: string[], angulosBrutos: unknown[], conceitosBrutos: object[],
 *             suficiente: boolean, falta: string, sugestao: string, semJson: boolean }}
 */
export function parseConceitosReply(finalText) {
  const bruto = extractContractJson(finalText);
  const prosa = stripContractFence(finalText || "").trim();
  if (!bruto) {
    return { prosa, formatos: [], angulosBrutos: [], conceitosBrutos: [], suficiente: false, falta: "", sugestao: "", semJson: true };
  }
  const formatos = (Array.isArray(bruto.anuncios) ? bruto.anuncios : [])
    .map((a) => getFormato(str(a?.formato, 40)))
    .filter((f) => f?.disponivel)
    .map((f) => f.id)
    .slice(0, MAX_ANUNCIOS);
  return {
    prosa,
    formatos,
    angulosBrutos: Array.isArray(bruto.angulos) ? bruto.angulos : [],
    conceitosBrutos: (Array.isArray(bruto.conceitos) ? bruto.conceitos : []).filter((c) => c && typeof c === "object"),
    suficiente: bruto.suficiente !== false,
    falta: str(bruto.falta),
    sugestao: str(bruto.sugestao),
    semJson: false,
  };
}

/** A resposta de um conceito novo. */
export function parseNovoConceitoReply(finalText) {
  const bruto = extractContractJson(finalText);
  if (!bruto) return { angulosBrutos: [], conceitoBruto: null, impossivel: "", semJson: true };
  return {
    angulosBrutos: Array.isArray(bruto.angulos_novos) ? bruto.angulos_novos : [],
    conceitoBruto: bruto.conceito && typeof bruto.conceito === "object" ? bruto.conceito : null,
    impossivel: str(bruto.impossivel),
    semJson: false,
  };
}

/**
 * Distribui os conceitos da primeira resposta pelos anúncios, conferindo cada um contra os que já
 * entraram. Anúncio sem conceito válido fica `pendente`, com o motivo — quem chama decide se pede
 * outro ao agente (material suficiente) ou espera a decisão de quem compõe (insuficiente).
 *
 * @returns {object[]} os slots
 */
export function distribuirConceitos({ formatos, conceitosBrutos, mapa, catalogo }) {
  const slots = formatos.map((formato_saida, n) => ({
    n,
    formato_saida,
    status: "pendente",
    conceito: null,
    reciclado: false,
    rejeitados: [],
    error: null,
  }));
  for (const bruto of conceitosBrutos) {
    const n = Number(bruto.anuncio) - 1;
    const slot = slots[n];
    if (!slot || slot.conceito) continue;
    const c = normalizarConceito(bruto, mapa);
    const { motivo } = validarConceito(c, {
      catalogo,
      ocupados: ocupadosExceto(slots, n),
      formatoSaida: slot.formato_saida,
    });
    if (motivo) {
      slot.error = `A sugestão do agente foi recusada: ${motivo}.`;
      continue;
    }
    Object.assign(slot, { status: "sugerido", conceito: c, error: null });
  }
  return slots;
}

// ---------------------------------------------------------------------------------------------
// O conceito na escrita do anúncio
// ---------------------------------------------------------------------------------------------

/**
 * O bloco do prompt de escrita que diz ao agente QUAL conceito este anúncio executa, com tudo que o
 * catálogo sabe dele.
 */
export function blocoDoConceito({ slot, slots, catalogo, criativo }) {
  const c = slot.conceito;
  const avatar = catalogo.avatares.find((a) => a.id === c.avatar_id);
  const angulo = catalogo.angulos.find((a) => a.id === c.angulo_id);
  const formato = catalogo.criativos.find((x) => x.id === c.criativo_ref);
  const saida = getFormato(slot.formato_saida);
  const funil = FUNIL[c.nivel];
  const video = saida?.midia === "video";
  const linhas = [
    "# O Conceito Estratégico deste anúncio",
    "Este anúncio EXECUTA este conceito. Não troque o avatar, o nível, o ângulo nem a estrutura.",
    "",
    `## Avatar: ${avatar?.nome ?? c.avatar_id}`,
    avatar?.perfil ? `Perfil: ${avatar.perfil}` : null,
    avatar?.dor ? `Como a dor se manifesta: ${avatar.dor}` : null,
    "",
    `## Nível de consciência: ${NIVEL_LABEL[c.nivel]} (funil de ${funil?.etapa})`,
    avatar?.nivel && avatar.nivel !== c.nivel
      ? `O Estudo põe este avatar em "${NIVEL_LABEL[avatar.nivel]}"; este conceito fala com ele em ` +
        `"${NIVEL_LABEL[c.nivel]}" — veja a justificativa.`
      : null,
    video && funil
      ? `O corpo falado tem no máximo ${funil.segundos} segundos (funil de ${funil.etapa}).`
      : null,
    "",
    `## Ângulo: ${angulo?.nome ?? c.angulo_id}`,
    angulo?.descricao || null,
    ...(angulo?.trechos || []).map((t) => `> ${t}`),
    "",
    `## Formato (a estrutura de persuasão a seguir): ${formato?.nome ?? c.criativo_ref}`,
    "Siga a ordem dos blocos e movimentos com o produto e o público DESTE cliente, sem as palavras " +
      "da peça original.",
    estruturaDoCriativo(criativo),
    "",
    c.justificativa ? `## Por que este conceito\n${c.justificativa}` : null,
  ];
  if (slot.reciclado) {
    const irmaos = slots
      .filter((s) => s.n !== slot.n && s.conceito && chaveDoConceito(s.conceito) === chaveDoConceito(c))
      .map((s) => `${s.n + 1} (${getFormato(s.formato_saida)?.label ?? s.formato_saida})`);
    linhas.push(
      "",
      `Este conceito também é o do(s) anúncio(s) ${irmaos.join(", ")}, em outro formato de saída. ` +
        "Escreva para ESTE uso, com outro gancho e outras frases."
    );
  }
  if (video) {
    linhas.push(
      "",
      "## Assinatura final",
      `Feche o roteiro e o texto na tela com a assinatura exatamente assim: ${catalogo.assinatura}`
    );
  }
  if (!catalogo.tem_rqe) {
    linhas.push(
      "",
      "O médico NÃO tem RQE: nunca o chame de especialista nem diga que ele é especialista em nada " +
        "(regra do CFM). Use a formação como o Estudo descreve."
    );
  }
  linhas.push(
    "",
    catalogo.estudo_tem_preco
      ? "Preço e condição de pagamento podem entrar, exatamente como o Estudo de Copy traz — nunca " +
          "invente valor, desconto ou promoção."
      : "Sem preço, valor ou condição de pagamento: o Estudo de Copy não traz."
  );
  return linhas.filter((l) => l !== null).join("\n");
}

/** O conjunto, para cada anúncio saber o que os outros dizem. */
export function descreverConjuntoDeConceitos(slots, catalogo, indice) {
  return slots
    .map((s) => {
      const linha = `${s.n + 1}. ${getFormato(s.formato_saida)?.label ?? s.formato_saida} — ${descreverConceito(s.conceito, catalogo)}`;
      return s.n === indice ? `${linha}  <- ESTE` : linha;
    })
    .join("\n");
}

/** O ângulo de um anúncio para a listagem (`plano`): o nome do ângulo e o avatar. */
export function anguloParaLista(slot, catalogo) {
  const c = slot.conceito;
  const angulo = catalogo.angulos.find((a) => a.id === c?.angulo_id);
  const avatar = catalogo.avatares.find((a) => a.id === c?.avatar_id);
  return [angulo?.nome, avatar?.nome].filter(Boolean).join(" — ") || null;
}

// ---------------------------------------------------------------------------------------------
// Avisos do anúncio escrito
// ---------------------------------------------------------------------------------------------

// O campo FALADO de cada formato de vídeo, o que se mede em segundos. Stories mistura o que se vê
// com o que se fala na mesma linha, e medir isso em segundos seria inventar precisão.
const CAMPO_FALADO = { instagram_reels: "roteiro" };
const PALAVRAS_POR_SEGUNDO = 2.5;

/** Todo o texto de um anúncio, para as conferências que olham a peça inteira. */
function textoDoAnuncio(composicao) {
  return Object.values(composicao || {})
    .flatMap((v) => (Array.isArray(v) ? v : [v]))
    .filter((v) => typeof v === "string")
    .join("\n");
}

/**
 * Os avisos que o conceito acrescenta aos de limite de caractere: duração estimada acima do funil,
 * preço citado, "especialista" sem RQE e assinatura ausente no vídeo. Como os de limite, não
 * corrigem nada — dizem o que conferir antes de publicar.
 */
export function avisosDoConceito({ formatoSaida, composicao, conceito, catalogo }) {
  const avisos = [];
  const formato = getFormato(formatoSaida);
  const texto = textoDoAnuncio(composicao);
  const falado = CAMPO_FALADO[formatoSaida];
  const funil = FUNIL[conceito?.nivel];
  if (falado && funil && typeof composicao?.[falado] === "string") {
    const palavras = composicao[falado].trim().split(/\s+/).filter(Boolean).length;
    const segundos = Math.round(palavras / PALAVRAS_POR_SEGUNDO);
    if (segundos > funil.segundos) {
      avisos.push({
        campo: falado,
        indice: null,
        tipo: "duracao_acima_do_funil",
        detalhe: `~${segundos}s estimados; o funil de ${funil.etapa} pede até ${funil.segundos}s`,
      });
    }
  }
  if (/R\$\s?\d|parcel|\b\d{1,2}\s?x\s+(sem|de)\b/i.test(texto)) {
    avisos.push({
      campo: null,
      indice: null,
      tipo: "cita_preco",
      detalhe: "cita preço ou condição de pagamento — confira as normas do CFM antes de publicar",
    });
  }
  if (!catalogo?.tem_rqe && /\bespecialista\b/i.test(texto)) {
    avisos.push({
      campo: null,
      indice: null,
      tipo: "especialista_sem_rqe",
      detalhe: "chama de especialista, mas o médico não tem RQE",
    });
  }
  if (formato?.midia === "video" && catalogo?.identificacao) {
    const crm = catalogo.identificacao.crm;
    if (!crm || !normalizarTexto(texto).includes(normalizarTexto(crm))) {
      avisos.push({
        campo: null,
        indice: null,
        tipo: crm ? "sem_assinatura" : "assinatura_incompleta",
        detalhe: crm
          ? `a assinatura (${catalogo.assinatura}) não aparece no vídeo`
          : "o Estudo de Copy não traz o CRM: a assinatura ficou para preencher",
      });
    }
  }
  return avisos;
}
