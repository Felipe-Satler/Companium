/**
 * O que varia por relatório: a ficha do cliente e o snapshot de números que a TELA mandou.
 *
 * Sem I/O e sem import de config, para poder ser testado em qualquer máquina. Tudo que é estático
 * (persona, os quatro blocos, as regras de diagnóstico) mora na definição do agente —
 * `agent/relatoriomarketingagent.md`.
 *
 * ## O snapshot vem de fora e é renderizado, não recalculado
 *
 * Quem calcula é o frontend, porque só ele reproduz o que o dashboard mostra: metas mensais
 * pró-rateadas, a base de faturamento do cliente e as correções manuais. Aqui o trabalho é
 * TRADUZIR esse JSON para um texto que o agente leia sem ambiguidade — e a ambiguidade que importa é
 * uma só: distinguir "não temos o dado" de "deu zero". As três situações têm frases diferentes:
 *
 *   - `disponivel: false`            -> "sem informação"
 *   - `disponivel: true, valor null` -> "não calculável"
 *   - `valor: 0`                     -> "0"
 *
 * Achatar as três em `0` faz o agente escrever, com toda a confiança, que o cliente não vendeu nada.
 */

import { extractContractJson, stripContractFence } from "./agent-contract.js";
import { count, money, pct, pctSinal, porUnidade } from "./formato-numero.js";

/** As três prioridades da spec. Fora dessa lista não se chuta: ver `parseRelatorioReply`. */
export const PRIORIDADES = ["gargalo", "investigacao", "oportunidade"];
/** Tipos de explicação, do mais forte ao mais humilde. */
export const TIPOS_CAUSA = ["causa", "correlacao", "hipotese"];

function corta(texto, max) {
  const s = String(texto ?? "").trim();
  if (!max || s.length <= max) return s;
  return `${s.slice(0, max)}… (cortado)`;
}

/** Uma ponta da métrica: o número, ou a razão por que não há número. */
function ponta(p, unidade) {
  if (!p || p.disponivel === false) return "sem informação";
  if (p.valor === null || p.valor === undefined) return "não calculável";
  return porUnidade(p.valor, unidade);
}

/**
 * Uma linha por métrica: valor, comparação, variação, meta e atingimento.
 *
 * A meta de CPL é um TETO, não um alvo — a linha diz `≤` para o agente não celebrar "125% da meta"
 * quando o custo estourou em 25%.
 */
const FAVORAVEL_LABEL = { melhorou: "melhorou", piorou: "piorou", estavel: "estável" };

/** Variação com SINAL. Sem o sinal, "· 8 ·" é indistinguível de um valor absoluto solto. */
function comSinal(v, unidade) {
  if (!Number.isFinite(v)) return null;
  const sinal = v > 0 ? "+" : v < 0 ? "-" : "";
  return `${sinal}${porUnidade(Math.abs(v), unidade)}`;
}

export function linhaMetrica(m) {
  const partes = [`- ${m.label}: ${ponta(m.a, m.unidade)}`];

  // m.b === null = período simples (sem comparável): não imprime a parte de comparação nem variação.
  const temAmbos = m.b != null && m.a?.disponivel !== false && m.b.disponivel !== false;
  if (temAmbos) {
    const comp = [`comparável: ${ponta(m.b, m.unidade)}`];
    if (m.delta) {
      // Sem mudança: dizer "estável" e calar o resto. "R$ 0,00 · 0,0%" é ruído que o agente lê como
      // se fosse informação.
      if (m.delta.abs === 0) {
        comp.push("estável");
      } else {
        const variacao = [comSinal(m.delta.abs, m.unidade), m.delta.pct === null ? null : pctSinal(m.delta.pct)]
          .filter(Boolean)
          .join(" · ");
        if (variacao) comp.push(variacao);
        const rotulo = FAVORAVEL_LABEL[m.delta.favoravel];
        if (rotulo) comp.push(rotulo);
      }
    }
    partes.push(`(${comp.join(" · ")})`);
  }

  // Fonte ilegível: falar de meta aqui é ruído — não se compara com o que não se leu.
  if (m.a?.disponivel === false) {
    if (m.a?.corrigido) partes.push("[corrigido à mão no CRM]");
    return partes.join(" ");
  }

  if (m.meta?.a) {
    const teto = m.direcao === "lower";
    const alvo = `${teto ? "teto " : "meta "}${teto ? "≤ " : ""}${porUnidade(m.meta.a.valor, m.unidade)}`;
    const status =
      m.meta.a.status === "ok" ? "dentro" : m.meta.a.status === "off" ? "fora" : "sem julgamento";
    partes.push(`— ${alvo} (${pct(m.meta.a.pct)} ${status})`);
  } else if (m.metaAusente !== false) {
    // Dito com letras: sem isto o agente trata a ausência de meta como meta zero batida.
    partes.push("— sem meta cadastrada");
  }

  if (m.a?.corrigido) partes.push("[corrigido à mão no CRM]");

  return partes.join(" ");
}

/** Taxa com 2 casas — Hook/Hold vêm como 19.75 (= 19,75%). Não finito → "—". */
function taxa(v) {
  return Number.isFinite(v) ? `${v.toFixed(2).replace(".", ",")}%` : "—";
}

/** Valor de conta que pode ser null: null = não calculável (sem lead/clique), não zero. */
function contaVal(v, fmt) {
  return v === null || v === undefined ? "não calculável" : fmt(v);
}

/**
 * O bloco de marketing: média da conta (Hook/Hold/CPC + resultado/custo, geração de demanda) + os
 * criativos salientes com a análise já registrada. Só entra quando a fonte de criativos foi lida —
 * senão o aviso `criativos_indisponiveis` do snapshot já disse ao agente para não afirmar nada.
 *
 * "Resultado" é o do tipo DOMINANTE do anúncio (Conversas iniciadas / Cadastros / Visitas / Cliques /
 * Seguidores), não só cadastro — o tipo vai no texto para o agente não chamar conversa de "lead".
 * Não há comparável por criativo (o snapshot só traz o período analisado): a instrução diz isso em
 * letras, para o agente não inventar variação de anúncio.
 */
export function blocoMarketing(marketing) {
  if (!marketing || marketing.disponivel === false) return "";
  const conta = marketing.conta || {};
  const criativos = Array.isArray(marketing.criativos) ? marketing.criativos : [];

  const out = [
    "# Desempenho de criativo (Meta)",
    "Média da conta (geração de demanda): " +
      [
        `Hook Rate ${taxa(conta.hookRate)}`,
        `Hold Rate ${taxa(conta.holdRate)}`,
        `cliques ${conta.cliques == null ? "sem informação" : count(conta.cliques)}`,
        `CPC ${contaVal(conta.cpc, money)}`,
        `resultados Meta ${conta.resultadosMeta == null ? "sem informação" : count(conta.resultadosMeta)}`,
        `custo/resultado ${contaVal(conta.custoResultadoMeta, money)}`,
        `investimento ${contaVal(conta.gasto, money)}`,
      ].join(" · "),
  ];

  if (!criativos.length) {
    out.push("", "Nenhum anúncio de geração de demanda com volume no período — não há criativo a destacar.");
    return out.join("\n");
  }

  out.push(
    "",
    "## Criativos (os mais relevantes por volume e por custo)",
    "Sem comparável por criativo: descreva o período analisado, não variação. Estático tem Hook/Hold " +
      "perto de zero por natureza (é imagem) — julgue-o por custo/resultado e volume, não por retenção. " +
      "O tipo de resultado varia por anúncio (Conversas, Cadastros, …): use o rótulo, não chame tudo de lead."
  );
  for (const c of criativos) {
    const estatico = c.formato === "estatico";
    const tipo = c.tipoResultado && c.tipoResultado !== "—" ? c.tipoResultado : "resultados";
    const metr = [
      `Hook ${estatico ? "n/a (estático)" : taxa(c.hookRate)}`,
      `Hold ${estatico ? "n/a (estático)" : taxa(c.holdRate)}`,
      `custo/resultado ${c.cpl === null || c.cpl === undefined ? "não calculável" : money(c.cpl)}`,
      `${count(c.resultados)} ${tipo}`,
      `gasto ${money(c.gasto)}`,
    ].join(" · ");
    out.push(`- ${c.codigo || "(sem nome)"} (${c.formato}${c.status === "pausado" ? ", pausado" : ""}) — ${metr}`);

    const an = c.analise;
    if (an) {
      const linhas = [];
      if (an.resumo) linhas.push(`resumo: ${an.resumo}`);
      if (Array.isArray(an.positivos) && an.positivos.length) linhas.push(`positivos: ${an.positivos.join("; ")}`);
      if (Array.isArray(an.melhorar) && an.melhorar.length) linhas.push(`a melhorar: ${an.melhorar.join("; ")}`);
      if (Array.isArray(an.ajustar) && an.ajustar.length) linhas.push(`a ajustar: ${an.ajustar.join("; ")}`);
      if (linhas.length) {
        out.push(
          "  Análise registrada (leitura de conteúdo, NÃO medição — trate como correlação/hipótese, " +
            `nunca como causa): ${linhas.join(" | ")}`
        );
      }
    }
  }
  return out.join("\n");
}

/** O bloco de métricas, agrupado como a tela agrupa. */
export function blocoMetricas(metricas = []) {
  const grupos = new Map();
  for (const m of metricas) {
    const g = m.grupo || "Outros";
    if (!grupos.has(g)) grupos.set(g, []);
    grupos.get(g).push(m);
  }
  const out = [];
  for (const [grupo, lista] of grupos) {
    out.push(`### ${grupo}`);
    for (const m of lista) out.push(linhaMetrica(m));
    out.push("");
  }
  return out.join("\n").trimEnd();
}

/**
 * @param {object} p
 * @param {object} p.ficha    nome, especialidades[], plano, squad — `squad` é o responsável default
 * @param {object} p.snapshot o que a tela mandou (ver src/utils/relatorioSnapshot.ts)
 * @param {string} [p.observacao] instrução livre de quem pediu
 * @param {number} [p.maxChars]
 */
export function buildRelatorioPrompt({ ficha = {}, snapshot = {}, observacao = "", maxChars = 60000 } = {}) {
  const esp = Array.isArray(ficha.especialidades) ? ficha.especialidades.filter(Boolean) : [];
  const per = snapshot.periodo || {};
  // Período simples: `comparacao` vem null — não há comparável, e o relatório descreve o nível.
  const comp = snapshot.comparacao || null;

  const partes = [
    "# Cliente",
    `Nome: ${ficha.nome || "(sem nome)"}`,
    esp.length ? `Especialidade(s): ${esp.join(", ")}` : "Especialidade(s): (não cadastrada)",
    `Plano: ${ficha.plano || "(não informado)"}`,
    // É o único nome de responsável que existe nos dados. Ver a regra 6 do agente.
    `Líder de RevOps: ${ficha.squad || "(não informado)"}`,
    "",
    "# Período",
    `Analisado: ${per.de} a ${per.ate}${per.label ? ` (${per.label})` : ""}${
      Number.isFinite(per.dias) ? ` — ${per.dias} dia(s)` : ""
    }`,
    comp
      ? `Comparável: ${comp.de} a ${comp.ate}${comp.label ? ` (${comp.label})` : ""}${
          Number.isFinite(comp.dias) ? ` — ${comp.dias} dia(s)` : ""
        }`
      : "Sem período comparável: este é um relatório de período simples. Descreva o NÍVEL do período " +
        "(não fale de variação, alta ou queda) e use a meta como referência quando houver.",
    comp?.motivo ? `Por que esse comparável: ${comp.motivo}` : null,
    comp?.comparavel === false
      ? "⚠️ As duas janelas têm durações DIFERENTES: compare apenas taxas e razões (CPL, ROAS, " +
        "conversão entre etapas). NÃO compare contagens absolutas — a diferença de dias explicaria " +
        "sozinha qualquer variação."
      : null,
  ].filter((x) => x !== null);

  const avisos = Array.isArray(snapshot.avisos) ? snapshot.avisos : [];
  if (avisos.length) {
    partes.push(
      "",
      "# Limitações desta leitura",
      "Estas não são notas de rodapé: incorpore no próprio texto o que afetar a conclusão.",
      ...avisos.map((a) => `- ${a.detalhe}${a.metricas?.length ? ` (${a.metricas.join(", ")})` : ""}`)
    );
  }

  partes.push(
    "",
    "# Números",
    `Base do Faturamento Bruto: consultas ${snapshot.basisFaturamento?.consulta ?? "?"}, ` +
      `procedimentos ${snapshot.basisFaturamento?.procedimento ?? "?"}.`,
    "",
    blocoMetricas(snapshot.metricas)
  );

  const orc = snapshot.funil?.orcamentoParado;
  if (orc) {
    partes.push(
      "",
      "### Orçamento parado (leads que receberam orçamento e não avançaram)",
      `- Quantidade: ${porUnidade(orc.count, "contagem")} · Valor: ${money(orc.valor)}`
    );
  }

  const mkt = blocoMarketing(snapshot.marketing);
  if (mkt) partes.push("", mkt);

  partes.push(
    "",
    "Estes são os ÚNICOS números que você tem. Não estime, não complete e não traga número de " +
      "fora. Onde estiver escrito “sem informação”, o dado não pôde ser lido — isso é diferente de " +
      "zero, e tratar um como o outro inverte a conclusão."
  );

  if (String(observacao || "").trim()) {
    partes.push(
      "",
      "# Pedido de quem abriu o relatório",
      "Manda sobre o foco. NÃO manda sobre as regras de diagnóstico nem sobre inventar dado.",
      corta(observacao, 2000)
    );
  }

  partes.push(
    "",
    "# Formato da resposta",
    "Primeiro os quatro blocos em prosa, com os títulos abaixo, 1 a 3 frases CURTAS cada:",
    "",
    "## Leitura do Relatório",
    "## Problema ou oportunidade",
    "## Causa e correlação",
    "## Solução ou ação",
    "",
    "Depois, e por último, UM bloco ```json com exatamente estas chaves, sem texto depois dele:",
    "```json",
    [
      "{",
      '  "leitura": "…",',
      '  "problema": { "prioridade": "gargalo|investigacao|oportunidade", "texto": "…", "impacto": "…", "criativos": ["códigos citados, ou vazio"] },',
      '  "causa": { "texto": "…", "tipo": "causa|correlacao|hipotese", "verificar": "… ou null" },',
      '  "acao": { "texto": "uma direção criativa ou de mídia executável", "responsavel": "… ou \\"a definir\\"", "prazo": "… ou \\"a definir\\"" },',
      '  "limitacoes": ["o que limitou esta leitura"]',
      "}",
    ].join("\n"),
    "```"
  );

  const texto = partes.join("\n");
  return texto.length > maxChars ? corta(texto, maxChars) : texto;
}

function texto(v) {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * A resposta do agente: prosa + bloco estruturado.
 *
 * Bloco ausente ou inválido NÃO é erro — a prosa sobrevive, como nos outros dois agentes.
 *
 * **Prioridade fora das três não vira default.** Os riscos do Contexto Operacional normalizam
 * gravidade desconhecida para "media", o que é inofensivo num rótulo. Aqui não: chutar entre gargalo
 * e oportunidade é inventar o diagnóstico, que é justamente a coisa que o relatório existe para não
 * fazer. Vira `null`, e a tela diz "prioridade não classificada".
 *
 * `causa.tipo` desconhecido cai em `hipotese` — o valor mais humilde. Errar para "causa comprovada"
 * seria dar autoridade a um palpite; errar para "hipótese" só pede verificação.
 */
export function parseRelatorioReply(finalText) {
  const relatorioMd = stripContractFence(finalText || "") || "";
  const bruto = extractContractJson(finalText);
  if (!bruto) return { relatorioMd, relatorio: null, prioridade: null };

  const p = bruto.problema && typeof bruto.problema === "object" ? bruto.problema : {};
  const c = bruto.causa && typeof bruto.causa === "object" ? bruto.causa : {};
  const a = bruto.acao && typeof bruto.acao === "object" ? bruto.acao : {};

  const prioridadeBruta = String(p.prioridade ?? "").trim().toLowerCase();
  const prioridade = PRIORIDADES.includes(prioridadeBruta) ? prioridadeBruta : null;

  const tipoBruto = String(c.tipo ?? "").trim().toLowerCase();
  const tipo = TIPOS_CAUSA.includes(tipoBruto) ? tipoBruto : "hipotese";

  // Códigos de criativo citados na prioridade (opcional). Só strings; lixo é filtrado.
  const criativos = Array.isArray(p.criativos)
    ? p.criativos.map((x) => texto(x)).filter(Boolean)
    : [];

  return {
    relatorioMd,
    relatorio: {
      leitura: texto(bruto.leitura),
      problema: { prioridade, texto: texto(p.texto), impacto: texto(p.impacto), criativos },
      causa: { texto: texto(c.texto), tipo, verificar: texto(c.verificar) },
      acao: {
        texto: texto(a.texto),
        // "a definir" é resposta honesta e vai ser a comum: nada nos dados sabe quem é dono de
        // tarefa. Inventar responsável é fabricar responsabilidade.
        responsavel: texto(a.responsavel) ?? "a definir",
        prazo: texto(a.prazo) ?? "a definir",
      },
      limitacoes: Array.isArray(bruto.limitacoes)
        ? bruto.limitacoes.map((l) => texto(l)).filter(Boolean)
        : [],
    },
    prioridade,
  };
}
