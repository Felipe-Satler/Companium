// O orquestrador em duas camadas: as decisões que ele lê e escreve (prompts e parsers, puros) e o
// percurso inteiro com os agentes e o banco trocados por dublês — que análise é usada, quando se
// minera, e o que acontece quando a mineração falha no meio.
import { describe, it, expect, vi, beforeEach } from "vitest";

const runAgentCli = vi.fn();
const patchOrquestracao = vi.fn();
const insertComposition = vi.fn();
const runComposition = vi.fn();
const insertRun = vi.fn();
const searchBlock = vi.fn();
const analyzeSelected = vi.fn();
const getRun = vi.fn();
const listAds = vi.fn();
const setSelection = vi.fn();
const salvarRunNaBiblioteca = vi.fn();
const coletarComMetricas = vi.fn();
const patchComposition = vi.fn();
const listOrquestracoesRodando = vi.fn();
const listComposicoesRodando = vi.fn();
const listClientDocPages = vi.fn();
const listCriativos = vi.fn();
const getComposition = vi.fn();
const rodarConceitos = vi.fn();
const conduzirSozinho = vi.fn();

const PAGINAS = [
  { page_id: "e1", nome: "Estudo de Copy – Dr. José Ramos", conteudo_lido_em: "x", conteudo_chars: 12000, tipo: "outro", doc: { local: "Clientes" } },
  { page_id: "d1", nome: "Estratégia 2026", conteudo_lido_em: "x", conteudo_chars: 900, tipo: "estrategia", doc: { local: "Clientes" } },
  // A página do cliente na Central de Copy: obrigatória desde 26/10/2026.
  { page_id: "r9", nome: "Resumo Estratégico", caminho: ["Central de Copy - Dr. José Ramos"], conteudo_lido_em: "x", conteudo_chars: 3000, tipo: "outro", doc: { local: "Central de Copy" } },
];
const CRIATIVOS = [
  { id: "c-recente", status: "done", titulo: "Recente" },
  { id: "c-rodando", status: "running", titulo: "Ainda rodando" },
  { id: "c-favorita", status: "done", titulo: "Favorita" },
];
const SLOTS = [{ n: 0, formato_saida: "instagram_reels", status: "aprovado", conceito: { avatar_id: "A1" } }];

const FICHAS = {
  clientes: [{ padrao: "jose_ramos", nome: "Dr. José Ramos", chaves: ["jose ramos"], plano: "Escala" }],
  espPor: new Map([["jose ramos", ["Cirurgia Vascular"]]]),
};
const SEMANA = { de: "2026-09-28", ate: "2026-10-04", deAnterior: "2026-09-21", ateAnterior: "2026-09-27" };
const linha = (consultas: number) => ({
  investimento: 3000, leadsTrafego: 60, leadsCRM: 48, consultasAgendadas: consultas, faturamentoBruto: 18000,
});
const ANALISE = {
  id: "lib-1", titulo: "Varizes — ângulos", tema: "varizes", especialidades: ["Cirurgia Vascular"],
  criado_em: "2026-09-20T00:00:00Z", analysis_md: "Os longevos abrem pelo medo da cirurgia.", ads: [{}, {}],
};
const RELATORIO = { id: "r1", titulo: "Setembro", status: "ok", periodo_de: "2026-09-01", periodo_ate: "2026-09-30", relatorio_md: "Agendamento caiu." };

vi.mock("../../apps/ad-spy-worker/agent-cli.js", () => ({ runAgentCli: (...a: unknown[]) => runAgentCli(...a) }));
vi.mock("../../apps/ad-spy-worker/config.js", () => ({
  COMPOSER_AGENT_ID: "composeragent", MAX_EXTRA_PROMPT_CHARS: 4000, MAX_ORQUESTRADOR_CHARS: 60000,
  ORQ_ESPERA_ANALISE_MS: 0, ORQ_MAX_BUSCAS: 2, ORQ_MAX_SELECIONADOS: 10,
  ORQUESTRADOR_AGENT_ID: "orquestradoragent", ORQUESTRADOR_RUN_TIMEOUT_MS: 1000,
  PERGUNTA_AGENT_ID: "perguntaagent", PERGUNTA_RUN_TIMEOUT_MS: 1000,
  PESQUISA_AGENT_ID: "pesquisaagent", PESQUISA_RUN_TIMEOUT_MS: 1000,
}));
vi.mock("../../apps/ad-spy-worker/briefs.js", () => ({
  coletarComMetricas: (...a: unknown[]) => coletarComMetricas(...a),
  coletarFichas: async () => FICHAS,
  mesesDeCasa: () => 18,
}));
vi.mock("../../apps/ad-spy-worker/biblioteca.js", () => ({
  salvarRunNaBiblioteca: (...a: unknown[]) => salvarRunNaBiblioteca(...a),
}));
vi.mock("../../apps/ad-spy-worker/composer.js", () => ({ runComposition: (...a: unknown[]) => runComposition(...a) }));
vi.mock("../../apps/ad-spy-worker/conceitos-servico.js", () => ({
  rodarConceitos: (...a: unknown[]) => rodarConceitos(...a),
  depsDeConceitos: () => ({}),
  esperarFila: async () => {},
}));
vi.mock("../../apps/ad-spy-worker/composer-conceitos.js", () => ({
  conduzirSozinho: (...a: unknown[]) => conduzirSozinho(...a),
}));
vi.mock("../../apps/ad-spy-worker/runner.js", () => ({
  analyzeSelected: (...a: unknown[]) => analyzeSelected(...a),
  hasAnalysisCapacity: () => true,
  searchBlock: (...a: unknown[]) => searchBlock(...a),
}));
vi.mock("../../apps/ad-spy-worker/pergunta.js", () => ({
  MAX_PERGUNTA_ADS: 160,
  runPergunta: async () => ({ status: "done", respostas: { "1": { veredito: "atende" }, "2": { veredito: "nao" } } }),
}));
vi.mock("../../apps/ad-spy-worker/db.js", () => ({
  getBrief: async () => ({ brief_md: "Cliente de vascular." }),
  getComposition: (...a: unknown[]) => getComposition(...a),
  getLibraryEntry: async () => ANALISE,
  getReport: async () => RELATORIO,
  getRun: (...a: unknown[]) => getRun(...a),
  insertComposition: (...a: unknown[]) => insertComposition(...a),
  insertRun: (...a: unknown[]) => insertRun(...a),
  listAds: (...a: unknown[]) => listAds(...a),
  listClientDocPages: (...a: unknown[]) => listClientDocPages(...a),
  listCriativos: (...a: unknown[]) => listCriativos(...a),
  listFavoritosCriativos: async () => new Set(["c-favorita"]),
  listLibrary: async () => [ANALISE],
  listReports: async () => [RELATORIO],
  patchComposition: (...a: unknown[]) => patchComposition(...a),
  listOrquestracoesRodando: (...a: unknown[]) => listOrquestracoesRodando(...a),
  listComposicoesRodando: (...a: unknown[]) => listComposicoesRodando(...a),
  patchOrquestracao: (...a: unknown[]) => patchOrquestracao(...a),
  patchRun: async () => {},
  setSelection: (...a: unknown[]) => setSelection(...a),
}));

import {
  OrquestracaoCancelada,
  orquestracaoAoConfirmar,
  orquestracaoAoFalhar,
  orquestracaoAoTerminar,
  runOrquestracao,
  numerosDoCliente,
  ordenarCandidatas,
  semearEtapas,
} from "../../apps/ad-spy-worker/orquestrador.js";
import { MOTIVO_REINICIO, fecharComposicao, fecharEtapas, fecharOrfas } from "../../apps/ad-spy-worker/orfas.js";
import {
  blocoNumeros,
  buildBriefingPrompt,
  buildPlanoPrompt,
  ordenarTermos,
  parseBriefingReply,
  parsePlanoReply,
  selecionarPecas,
} from "../../apps/ad-spy-worker/orquestrador-prompt.js";

const bloco = (obj: unknown, prosa = "Prosa.") => [prosa, "", "```json", JSON.stringify(obj), "```"].join("\n");

describe("orquestrador — decisões", () => {
  it("mostra as duas semanas com a variação, e travessão onde não há dado", () => {
    const txt = blocoNumeros({ semana: SEMANA, atual: { ...linha(6), roas: 6 }, anterior: { ...linha(12), roas: null } });
    expect(txt).toContain("2026-09-28 a 2026-10-04");
    expect(txt).toMatch(/Consultas agendadas: 6 \(anterior: 12; variação: -50,0%\)/);
    expect(txt).toMatch(/ROAS: 6,00x \(anterior: —; variação: —\)/);
  });

  it("sem números, diz que não há — em vez de mandar zeros", () => {
    const txt = blocoNumeros({ motivo: "CRM fora do ar" });
    expect(txt).toContain("CRM fora do ar");
    expect(txt).toContain("NÃO suponha desempenho");
  });

  it("o prompt do plano leva os ids que ele pode escolher", () => {
    const p = buildPlanoPrompt({
      ficha: { nome: "Dr. José Ramos" },
      relatorios: [RELATORIO],
      documentos: [{ id: "d1", nome: "Estratégia 2026" }],
      analises: [ANALISE],
      pedido: "só Stories",
    });
    expect(p).toContain("id: r1");
    expect(p).toContain("id: d1");
    expect(p).toContain("id: lib-1");
    expect(p).toContain("só Stories");
    expect(p).toContain('"mineracao"');
  });

  it("descarta id que não foi oferecido: é o que impede material de outro cliente", () => {
    const plano = parsePlanoReply(
      bloco({
        abordagem: "Qualificar.",
        analise: { usar: "lib-de-outro", motivo: "x" },
        relatorios: [{ id: "r1", motivo: "período" }, { id: "r-de-outro" }, { id: "r1" }],
        documentos: [{ id: "d9" }],
      }),
      { relatorios: [RELATORIO], documentos: [{ id: "d1" }], analises: [ANALISE] },
    );
    expect(plano.analise.id).toBeNull();
    expect(plano.relatorios).toEqual([{ id: "r1", motivo: "período" }]);
    expect(plano.documentos).toEqual([]);
  });

  it("com análise escolhida, a mineração pedida junto é ignorada", () => {
    const plano = parsePlanoReply(
      bloco({ analise: { usar: "lib-1" }, mineracao: { nicho: "varizes" } }),
      { analises: [ANALISE] },
    );
    expect(plano.analise.id).toBe("lib-1");
    expect(plano.mineracao).toBeNull();
  });

  it("sem bloco, o plano é compor só com o Contexto — e o diagnóstico continua valendo", () => {
    const plano = parsePlanoReply("Só o diagnóstico.");
    expect(plano.semBlocoJson).toBe(true);
    expect(plano.usarContexto).toBe(true);
    expect(plano.diagnosticoMd).toContain("Só o diagnóstico");
  });

  it("o pedido ao Composer leva a análise e o teto de anúncios, e é lido de volta", () => {
    const p = buildBriefingPrompt({ ficha: { nome: "X" }, diagnosticoMd: "Caiu o agendamento.", analise: ANALISE });
    expect(p).toContain("medo da cirurgia");
    expect(p).toContain("de 1 a 8");
    expect(buildBriefingPrompt({ ficha: { nome: "X" } })).toContain("vai SEM análise");
    expect(parseBriefingReply(bloco({ pedido: "Dois Stories." })).pedido).toBe("Dois Stories.");
    expect(parseBriefingReply("sem bloco").pedido).toBeNull();
  });

  it("tenta primeiro a palavra-chave que o agente de pesquisa VIU, e o nicho fecha a fila", () => {
    const fila = ordenarTermos(
      [{ termo: "varizes laser", confianca: "palpite" }, { termo: "Varizes", confianca: "visto" }],
      "varizes",
    );
    expect(fila).toEqual(["Varizes", "varizes laser"]);
    expect(ordenarTermos([], "tratamento de varizes")).toEqual(["tratamento de varizes"]);
  });

  it("escolhe as peças que atendem, pela longevidade — e completa um mínimo quando são poucas", () => {
    const ads = [
      { id: 1, days_running: 10 }, { id: 2, days_running: 200 }, { id: 3, days_running: 90 },
      { id: 4, days_running: 50 }, { id: 5, days_running: 5 },
    ];
    const respostas = { "1": { veredito: "atende" }, "3": { veredito: "atende" }, "4": { veredito: "parcial" }, "5": { veredito: "atende" }, "2": { veredito: "nao" } };
    expect(selecionarPecas(ads, respostas)).toEqual([3, 1, 5, 4]);
    // Só uma atende: com menos de 4 a análise seria a leitura de um anúncio, então entra o resto.
    expect(selecionarPecas(ads, { "5": { veredito: "atende" } })).toEqual([5, 2, 3, 4]);
    // Sem pergunta respondida, vale só a longevidade.
    expect(selecionarPecas(ads, {}, { max: 2 })).toEqual([2, 3]);
  });

  it("soma as chaves do cliente, e sem nenhuma devolve null em vez de zeros", () => {
    const mapa = new Map([["a", linha(4)], ["b", linha(2)]]);
    const n = numerosDoCliente(mapa, ["a", "b", "c"]);
    expect(n.consultasAgendadas).toBe(6);
    expect(n.roas).toBe(6);
    expect(numerosDoCliente(mapa, ["z"])).toBeNull();
  });

  it("leitura de anúncios vazia para a carteira inteira vira travessão, não R$ 0,00", () => {
    // Foi o que aconteceu em produção: a view de anúncios não devolvia linha ao worker, o CRM sim,
    // e todo cliente aparecia com investimento zero ao lado do faturamento real.
    const mapa = new Map([["a", { ...linha(4), investimento: 0, leadsTrafego: 0 }]]);
    const n = numerosDoCliente(mapa, ["a"], { crm: true, ads: false });
    expect(n.investimento).toBeNull();
    expect(n.leadsTrafego).toBeNull();
    expect(n.roas).toBeNull();
    expect(n.faturamentoBruto).toBe(18000);
    expect(blocoNumeros({ semana: SEMANA, atual: n, anterior: n })).toMatch(/Investimento em anúncios: — \(anterior: —/);
  });

  it("candidata do segmento do cliente vem antes de uma mais recente de outro", () => {
    const ordem = ordenarCandidatas(
      [
        { id: "capilar", especialidades: ["Capilar"], criado_em: "2026-10-01" },
        { id: "vascular", especialidades: ["Cirurgia Vascular"], criado_em: "2026-01-01" },
      ],
      ["Cirurgia Vascular"],
    ).map((e: { id: string }) => e.id);
    expect(ordem).toEqual(["vascular", "capilar"]);
  });
});

describe("runOrquestracao — o percurso", () => {
  type Patch = { status?: string; etapas?: { key: string; status: string; note: string | null }[]; decisoes?: Record<string, unknown>; perguntas?: { para: string }[] };
  const ultima = () => patchOrquestracao.mock.calls.at(-1)![1] as Patch;
  const etapa = (key: string) => ultima().etapas!.find((e) => e.key === key)!;
  const rodar = (signal?: AbortSignal, pularRevisao = false) =>
    runOrquestracao({ id: "orq-12345678", cliente: "jose_ramos", userId: "u1", userName: "Ana", settingsDaBusca: {}, metaProvider: "x", pausaMs: 0, signal, pularRevisao });

  /** O agente de mentira: responde pelo que o prompt pede, não pela ordem das chamadas. */
  const agentes = (plano: unknown) =>
    runAgentCli.mockImplementation(async ({ agentId, content }: { agentId: string; content: string }) => {
      if (agentId === "pesquisaagent") return { finalText: bloco({ termos: [{ termo: "varizes", confianca: "visto" }] }) };
      if (content.includes("PEDIDO ao Composer")) return { finalText: bloco({ pedido: "Dois Stories sobre o medo da cirurgia." }) };
      return { finalText: bloco(plano, "O agendamento caiu pela metade.") };
    });

  beforeEach(() => {
    patchComposition.mockReset().mockResolvedValue(undefined);
    for (const m of [runAgentCli, patchOrquestracao, insertComposition, runComposition, insertRun, searchBlock, analyzeSelected, getRun, listAds, setSelection, salvarRunNaBiblioteca, coletarComMetricas, rodarConceitos, conduzirSozinho]) m.mockReset();
    listClientDocPages.mockReset().mockResolvedValue(PAGINAS);
    listCriativos.mockReset().mockResolvedValue(CRIATIVOS);
    getComposition.mockReset().mockResolvedValue({ status: "conceitos", catalogo_copy: { avatares: [] } });
    rodarConceitos.mockResolvedValue({ bloqueada: false });
    conduzirSozinho.mockResolvedValue(SLOTS);
    patchOrquestracao.mockResolvedValue(undefined);
    insertComposition.mockResolvedValue({ id: "cmp-1" });
    runComposition.mockResolvedValue({ anuncios: 2 });
    coletarComMetricas.mockResolvedValue({
      ...FICHAS, semana: SEMANA,
      atual: new Map([["jose ramos", linha(6)]]), anterior: new Map([["jose ramos", linha(12)]]),
    });
  });

  it("com análise boa na Biblioteca: não minera, e compõe com o que ele escolheu", async () => {
    agentes({
      abordagem: "Qualificar melhor.",
      analise: { usar: "lib-1", motivo: "mesmo nicho" },
      relatorios: [{ id: "r1", motivo: "período" }],
      documentos: [{ id: "d1", motivo: "posicionamento" }],
    });

    await rodar();

    expect(insertRun).not.toHaveBeenCalled();
    // Duas perguntas, as duas ao próprio orquestrador: o plano e o pedido.
    expect(runAgentCli.mock.calls.map((c) => c[0].agentId)).toEqual(["orquestradoragent", "orquestradoragent"]);
    // Os números das duas semanas chegaram ao prompt do plano.
    expect(runAgentCli.mock.calls[0][0].content).toMatch(/Consultas agendadas: 6 \(anterior: 12/);

    // A composição nasce nos conceitos, com o Estudo de Copy (entra sempre, mesmo que o plano não o
    // tenha escolhido) e as análises de criativo prontas da especialidade — a favorita primeiro.
    const composicao = insertComposition.mock.calls[0][0];
    expect(composicao).toMatchObject({ status: "conceitos", library_entry_id: "lib-1", extra_prompt: "Dois Stories sobre o medo da cirurgia." });
    expect(composicao.entradas.map((e: { tipo: string; id: string | null }) => `${e.tipo}:${e.id}`)).toEqual([
      "brief:null", "relatorio:r1", "documento:e1", "documento:r9", "documento:d1", "criativo:c-favorita", "criativo:c-recente",
    ]);
    expect(listCriativos).toHaveBeenCalledWith({ especialidades: ["Cirurgia Vascular"], origem: "mineracao" });
    expect(rodarConceitos).toHaveBeenCalledTimes(1);
    // Sem "pular revisão", PARA nos conceitos: a vez é de uma pessoa. Nada é escrito ainda.
    expect(runComposition).not.toHaveBeenCalled();
    expect(ultima().status).toBe("conceitos");
    expect(ultima().etapas!.map((e) => `${e.key}:${e.status}`)).toEqual([
      "numeros:done", "plano:done", "analise:done", "pedido:done", "conceitos:aguardando", "composicao:pending", "revisao:pending",
    ]);
    expect(etapa("analise").note).toContain("da Biblioteca");
  });

  it("sem análise que sirva: pesquisa, busca, pergunta ao grid, analisa e salva na Biblioteca", async () => {
    agentes({
      abordagem: "Ângulo novo.",
      analise: { usar: null, motivo: "nenhuma é do nicho" },
      mineracao: { nicho: "tratamento de varizes", contexto: "Goiânia", pergunta: "Fala do medo da cirurgia?", foco: "objeções" },
    });
    insertRun.mockResolvedValue({ id: "run-12345678" });
    searchBlock.mockResolvedValue(undefined);
    analyzeSelected.mockResolvedValue(undefined);
    getRun
      .mockResolvedValueOnce({ id: "run-12345678", tema: "varizes", status: "awaiting_selection", search_state: { creditsUsed: 30 } })
      .mockResolvedValueOnce({ id: "run-12345678", tema: "varizes", status: "done", analysis_md: "Análise nova." });
    listAds.mockResolvedValue([{ id: 1, days_running: 90 }, { id: 2, days_running: 300 }, { id: 3, days_running: 40 }, { id: 4, days_running: 10 }]);
    setSelection.mockImplementation(async (_run: string, ids: number[]) => ids.length);
    salvarRunNaBiblioteca.mockResolvedValue({ id: "lib-nova", titulo: "tratamento de varizes — orquestrador", analysis_md: "Análise nova." });

    await rodar();

    // A palavra-chave veio do agente de pesquisa, e a busca leva o foco que o orquestrador escreveu.
    expect(insertRun.mock.calls[0][0]).toMatchObject({ tema: "varizes", extraPrompt: "objeções", userId: "u1" });
    // A peça que ATENDE vai na frente; as outras completam o mínimo por longevidade.
    expect(setSelection.mock.calls[0][1]).toEqual([1, 2, 3, 4]);
    expect(salvarRunNaBiblioteca.mock.calls[0][0]).toMatchObject({ especialidade: "Cirurgia Vascular", userId: "u1", name: "Ana" });
    expect(insertComposition.mock.calls[0][0].library_entry_id).toBe("lib-nova");

    expect(ultima().status).toBe("conceitos");
    // `decisoes` só vai nas gravações que as mudam: a última que as trouxe é a que vale.
    const decisoes = patchOrquestracao.mock.calls.map((c) => (c[1] as Patch).decisoes).filter(Boolean).at(-1)!;
    expect((decisoes.analise as { nova: boolean }).nova).toBe(true);
    // O custo da rodada, contado enquanto acontece: 3 perguntas pelo orquestrador + a análise + a
    // primeira chamada dos conceitos (o lote do grid é dublado aqui, então não conta); nenhum
    // anúncio ainda — a composição espera a aprovação. A busca gastou o que a run registrou.
    expect(decisoes.custo).toEqual({ creditos: 30, buscas: 1, chamadas_agente: 5, pecas: 4, anuncios: 0 });
    expect(ultima().perguntas!.map((p) => p.para)).toEqual([
      "orquestrador", "pesquisa", "pergunta ao grid", "análise de anúncios", "orquestrador",
    ]);
  });

  it("mineração que não acha anúncio não cancela nada: compõe sem análise e diz por quê", async () => {
    agentes({ analise: { usar: null }, mineracao: { nicho: "varizes" } });
    insertRun.mockResolvedValue({ id: "run-12345678" });
    searchBlock.mockResolvedValue(undefined);
    getRun.mockResolvedValue({ id: "run-12345678", status: "error", error: "Nenhum anúncio utilizável.", search_state: { creditsUsed: 12 } });
    listAds.mockResolvedValue([]);

    await rodar();

    expect(analyzeSelected).not.toHaveBeenCalled();
    expect(insertComposition.mock.calls[0][0].library_entry_id).toBeNull();
    // Busca que não achou nada também gastou crédito, e isso aparece no custo.
    const custo = patchOrquestracao.mock.calls.map((c) => (c[1] as Patch).decisoes?.custo).filter(Boolean).at(-1) as { creditos: number; buscas: number };
    expect(custo.buscas).toBe(1);
    expect(custo.creditos).toBe(12);
    expect(etapa("analise").status).toBe("error");
    expect(etapa("analise").note).toContain("segue sem análise");
    expect(ultima().status).toBe("conceitos");
  });

  it("CRM fora do ar: o plano sai sem números, e o prompt diz isso ao orquestrador", async () => {
    coletarComMetricas.mockRejectedValue(new Error("CRM fora do ar"));
    agentes({ analise: { usar: "lib-1" } });

    await rodar();

    expect(runAgentCli.mock.calls[0][0].content).toContain("CRM fora do ar");
    expect(etapa("numeros").status).toBe("skipped");
    expect(ultima().status).toBe("conceitos");
  });

  it("conceitos que falham derrubam a orquestração — e a composição fecha como erro", async () => {
    agentes({ analise: { usar: "lib-1" } });
    rodarConceitos.mockRejectedValue(new Error("agente fora do ar"));

    await expect(rodar()).rejects.toThrow("agente fora do ar");
    expect(etapa("conceitos").status).toBe("error");
    expect(patchComposition).toHaveBeenCalledWith("cmp-1", { status: "error", error: "agente fora do ar" });
  });

  it("composição que falha derruba a orquestração — é a única etapa sem plano B", async () => {
    agentes({ analise: { usar: "lib-1" } });
    runComposition.mockRejectedValue(new Error("agente fora do ar"));

    await expect(rodar(undefined, true)).rejects.toThrow("agente fora do ar");
    expect(etapa("composicao").status).toBe("error");
  });

  it("cliente sem Estudo de Copy: para ANTES do plano, sem gastar chamada nem crédito", async () => {
    agentes({ analise: { usar: null }, mineracao: { nicho: "varizes" } });
    listClientDocPages.mockResolvedValue(PAGINAS.slice(1));

    await expect(rodar()).rejects.toThrow(/não tem Estudo de Copy/);
    expect(runAgentCli).not.toHaveBeenCalled();
    expect(insertRun).not.toHaveBeenCalled();
    expect(insertComposition).not.toHaveBeenCalled();
  });

  it("cliente sem Resumo Estratégico: também para antes do plano", async () => {
    agentes({ analise: { usar: null }, mineracao: { nicho: "varizes" } });
    listClientDocPages.mockResolvedValue(PAGINAS.slice(0, 2));

    await expect(rodar()).rejects.toThrow(/não tem Resumo Estratégico/);
    expect(runAgentCli).not.toHaveBeenCalled();
    expect(insertComposition).not.toHaveBeenCalled();
  });

  it("cancelada durante o plano: para ali, sem minerar nem compor", async () => {
    const controller = new AbortController();
    runAgentCli.mockImplementation(async () => {
      // O cancelamento chega com a chamada do plano em curso; o subprocesso morto volta como erro.
      controller.abort();
      throw new Error("subprocesso encerrado");
    });

    await expect(rodar(controller.signal)).rejects.toThrow("subprocesso encerrado");
    expect(runAgentCli).toHaveBeenCalledTimes(1);
    expect(runAgentCli.mock.calls[0][0].signal).toBe(controller.signal);
    expect(insertRun).not.toHaveBeenCalled();
    expect(insertComposition).not.toHaveBeenCalled();
  });

  it("cancelada durante a mineração: NÃO segue para compor sem análise", async () => {
    // É o caso que separa cancelar de falhar: uma mineração que falha continua para a composição;
    // uma cancelada não continua para lugar nenhum.
    const controller = new AbortController();
    agentes({ analise: { usar: null }, mineracao: { nicho: "varizes" } });
    insertRun.mockResolvedValue({ id: "run-12345678" });
    searchBlock.mockImplementation(async () => controller.abort());
    getRun.mockResolvedValue({ id: "run-12345678", status: "awaiting_selection" });
    listAds.mockResolvedValue([{ id: 1, days_running: 90 }]);

    await expect(rodar(controller.signal)).rejects.toBeInstanceOf(OrquestracaoCancelada);
    expect(analyzeSelected).not.toHaveBeenCalled();
    expect(insertComposition).not.toHaveBeenCalled();
  });

  it("cancelada durante a composição: a composição fecha como cancelada", async () => {
    const controller = new AbortController();
    agentes({ analise: { usar: "lib-1" } });
    runComposition.mockImplementation(async ({ signal }: { signal: AbortSignal }) => {
      expect(signal).toBe(controller.signal);
      controller.abort();
      throw new Error("Cancelada.");
    });

    await expect(rodar(controller.signal, true)).rejects.toBeInstanceOf(OrquestracaoCancelada);
    expect(patchComposition).toHaveBeenCalledWith("cmp-1", { status: "error", error: "Cancelada." });
  });

  it("com a chave de pular revisão, salva direto e conclui", async () => {
    agentes({ analise: { usar: "lib-1" } });
    await runOrquestracao({
      id: "orq-12345678", cliente: "jose_ramos", userId: "u1", userName: "Ana",
      settingsDaBusca: {}, metaProvider: "x", pausaMs: 0, pularRevisao: true,
    });
    // Os conceitos foram conduzidos sem ninguém, e a escrita usou os aprovados.
    expect(conduzirSozinho).toHaveBeenCalledTimes(1);
    expect(runComposition.mock.calls[0][0]).toMatchObject({ conceitos: SLOTS, catalogo: { avatares: [] } });
    expect(patchComposition).toHaveBeenCalledWith("cmp-1", { status: "running", error: null });
    expect(patchComposition).toHaveBeenCalledWith("cmp-1", { status: "ok" });
    expect(ultima().status).toBe("ok");
    expect(etapa("conceitos").status).toBe("done");
    expect(etapa("revisao").status).toBe("skipped");
  });
});

describe("orquestração parada nos conceitos, continuada pela tela", () => {
  const parada = () => ({
    etapas: semearEtapas().map((e) =>
      ["numeros", "plano", "analise", "pedido"].includes(e.key)
        ? { ...e, status: "done" }
        : e.key === "conceitos"
          ? { ...e, status: "aguardando" }
          : e,
    ),
  });
  const status = (p: { etapas: { key: string; status: string }[] }) => p.etapas.map((e) => `${e.key}:${e.status}`).slice(4);

  it("aprovou: os conceitos fecham e a composição roda; terminou: espera a revisão", () => {
    const confirmada = orquestracaoAoConfirmar(parada(), "2026-10-20T12:00:00Z");
    expect(confirmada.status).toBe("running");
    expect(status(confirmada)).toEqual(["conceitos:done", "composicao:running", "revisao:pending"]);
    const terminada = orquestracaoAoTerminar(confirmada, { anuncios: 3 }, "2026-10-20T12:05:00Z");
    expect(terminada.status).toBe("revisao");
    expect(status(terminada)).toEqual(["conceitos:done", "composicao:done", "revisao:aguardando"]);
  });

  it("descartou ou cancelou: fecha com o motivo na etapa", () => {
    const f = orquestracaoAoFalhar(parada(), "Conceitos descartados por quem disparou.", "conceitos");
    expect(f).toMatchObject({ status: "error", error: "Conceitos descartados por quem disparou." });
    expect(f.etapas.find((e: { key: string }) => e.key === "conceitos")).toMatchObject({ status: "error" });
  });
});

describe("órfãs — o que ficou running depois de o worker reiniciar", () => {
  const anuncio = (status: string) => ({ formato: "google_ads", angulo: null, status, avisos: [], error: null });

  beforeEach(() => {
    for (const m of [patchOrquestracao, patchComposition, listOrquestracoesRodando, listComposicoesRodando]) m.mockReset();
    patchOrquestracao.mockResolvedValue(undefined);
    patchComposition.mockResolvedValue(undefined);
  });

  it("a etapa que rodava fecha como erro; as outras ficam como estavam", () => {
    const etapas = fecharEtapas(
      [{ key: "plano", status: "done" }, { key: "analise", status: "running" }, { key: "pedido", status: "pending" }],
      "motivo",
    );
    expect(etapas.map((e: { status: string }) => e.status)).toEqual(["done", "error", "pending"]);
    expect(etapas[1].note).toBe("motivo");
  });

  it("composição com anúncio pronto não some: vai para revisão, e os que faltavam viram erro", () => {
    const patch = fecharComposicao([anuncio("ok"), anuncio("running"), anuncio("pendente")], "motivo");
    expect(patch.status).toBe("revisao");
    expect(patch.anuncios.map((a: { status: string }) => a.status)).toEqual(["ok", "error", "error"]);
    expect(patch.plano.map((a: { status: string }) => a.status)).toEqual(["ok", "error", "error"]);
  });

  it("composição sem nenhum anúncio pronto é erro inteira", () => {
    expect(fecharComposicao([], "motivo")).toEqual({ status: "error", error: "motivo" });
    expect(fecharComposicao([anuncio("running")], "motivo").status).toBe("error");
  });

  it("no boot, fecha as duas tabelas — é o que destrava o botão de disparar", async () => {
    listOrquestracoesRodando.mockResolvedValue([{ id: "o1", etapas: [{ key: "analise", status: "running" }] }]);
    listComposicoesRodando.mockResolvedValue([{ id: "c1", anuncios: [anuncio("ok"), anuncio("pendente")] }]);

    expect(await fecharOrfas()).toEqual({ orquestracoes: 1, composicoes: 1 });
    expect(patchOrquestracao.mock.calls[0]).toEqual([
      "o1",
      expect.objectContaining({ status: "error", error: MOTIVO_REINICIO }),
    ]);
    expect(patchComposition.mock.calls[0][1].status).toBe("revisao");
  });

  it("banco fora do ar no boot não impede o worker de subir", async () => {
    listOrquestracoesRodando.mockRejectedValue(new Error("sem banco"));
    await expect(fecharOrfas()).resolves.toEqual({ orquestracoes: 0, composicoes: 0 });
  });
});
