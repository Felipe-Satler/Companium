/**
 * Experimento JEV (apps/ad-spy-worker/experimentos/jev): a parte pura.
 *
 * O que estes testes prendem é o que faria o experimento mentir sem erro aparente: cópias contando
 * como anúncios independentes, a confiança de uma pergunta sumindo, um gabarito salvo pelo Excel em
 * português lido torto, e um perguntas.json quebrado só descoberto depois de pagar a rodada.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  celulaDoJev,
  celulaDoLlm,
  concorda,
  confianca,
  correlacao,
  deduplicar,
  emParalelo,
  esperaMs,
  lerCsv,
  lerRespostas,
  lerRotuloHumano,
  linhaCsv,
  notaComposta,
  resolverDecisao,
  respostasDoGabarito,
  esquemaRotulos,
  topN,
  validarPerguntas,
} from "../../apps/ad-spy-worker/experimentos/jev/jev-lib.js";

const perguntasReais = JSON.parse(
  // Pela raiz do projeto: no ambiente jsdom, import.meta.url não é uma URL de arquivo.
  readFileSync(path.resolve(process.cwd(), "apps/ad-spy-worker/experimentos/jev/perguntas.json"), "utf8"),
);

describe("corpus", () => {
  it("cópias viram uma peça só, com o maior tempo no ar; sem texto fica de fora", () => {
    const texto = "Harmonização facial com resultado natural, agende sua avaliação hoje";
    const { pecas, semTexto } = deduplicar([
      { id: 1, ad_copy: texto, days_running: 10 },
      { id: 2, ad_copy: `  ${texto.toUpperCase()}!! `, days_running: 90 },
      { id: 3, ad_copy: "oi" },
      { id: 4, ad_copy: "Outro anúncio, bem diferente do primeiro, sobre lentes" },
    ]);
    expect(pecas).toHaveLength(2);
    expect(pecas[0]).toMatchObject({ ids: [1, 2], dias: 90 });
    expect(semTexto).toBe(1);
  });

  it("título, copy e transcrição entram rotulados no texto que o JEV lê", () => {
    const { pecas } = deduplicar([{ id: 1, title: "Antes e depois", ad_copy: "copy do anúncio aqui", transcript: "fala do vídeo" }]);
    expect(pecas[0].estado).toBe("Título: Antes e depois\n\nTexto do anúncio: copy do anúncio aqui\n\nTranscrição do vídeo: fala do vídeo");
    expect(pecas[0].temTranscricao).toBe(true);
  });
});

describe("perguntas", () => {
  it("o perguntas.json do repositório é válido", () => {
    expect(validarPerguntas(perguntasReais)).toEqual([]);
  });

  it("acusa formato quebrado antes de gastar", () => {
    const erros = validarPerguntas({
      perguntas: { "Gancho!": { type: "choice", instructions: "x", criteria: { a: "só uma" } } },
      nota: { pesos: { inexistente: 1, "Gancho!": 0.5 } },
    });
    expect(erros.join(" | ")).toMatch(/a-z/);
    expect(erros.join(" | ")).toMatch(/2\+ opções/);
    expect(erros.join(" | ")).toMatch(/inexistente/);
    expect(erros.join(" | ")).toMatch(/choice não entra na nota/);
  });
});

describe("chamadas", () => {
  it("respeita o Retry-After; sem ele, exponencial com jitter e teto", () => {
    expect(esperaMs(0, "2")).toBe(2000);
    expect(esperaMs(0, "999")).toBe(60_000);
    expect(esperaMs(0, null, () => 0)).toBe(250);
    expect(esperaMs(3, null, () => 1)).toBe(4000);
    expect(esperaMs(20, null, () => 1)).toBe(30_000);
    // Cabeçalho ausente NÃO é "espere zero" (Number(null) === 0 fazia exatamente isso).
    expect(esperaMs(0, null, () => 1)).toBe(500);
    expect(esperaMs(0, "", () => 1)).toBe(500);
    // Retry-After em formato de data.
    const agora = Date.parse("2026-10-12T12:00:00Z");
    expect(esperaMs(0, "Mon, 12 Oct 2026 12:00:05 GMT", () => 0, agora)).toBe(5000);
  });

  it("nunca passa do limite de chamadas em paralelo, e devolve na ordem", async () => {
    let agora = 0;
    let pico = 0;
    const r = await emParalelo([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, async (x) => {
      agora += 1;
      pico = Math.max(pico, agora);
      await new Promise((ok) => setTimeout(ok, 5));
      agora -= 1;
      return x * 2;
    });
    expect(pico).toBe(3);
    expect(r).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
  });
});

describe("respostas", () => {
  const p = perguntasReais.perguntas;
  const answers = {
    prova_concreta: { type: "boolean", probability: 0.1 },
    gancho: { type: "choice", choice: "dor_direta", probabilities: { dor_direta: 0.7, pergunta: 0.3 } },
    especificidade: { type: "score", score: 1.8, probabilities: { "0": 0.05, "1": 0.15, "2": 0.8 } },
  };

  it("lê os três tipos; score vira nota 0..1 e mantém a confiança", () => {
    const r = lerRespostas(answers, p);
    expect(r.prova_concreta).toEqual({ tipo: "boolean", p: 0.1 });
    expect(r.gancho).toMatchObject({ escolha: "dor_direta", p: 0.7 });
    // A confiança do score sumia com Math.max(..., NaN) — o "por confiança" do comparar vinha vazio.
    expect(r.especificidade).toMatchObject({ score: 1.8, norm: 0.9, p: 0.8 });
    expect(r.mostra_resultado).toBeNull();
  });

  it("confiança do boolean é a distância do 0,5: p=0,1 é um 'não' confiante", () => {
    expect(confianca({ tipo: "boolean", p: 0.1 })).toBe(0.9);
  });

  it("nota composta conta o que faltou", () => {
    const r = lerRespostas(answers, p);
    const { nota, faltando } = notaComposta(r, { especificidade: 0.5, prova_concreta: 0.5, mostra_resultado: 1 });
    expect(nota).toBeCloseTo((0.5 * 0.9 + 0.5 * 0.1) / 2);
    expect(faltando).toBe(1);
  });

  it("top N não repete texto", () => {
    const top = topN(
      [
        { estado: "Mesmo texto!", nota: 0.9 },
        { estado: "mesmo   texto", nota: 0.8 },
        { estado: "outro", nota: 0.5 },
      ],
      10,
    );
    expect(top.map((x) => x.nota)).toEqual([0.9, 0.5]);
  });
});

describe("gabarito", () => {
  it("rótulo humano: aceita sim/não/opção/nível; inválido é undefined, vazio é null", () => {
    const p = perguntasReais.perguntas;
    expect(lerRotuloHumano("Sim", p.prova_concreta)).toBe(true);
    expect(lerRotuloHumano("não", p.prova_concreta)).toBe(false);
    expect(lerRotuloHumano("talvez", p.prova_concreta)).toBeUndefined();
    expect(lerRotuloHumano("", p.prova_concreta)).toBeNull();
    expect(lerRotuloHumano("dor_direta", p.gancho)).toBe("dor_direta");
    expect(lerRotuloHumano("3", p.especificidade)).toBeUndefined();
    expect(lerRotuloHumano("2", p.especificidade)).toBe(2);
  });

  it("concordância: boolean corta em 0,5; score arredonda", () => {
    expect(concorda({ tipo: "boolean", p: 0.7 }, true, { type: "boolean" })).toBe(true);
    expect(concorda({ tipo: "score", score: 1.6 }, 2, { type: "score" })).toBe(true);
    expect(concorda(null, true, { type: "boolean" })).toBeNull();
  });

  it("lê o CSV que nós gravamos E o que o Excel em português salva (;), com vírgula no texto", () => {
    const nosso = `${linhaCsv(["chave", "texto", "gancho"])}\n${linhaCsv(["k1", 'Olá, "doutora"', "pergunta"])}\n`;
    expect(lerCsv(nosso)).toEqual([{ chave: "k1", texto: 'Olá, "doutora"', gancho: "pergunta" }]);
    const excel = "﻿chave;texto;gancho\r\nk1;Olá, tudo bem, doutora;pergunta\r\n";
    expect(lerCsv(excel)).toEqual([{ chave: "k1", texto: "Olá, tudo bem, doutora", gancho: "pergunta" }]);
  });
});

describe("estatística", () => {
  it("correlação: perfeita, inversa, e nula quando não há o que medir", () => {
    expect(correlacao([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
    expect(correlacao([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1);
    expect(correlacao([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(correlacao([1, 2], [1, 2])).toBeNull();
  });
});

describe("referência pelo Claude e revisão das discordâncias", () => {
  const p = perguntasReais.perguntas;

  it("o schema restringe cada pergunta às mesmas opções do gabarito humano", () => {
    const s = esquemaRotulos(p);
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(Object.keys(p));
    expect(s.properties.prova_concreta).toEqual({ type: "boolean" });
    expect(s.properties.gancho.enum).toContain("nenhum");
    // Nota como string: enum de string é o que a saída estruturada aceita com segurança.
    expect(s.properties.especificidade).toEqual({ type: "string", enum: ["0", "1", "2"] });
  });

  it("as respostas dos dois lados viram células no formato humano", () => {
    expect(celulaDoLlm(true, p.prova_concreta)).toBe("sim");
    expect(celulaDoLlm(false, p.prova_concreta)).toBe("não");
    expect(celulaDoLlm(undefined, p.gancho)).toBe("");
    expect(celulaDoJev({ tipo: "boolean", p: 0.3 }, p.prova_concreta)).toBe("não");
    expect(celulaDoJev({ tipo: "score", score: 1.6 }, p.especificidade)).toBe("2");
    // E a célula do Claude lê de volta como rótulo válido — o comparar não muda.
    expect(lerRotuloHumano(celulaDoLlm(false, p.prova_concreta), p.prova_concreta)).toBe(false);
  });

  it("decisão: atalhos jev/llm, valor direto, vazio e inválido", () => {
    const lados = { jev: "sim", llm: "não" };
    expect(resolverDecisao("jev", lados, p.prova_concreta)).toBe("sim");
    expect(resolverDecisao("LLM", lados, p.prova_concreta)).toBe("não");
    expect(resolverDecisao("claude", lados, p.prova_concreta)).toBe("não");
    expect(resolverDecisao("não", lados, p.prova_concreta)).toBe("não");
    expect(resolverDecisao("", lados, p.prova_concreta)).toBeNull();
    expect(resolverDecisao("talvez", lados, p.prova_concreta)).toBeUndefined();
  });
});

describe("longevidade com rótulos de gabarito", () => {
  it("rótulo vira resposta certa (probabilidade 1 ou 0), vazio e inválido viram null", () => {
    const p = perguntasReais.perguntas;
    const r = respostasDoGabarito(
      { prova_concreta: "sim", autoridade: "não", gancho: "oferta", especificidade: "2", trata_objecao: "talvez" },
      p,
    );
    expect(r.prova_concreta).toEqual({ tipo: "boolean", p: 1 });
    expect(r.autoridade).toEqual({ tipo: "boolean", p: 0 });
    expect(r.gancho).toMatchObject({ escolha: "oferta", probs: { oferta: 1 } });
    expect(r.especificidade).toMatchObject({ score: 2, norm: 1 });
    expect(r.trata_objecao).toBeNull();
    expect(r.cta_explicito).toBeNull();
  });
});
