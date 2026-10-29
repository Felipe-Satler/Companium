/**
 * "Perguntar ao grid": a pessoa escreve o que procura, o agente lê as peças, o grid reordena.
 *
 * O que estes testes prendem é o que enganaria em silêncio — nada aqui quebra a tela, só faz ela
 * mentir:
 *
 *   - uma citação que o agente inventou ou parafraseou aparecendo como prova;
 *   - o agente respondendo por uma peça que não estava no lote;
 *   - vídeo sem texto nenhum aparecendo como "não atende", quando ninguém o leu;
 *   - um lote que falha derrubando as respostas dos outros;
 *   - a pergunta desfazendo a ordem de desempenho que a busca já deu.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: { access_token: "tok" } }),
}));
vi.mock("@/hooks/useAdSpy", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useAdSpy")>("@/hooks/useAdSpy");
  return { ...actual, useSpyMedia: () => null };
});

import {
  buildPerguntaPrompt,
  LOTE,
  parsePerguntaReply,
  pecasPendentes,
  runPergunta,
  textoDaPeca,
} from "../../apps/ad-spy-worker/pergunta.js";
import { AdGrid } from "@/components/marketing/mineracao/AdGrid";
import {
  contarRespostas,
  ordenarPorResposta,
  pendentes,
  PERGUNTAS_PRONTAS,
} from "@/components/marketing/mineracao/perguntaGrid";
import type { SpyAd, SpyQuestion, SpyResposta, SpyRun } from "@/lib/adSpyApi";

function makeAd(id: number, over: Partial<SpyAd> = {}): SpyAd {
  return {
    id,
    run_id: "run-1",
    source: "meta",
    external_id: `14980592619825${id}`,
    page_name: `Clínica ${id}`,
    page_id: "104455566677",
    page_profile_uri: null,
    permalink: null,
    ad_copy: `Texto da peça ${id}`,
    title: null,
    cta_text: null,
    link_url: null,
    display_format: "VIDEO",
    publisher_platform: ["INSTAGRAM"],
    started_running_on: "2026-04-25",
    days_running: 145,
    media_type: "video",
    thumb_path: null,
    avatar_path: null,
    media_path: null,
    media_url: null,
    duration_sec: null,
    transcript: null,
    transcript_lang: null,
    transcript_model: null,
    collation_count: 3,
    is_active: true,
    selected: false,
    criado_em: "2026-10-12T00:00:00Z",
    ...over,
  } as SpyAd;
}

const bloco = (respostas: unknown[]) => "```json\n" + JSON.stringify({ respostas }) + "\n```";

describe("o que o agente lê de cada peça", () => {
  it("a base diz se a fala do vídeo entrou, e peça sem texto nenhum é 'vazio'", () => {
    expect(textoDaPeca(makeAd(1)).base).toBe("copy");
    expect(textoDaPeca(makeAd(1, { transcript: "oi, eu sou a doutora" })).base).toBe("transcricao");
    expect(textoDaPeca(makeAd(1, { ad_copy: "  ", title: null })).base).toBe("vazio");
    // Short do YouTube: o texto é o título.
    expect(textoDaPeca(makeAd(1, { ad_copy: null, title: "Antes e depois" })).base).toBe("copy");
  });

  it("o prompt leva a pergunta e cada peça sob o próprio id", () => {
    const prompt = buildPerguntaPrompt({
      pergunta: "fala de preço?",
      ads: [makeAd(7, { title: "Lente de contato", transcript: "parcelamos em 12 vezes" }), makeAd(8)],
    });
    expect(prompt).toMatch(/^PERGUNTA: fala de preço\?/);
    expect(prompt).toContain("### Peça 7");
    expect(prompt).toContain("Título: Lente de contato");
    expect(prompt).toContain("Fala do vídeo: parcelamos em 12 vezes");
    expect(prompt).toContain("### Peça 8");
  });
});

describe("leitura da resposta do agente", () => {
  const ads = [
    makeAd(1, { ad_copy: "Parcelamos em até 12x sem juros.\nAgende sua avaliação." }),
    makeAd(2, { ad_copy: "Recupere sua autoestima" }),
    makeAd(3, { ad_copy: "Catarata tem cura", transcript: "a cirurgia leva quinze minutos" }),
  ];

  it("aceita o trecho literal — mesmo com caixa, acento, aspas e quebra de linha diferentes", () => {
    const { respostas } = parsePerguntaReply(
      bloco([{ id: 1, veredito: "atende", trecho: "“parcelamos em ate 12x sem juros. agende sua avaliação”" }]),
      ads,
    );
    expect(respostas["1"]).toMatchObject({ veredito: "atende", base: "copy" });
    expect(respostas["1"].trecho).toMatch(/12x sem juros/i);
  });

  it("descarta o trecho que não está na peça, mas mantém o veredito", () => {
    const { respostas } = parsePerguntaReply(
      bloco([{ id: 2, veredito: "parcial", trecho: "condições especiais de pagamento" }]),
      ads,
    );
    expect(respostas["2"]).toEqual({ veredito: "parcial", trecho: null, base: "copy" });
  });

  it("o trecho pode vir da fala, e a base registra que ela foi lida", () => {
    const { respostas } = parsePerguntaReply(
      bloco([{ id: 3, veredito: "atende", trecho: "a cirurgia leva quinze minutos" }]),
      ads,
    );
    expect(respostas["3"]).toEqual({ veredito: "atende", trecho: "a cirurgia leva quinze minutos", base: "transcricao" });
  });

  it("ignora id que não é do lote, veredito fora do contrato e resposta repetida", () => {
    const { respostas } = parsePerguntaReply(
      bloco([
        { id: 99, veredito: "atende", trecho: "x" },
        { id: 1, veredito: "talvez", trecho: "" },
        { id: 2, veredito: "Não atende", trecho: "" },
        { id: 2, veredito: "atende", trecho: "" },
        { id: "3", veredito: "atende em parte", trecho: "" },
      ]),
      ads,
    );
    expect(Object.keys(respostas).sort()).toEqual(["2", "3"]);
    expect(respostas["2"].veredito).toBe("nao");
    expect(respostas["3"].veredito).toBe("parcial");
  });

  it("prosa sem o bloco não vira resposta nenhuma", () => {
    expect(parsePerguntaReply("Todas atendem.", ads)).toEqual({ respostas: {}, semBlocoJson: true });
  });
});

describe("rodada da pergunta", () => {
  const todasAtendem = (prompt: string) =>
    bloco([...prompt.matchAll(/### Peça (\d+)/g)].map((m) => ({ id: Number(m[1]), veredito: "atende", trecho: "" })));

  it("vai em lotes, grava o progresso e termina com uma resposta por peça", async () => {
    const ads = Array.from({ length: LOTE + 3 }, (_, i) => makeAd(i + 1));
    const gravados: SpyQuestion[] = [];
    const perguntar = vi.fn(async (prompt: string) => todasAtendem(prompt));
    const final = await runPergunta({
      id: "q1", pergunta: "fala de preço?", ads, pedidoEm: "2026-10-12T00:00:00Z",
      perguntar, gravar: async (q: SpyQuestion) => void gravados.push(q),
    });
    expect(perguntar).toHaveBeenCalledTimes(2);
    expect(gravados[0]).toMatchObject({ status: "running", feito: LOTE, total: LOTE + 3 });
    expect(final).toMatchObject({ status: "done", error: null, feito: LOTE + 3, texto: "fala de preço?" });
    expect(Object.keys(final.respostas)).toHaveLength(LOTE + 3);
  });

  it("peça sem texto não vai ao agente e não vira 'não atende'", async () => {
    const perguntar = vi.fn(async (prompt: string) => todasAtendem(prompt));
    const final = await runPergunta({
      id: "q1", pergunta: "fala de preço?", pedidoEm: "x",
      ads: [makeAd(1), makeAd(2, { ad_copy: null })],
      perguntar, gravar: async () => {},
    });
    expect(perguntar.mock.calls[0][0]).not.toContain("### Peça 2");
    expect(final.respostas["2"]).toEqual({ veredito: null, trecho: null, base: "vazio" });
    expect(final.total).toBe(1);
  });

  it("um lote que falha não derruba os outros; a pergunta termina com aviso", async () => {
    const ads = Array.from({ length: LOTE * 2 }, (_, i) => makeAd(i + 1));
    const perguntar = vi
      .fn<(p: string) => Promise<string>>()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockImplementationOnce(async (p) => todasAtendem(p));
    const final = await runPergunta({
      id: "q1", pergunta: "fala de preço?", ads, pedidoEm: "x", perguntar, gravar: async () => {},
    });
    expect(final.status).toBe("done");
    expect(final.error).toMatch(/sem resposta/i);
    expect(Object.keys(final.respostas)).toHaveLength(LOTE);
    expect(final.respostas["1"]).toBeUndefined();
  });

  it("se nenhum lote responde, é erro — e resposta sem bloco conta como falha", async () => {
    const final = await runPergunta({
      id: "q1", pergunta: "fala de preço?", ads: [makeAd(1)], pedidoEm: "x",
      perguntar: async () => "Claro! Todas atendem.", gravar: async () => {},
    });
    expect(final.status).toBe("error");
    expect(final.error).toMatch(/não respondeu/i);
  });

  it("repetir a mesma pergunta só lê o que falta: peça nova e peça que ganhou transcrição", async () => {
    const anteriores: Record<string, SpyResposta> = {
      "1": { veredito: "nao", trecho: null, base: "copy" },
      "2": { veredito: "atende", trecho: null, base: "copy" },
    };
    const ads = [makeAd(1), makeAd(2, { transcript: "agora tem fala" }), makeAd(3)];
    expect(pecasPendentes(ads, anteriores).map((a: SpyAd) => a.id)).toEqual([2, 3]);

    const perguntar = vi.fn(async (prompt: string) => todasAtendem(prompt));
    const final = await runPergunta({
      id: "q2", pergunta: "fala de preço?", ads, anteriores, pedidoEm: "x", perguntar, gravar: async () => {},
    });
    expect(perguntar.mock.calls[0][0]).not.toContain("### Peça 1");
    // A resposta antiga da peça 1 continua lá, e a da peça 2 foi refeita com a nova base.
    expect(final.respostas["1"]).toEqual(anteriores["1"]);
    expect(final.respostas["2"].base).toBe("transcricao");
    expect(final.respostas["3"].veredito).toBe("atende");
  });
});

// --- tela ---------------------------------------------------------------------------------------

const r = (veredito: SpyResposta["veredito"], over: Partial<SpyResposta> = {}): SpyResposta => ({
  veredito,
  trecho: null,
  base: "copy",
  ...over,
});

function makeQuestion(respostas: Record<string, SpyResposta>, over: Partial<SpyQuestion> = {}): SpyQuestion {
  return {
    id: "q1",
    texto: "O anúncio fala de preço?",
    status: "done",
    error: null,
    pedido_em: "2026-10-12T00:00:00Z",
    concluido_em: "2026-10-12T00:01:00Z",
    total: Object.keys(respostas).length,
    feito: Object.keys(respostas).length,
    respostas,
    ...over,
  };
}

function makeRun(question: SpyQuestion | null, over: Partial<SpyRun> = {}): SpyRun {
  return {
    id: "run-1",
    tema: "oftalmologista",
    sources: ["meta"],
    settings: {},
    status: "awaiting_selection",
    stages: [],
    question,
    search: {
      exhausted: true, buffered: 0, creditsUsed: 1, pagesUsed: 1, found: 4, rejected: 0,
      target: 8, creditBudget: 20, note: null,
    },
    ...over,
  } as SpyRun;
}

describe("ordem do grid", () => {
  const ads = [makeAd(1), makeAd(2), makeAd(3), makeAd(4), makeAd(5)];
  const q = makeQuestion({
    "1": r("nao"),
    "2": r("atende"),
    "3": r("parcial"),
    "4": r("atende"),
  });

  it("atende, em parte, não atende, sem resposta — mantendo a ordem da busca dentro de cada grupo", () => {
    expect(ordenarPorResposta(ads, q).map((a) => a.id)).toEqual([2, 4, 3, 1, 5]);
    expect(contarRespostas(ads, q)).toEqual({ atende: 2, parcial: 1, nao: 1, sem: 1 });
  });

  it("sem pergunta, com pergunta em erro ou sem resposta nenhuma, a ordem é a da busca", () => {
    expect(ordenarPorResposta(ads, null)).toBe(ads);
    expect(ordenarPorResposta(ads, makeQuestion({}, { status: "running" }))).toBe(ads);
    expect(ordenarPorResposta(ads, { ...q, status: "error" })).toBe(ads);
  });

  it("conta como pendente a peça nova e a que ganhou transcrição depois da resposta", () => {
    expect(pendentes(ads, q)).toBe(1);
    expect(pendentes([makeAd(1, { transcript: "fala" }), ...ads.slice(1)], q)).toBe(2);
  });
});

describe("perguntas prontas", () => {
  it("levam, palavra por palavra, as perguntas de sim/não do experimento JEV", () => {
    const arquivo = path.resolve(process.cwd(), "apps/ad-spy-worker/experimentos/jev/perguntas.json");
    const { perguntas } = JSON.parse(fs.readFileSync(arquivo, "utf-8")) as {
      perguntas: Record<string, { type: string; instructions: string }>;
    };
    const prontas = new Set(PERGUNTAS_PRONTAS.map((p) => p.pergunta));
    const booleanas = Object.values(perguntas).filter((p) => p.type === "boolean");
    expect(booleanas.length).toBeGreaterThanOrEqual(6);
    for (const p of booleanas) expect(prontas.has(p.instructions)).toBe(true);
    // Nove no total, como as do experimento, e todas dentro do limite da rota.
    expect(PERGUNTAS_PRONTAS).toHaveLength(Object.keys(perguntas).length);
    for (const p of PERGUNTAS_PRONTAS) expect(p.pergunta.length).toBeLessThanOrEqual(300);
  });
});

describe("tela", () => {
  const props = {
    selectedIds: new Set<number>(),
    onToggle: () => {},
    onClearSelection: () => {},
    onLoadMore: () => {},
    isLoadingMore: false,
    onAnalyze: () => {},
    isAnalyzing: false,
    maxSelected: 30,
    onClearQuestion: () => {},
    onSelectMatching: () => {},
  };
  const tela = (ui: React.ReactNode) =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <TooltipProvider>{ui}</TooltipProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  /** Os anunciantes na ordem em que os cards aparecem. */
  const ordemNaTela = () =>
    screen.getAllByRole("button", { name: /ver o anúncio completo de/i }).map((b) => b.getAttribute("aria-label")!.match(/Clínica (\d+)/)![1]);

  it("manda a pergunta digitada, e uma pronta só preenche o campo", () => {
    const onAsk = vi.fn();
    tela(<AdGrid {...props} run={makeRun(null)} ads={[makeAd(1)]} onAsk={onAsk} />);
    const campo = screen.getByLabelText(/pergunta sobre as peças/i);
    const perguntar = screen.getByRole("button", { name: /^perguntar$/i });
    expect(perguntar).toBeDisabled();

    fireEvent.keyDown(screen.getByRole("button", { name: /perguntas prontas/i }), { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: /fala de preço ou oferta/i }));
    expect(onAsk).not.toHaveBeenCalled();
    expect((campo as HTMLInputElement).value).toMatch(/menciona preço, parcelamento/i);

    fireEvent.change(campo, { target: { value: "  abre com   uma pergunta? " } });
    fireEvent.click(perguntar);
    expect(onAsk).toHaveBeenCalledWith("abre com uma pergunta?");
  });

  it("reordena os cards e mostra veredito, trecho e o que não foi lido", () => {
    const ads = [makeAd(1), makeAd(2), makeAd(3, { ad_copy: null }), makeAd(4)];
    const q = makeQuestion({
      "1": r("nao"),
      "2": r("atende", { trecho: "12x sem juros" }),
      "3": r(null, { base: "vazio" }),
    });
    tela(<AdGrid {...props} run={makeRun(q)} ads={ads} onAsk={() => {}} />);

    expect(ordemNaTela()).toEqual(["2", "1", "3", "4"]);
    expect(screen.getByText("Atende")).toBeInTheDocument();
    expect(screen.getByText("“12x sem juros”")).toBeInTheDocument();
    // Vídeo respondido só pelo texto: o card avisa que a fala não entrou.
    expect(screen.getAllByText(/só o texto foi lido/i)).toHaveLength(2);
    // Ninguém leu a peça 3 (sem texto) nem a 4 (chegou depois): nenhuma vira "não atende".
    expect(screen.getByText(/sem texto para ler/i)).toBeInTheDocument();
    expect(screen.getByText(/ainda não lida para esta pergunta/i)).toBeInTheDocument();
    expect(screen.getAllByText("Não atende")).toHaveLength(1);
    expect(screen.getByText("2 sem resposta")).toBeInTheDocument();
    // A mesma pergunta já está no campo: o botão oferece ler só o que falta.
    expect(screen.getByRole("button", { name: /ler 1 peça que falta/i })).toBeInTheDocument();
  });

  it("'selecionar as que atendem' entrega só as que atendem, na ordem do grid", () => {
    const onSelectMatching = vi.fn();
    const q = makeQuestion({ "1": r("parcial"), "2": r("atende"), "3": r("nao"), "4": r("atende") });
    tela(
      <AdGrid
        {...props}
        run={makeRun(q)}
        ads={[makeAd(1), makeAd(2), makeAd(3), makeAd(4)]}
        onAsk={() => {}}
        onSelectMatching={onSelectMatching}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /selecionar as que atendem/i }));
    expect(onSelectMatching).toHaveBeenCalledWith([2, 4]);
  });

  it("enquanto o agente lê, mostra o progresso e não deixa perguntar de novo", () => {
    const q = makeQuestion({}, { status: "running", total: 40, feito: 20 });
    tela(<AdGrid {...props} run={makeRun(q)} ads={[makeAd(1)]} onAsk={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent("20 de 40");
    expect(screen.getByRole("button", { name: /^perguntar$/i })).toBeDisabled();
    // Sem resposta ainda, os cards não ganham selo nenhum.
    expect(screen.queryByText(/ainda não lida/i)).toBeNull();
  });

  it("sem `onAsk` (Biblioteca) a barra da pergunta não existe", () => {
    tela(<AdGrid {...props} run={makeRun(null)} ads={[makeAd(1)]} />);
    expect(screen.queryByLabelText(/pergunta sobre as peças/i)).toBeNull();
  });
});

// --- várias perguntas na mesma busca -----------------------------------------------------------

import {
  MAX_PERGUNTAS_GUARDADAS,
  perguntasDaPeca,
  trocarPergunta,
} from "../../apps/ad-spy-worker/pergunta.js";
import { perguntaSalva, perguntasSalvas, rotuloDaPergunta } from "@/components/marketing/mineracao/perguntaGrid";

describe("perguntas guardadas na busca", () => {
  const A = { "1": r("atende"), "2": r("nao") };
  const B = { "1": r("nao"), "2": r("atende") };
  const naTelaA = makeQuestion(A, { texto: "A?" });

  it("perguntar outra coisa guarda a pergunta da tela, em vez de apagá-la", () => {
    const { base, outras } = trocarPergunta(naTelaA, "B?");
    expect(base).toEqual({});
    expect(outras).toEqual([{ texto: "A?", concluido_em: naTelaA.concluido_em, respostas: A }]);
  });

  it("voltar a uma guardada traz as respostas dela — e a da tela troca de lugar com ela", () => {
    const naTelaB = makeQuestion(B, { texto: "B?", outras: [{ texto: "A?", concluido_em: null, respostas: A }] });
    const { base, outras } = trocarPergunta(naTelaB, "A?");
    expect(base).toBe(A);
    expect(outras.map((o: { texto: string }) => o.texto)).toEqual(["B?"]);
  });

  it(`guarda no máximo ${MAX_PERGUNTAS_GUARDADAS} por busca, contando a da tela; a mais antiga sai`, () => {
    let q: SpyQuestion | null = null;
    for (const texto of ["p1", "p2", "p3", "p4", "p5", "p6", "p7"]) {
      const { outras } = trocarPergunta(q, texto);
      q = makeQuestion({ "1": r("atende") }, { texto, outras });
    }
    expect(q!.texto).toBe("p7");
    expect(q!.outras!.map((o) => o.texto)).toEqual(["p6", "p5", "p4", "p3"]);
  });

  it("pergunta que terminou em erro sem resposta nenhuma não ocupa lugar", () => {
    const falhou = makeQuestion({}, { texto: "X?", status: "error", outras: [{ texto: "A?", concluido_em: null, respostas: A }] });
    expect(trocarPergunta(falhou, "B?").outras.map((o: { texto: string }) => o.texto)).toEqual(["A?"]);
  });

  it("a rodada regrava as guardadas junto — a coluna é uma só", async () => {
    const outras = [{ texto: "A?", concluido_em: null, respostas: A }];
    const gravados: SpyQuestion[] = [];
    const final = await runPergunta({
      id: "q", pergunta: "B?", pedidoEm: "x", outras,
      ads: Array.from({ length: LOTE + 1 }, (_, i) => makeAd(i + 1)),
      perguntar: async (p: string) =>
        bloco([...p.matchAll(/### Peça (\d+)/g)].map((m) => ({ id: Number(m[1]), veredito: "nao", trecho: "" }))),
      gravar: async (q: SpyQuestion) => void gravados.push(q),
    });
    expect(gravados.every((g) => g.outras === outras)).toBe(true);
    expect(final.outras).toBe(outras);
  });

  it("voltar a uma pergunta já respondida por inteiro não chama o agente", async () => {
    const perguntar = vi.fn();
    const final = await runPergunta({
      id: "q", pergunta: "A?", pedidoEm: "x", ads: [makeAd(1), makeAd(2)], anteriores: A,
      perguntar, gravar: async () => {},
    });
    expect(perguntar).not.toHaveBeenCalled();
    expect(final).toMatchObject({ status: "done", error: null, respostas: A });
  });

  it("na tela, as guardadas viram atalhos que pedem a pergunta inteira", () => {
    const onAsk = vi.fn();
    const pronta = PERGUNTAS_PRONTAS[6].pergunta;
    const q = makeQuestion(B, {
      texto: "B?",
      outras: [
        { texto: pronta, concluido_em: null, respostas: A },
        { texto: "Uma pergunta escrita à mão, comprida o bastante para ser cortada no atalho?", concluido_em: null, respostas: A },
      ],
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <TooltipProvider>
            <AdGrid
              selectedIds={new Set()} onToggle={() => {}} onClearSelection={() => {}} onLoadMore={() => {}}
              isLoadingMore={false} onAnalyze={() => {}} isAnalyzing={false} maxSelected={30}
              run={makeRun(q)} ads={[makeAd(1), makeAd(2)]} onAsk={onAsk}
            />
          </TooltipProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const grupo = screen.getByRole("group", { name: /perguntas já feitas/i });
    expect(grupo.querySelectorAll("button")).toHaveLength(2);
    // A pronta aparece pelo rótulo; a escrita à mão, cortada.
    expect(rotuloDaPergunta(pronta)).toBe(PERGUNTAS_PRONTAS[6].rotulo);
    fireEvent.click(screen.getByRole("button", { name: PERGUNTAS_PRONTAS[6].rotulo }));
    expect(onAsk).toHaveBeenCalledWith(pronta);
    expect(screen.getByRole("button", { name: /^Uma pergunta escrita à mão.*…$/ })).toBeInTheDocument();
  });
});

describe("perguntas na Biblioteca", () => {
  const A = { "1": r("nao"), "2": r("atende", { trecho: "12x" }) };
  const B = { "1": r("atende"), "3": r("parcial") };
  const question = makeQuestion(B, { texto: "B?", outras: [{ texto: "A?", concluido_em: null, respostas: A }] });

  it("cada anúncio salvo leva as perguntas que o leram — a da tela e as guardadas", () => {
    expect(perguntasDaPeca(question, 1)).toEqual([
      { texto: "B?", veredito: "atende", trecho: null, base: "copy" },
      { texto: "A?", veredito: "nao", trecho: null, base: "copy" },
    ]);
    expect(perguntasDaPeca(question, 2)).toEqual([{ texto: "A?", veredito: "atende", trecho: "12x", base: "copy" }]);
    expect(perguntasDaPeca(question, 9)).toEqual([]);
    expect(perguntasDaPeca(null, 1)).toEqual([]);
  });

  it("leva as cinco, não quatro, quando não há lugar reservado para uma pergunta nova", () => {
    const outras = ["p4", "p3", "p2", "p1"].map((texto) => ({ texto, concluido_em: null, respostas: { "1": r("nao") } }));
    const cheia = makeQuestion({ "1": r("atende") }, { texto: "p5", outras });
    expect(perguntasDaPeca(cheia, 1).map((p: { texto: string }) => p.texto)).toEqual(["p5", "p4", "p3", "p2", "p1"]);
  });

  it("a ordenação da Biblioteca sai dos anúncios salvos, só entre eles", () => {
    // Só os selecionados (1, 2 e 3) foram salvos; cada um carrega as próprias respostas.
    const salvos = [1, 2, 3].map((id) => makeAd(id, { perguntas: perguntasDaPeca(question, id) }));
    expect(perguntasSalvas(salvos)).toEqual(["B?", "A?"]);
    expect(ordenarPorResposta(salvos, perguntaSalva(salvos, "A?")).map((a) => a.id)).toEqual([2, 1, 3]);
    expect(ordenarPorResposta(salvos, perguntaSalva(salvos, "B?")).map((a) => a.id)).toEqual([1, 3, 2]);
    // Análise salva antes das perguntas: nada a oferecer, ordem intacta.
    expect(perguntasSalvas([makeAd(1)])).toEqual([]);
  });
});
