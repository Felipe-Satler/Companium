/**
 * Spike de acesso ao Jev (Fase 0): três chamadas reais, uma por tipo de pergunta, para registrar o
 * formato de verdade antes de qualquer integração. Não toca no produto, não lê o banco.
 *
 *   OPENROUTER_API_KEY=... node scripts/jev-spike.js
 *
 * Imprime a resposta crua de cada chamada e grava a seção "Medições" de docs/jev-api.md (entre os
 * marcadores). A chave nunca vai para o arquivo nem para a tela.
 *
 * Além das três chamadas, sonda duas rotas vizinhas com a mesma pergunta `noul`, porque a dúvida
 * da fase é justamente essa: o endpoint compatível com OpenAI aceita perguntas tipadas? A sonda
 * só registra o status e o começo do corpo; resposta 4xx ali é resultado, não falha do script.
 *
 * Variáveis: JEV_ENDPOINT (padrão: rota de decisões do OpenRouter), JEV_MODELO, JEV_SEM_SONDAS=1.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ENDPOINT = process.env.JEV_ENDPOINT || "https://openrouter.ai/api/alpha/decisions";
const MODELO = process.env.JEV_MODELO || "typesafe/jev-1.13";
const DOC = fileURLToPath(new URL("../docs/jev-api.md", import.meta.url));
const INICIO = "<!-- medicoes:inicio -->";
const FIM = "<!-- medicoes:fim -->";
/** Preço de tabela, só para conferir contra o `usage.cost` que o OpenRouter devolve. */
const USD_POR_MILHAO_ENTRADA = 0.042;

const ANUNCIO = [
  "Dra. Helena Pimentel | Dermatologia",
  "Manchas no rosto que não saem com creme nenhum? O melasma tem tratamento, e ele começa com um",
  "diagnóstico correto. Avaliação completa por R$ 290, com mapeamento da pele no mesmo dia.",
  "Agende pelo WhatsApp e venha conhecer a clínica em Moema.",
].join("\n");

const CHAMADAS = [
  {
    nome: "noul",
    questions: {
      mostra_preco: {
        type: "noul",
        instructions: "Este anúncio mostra preço?",
        criteria: {
          true: "O texto traz um valor em dinheiro, parcela ou desconto com número",
          false: "Nenhum valor aparece no texto",
        },
      },
    },
  },
  {
    nome: "choice",
    questions: {
      especialidade: {
        type: "choice",
        instructions: "De qual especialidade médica é este anúncio?",
        criteria: {
          dermatologia: "Pele, cabelo e unhas",
          oftalmologia: "Olhos e visão",
          ortopedia: "Ossos, articulações e coluna",
          cirurgia_plastica: "Cirurgias estéticas e reparadoras",
          outra: "Nenhuma das anteriores",
        },
      },
    },
  },
  {
    nome: "score",
    questions: {
      relevancia: {
        type: "score",
        instructions:
          "Qual a relevância deste anúncio para uma clínica de dermatologia que procura referências de anúncios de tratamento de melasma?",
        criteria: [
          "1: sem relação com o tema",
          "2: mesma área médica, outro assunto",
          "3: assunto próximo",
          "4: mesmo assunto, abordagem diferente",
          "5: exatamente o que se procura",
        ],
      },
    },
  },
];

const SONDAS = [
  { nome: "OpenAI-compatível (/api/v1/chat/completions) com `questions`", url: "https://openrouter.ai/api/v1/chat/completions", chat: true },
  { nome: "Rota do SDK da TypeSafe (/api/v1/systemone)", url: "https://openrouter.ai/api/v1/systemone" },
];

async function postar(url, chave, corpo) {
  const t0 = performance.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(30_000),
  });
  const texto = await res.text();
  const latenciaMs = Math.round(performance.now() - t0);
  let json = null;
  try {
    json = JSON.parse(texto);
  } catch {
    // corpo não-JSON (página de erro): fica só o texto
  }
  return { status: res.status, latenciaMs, texto, json };
}

const bloco = (v) => "```json\n" + JSON.stringify(v, null, 2) + "\n```";
const num = (n) => (Number.isFinite(n) ? String(n) : "—");

async function main() {
  const chave = process.env.OPENROUTER_API_KEY;
  if (!chave) {
    console.error("OPENROUTER_API_KEY ausente no ambiente.");
    process.exit(1);
  }

  const linhas = [];
  const secoes = [];
  for (const c of CHAMADAS) {
    const corpo = { model: MODELO, state: ANUNCIO, questions: c.questions };
    let r;
    try {
      r = await postar(ENDPOINT, chave, corpo);
    } catch (err) {
      r = { status: null, latenciaMs: null, texto: String(err?.message || err), json: null };
    }
    const uso = r.json?.usage ?? {};
    const entrada = uso.input_tokens ?? uso.inputTokens;
    const saida = uso.output_tokens ?? uso.outputTokens;
    const tabela = Number.isFinite(entrada) ? (entrada * USD_POR_MILHAO_ENTRADA) / 1e6 : null;
    console.log(`\n=== ${c.nome}: HTTP ${r.status ?? "erro de rede"}, ${num(r.latenciaMs)} ms ===`);
    console.log(r.json ? JSON.stringify(r.json, null, 2) : r.texto.slice(0, 600));
    linhas.push(
      `| \`${c.nome}\` | ${r.status ?? "erro de rede"} | ${num(r.latenciaMs)} | ${num(entrada)} | ${num(saida)} | ${num(uso.cost)} | ${tabela == null ? "—" : tabela.toFixed(9)} | ${r.json?.model ?? "—"} |`,
    );
    secoes.push(
      `### \`${c.nome}\`\n\nPerguntas enviadas:\n\n${bloco(c.questions)}\n\nResposta crua (HTTP ${r.status ?? "erro de rede"}):\n\n` +
        (r.json ? bloco(r.json) : "```\n" + r.texto.slice(0, 600) + "\n```"),
    );
  }

  const sondas = [];
  if (process.env.JEV_SEM_SONDAS !== "1") {
    for (const s of SONDAS) {
      const base = { model: MODELO, questions: CHAMADAS[0].questions };
      const corpo = s.chat ? { ...base, messages: [{ role: "user", content: ANUNCIO }] } : { ...base, state: ANUNCIO };
      let r;
      try {
        r = await postar(s.url, chave, corpo);
      } catch (err) {
        r = { status: null, texto: String(err?.message || err) };
      }
      console.log(`\n=== sonda ${s.url}: HTTP ${r.status ?? "erro de rede"} ===\n${r.texto.slice(0, 400)}`);
      sondas.push(`- **${s.nome}**: HTTP ${r.status ?? "erro de rede"}\n\n  \`\`\`\n  ${r.texto.slice(0, 400).replace(/\n/g, "\n  ")}\n  \`\`\``);
    }
  }

  const medicoes = [
    INICIO,
    `Rodado em ${new Date().toISOString()} contra \`${ENDPOINT}\`, modelo \`${MODELO}\`.`,
    "",
    "Texto do estado (o mesmo nas três chamadas):",
    "",
    "```\n" + ANUNCIO + "\n```",
    "",
    "| Chamada | HTTP | Latência (ms) | Tokens entrada | Tokens saída | `usage.cost` (US$) | Custo pela tabela (US$) | Modelo servido |",
    "|---|---|---|---|---|---|---|---|",
    ...linhas,
    "",
    "A latência é de ponta a ponta, medida daqui (inclui rede e TLS da primeira conexão).",
    "",
    ...secoes.flatMap((s) => [s, ""]),
    "### Sondas de rota",
    "",
    sondas.length ? sondas.join("\n\n") : "Não rodadas (`JEV_SEM_SONDAS=1`).",
    FIM,
  ].join("\n");

  const doc = readFileSync(DOC, "utf8");
  const i = doc.indexOf(INICIO);
  const f = doc.indexOf(FIM);
  if (i === -1 || f === -1) {
    console.error(`\nMarcadores de medição não encontrados em ${DOC}; nada foi gravado.`);
    process.exit(1);
  }
  writeFileSync(DOC, doc.slice(0, i) + medicoes + doc.slice(f + FIM.length));
  console.log(`\nMedições gravadas em ${DOC}`);
}

main();
