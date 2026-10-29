/**
 * Estudo de Copy — o documento do cliente de onde saem os Conceitos Estratégicos do Composer.
 * DADO COMPARTILHADO entre o frontend e o worker.
 *
 * Em `shared/` pelo mesmo motivo de `clickup-doc-tipos.js`: a tela destaca o Estudo de Copy na
 * coluna de documentos e exige um para compor, e o worker confere de novo e o lê — os dois pela
 * MESMA regra de nome. "Documento que a tela trata como Estudo e o worker não" não existe.
 *
 * ## Por que pelo NOME, e não pelo `tipo`
 *
 * O `tipo` de um documento é gravado no sync (`marketing_client_doc_pages.tipo`): um tipo novo só
 * valeria para as páginas depois do próximo sync que as tocasse. O nome vale na hora, para todas.
 *
 * ## O que o código lê, e o que fica para o agente (decisão de 20/10/2026)
 *
 * O Estudo de Copy segue um MODELO PADRÃO de seções. O que tem lugar fixo no modelo é lido aqui,
 * sem modelo de linguagem: a identificação do médico (nome, CRM, RQE) e os avatares (nome, nível
 * de consciência, perfil e a manifestação da dor de cada um). É isso que dá aos avatares um id
 * estável — e a unicidade dos conceitos é conferida por esses ids, não por texto livre — e é o que
 * torna a assinatura confiável: CRM lido do documento, não transcrito por um modelo.
 *
 * Os ÂNGULOS não têm seção no modelo: o agente os deriva cruzando a dor de um avatar com a
 * vantagem do cliente que responde a ela, e o worker confere que os trechos citados existem aqui.
 *
 * O documento chega como Markdown do ClickUp, mas a leitura não depende disso: cabeçalhos (`##`),
 * negrito (`**`), itens de lista e numeração são removidos antes de comparar as linhas, para o
 * mesmo Estudo ser lido igual colado como texto ou como Markdown.
 */

/** minúsculas, sem acento, espaços colapsados — a mesma régua de `normalizarNomeDoc`. */
const normaliza = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * "Estudo de Copy – Tricologia e Transplante Capilar - Dr. Otavio Brandt" e variações — inclusive
 * com numeração na frente ("1. Estudo de Copy – …", "01 - Estudo de Copy"), que é como as
 * subpáginas aparecem no ClickUp.
 */
export function ehEstudoDeCopy(nome) {
  const n = normaliza(nome).replace(/^\d+\s*[.)\-–—:]?\s*/, "");
  return /^estudo\s+de\s+copys?\b/.test(n);
}

/**
 * A página é (parte de) um Estudo de Copy? Pelo título dela, pelo do Doc que a contém OU pelo de
 * qualquer página acima dela (`caminho`): uma subpágina de um Estudo de Copy É Estudo de Copy
 * (decisão do usuário, 20/10/2026) — o do Dr. Otavio é uma página "Estudo de Copy: Dr. Otavio
 * Brandt" com o texto numa subpágina.
 */
export function ehPaginaDeEstudo({ nome, docNome = null, caminho = [] } = {}) {
  return [nome, docNome, ...(Array.isArray(caminho) ? caminho : [])].some(ehEstudoDeCopy);
}

/**
 * Os quatro níveis do sistema a partir do rótulo do Estudo.
 *
 * "Consciente do Mecanismo" não existe no sistema e é lido como consciente da SOLUÇÃO (decisão de
 * 20/10/2026): a pessoa já sabe que há tratamento e entende como ele age. O rótulo original fica
 * guardado ao lado (`nivel_original`), para a tela mostrar o que o Estudo diz.
 */
export function nivelDoEstudo(texto) {
  const t = normaliza(texto);
  if (/\binconsciente\b/.test(t)) return "inconsciente";
  if (/consciente d[oa] (problema|dor)\b/.test(t)) return "consciente_problema";
  if (/consciente d[oa] (solucao|mecanismo)\b/.test(t)) return "consciente_solucao";
  if (/consciente do produto\b|totalmente consciente|mais consciente/.test(t)) return "consciente_produto";
  return "";
}

// As seções do modelo, pelo começo do título normalizado. Uma linha só abre seção se for curta:
// "Avatares Base (Níveis de Consciência)" abre; um parágrafo que comece com "Resumo" não.
const SECOES = [
  ["resumo", "resumo geral"],
  ["identificacao", "identificacao profissional"],
  ["servicos", "servicos e procedimentos"],
  ["vantagens", "vantagens competitivas"],
  ["vende", "o que o cliente realmente vende"],
  ["publico", "descricao psicografica"],
  ["avatares", "avatares base"],
  ["dor", "manifestacao da dor"],
  ["pesquisa", "plano de pesquisa"],
  ["concorrentes", "analise dos profissionais"],
];
const MAX_TITULO = 90;

/** A linha sem a marcação de Markdown: cabeçalho, citação, item de lista, negrito, itálico. */
function semMarcacao(linha) {
  return (
    String(linha)
      .replace(/^\s*(#{1,6}\s+|>\s*)+/, "")
      .replace(/^\s*[-*+•]\s+/, "")
      .replace(/\*\*|__/g, "")
      .replace(/^\s*[*_](.*)[*_]\s*$/, "$1")
      // Os escapes do Markdown, por último (depois de a marcação ter saído): o ClickUp escreve
      // `#### 1\. Avatar 1: …` para o número não virar lista, e sem desfazer isso nenhum avatar
      // casava — o Estudo do Dr. Otavio foi recusado por "não ter Avatares Base" (20/10/2026).
      .replace(/\\([\\`*_{}[\]()#+\-.!|>~"'<])/g, "$1")
      .trim()
  );
}

function secaoDaLinha(limpa) {
  if (!limpa || limpa.length > MAX_TITULO) return null;
  // O 📍 e outros emojis da frente não podem impedir o casamento.
  const n = normaliza(limpa).replace(/^[^a-z0-9]+/, "");
  const achada = SECOES.find(([, inicio]) => n.startsWith(inicio));
  return achada ? achada[0] : null;
}

/** "Rótulo: valor" -> valor, quando o rótulo normalizado casa. */
function valorDe(limpa, rotulo) {
  const m = limpa.match(/^([^:]{1,40}):\s*(.*)$/);
  if (!m) return null;
  return normaliza(m[1]) === rotulo ? m[2].trim() : null;
}

// "Não possui (Médico com atuação e pós-graduação em ...)" é o caso real: o começo decide.
const SEM_RQE = /^(nao possui|nao tem|sem rqe|nenhum|n\/a|-|—)/;

/**
 * Lê o Estudo de Copy.
 *
 * @returns {{
 *   identificacao: { nome: string|null, crm: string|null, rqe: string|null, rqe_texto: string|null },
 *   avatares: { id: string, n: number, nome: string, nivel: string, nivel_original: string,
 *               perfil: string, dor: string }[],
 *   secoes: string[],
 *   faltando: string[],
 * }}
 *
 * `rqe` é null quando o Estudo diz que não há ("Não possui"); `rqe_texto` guarda o que estava
 * escrito. `faltando` lista as seções ESSENCIAIS ausentes, com o nome que a tela mostra.
 */
export function lerEstudoDeCopy(md) {
  const linhas = String(md ?? "").split(/\r?\n/).map(semMarcacao);
  const identificacao = { nome: null, crm: null, rqe: null, rqe_texto: null };
  const avatares = [];
  const dores = new Map();
  const secoes = new Set();
  let secao = null;
  let avatar = null; // o avatar em leitura na seção "Avatares Base"
  let dor = null; // { n, partes } na seção "Manifestação da Dor"

  const fecharDor = () => {
    if (dor && dor.partes.length) dores.set(dor.n, dor.partes.join("\n").trim());
    dor = null;
  };

  for (const limpa of linhas) {
    if (!limpa) continue;
    const nova = secaoDaLinha(limpa);
    if (nova) {
      fecharDor();
      avatar = null;
      secao = nova;
      secoes.add(nova);
      continue;
    }

    // A identificação aparece no começo do modelo, mas "CRM:" e "RQE:" são lidos onde estiverem
    // ANTES de qualquer outro valor achado: o primeiro é o do médico.
    const medico = valorDe(limpa, "medico");
    if (medico && !identificacao.nome) identificacao.nome = medico;
    const crm = valorDe(limpa, "crm");
    if (crm && !identificacao.crm) identificacao.crm = crm;
    const rqe = valorDe(limpa, "rqe");
    if (rqe != null && identificacao.rqe_texto == null) {
      identificacao.rqe_texto = rqe;
      identificacao.rqe = rqe && !SEM_RQE.test(normaliza(rqe)) ? rqe : null;
    }

    if (secao === "avatares") {
      // "1. Avatar 1: O Empresário/Líder Discreto (Homem, 35 a 48 anos)"
      const m = limpa.match(/^(?:\d+[.)]\s*)?avatar\s+(\d+)\s*[:\-–—]\s*(.+)$/i);
      if (m) {
        avatar = { id: `A${m[1]}`, n: Number(m[1]), nome: m[2].trim(), nivel: "", nivel_original: "", perfil: "", dor: "" };
        avatares.push(avatar);
        continue;
      }
      if (!avatar) continue;
      const nivel = valorDe(limpa, "nivel de consciencia");
      if (nivel != null) {
        avatar.nivel_original = nivel.replace(/\.$/, "");
        avatar.nivel = nivelDoEstudo(nivel);
        continue;
      }
      const perfil = valorDe(limpa, "perfil");
      if (perfil != null) {
        avatar.perfil = perfil;
        continue;
      }
      // Continuação do perfil em outra linha.
      if (avatar.perfil) avatar.perfil += `\n${limpa}`;
      continue;
    }

    if (secao === "dor") {
      // "Avatar 1 (Empresário Discreto):"
      const m = limpa.match(/^avatar\s+(\d+)\b[^:]*:?\s*$/i);
      if (m) {
        fecharDor();
        dor = { n: Number(m[1]), partes: [] };
        continue;
      }
      if (dor) dor.partes.push(limpa);
    }
  }
  fecharDor();

  for (const a of avatares) a.dor = dores.get(a.n) || "";

  const faltando = [];
  if (!avatares.length) faltando.push("Avatares Base");
  return { identificacao, avatares, secoes: [...secoes], faltando };
}

/**
 * A assinatura do vídeo: "Dr. Fulano | CRM: 12345/UF | RQE: 678". Sem RQE no Estudo, o campo NÃO
 * aparece — e não "RQE: [preencher]": médico sem RQE não tem o que preencher ali. Sem nome ou sem
 * CRM, o que falta vem marcado entre colchetes, e a tela avisa.
 */
export function assinaturaDoEstudo(identificacao) {
  const id = identificacao || {};
  const partes = [id.nome || "[Nome do médico]", `CRM: ${id.crm || "[CRM]"}`];
  if (id.rqe) partes.push(`RQE: ${id.rqe}`);
  return partes.join(" | ");
}

// ---------------------------------------------------------------------------------------------
// Estudo dividido em subpáginas: o que entra no prompt quando ele não cabe inteiro
// ---------------------------------------------------------------------------------------------

/**
 * A ordem de utilidade de cada parte do Estudo para escrever copy, pelo título dela. Os clientes
 * mais antigos têm o Estudo em subpáginas ("1. Briefing de Copy", "2. Buyer Personas", "7.
 * Ângulos & Ideias"…) que somam ~150 mil caracteres — o do Instituto Serena tem 147 mil, 61 mil só
 * no Briefing. Cortar na ordem das páginas deixava as personas e os ângulos de fora.
 */
const PRIORIDADES = [
  /persona|avatar|publico|perfil/,
  /angulo|ideia|conceito/,
  /tom de voz|linguagem/,
  /briefing|identifica|resumo|vantage|posicionamento/,
  /palavra|deep research|pesquisa/,
];
const prioridadeDoTitulo = (titulo) => {
  const n = normaliza(titulo).replace(/^\d+\s*[.)\-–—:]?\s*/, "");
  const i = PRIORIDADES.findIndex((re) => re.test(n));
  return i < 0 ? PRIORIDADES.length : i;
};

/**
 * As partes do Estudo, como `conteudoComSubpaginas` (worker) as junta: o corpo da página, depois
 * uma parte por "## Subpágina: <título>". Estudo do modelo padrão (uma página só) é uma parte só.
 */
export function partesDoEstudo(md) {
  const texto = String(md ?? "");
  const partes = [];
  const re = /^## Subpágina: (.+)$/gm;
  let ultimo = 0;
  let titulo = null;
  for (let m = re.exec(texto); m; m = re.exec(texto)) {
    const corpo = texto.slice(ultimo, m.index).trim();
    if (corpo) partes.push({ titulo, texto: corpo });
    titulo = m[1].trim();
    ultimo = m.index;
  }
  const resto = texto.slice(ultimo).trim();
  if (resto) partes.push({ titulo, texto: resto });
  return partes;
}

/**
 * O Estudo dentro de um orçamento de caracteres, pelas partes mais úteis primeiro (ver
 * PRIORIDADES). Cabe inteiro: volta igual. Não cabe: entram as partes inteiras em ordem de
 * prioridade, a que estourar o orçamento entra cortada dizendo que foi, e uma linha final lista as
 * que ficaram de fora — o agente precisa saber o que não leu.
 */
export function estudoPriorizado(md, max) {
  const texto = String(md ?? "").trim();
  if (!max || texto.length <= max) return texto;
  const partes = partesDoEstudo(texto).map((p, i) => ({ ...p, i, prioridade: p.titulo ? prioridadeDoTitulo(p.titulo) : -1 }));
  partes.sort((a, b) => a.prioridade - b.prioridade || a.i - b.i);
  const dentro = [];
  const fora = [];
  let usado = 0;
  for (const p of partes) {
    const resta = max - usado;
    if (resta <= 200) {
      fora.push(p.titulo || "(corpo da página)");
      continue;
    }
    const t = p.texto.length <= resta ? p.texto : `${p.texto.slice(0, resta - 40)}… (parte cortada)`;
    dentro.push(t);
    usado += t.length + 2;
  }
  if (fora.length) dentro.push(`(Partes do Estudo que NÃO couberam aqui e não foram lidas: ${fora.join("; ")}.)`);
  return dentro.join("\n\n");
}
