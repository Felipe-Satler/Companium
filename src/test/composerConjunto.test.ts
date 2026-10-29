// O percurso inteiro de uma composição de vários anúncios, com o agente e o banco trocados por
// dublês: a ordem das chamadas, o que é gravado a cada anúncio e o que acontece quando um falha.
// É o que a tela lê para dizer "2 de 3" — e não aparece em nenhum teste de prompt ou de componente.
import { describe, it, expect, vi, beforeEach } from "vitest";

const runAgentCli = vi.fn();
const patchComposition = vi.fn();
const getComposition = vi.fn();

vi.mock("../../apps/ad-spy-worker/agent-cli.js", () => ({
  runAgentCli: (...a: unknown[]) => runAgentCli(...a),
}));
vi.mock("../../apps/ad-spy-worker/config.js", () => ({
  COMPOSER_AGENT_ID: "composeragent",
  COMPOSER_RUN_TIMEOUT_MS: 1000,
  MAX_COMPOSER_CHARS: 80000,
}));
vi.mock("../../apps/ad-spy-worker/briefs.js", () => ({
  coletarFichas: async () => ({
    clientes: [{ padrao: "jose_ramos", nome: "Dr. José Ramos", chaves: [], plano: "Escala" }],
    espPor: new Map(),
  }),
  mesesDeCasa: () => 18,
}));
vi.mock("../../apps/ad-spy-worker/clickup.js", () => ({ conteudoDoDocumento: async () => null }));
vi.mock("../../apps/ad-spy-worker/db.js", () => ({
  getBrief: async () => null,
  getLibraryEntry: async () => null,
  getReport: async () => null,
  patchComposition: (...a: unknown[]) => patchComposition(...a),
  getComposition: (...a: unknown[]) => getComposition(...a),
  getCriativo: async () => null,
}));

import { revisarAnuncio, runComposition } from "../../apps/ad-spy-worker/composer.js";
import {
  comVersaoAnterior,
  normalizarCampos,
  tirarUltimaVersao,
} from "../../apps/ad-spy-worker/composer-conjunto.js";
import { buildRevisaoPrompt } from "../../apps/ad-spy-worker/composer-prompt.js";
import { destravarRevisao } from "../../apps/ad-spy-worker/orfas.js";

const bloco = (obj: unknown) => ["Prosa.", "", "```json", JSON.stringify(obj), "```"].join("\n");
const GOOGLE = { headlines: ["a", "b", "c"], descriptions: ["x", "y"] };
const STORIES = {
  sequencia: ["1", "2", "3"],
  texto_na_tela: ["1", "2", "3"],
  cta: "Agende",
  direcao_visual: "Consultório.",
};

type Patch = { status?: string; plano?: { status: string }[]; anuncios?: { status: string; error: string | null }[] };
const gravacoes = () => patchComposition.mock.calls.map((c) => c[1] as Patch);

describe("runComposition — conjunto de anúncios", () => {
  beforeEach(() => {
    runAgentCli.mockReset();
    patchComposition.mockReset().mockResolvedValue(undefined);
  });

  it("uma chamada por anúncio, e o conjunto inteiro é gravado já na primeira", async () => {
    runAgentCli
      .mockResolvedValueOnce({
        finalText: bloco({
          anuncios: [
            { formato: "google_ads", angulo: "busca" },
            { formato: "instagram_stories", angulo: "medo" },
            { formato: "instagram_stories", angulo: "rotina" },
          ],
          campos: GOOGLE,
        }),
      })
      .mockResolvedValue({ finalText: bloco({ campos: STORIES }) });

    await runComposition({ id: "c1", cliente: "jose_ramos", extraPrompt: "três anúncios" });

    expect(runAgentCli).toHaveBeenCalledTimes(3);
    // Sessão nova por chamada: sessão viva reaproveitada faz o Gateway abortar o turno.
    const sessoes = runAgentCli.mock.calls.map((c) => (c[0] as { sessionId: string }).sessionId);
    expect(new Set(sessoes).size).toBe(3);

    const [primeira, ...resto] = gravacoes();
    expect(primeira.plano?.map((p) => p.status)).toEqual(["ok", "pendente", "pendente"]);
    // Só sai de `running` na última gravação: até lá a tela precisa continuar perguntando.
    expect(primeira.status).toBeUndefined();
    expect(resto.slice(0, -1).every((g) => g.status === undefined)).toBe(true);
    const ultima = resto[resto.length - 1];
    // Pronta = em revisão: desde 19/10/2026 nada fica salvo sem alguém rever.
    expect(ultima.status).toBe("revisao");
    expect(ultima.plano?.map((p) => p.status)).toEqual(["ok", "ok", "ok"]);
  });

  it("um anúncio que falha fica marcado, e os outros seguem", async () => {
    runAgentCli
      .mockResolvedValueOnce({
        finalText: bloco({
          anuncios: [{ formato: "google_ads" }, { formato: "instagram_stories" }, { formato: "google_ads" }],
          campos: GOOGLE,
        }),
      })
      .mockRejectedValueOnce(new Error("tempo esgotado"))
      .mockResolvedValueOnce({ finalText: bloco({ campos: GOOGLE }) });

    await runComposition({ id: "c1", cliente: "jose_ramos" });

    const ultima = gravacoes().at(-1)!;
    // Pronta = em revisão: desde 19/10/2026 nada fica salvo sem alguém rever.
    expect(ultima.status).toBe("revisao");
    expect(ultima.anuncios?.map((a) => a.status)).toEqual(["ok", "error", "ok"]);
    expect(ultima.anuncios?.[1].error).toBe("tempo esgotado");
  });

  it("agente no contrato anterior continua dando UM anúncio, numa chamada só", async () => {
    runAgentCli.mockResolvedValueOnce({
      finalText: bloco({ formato: "google_ads", formato_justificativa: "busca", campos: GOOGLE }),
    });

    await runComposition({ id: "c1", cliente: "jose_ramos" });

    expect(runAgentCli).toHaveBeenCalledTimes(1);
    const ultima = gravacoes().at(-1) as Patch & { anuncios: { formato: string; composicao: unknown }[] };
    // Pronta = em revisão: desde 19/10/2026 nada fica salvo sem alguém rever.
    expect(ultima.status).toBe("revisao");
    expect(ultima.anuncios).toHaveLength(1);
    expect(ultima.anuncios[0].formato).toBe("google_ads");
    expect(ultima.anuncios[0].composicao).toEqual(GOOGLE);
  });

  it("cancelada no meio: os prontos ficam, os que faltam viram erro, e não escreve mais nada", async () => {
    const controller = new AbortController();
    runAgentCli
      .mockResolvedValueOnce({
        finalText: bloco({
          anuncios: [{ formato: "google_ads" }, { formato: "instagram_stories" }, { formato: "google_ads" }],
          campos: GOOGLE,
        }),
      })
      .mockImplementationOnce(async () => {
        controller.abort();
        throw new Error("subprocesso encerrado");
      });

    await expect(
      runComposition({ id: "c1", cliente: "jose_ramos", signal: controller.signal }),
    ).rejects.toThrow(/cancelada/i);

    expect(runAgentCli).toHaveBeenCalledTimes(2);
    const ultima = gravacoes().at(-1) as Patch & { error: string };
    // Pronta = em revisão: desde 19/10/2026 nada fica salvo sem alguém rever.
    expect(ultima.status).toBe("revisao");
    expect(ultima.error).toMatch(/^Cancelada/);
    expect(ultima.anuncios?.map((a) => a.status)).toEqual(["ok", "error", "error"]);
  });
});

describe("revisão — editar, revisar, desfazer", () => {
  it("normaliza a edição pela spec e recalcula os avisos", () => {
    const r = normalizarCampos("google_ads", {
      headlines: ["  Varizes sem cirurgia  ", "", "Tratamento de varizes sem cirurgia"],
      descriptions: ["Agende."],
      inventado: "fora da spec",
    });
    expect(r?.composicao).toEqual({
      headlines: ["Varizes sem cirurgia", "Tratamento de varizes sem cirurgia"],
      descriptions: ["Agende."],
    });
    // 34 > 30: o aviso volta, para a tela mostrar "34/30" no que a pessoa acabou de escrever.
    expect(r?.avisos.some((a: { tipo: string }) => a.tipo === "excede_limite_rigido")).toBe(true);
    expect(normalizarCampos("formato_que_nao_existe", {})).toBeNull();
  });

  it("guarda a versão anterior e o desfazer devolve a mais recente DAQUELE anúncio", () => {
    let versoes: unknown[] = [];
    versoes = comVersaoAnterior(versoes, { indice: 0, anuncio: { composicao: { a: "v1" } }, motivo: "edicao" });
    versoes = comVersaoAnterior(versoes, { indice: 1, anuncio: { composicao: { b: "x" } }, motivo: "revisao" });
    versoes = comVersaoAnterior(versoes, { indice: 0, anuncio: { composicao: { a: "v2" } }, motivo: "revisao" });

    const { versao, resto } = tirarUltimaVersao(versoes, 0);
    expect(versao.composicao).toEqual({ a: "v2" });
    expect(resto).toHaveLength(2);
    expect(tirarUltimaVersao(resto, 0).versao.composicao).toEqual({ a: "v1" });
    expect(tirarUltimaVersao([], 3).versao).toBeNull();
  });

  it("o prompt de revisão leva a versão ATUAL, o pedido e só a spec do formato", () => {
    const prompt = buildRevisaoPrompt({
      ficha: { nome: "Dr. José Ramos" },
      plano: [{ formato: "google_ads", angulo: "busca" }, { formato: "instagram_stories", angulo: "medo" }],
      indice: 0,
      atual: { headlines: ["Editado à mão"], descriptions: ["x"] },
      pedido: "título mais direto",
    });
    expect(prompt).toContain("Editado à mão");
    expect(prompt).toContain("título mais direto");
    expect(prompt).toContain("REVISE este anúncio");
    expect(prompt).toContain("`headlines`");
    expect(prompt).not.toContain("`sequencia`");
  });

  const linha = (anuncios: object[], versoes: object[] = []) => ({
    id: "c1",
    cliente: "jose_ramos",
    library_entry_id: null,
    entradas: [],
    extra_prompt: null,
    status: "revisao",
    anuncios,
    versoes,
  });
  const pronto = (composicao: object, extra: object = {}) => ({
    formato: "google_ads",
    angulo: null,
    status: "ok",
    composicao,
    avisos: [],
    error: null,
    ...extra,
  });

  beforeEach(() => {
    runAgentCli.mockReset();
    patchComposition.mockReset().mockResolvedValue(undefined);
    getComposition.mockReset();
  });

  it("revisão troca SÓ aquele anúncio, relendo a linha, e empilha a versão anterior", async () => {
    const original = linha([pronto(GOOGLE), pronto(GOOGLE)]);
    // Enquanto o agente revisava o anúncio 1, alguém editou o 2 à mão: a gravação não pode apagar.
    const editadaNoMeio = linha([pronto(GOOGLE, { status: "running" }), pronto({ headlines: ["editado"] })]);
    getComposition.mockResolvedValue(editadaNoMeio);
    runAgentCli.mockResolvedValue({ finalText: bloco({ campos: { headlines: ["novo", "b", "c"], descriptions: ["x", "y"] } }) });

    await revisarAnuncio({ composicao: original, indice: 0, pedido: "mais direto", userId: "u1" });

    const patch = patchComposition.mock.calls.at(-1)![1];
    expect(patch.anuncios[0]).toMatchObject({ status: "ok", error: null, ultima_revisao: "mais direto" });
    expect(patch.anuncios[0].composicao.headlines[0]).toBe("novo");
    expect(patch.anuncios[1].composicao).toEqual({ headlines: ["editado"] });
    expect(patch.versoes).toHaveLength(1);
    expect(patch.versoes[0]).toMatchObject({ indice: 0, motivo: "revisao", por: "u1" });
  });

  it("revisão que falha devolve o anúncio como estava, com o motivo, e não empilha versão", async () => {
    const original = linha([pronto(GOOGLE)]);
    getComposition.mockResolvedValue(linha([pronto(GOOGLE, { status: "running" })]));
    runAgentCli.mockRejectedValue(new Error("tempo esgotado"));

    await revisarAnuncio({ composicao: original, indice: 0, pedido: "x" });

    const patch = patchComposition.mock.calls.at(-1)![1];
    expect(patch.anuncios[0].status).toBe("ok");
    expect(patch.anuncios[0].composicao).toEqual(GOOGLE);
    expect(patch.anuncios[0].error).toMatch(/revisão falhou.*tempo esgotado/);
    expect(patch.versoes).toEqual([]);
  });

  it("revisão interrompida por reinício volta a ok com o conteúdo intacto", () => {
    const r = destravarRevisao([pronto(GOOGLE, { status: "running" }), pronto(GOOGLE)]);
    expect(r.anuncios.map((a: { status: string }) => a.status)).toEqual(["ok", "ok"]);
    expect(r.anuncios[0].composicao).toEqual(GOOGLE);
    expect(r.anuncios[0].error).toMatch(/interrompida/);
  });
});
