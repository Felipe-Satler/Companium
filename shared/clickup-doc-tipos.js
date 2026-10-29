/**
 * Que documentos do ClickUp têm o CONTEÚDO ingerido — e quais nunca são lidos.
 *
 * Em `shared/` pelo mesmo motivo de `ad-formats.js`: a tela rotula o documento e o worker decide se
 * baixa o conteúdo a partir da MESMA definição. "Tipo que a tela mostra e o worker não conhece" não
 * existe.
 *
 * ## Aberto por padrão, com uma lista curta de bloqueio (05/10/2026)
 *
 * Até esta data era o contrário: allowlist, com padrão FECHADO. A medição derrubou a regra — das
 * 6.057 páginas do workspace, **2.812 ficavam barradas**, e entre elas as 32 páginas de Copys de um
 * cliente, que são exatamente o material que o Composer existe para usar. O custo do padrão fechado
 * passou a ser maior que o risco que ele cobria.
 *
 * Agora o padrão é aberto e o bloqueio é por nome: documento de **acesso/credencial** nunca tem o
 * corpo lido. O radical é `acesso`, singular e plural, porque a lista real tem "Acessos",
 * "Materiais e Acessos" **e** "Acesso Meta Ads Dr. Antonio" — e uma regra só no plural deixaria
 * passar justamente a que tem credencial de um cliente nomeado.
 *
 * ⚠️ **O risco desta inversão é conhecido e aceito:** o próximo nome que ninguém previu
 * ("Infra - chaves", "Credenciais GA4") passa, grava o segredo na tabela e o manda ao prompt de um
 * modelo. Se aparecer um desses, a correção é acrescentar o radical aqui — e é por isso que este
 * arquivo é o único lugar que decide, em vez de a regra estar espalhada.
 */

/** Tipo de quem não casa com nenhum rótulo conhecido. Liberado, só sem etiqueta na tela. */
export const TIPO_OUTRO = "outro";

/**
 * Nome que indica credencial. **Nunca** tem o corpo lido — é a única trava de conteúdo que sobrou.
 *
 * Radical `acesso` com fronteira de palavra: pega "Acessos", "Materiais e Acessos" e "Acesso Meta
 * Ads Dr. Antonio", e não pega "Acessório" nem "Acessibilidade", que são palavras legítimas de
 * documento de cliente.
 */
export function bloqueadoPorSeguranca(nome) {
  return /\bacessos?\b/.test(normalizarNomeDoc(nome));
}

/**
 * Os tipos conhecidos. `padrao` casa contra o nome NORMALIZADO (minúsculas, sem acento).
 *
 * `composer: true` = pode ser oferecido como insumo do Ad Composer. Nem todo documento ingerido
 * serve de insumo criativo: ata de reunião é contexto de operação, não matéria-prima de anúncio.
 */
export const TIPOS_DOC = [
  {
    id: "mapeamento_estrategico",
    label: "Mapeamento Estratégico",
    padrao: /mapeamento\s+estrategico/,
    composer: true,
  },
  {
    id: "mapeamento_cliente",
    label: "Mapeamento do Cliente",
    padrao: /mapeamento\s+(do\s+)?cliente/,
    composer: true,
  },
  {
    id: "diagnostico_planejamento",
    label: "Diagnóstico & Planejamento",
    padrao: /diagnostico|planejamento/,
    composer: true,
  },
  {
    id: "briefing",
    label: "Briefing",
    // Pega "Briefing de Conteúdo" e "Ata | Briefing".
    padrao: /briefing/,
    composer: true,
  },
  {
    // A base dos Conceitos Estratégicos do Composer (ver shared/estudo-copy.js). A tela e o worker
    // reconhecem o Estudo pelo NOME (`ehEstudoDeCopy`), que vale na hora; este tipo só dá o chip,
    // e passa a valer para cada página no próximo sync que a tocar.
    id: "estudo_copy",
    label: "Estudo de Copy",
    padrao: /^estudo\s+de\s+copys?\b/,
    composer: true,
  },
  {
    id: "copys",
    label: "Copys",
    padrao: /^copys?\b|\bcopys\b/,
    composer: true,
  },
  {
    id: "reuniao",
    label: "Reunião / Ata",
    padrao: /\bata\b|meetings?\b|reuniao/,
    // Contexto de operação, não matéria-prima criativa: fica fora do Composer por default para não
    // gastar orçamento de prompt com quem decidiu o quê numa reunião de abril.
    composer: false,
  },
];

/** minúsculas, sem acento, espaços colapsados. */
export function normalizarNomeDoc(nome) {
  return String(nome ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Este documento é um TEMPLATE da agência?
 *
 * Seis Docs do workspace são templates — formulários em branco de mapeamento e briefing. O nome
 * deles casa com a allowlist (um "Template de Mapeamento Estratégico" contém "mapeamento
 * estrategico"), então sem esta guarda o sync baixaria o conteúdo dos seis a cada edição e os
 * ofereceria como insumo. Template não é material de cliente: alimentar o Composer com um
 * formulário em branco é pior do que não alimentar, porque o modelo preenche os espaços vazios com
 * invenção e o resultado parece fundamentado.
 *
 * Só `template`, de propósito. "Modelo" seria o sinônimo natural e está FORA: "Modelo de Negócio" é
 * seção legítima de mapeamento estratégico, e a palavra derrubaria documento de cliente de verdade.
 * A guarda erra para o lado de deixar passar — um template não pego fica sem cliente atribuído de
 * qualquer jeito, o que é o estado inofensivo.
 */
export function ehTemplate(nome) {
  return /\btemplates?\b/.test(normalizarNomeDoc(nome));
}

/**
 * O tipo de um documento pelo nome, ou `null` quando não reconhecido.
 *
 * `null` é a resposta para a maioria dos documentos, e é o estado seguro: sem tipo, sem leitura de
 * conteúdo. Não há fallback "outros".
 */
export function classificarDoc(nome) {
  const n = normalizarNomeDoc(nome);
  if (!n) return null;
  // As duas travas, antes de qualquer rótulo. Credencial é segurança; template é qualidade — molde
  // em branco não é material de cliente, e o modelo preenche os vazios com invenção que parece
  // fundamentada. Template também nunca recebe cliente atribuído, então ler o corpo dele seria
  // chamada gasta num documento que não aparece em aba nenhuma.
  if (bloqueadoPorSeguranca(n)) return null;
  if (ehTemplate(n)) return null;
  for (const t of TIPOS_DOC) {
    if (t.padrao.test(n)) return t.id;
  }
  // Sem rótulo conhecido NÃO é bloqueio: é documento comum. A tela só não mostra chip de tipo.
  return TIPO_OUTRO;
}

export function tipoDoc(id) {
  return TIPOS_DOC.find((t) => t.id === id) ?? null;
}

/** O conteúdo deste documento pode ser baixado e gravado? */
export function podeIngerirConteudo(nome) {
  return classificarDoc(nome) !== null;
}

/** Este tipo pode ser oferecido como insumo do Ad Composer? */
export function serveAoComposer(tipoId) {
  // `outro` serve: com o padrão aberto, o que não tem rótulo é documento comum do cliente.
  if (tipoId === TIPO_OUTRO) return true;
  return Boolean(tipoDoc(tipoId)?.composer);
}

/**
 * Teto de caracteres que os documentos escolhidos podem ocupar no prompt do Composer.
 *
 * O prompt já carrega a análise da Mineração e os anúncios dela, e `MAX_COMPOSER_CHARS` é 80k. Sem
 * um orçamento próprio, dois documentos grandes empurram a análise para fora do prompt — ou seja, a
 * novidade degrada o que já funciona. 24k é ~6 páginas: cabe o mapeamento estratégico de um cliente
 * sem disputar com o resto.
 */
export const MAX_DOCS_COMPOSER_CHARS = 24000;
