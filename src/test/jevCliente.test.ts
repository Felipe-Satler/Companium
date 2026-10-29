/**
 * Cliente do Jev (apps/ad-spy-worker/jev.js), com o fetch trocado por um dublê.
 *
 * O que estes testes prendem é o que faria uma decisão errada passar por certa: uma opção que não
 * foi oferecida aceita, um nível de nota contado a partir do zero, uma exceção que derruba quem
 * chamou, e uma chamada que sai com a flag desligada.
 */
import { describe, it, expect, vi } from "vitest";
import {
  criarClienteJev,
  criarFila,
  lerResposta,
  perguntasParaApi,
  MAX_ESTADO_CHARS,
} from "../../apps/ad-spy-worker/jev.js";

const PERGUNTAS = {
  mostra_preco: { tipo: "noul", instrucoes: "Este anúncio mostra preço?", criterios: { sim: "Tem valor", nao: "Não tem" } },
  especialidade: { tipo: "choice", instrucoes: "Qual especialidade?", opcoes: { dermatologia: "Pele", oftalmologia: "Olhos" } },
  relevancia: { tipo: "score", instrucoes: "Qual a relevância?", niveis: ["nenhuma", "pouca", "média", "alta", "total"] },
};

/** Respostas como o OpenRouter devolveu no spike de 15/10 (docs/jev-api.md). */
const RESPOSTA_OK = {
  model: "typesafe/jev-1.13-20260917",
  answers: {
    mostra_preco: { type: "noul", noul: 0.99 },
    especialidade: {
      type: "choice",
      choice: "dermatologia",
      probabilities: { dermatologia: 0.9, oftalmologia: 0.1 },
      confidence: 0.8,
    },
    relevancia: {
      type: "score",
      score: 3.93,
      legend: { 0: "nenhuma", 1: "pouca", 2: "média", 3: "alta", 4: "total" },
      probabilities: { 0: 0, 1: 0, 2: 0.01, 3: 0.05, 4: 0.94 },
      confidence: 0.94,
    },
  },
  usage: { input_tokens: 476, output_tokens: 72, cost: 0.000019992 },
};

const resposta = (status: number, corpo: unknown) =>
  new Response(typeof corpo === "string" ? corpo : JSON.stringify(corpo), { status });

/** O corpo JSON da primeira requisição que o dublê recebeu. */
const corpoEnviado = (f: { mock: { calls: unknown[][] } }) =>
  JSON.parse(String((f.mock.calls[0]?.[1] as RequestInit | undefined)?.body ?? "null"));

function cliente(fetchFn: (...a: unknown[]) => Promise<Response>, extra: Record<string, unknown> = {}) {
  return criarClienteJev({ habilitado: true, chave: "teste", fetch: fetchFn, log: () => {}, ...extra });
}

describe("jev.avaliar", () => {
  it("lê as três respostas, com o score numerado a partir de 1", async () => {
    const fetchFn = vi.fn(async () => resposta(200, RESPOSTA_OK));
    const r = await cliente(fetchFn).avaliar({ estado: "Avaliação por R$ 290", perguntas: PERGUNTAS });

    expect(r.erro).toBeNull();
    expect(r.respostas.mostra_preco).toEqual({
      valor: true,
      probabilidade: 0.99,
      probabilidades: { sim: 0.99, nao: 0.01 },
    });
    expect(r.respostas.especialidade).toMatchObject({ valor: "dermatologia", probabilidade: 0.9, confianca: 0.8 });
    expect(r.respostas.relevancia).toMatchObject({ valor: 5, probabilidade: 0.94, media: expect.closeTo(4.93, 6) });
    expect(r.tokens).toEqual({ entrada: 476, saida: 72 });
    expect(r.custoUsd).toBe(0.000019992);
    expect(r.modelo).toBe("typesafe/jev-1.13-20260917");
    expect(r.latenciaMs).toEqual(expect.any(Number));

    const corpo = corpoEnviado(fetchFn);
    expect(corpo.model).toBe("typesafe/jev-1.13");
    expect(corpo.questions.mostra_preco.criteria).toEqual({ true: "Tem valor", false: "Não tem" });
    expect(corpo.questions.relevancia.criteria).toHaveLength(5);
  });

  it("noul com 'não': a probabilidade é a do não, e a de sim fica em probabilidades.sim", async () => {
    const fetchFn = vi.fn(async () => resposta(200, { answers: { mostra_preco: { type: "noul", noul: 0.04 } } }));
    const r = await cliente(fetchFn).avaliar({ estado: "texto", perguntas: { mostra_preco: PERGUNTAS.mostra_preco } });
    expect(r.respostas.mostra_preco).toMatchObject({ valor: false, probabilidade: 0.96, probabilidades: { sim: 0.04 } });
  });

  it("descarta choice fora das opções e não inventa resposta para id não perguntado", async () => {
    const fetchFn = vi.fn(async () =>
      resposta(200, {
        answers: {
          ...RESPOSTA_OK.answers,
          especialidade: { type: "choice", choice: "cardiologia", probabilities: { cardiologia: 1 }, confidence: 1 },
          intrusa: { type: "noul", noul: 1 },
        },
      }),
    );
    const r = await cliente(fetchFn).avaliar({ estado: "texto", perguntas: PERGUNTAS });
    expect(r.respostas.especialidade).toBeNull();
    expect(r.respostas.mostra_preco).not.toBeNull();
    expect(Object.keys(r.respostas).sort()).toEqual(["especialidade", "mostra_preco", "relevancia"]);
  });

  it("sem usage.cost, calcula o custo pelos tokens de entrada", async () => {
    const fetchFn = vi.fn(async () => resposta(200, { ...RESPOSTA_OK, usage: { input_tokens: 1_000_000, output_tokens: 5 } }));
    const r = await cliente(fetchFn).avaliar({ estado: "texto", perguntas: PERGUNTAS });
    expect(r.custoUsd).toBeCloseTo(0.042, 9);
  });

  it("timeout: tenta de novo uma vez e devolve null sem lançar", async () => {
    const fetchFn = vi.fn(
      (_url: unknown, init: { signal: AbortSignal }) =>
        new Promise<Response>((_ok, falha) => init.signal.addEventListener("abort", () => falha(init.signal.reason))),
    );
    const r = await cliente(fetchFn).avaliar({ estado: "texto", perguntas: PERGUNTAS, timeoutMs: 20 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(r.respostas).toEqual({ mostra_preco: null, especialidade: null, relevancia: null });
    expect(r.erro).toMatch(/timeout/);
  });

  it("depois de um 500, a nova tentativa vale", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(resposta(500, "erro"))
      .mockResolvedValueOnce(resposta(200, RESPOSTA_OK));
    const r = await cliente(fetchFn).avaliar({ estado: "texto", perguntas: PERGUNTAS });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(r.erro).toBeNull();
    expect(r.respostas.mostra_preco?.valor).toBe(true);
  });

  it("dois 500 seguidos: null, sem terceira tentativa", async () => {
    const fetchFn = vi.fn(async () => resposta(503, "fora"));
    const r = await cliente(fetchFn).avaliar({ estado: "texto", perguntas: PERGUNTAS });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(r.respostas.mostra_preco).toBeNull();
    expect(r.erro).toMatch(/HTTP 503/);
  });

  it("erro de validação (422) não é repetido", async () => {
    const fetchFn = vi.fn(async () => resposta(422, { error: "questions.x.criteria" }));
    const r = await cliente(fetchFn).avaliar({ estado: "texto", perguntas: PERGUNTAS });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(r.erro).toMatch(/HTTP 422/);
  });

  it("corpo que não é JSON vira null, sem lançar", async () => {
    const fetchFn = vi.fn(async () => resposta(200, "<html>"));
    const r = await cliente(fetchFn).avaliar({ estado: "texto", perguntas: PERGUNTAS });
    expect(r.respostas.mostra_preco).toBeNull();
    expect(r.erro).toBeTruthy();
  });

  it("flag desligada: nenhuma chamada, tudo null", async () => {
    const fetchFn = vi.fn();
    const r = await cliente(fetchFn, { habilitado: false }).avaliar({ estado: "texto", perguntas: PERGUNTAS });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(r.respostas).toEqual({ mostra_preco: null, especialidade: null, relevancia: null });
    expect(r.erro).toBe("desligado");
  });

  it("sem chave: nenhuma chamada", async () => {
    const fetchFn = vi.fn();
    const r = await cliente(fetchFn, { chave: "" }).avaliar({ estado: "texto", perguntas: PERGUNTAS });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(r.erro).toBe("sem chave");
  });

  it("estado grande demais é truncado e marcado", async () => {
    const fetchFn = vi.fn(async () => resposta(200, RESPOSTA_OK));
    const r = await cliente(fetchFn).avaliar({ estado: "a".repeat(MAX_ESTADO_CHARS + 500), perguntas: PERGUNTAS });
    expect(r.truncado).toBe(true);
    const corpo = corpoEnviado(fetchFn);
    expect(corpo.state.length).toBeLessThan(MAX_ESTADO_CHARS + 100);
    expect(corpo.state).toMatch(/\[texto truncado\]$/);
  });

  it("pergunta inválida não é enviada, e as válidas seguem", async () => {
    const fetchFn = vi.fn(async () => resposta(200, RESPOSTA_OK));
    const r = await cliente(fetchFn).avaliar({
      estado: "texto",
      perguntas: { ...PERGUNTAS, ruim: { tipo: "score", instrucoes: "x", niveis: ["só um"] } },
    });
    const corpo = corpoEnviado(fetchFn);
    expect(Object.keys(corpo.questions)).not.toContain("ruim");
    expect(r.respostas.ruim).toBeNull();
    expect(r.respostas.mostra_preco).not.toBeNull();
  });

  it("respeita o limite de concorrência", async () => {
    let ativos = 0;
    let pico = 0;
    const fetchFn = vi.fn(async () => {
      ativos += 1;
      pico = Math.max(pico, ativos);
      await new Promise((r) => setTimeout(r, 5));
      ativos -= 1;
      return resposta(200, RESPOSTA_OK);
    });
    const c = cliente(fetchFn, { concorrencia: 3 });
    const rs = await Promise.all(Array.from({ length: 10 }, () => c.avaliar({ estado: "texto", perguntas: PERGUNTAS })));
    expect(fetchFn).toHaveBeenCalledTimes(10);
    expect(pico).toBe(3);
    expect(rs.every((r) => r.erro === null)).toBe(true);
  });
});

describe("jev.lerResposta", () => {
  const { questions } = perguntasParaApi(PERGUNTAS);

  it("score fora da faixa é descartado", () => {
    expect(lerResposta(questions.relevancia, { type: "score", score: 5.2, probabilities: { 4: 1 } })).toBeNull();
    expect(lerResposta(questions.relevancia, { type: "score", score: 2, probabilities: { 7: 1 } })).toBeNull();
  });

  it("noul fora de 0 a 1 e tipo trocado são descartados", () => {
    expect(lerResposta(questions.mostra_preco, { type: "noul", noul: 1.3 })).toBeNull();
    expect(lerResposta(questions.mostra_preco, { type: "choice", choice: "sim" })).toBeNull();
  });

  it("choice em lista simples aceita as opções como ids", () => {
    const { questions: q } = perguntasParaApi({ c: { tipo: "choice", instrucoes: "x", opcoes: ["a", "b"] } });
    expect(q.c.criteria).toEqual({ a: null, b: null });
    expect(lerResposta(q.c, { type: "choice", choice: "b", probabilities: { a: 0.3, b: 0.7 } })).toMatchObject({ valor: "b", probabilidade: 0.7 });
  });
});

describe("jev.criarFila", () => {
  it("um erro não trava a fila", async () => {
    const fila = criarFila(1);
    const a = fila(async () => {
      throw new Error("x");
    });
    const b = fila(async () => 2);
    await expect(a).rejects.toThrow("x");
    await expect(b).resolves.toBe(2);
  });
});
