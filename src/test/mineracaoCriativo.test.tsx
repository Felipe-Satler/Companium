/**
 * Análises de Criativos: a dissecação de UM anúncio pelo spyagent, pedida pelo "Analisar Criativo".
 *
 * O que estes testes prendem:
 *
 *   - o prompt abre com o cabeçalho que a definição do agente usa para trocar de tarefa — se os dois
 *     divergirem, o agente devolve uma análise de corpus inteira para uma peça só;
 *   - vídeo sem transcrição passa pelo Whisper ANTES, e a transcrição volta para o anúncio da busca;
 *   - se a transcrição falha, a análise segue, e o agente é avisado de que a fala não foi lida;
 *   - a dissecação saiu da análise da mineração (instruções do agente e tela).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";

const startMutate = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ session: { access_token: "tok" } }) }));
vi.mock("@/hooks/useAdSpy", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useAdSpy")>("@/hooks/useAdSpy");
  return {
    ...actual,
    useSpyMedia: () => null,
    useStartCriativo: () => ({ mutate: startMutate, isPending: false }),
  };
});
vi.mock("@/hooks/useEspecialidades", () => ({
  useEspecialidades: () => ({ especialidadeOptions: ["Odontologia", "Dermatologia"], getEspecialidades: () => [], loading: false }),
}));

import {
  buildDissecacaoPrompt,
  completarInterno,
  DissecacaoImpossivel,
  mensagemImpossivel,
  pecaDoCriativoInterno,
  permalinkValido,
  parseDissecacao,
  precisaTranscrever,
  runCriativo,
  snapshotDoAnuncio,
} from "../../apps/ad-spy-worker/criativo.js";
import { ALVOS, alvoValido } from "../../shared/avaliacao-tags.js";
import { AdDetailDialog } from "@/components/marketing/mineracao/AdDetailDialog";
import { semDissecacao } from "@/components/marketing/mineracao/relatorioTexto";
import { filtrarCriativos, nomeDoCriativo, tituloPadraoCriativo } from "@/components/marketing/mineracao/criativoTexto";
import type { SpyAd, SpyCriativoResumo } from "@/lib/adSpyApi";

function makeAd(id: number, over: Partial<SpyAd> = {}): SpyAd {
  return {
    id,
    run_id: "run-1",
    source: "meta",
    external_id: `14980592619825${id}`,
    page_name: "Clínica Sorriso",
    page_id: "104455566677",
    page_profile_uri: null,
    permalink: null,
    ad_copy: "Tem vergonha de sorrir? Lente de contato dental em 2 sessões.",
    title: null,
    cta_text: "Saiba mais",
    link_url: null,
    display_format: "VIDEO",
    publisher_platform: ["INSTAGRAM"],
    started_running_on: "2026-04-25",
    days_running: 145,
    media_type: "video",
    thumb_path: null,
    avatar_path: null,
    media_path: null,
    media_url: "https://cdn/v.mp4",
    duration_sec: 30,
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

const resposta = (dissecacao: Record<string, string>) =>
  "## Formato\nVídeo.\n\n## Estrutura\nAbre com pergunta.\n\n```json\n" + JSON.stringify(dissecacao) + "\n```";

const DISSECACAO = {
  formato: "Vídeo vertical, profissional falando para a câmera.",
  estrutura: "Pergunta sobre a dor, procedimento, convite.",
  anatomia_semantica: "Coloquial; omite preço.",
  anatomia_psicologica: "Ataca a vergonha de sorrir.",
  nivel_consciencia: "consciente_problema",
};

/** As dependências de produção trocadas por espiões. */
function deps(over: Record<string, unknown> = {}) {
  return {
    downloadable: true,
    baixar: vi.fn(async () => Buffer.from("mp4")),
    transcrever: vi.fn(async () => ({ text: "Oi, eu sou a doutora Ana.", lang: "pt", model: "small" })),
    gravarAnuncio: vi.fn(async () => {}),
    perguntar: vi.fn(async (_prompt: string) => resposta(DISSECACAO)),
    gravar: vi.fn(async () => {}),
    ...over,
  };
}

describe("o pedido ao agente", () => {
  it("abre com o cabeçalho do modo, o MESMO que as instruções do spyagent esperam", () => {
    const prompt = buildDissecacaoPrompt(makeAd(1));
    const cabecalho = prompt.split("\n")[0];
    expect(cabecalho).toBe("## Modo: dissecação de criativo");
    const md = fs.readFileSync(path.resolve(process.cwd(), "apps/ad-spy-worker/agent/spyagent.md"), "utf-8");
    expect(md).toContain(`Quando a mensagem começar com \`${cabecalho}\``);
    // A peça vai no mesmo formato da análise do corpus.
    expect(prompt).toContain("### Anúncio #1");
    expect(prompt).toContain("Tem vergonha de sorrir?");
  });

  it("a análise da mineração não pede mais a dissecação ao agente", () => {
    const md = fs.readFileSync(path.resolve(process.cwd(), "apps/ad-spy-worker/agent/spyagent.md"), "utf-8");
    const contrato = md.split("\n").find((l) => l.startsWith('{"publicos"'))!;
    expect(contrato).toBeDefined();
    expect(contrato).not.toContain("dissecacoes");
    expect(md).not.toMatch(/^## Dissecação$/m);
  });

  it("lê a dissecação do bloco JSON, e nível de consciência fora da lista vira vazio", () => {
    expect(parseDissecacao(resposta(DISSECACAO)).dissecacao).toEqual(DISSECACAO);
    expect(parseDissecacao(resposta({ ...DISSECACAO, nivel_consciencia: "muito consciente" })).dissecacao!.nivel_consciencia).toBe("");
    const sem = parseDissecacao("## Formato\nSó texto.");
    expect(sem).toMatchObject({ dissecacao: null, semBlocoJson: true, md: "## Formato\nSó texto." });
  });

  it("o snapshot guardado não leva os links de CDN, que expiram", () => {
    expect(snapshotDoAnuncio({ id: 1, media_url: "x", thumb_url: "y", ad_copy: "z" })).toEqual({ id: 1, ad_copy: "z" });
  });
});

describe("a rodada", () => {
  it("vídeo sem transcrição passa pelo Whisper antes, e a transcrição volta para o anúncio", async () => {
    const d = deps();
    const final = await runCriativo({ id: "c1", ad: makeAd(7), deps: d });
    expect(d.baixar).toHaveBeenCalledOnce();
    expect(d.gravarAnuncio).toHaveBeenCalledWith(7, {
      transcript: "Oi, eu sou a doutora Ana.",
      transcript_lang: "pt",
      transcript_model: "small",
    });
    expect(d.perguntar.mock.calls[0][0]).toContain("Oi, eu sou a doutora Ana.");
    expect(final).toMatchObject({ status: "done", dissecacao: DISSECACAO });
    // O snapshot gravado já leva a transcrição: a análise salva mostra o que o agente leu.
    expect(d.gravar).toHaveBeenCalledWith(expect.objectContaining({ ad: expect.objectContaining({ transcript: "Oi, eu sou a doutora Ana." }) }));
  });

  it("vídeo já transcrito e fonte sem arquivo (YouTube, Google) não passam pelo Whisper", async () => {
    expect(precisaTranscrever(makeAd(1, { transcript: "já tem" }))).toBe(false);
    expect(precisaTranscrever(makeAd(1, { media_type: "image" }))).toBe(false);
    expect(precisaTranscrever(makeAd(1), { downloadable: false })).toBe(false);
    const d = deps({ downloadable: false });
    await runCriativo({ id: "c1", ad: makeAd(1, { source: "youtube", transcript: "legenda do YouTube" }), deps: d });
    expect(d.baixar).not.toHaveBeenCalled();
    expect(d.perguntar).toHaveBeenCalledOnce();
  });

  it("sem vídeo não há dissecação: imagem é impossível, e o agente nem é chamado", async () => {
    const d = deps();
    await expect(runCriativo({ id: "c1", ad: makeAd(1, { media_type: "image" }), deps: d })).rejects.toThrow(
      /não tem vídeo/,
    );
    await expect(runCriativo({ id: "c1", ad: makeAd(1, { media_type: "image" }), deps: d })).rejects.toBeInstanceOf(
      DissecacaoImpossivel,
    );
    expect(d.perguntar).not.toHaveBeenCalled();
  });

  it("se o vídeo não baixa ou não transcreve, a dissecação é impossível — não segue só com o texto", async () => {
    const d = deps({ baixar: vi.fn(async () => { throw new Error("link expirado"); }) });
    await expect(runCriativo({ id: "c1", ad: makeAd(1), deps: d })).rejects.toThrow(/não foi possível baixar ou transcrever o vídeo \(link expirado\)/);
    expect(d.perguntar).not.toHaveBeenCalled();
    expect(d.gravarAnuncio).not.toHaveBeenCalled();
  });

  it("vídeo sem fala (só música) ou short sem legenda também é impossível", async () => {
    const semFala = deps({ transcrever: vi.fn(async () => ({ text: "  ", lang: "pt", model: "small" })) });
    await expect(runCriativo({ id: "c1", ad: makeAd(1), deps: semFala })).rejects.toThrow(/não tem fala/);
    const semLegenda = deps({ downloadable: false });
    await expect(runCriativo({ id: "c1", ad: makeAd(1, { source: "youtube" }), deps: semLegenda })).rejects.toThrow(
      /não tem fala/,
    );
    expect(mensagemImpossivel("o anúncio não tem vídeo")).toBe("Dissecação não é possível: o anúncio não tem vídeo.");
  });

  it("a fonte completa a peça antes (texto do TikTok, legenda do YouTube)", async () => {
    const d = deps({
      downloadable: false,
      completar: vi.fn(async (p: SpyAd) => ({ ...p, ad_copy: "Texto que veio do detalhe", transcript: "legenda" })),
    });
    await runCriativo({ id: "c1", ad: makeAd(1, { ad_copy: "" }), deps: d });
    expect(d.perguntar.mock.calls[0][0]).toContain("Texto que veio do detalhe");
  });

  it("resposta vazia do agente é erro, não uma análise em branco", async () => {
    const d = deps({ perguntar: vi.fn(async (_prompt: string) => "   ") });
    await expect(runCriativo({ id: "c1", ad: makeAd(1, { transcript: "x" }), deps: d })).rejects.toThrow(/vazio/);
  });
});

describe("voto e tag", () => {
  it("o sistema de voto e tag aceita o criativo como um terceiro tipo de item", () => {
    expect(ALVOS).toEqual(["analise", "composicao", "criativo"]);
    expect(alvoValido("criativo")).toBe(true);
  });

  it("a migração libera o tipo novo no CHECK das duas tabelas", () => {
    const sql = fs.readFileSync(
      path.resolve(process.cwd(), "supabase/migrations/20261017_ad_spy_analises_criativos_EXTERNAL.sql"),
      "utf-8",
    );
    expect(sql.match(/check \(alvo_tipo in \('analise', 'composicao', 'criativo'\)\)/g)).toHaveLength(2);
  });
});

describe("relatório da mineração", () => {
  it("tira a seção de dissecação do texto e mantém as outras", () => {
    const md = "## Leitura geral\nA.\n\n## Dissecação\n| # |\n|---|\n| 1 |\n### sub\nB\n\n## Ganchos\nC.";
    expect(semDissecacao(md)).toBe("## Leitura geral\nA.\n\n## Ganchos\nC.");
    expect(semDissecacao("## Leitura geral\nA.\n\n## Dissecação\nfim")).toBe("## Leitura geral\nA.\n\n");
    expect(semDissecacao(null)).toBeNull();
  });
});

describe("lista de Análises de Criativos", () => {
  const c = (over: Partial<SpyCriativoResumo>): SpyCriativoResumo =>
    ({
      id: "x", titulo: null, especialidades: ["Odontologia"], status: "done", favorito: false,
      ad: { id: 1, source: "meta", found_via: null, page_name: "Clínica Sorriso", media_type: "video", thumb_path: null, ad_copy: "" },
      ...over,
    }) as SpyCriativoResumo;

  it("busca por nome ou anunciante, e recorta favoritos", () => {
    const lista = [c({ id: "a", titulo: "Lente — 12 out" }), c({ id: "b", titulo: null }), c({ id: "d", titulo: "Outra", favorito: true, ad: null })];
    expect(filtrarCriativos(lista, { busca: "lente" }).map((x) => x.id)).toEqual(["a"]);
    expect(filtrarCriativos(lista, { busca: "sorriso" }).map((x) => x.id)).toEqual(["a", "b"]);
    expect(filtrarCriativos(lista, { soFavoritos: true }).map((x) => x.id)).toEqual(["d"]);
    expect(nomeDoCriativo(lista[1])).toBe("Clínica Sorriso");
  });

  it("o nome padrão é o anunciante e a data", () => {
    expect(tituloPadraoCriativo({ page_name: "Clínica Sorriso" }, new Date("2026-10-17T12:00:00"))).toMatch(
      /^Clínica Sorriso — 17 de out\.? de 2026$/,
    );
  });
});

describe("botão Analisar Criativo", () => {
  const tela = (ui: React.ReactNode) =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <TooltipProvider>{ui}</TooltipProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

  it("fica dentro do anúncio e pede a análise com a origem, o anúncio e a especialidade", () => {
    startMutate.mockReset();
    tela(
      <AdDetailDialog
        ad={makeAd(5)}
        open
        onOpenChange={() => {}}
        selected={false}
        origemCriativo={{ libraryEntryId: "lib-1" }}
        especialidadeCriativo="Odontologia"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /analisar criativo/i }));
    // Vídeo ainda sem fala: o diálogo avisa que transcreve antes.
    expect(screen.getByText(/a fala é transcrita antes/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^analisar$/i }));
    expect(startMutate).toHaveBeenCalledOnce();
    expect(startMutate.mock.calls[0][0]).toMatchObject({
      libraryEntryId: "lib-1",
      adId: 5,
      especialidade: "Odontologia",
      titulo: expect.stringMatching(/^Clínica Sorriso — /),
    });
  });

  it("sem especialidade, não deixa analisar", () => {
    tela(<AdDetailDialog ad={makeAd(5)} open onOpenChange={() => {}} selected={false} origemCriativo={{ runId: "r" }} />);
    fireEvent.click(screen.getByRole("button", { name: /analisar criativo/i }));
    expect(screen.getByRole("button", { name: /^analisar$/i })).toBeDisabled();
  });

  it("anúncio sem vídeo: o botão aparece apagado, dizendo que não há dissecação", () => {
    tela(
      <AdDetailDialog ad={makeAd(5, { media_type: "image" })} open onOpenChange={() => {}} selected={false} origemCriativo={{ runId: "r" }} />,
    );
    const b = screen.getByRole("button", { name: /analisar criativo \(sem vídeo\)/i });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute("title", expect.stringMatching(/não tem vídeo/));
  });

  it("sem origem (a tela não sabe de onde a peça veio), não aparece", () => {
    tela(<AdDetailDialog ad={makeAd(5)} open onOpenChange={() => {}} selected={false} />);
    expect(screen.queryByRole("button", { name: /analisar criativo/i })).toBeNull();
  });
});

// --- análise de conteúdo orgânico --------------------------------------------------------------

import { buildSpyPrompt, CORPUS_ORGANICO, corpusOrganico } from "../../apps/ad-spy-worker/analyze.js";
import { AnalysisReport } from "@/components/marketing/mineracao/AnalysisReport";
import { analiseOrganica, semSecoes } from "@/components/marketing/mineracao/relatorioTexto";

describe("análise de conteúdo orgânico", () => {
  const reel = (id: number) => makeAd(id, { source: "instagram", transcript: "fala" });
  const anuncio = (id: number) => makeAd(id, { transcript: "fala" });

  it("o prompt de um corpus só orgânico abre com o marcador que a regra 14 do agente espera", () => {
    const prompt = buildSpyPrompt({ tema: "lentes", ads: [reel(1), makeAd(2, { source: "tiktok_organic" })] });
    expect(prompt.split("\n")[0]).toBe(CORPUS_ORGANICO);
    const md = fs.readFileSync(path.resolve(process.cwd(), "apps/ad-spy-worker/agent/spyagent.md"), "utf-8");
    expect(md).toContain(`quando a mensagem começar com \`${CORPUS_ORGANICO}\``);
  });

  it("corpus de anúncios (ou misto, de runs antigas) não leva o marcador", () => {
    expect(buildSpyPrompt({ tema: "x", ads: [anuncio(1)] }).split("\n")[0]).toBe("## Tema pesquisado");
    expect(buildSpyPrompt({ tema: "x", ads: [anuncio(1), reel(2)] })).not.toContain(CORPUS_ORGANICO);
    expect(corpusOrganico([])).toBe(false);
  });

  it("TikTok Ads e Meta não são orgânicos; Instagram, TikTok e YouTube são", () => {
    expect(analiseOrganica([{ source: "instagram" }, { source: "tiktok_organic" }, { source: "youtube" }])).toBe(true);
    expect(analiseOrganica([{ source: "instagram" }, { source: "tiktok" }])).toBe(false);
    expect(analiseOrganica([])).toBe(false);
  });

  it("na tela, a análise orgânica não mostra fatias de público, o que parece funcionar nem sugestões", () => {
    const analysis = {
      publicos: [{ fatia: "Quem já fez e ficou artificial", demanda: "imediata" as const }],
      o_que_funciona: ["Abrir com a dor"],
      sugestoes: [{ titulo: "Teste de gancho", detalhe: "x" }],
      temas: [{ nome: "Vergonha de sorrir", exemplos: [1] }],
    };
    const md =
      "## Leitura geral\nA.\n\n## Ganchos\nB.\n\n## Fatias de público\nC.\n\n## O que parece funcionar\nD.\n\n## Sugestões\nE.\n";
    const { unmount } = render(<AnalysisReport analysisMd={md} analysis={analysis} organico />);
    expect(screen.getByText("Vergonha de sorrir")).toBeInTheDocument();
    expect(screen.queryByText(/quem já fez e ficou artificial/i)).toBeNull();
    expect(screen.queryByText("Abrir com a dor")).toBeNull();
    expect(screen.queryByText("Teste de gancho")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /ler o relatório em texto/i }));
    expect(screen.getByRole("heading", { name: /ganchos/i })).toBeInTheDocument();
    for (const t of [/fatias de público/i, /o que parece funcionar/i, /sugestões/i]) {
      expect(screen.queryByRole("heading", { name: t })).toBeNull();
    }
    unmount();

    // A mesma análise, de anúncio: tudo aparece.
    render(<AnalysisReport analysisMd={md} analysis={analysis} />);
    expect(screen.getByText(/quem já fez e ficou artificial/i)).toBeInTheDocument();
    expect(screen.getByText("Teste de gancho")).toBeInTheDocument();
  });

  it("tira várias seções do texto de uma vez, sem tocar nas outras", () => {
    expect(semSecoes("## A\n1\n## B\n2\n## C\n3\n", ["B", "C"])).toBe("## A\n1\n");
    expect(semSecoes("## A\n1\n", [])).toBe("## A\n1\n");
  });
});

// --- análises de criativo como insumo do Composer ----------------------------------------------

import { blocoCriativos, buildComposerPrompt } from "../../apps/ad-spy-worker/composer-prompt.js";

describe("análise de criativo no prompt do Composer", () => {
  const cri = {
    titulo: "Lente — vergonha de sorrir",
    ad: { page_name: "Clínica Sorriso", ad_copy: "Tem vergonha de sorrir?" },
    dissecacao: { ...DISSECACAO },
    dissecacao_md: "## Formato\nVídeo.",
  };

  it("entra como referência de concorrente, com as cinco partes e o aviso de não copiar", () => {
    const txt = blocoCriativos([cri], 5000);
    expect(txt).toMatch(/^# Análises de criativos de concorrentes/);
    expect(txt).toMatch(/NÃO copie/);
    expect(txt).toContain("## Lente — vergonha de sorrir");
    expect(txt).toContain("Anunciante: Clínica Sorriso");
    expect(txt).toContain("Estrutura: Pergunta sobre a dor, procedimento, convite.");
    expect(txt).toContain("Nível de consciência: consciente do problema");
  });

  it("sem o JSON, vai o texto; sem nada, não entra", () => {
    expect(blocoCriativos([{ ...cri, dissecacao: null }], 5000)).toContain("## Formato\nVídeo.");
    expect(blocoCriativos([{ titulo: "x", dissecacao: null, dissecacao_md: null }], 5000)).toBe("");
    expect(blocoCriativos([], 5000)).toBe("");
  });

  it("dissecação longa é cortada dizendo que foi cortada", () => {
    const longa = { ...cri, dissecacao: { ...DISSECACAO, anatomia_semantica: "x".repeat(5000) } };
    expect(blocoCriativos([longa], 1200)).toContain("(cortado)");
  });

  it("vai no prompt da composição quando escolhida, e só então", () => {
    const ficha = { nome: "Dr. José", especialidades: ["Odontologia"] };
    expect(buildComposerPrompt({ ficha, criativos: [cri] })).toContain("# Análises de criativos de concorrentes");
    expect(buildComposerPrompt({ ficha })).not.toContain("# Análises de criativos de concorrentes");
  });
});


// --- criativo interno (do próprio cliente) -----------------------------------------------------

describe("criativo interno: do link do post ao vídeo", () => {
  const linha = {
    Ad_ID: "120211111111111",
    Client: "Dr. Leonel | Groohub",
    Nome_Anuncio: "Reel avanço capilar",
    Headline: "Agende sua avaliação",
    Thumbnail_URL: "https://x.supabase.co/storage/v1/object/public/meta-ads-creativos/1.jpg",
    Media_URL: "https://x.supabase.co/storage/v1/object/public/meta-ads-creativos/1.jpg",
    Video_Permalink: "https://www.facebook.com/122104211271391710/videos/1020689847343373",
    Ad_Criado_Em: "2026-09-02T10:00:00-0300",
  };

  it("a linha da conta de anúncios vira a peça que o agente lê, ainda sem texto nem arquivo", () => {
    expect(pecaDoCriativoInterno(linha)).toMatchObject({
      source: "meta",
      external_id: "120211111111111",
      title: "Agende sua avaliação",
      media_type: "video",
      permalink: linha.Video_Permalink,
      thumb_public_url: linha.Thumbnail_URL,
      started_running_on: "2026-09-02",
    });
    expect(pecaDoCriativoInterno({ ...linha, Video_Permalink: null }).media_type).toBe("image");
  });

  it("só link de vídeo do Facebook vai à API", () => {
    expect(permalinkValido(linha.Video_Permalink)).toBe(true);
    expect(permalinkValido("https://www.facebook.com/120241416958450384/videos/2163405311171546/?idorvanity=120241416958450384")).toBe(true);
    expect(permalinkValido("https://evil.example/x/videos/123456")).toBe(false);
    expect(permalinkValido(null)).toBe(false);
  });

  it("o post devolve o vídeo e o texto do anúncio", async () => {
    const scGet = vi.fn(async () => ({
      success: true,
      description: "Com o avanço capilar assimétrico, dá pra corrigir as entradas.",
      video: { sd_url: "https://video.fbcdn.net/sd.mp4", hd_url: "https://video.fbcdn.net/hd.mp4" },
    }));
    const p = await completarInterno(pecaDoCriativoInterno(linha), { scGet });
    expect(scGet).toHaveBeenCalledWith("/v1/facebook/post", { url: linha.Video_Permalink }, expect.anything());
    expect(p).toMatchObject({
      media_type: "video",
      media_url: "https://video.fbcdn.net/hd.mp4",
      ad_copy: "Com o avanço capilar assimétrico, dá pra corrigir as entradas.",
    });
  });

  it("post fechado (pede login), sem arquivo ou sem link: impossível, com o motivo", async () => {
    const fechado = vi.fn(async () => ({ success: true, message: "Shoot it looks like the post either doesn't exist, or is behind the login" }));
    await expect(completarInterno(pecaDoCriativoInterno(linha), { scGet: fechado })).rejects.toThrow(/não está público/);
    const semArquivo = vi.fn(async () => ({ success: true, description: "x" }));
    await expect(completarInterno(pecaDoCriativoInterno(linha), { scGet: semArquivo })).rejects.toThrow(/não devolveu o arquivo/);
    const nunca = vi.fn();
    await expect(
      completarInterno(pecaDoCriativoInterno({ ...linha, Video_Permalink: null }), { scGet: nunca }),
    ).rejects.toBeInstanceOf(DissecacaoImpossivel);
    expect(nunca).not.toHaveBeenCalled();
  });

  it("na rodada, o motivo do post fechado chega inteiro (não vira 'falha técnica')", async () => {
    const d = deps({
      completar: vi.fn(async () => {
        throw new DissecacaoImpossivel("o vídeo do anúncio não está público (o Facebook só o mostra com login)");
      }),
    });
    await expect(runCriativo({ id: "c1", ad: pecaDoCriativoInterno(linha), deps: d })).rejects.toThrow(/não está público/);
    expect(d.perguntar).not.toHaveBeenCalled();
  });

  it("com o arquivo do vídeo guardado, não depende do link do post (VID 005 do Dr. Aurelio)", async () => {
    const comArquivo = { ...linha, Video_URL: "https://x.supabase.co/storage/v1/object/public/meta-ads-videos/5.mp4", Video_Permalink: null };
    const peca = pecaDoCriativoInterno(comArquivo);
    expect(peca).toMatchObject({ media_type: "video", media_url: comArquivo.Video_URL });

    const nunca = vi.fn();
    const p = await completarInterno(peca, { scGet: nunca });
    expect(p.media_url).toBe(comArquivo.Video_URL);
    expect(nunca).not.toHaveBeenCalled();

    // Com link também, o post vale só pelo TEXTO; se ele falhar, a dissecação segue com o arquivo.
    const caiu = vi.fn(async () => {
      throw new Error("Scrape Creators fora");
    });
    const comLink = pecaDoCriativoInterno({ ...comArquivo, Video_Permalink: linha.Video_Permalink });
    await expect(completarInterno(comLink, { scGet: caiu })).resolves.toMatchObject({ media_url: comArquivo.Video_URL });
  });

  it("aceita as formas de link de vídeo do Facebook, e diz qual link não serviu", async () => {
    for (const u of [
      "https://www.facebook.com/dr.aurelio/videos/titulo-do-video/1020689847343373/",
      "https://www.facebook.com/reel/1020689847343373",
      "https://m.facebook.com/watch/?v=1020689847343373",
    ]) {
      expect(permalinkValido(u)).toBe(true);
    }
    expect(permalinkValido("https://www.facebook.com.evil.com/x/videos/123456")).toBe(false);

    const estranho = { ...pecaDoCriativoInterno({ ...linha, Video_Permalink: null }), permalink: "https://www.facebook.com/photo/?fbid=123" };
    await expect(completarInterno(estranho, { scGet: vi.fn() })).rejects.toThrow(/fbid=123/);
  });

  it("o prompt diz que o anúncio é do próprio cliente", () => {
    expect(buildDissecacaoPrompt(makeAd(1), { interno: true })).toMatch(/do PRÓPRIO cliente/);
    expect(buildDissecacaoPrompt(makeAd(1))).not.toMatch(/do PRÓPRIO cliente/);
  });
});

import {
  analisePorAnuncio,
  escolhivel,
  estadoDoInterno,
  filtrarInternos,
  numerosDoAnuncio,
} from "@/components/marketing/composer/criativoInterno";

describe("criativos internos na tela", () => {
  it("o selo: dissecado, dissecando, impossível, sem vídeo ou não dissecado — e quem pode ser escolhido", () => {
    const comVideo = { videoPermalink: "https://www.facebook.com/1/videos/2" };
    expect(estadoDoInterno(comVideo, { status: "done" })).toBe("dissecado");
    expect(estadoDoInterno(comVideo, { status: "running" })).toBe("dissecando");
    expect(estadoDoInterno(comVideo, { status: "error" })).toBe("impossivel");
    expect(estadoDoInterno(comVideo, undefined)).toBe("nao_dissecado");
    expect(estadoDoInterno({ videoPermalink: null }, undefined)).toBe("sem_video");
    expect(["dissecado", "dissecando", "nao_dissecado"].every((e) => escolhivel(e as never))).toBe(true);
    expect(escolhivel("sem_video")).toBe(false);
    // Desde 19/10/2026 "impossível" pode ser escolhido de novo: escolher é tentar outra vez.
    expect(escolhivel("impossivel")).toBe(true);
    // O arquivo guardado também é vídeo — é o que o card da aba Meta Ads toca.
    expect(estadoDoInterno({ videoPermalink: null, videoUrl: "https://x.supabase.co/v.mp4" }, undefined)).toBe("nao_dissecado");
  });

  it("a análise que vale é a mais recente de cada anúncio", () => {
    const m = analisePorAnuncio([
      { id: "novo", meta_ad_id: "1", status: "done" },
      { id: "velho", meta_ad_id: "1", status: "error" },
      { id: "outro", meta_ad_id: "2", status: "running" },
      { id: "concorrente", meta_ad_id: null, status: "done" },
    ] as never);
    expect(m.get("1")?.id).toBe("novo");
    expect(m.get("2")?.id).toBe("outro");
    expect(m.size).toBe(2);
  });

  it("busca por nome, título ou campanha", () => {
    const a = (nome: string, headline: string | null = null) => ({ nome, headline, campanha: "GROOHUB 003 - Leads" }) as never;
    const lista = [a("Reel avanço capilar"), a("Carrossel", "Calvície tem solução")];
    expect(filtrarInternos(lista, "calvicie")).toHaveLength(1);
    expect(filtrarInternos(lista, "groohub")).toHaveLength(2);
    expect(filtrarInternos(lista, "")).toHaveLength(2);
  });

  it("os números do criativo, em uma linha, só com o que existe", () => {
    const agg = {
      gasto: 1234.5, resultado: 42, tipoResultado: "Conversas iniciadas", custoPorResultado: 29.39,
      impressoes: 50000, ctr: 1.8, cpc: 2.1, hookRate: 31.2, holdRate: 0,
    };
    const txt = numerosDoAnuncio({ agg } as never, "de 1 set 2026 a 30 set 2026");
    expect(txt).toBe(
      "de 1 set 2026 a 30 set 2026: investimento R$ 1.234,50, 42 Conversas iniciadas, custo por resultado R$ 29,39, " +
        "50.000 impressões, CTR 1,8%, CPC R$ 2,10, hook 31,2%",
    );
    expect(numerosDoAnuncio({ agg: { gasto: 0, resultado: 0, custoPorResultado: 0, impressoes: 0, ctr: 0, cpc: 0, hookRate: 0, holdRate: 0 } } as never, "x")).toBe("");
  });
});

describe("criativo interno no prompt do Composer", () => {
  it("vai como anúncio do próprio cliente, e os números só quando vieram no pedido", () => {
    const base = { titulo: "Reel avanço capilar", origem: "cliente", ad: { ad_copy: "Corrija as entradas." }, dissecacao: { ...DISSECACAO } };
    const sem = blocoCriativos([base], 5000);
    expect(sem).toMatch(/^# Análise de um criativo do próprio cliente/);
    expect(sem).toContain("Origem: anúncio do PRÓPRIO cliente");
    expect(sem).not.toContain("Números deste anúncio");
    const com = blocoCriativos([{ ...base, numeros: "set: investimento R$ 10,00" }], 5000);
    expect(com).toContain("Números deste anúncio na conta do cliente (set: investimento R$ 10,00)");
  });
});

// --- dissecação versão 2: frase a frase, movimentos, blocos e a estrutura para agentes -----------

import { resumoDaDissecacao } from "../../apps/ad-spy-worker/criativo.js";
import { estruturaParaAgentes } from "../../shared/dissecacao-agentes.js";
import { DissecacaoCriativo } from "@/components/marketing/mineracao/DissecacaoCriativo";

const FALA = "Você tem vergonha de sorrir nas fotos? A culpa não é sua. Clareamento caseiro não resolve.";

const V2 = {
  versao: 2,
  frases: [
    { origem: "fala", texto: "Você tem vergonha de sorrir nas fotos?", original: "", funcoes: ["qualifica o público"], explicacao: "Faz quem tem o problema se reconhecer.", movimento: 1 },
    { origem: "fala", texto: "A culpa não é sua.", original: "", funcoes: ["cria identificação"], explicacao: "Tira o peso da pessoa.", movimento: 2 },
    { origem: "fala", texto: "Clareamento caseiro não resolve.", original: "", funcoes: ["descredibiliza solução comum"], explicacao: "Mostra que o que ela tentou não serve.", movimento: 2 },
    { origem: "texto", texto: "Agende sua avaliação.", original: "", funcoes: ["faz CTA"], explicacao: "Diz o próximo passo.", movimento: null },
  ],
  movimentos: [
    { n: 1, nome: "Qualifica o público", como_funciona: "Nomeia uma situação que só quem tem o problema reconhece.", bloco: 1 },
    { n: 2, nome: "Descredibiliza solução comum", como_funciona: "Mostra por que o que a pessoa já tentou falhou.", bloco: 2 },
  ],
  blocos: [
    { n: 1, nome: "Chama e qualifica o público" },
    { n: 2, nome: "Destrói a solução atual" },
  ],
  formato: "Vídeo vertical.",
  anatomia_semantica: "Coloquial; omite preço.",
  anatomia_psicologica: "Ataca a vergonha.",
  nivel_consciencia: "consciente_problema",
};

const respostaV2 = (obj: unknown) => "## Frase a frase\n> \"…\"\n\n```json\n" + JSON.stringify(obj) + "\n```";

describe("dissecação versão 2", () => {
  it("lê frases, movimentos e blocos; escreve a estrutura a partir dos blocos", () => {
    const { dissecacao } = parseDissecacao(respostaV2(V2), { transcript: FALA });
    expect(dissecacao).toMatchObject({ versao: 2, ligacoes: true, cobertura_baixa: false });
    expect(dissecacao!.estrutura).toBe("Chama e qualifica o público → Destrói a solução atual");
    expect(dissecacao!.frases).toHaveLength(4);
    expect(dissecacao!.frases[3]).toMatchObject({ origem: "texto", movimento: null });
  });

  it("frase a frase que pula a fala marca cobertura baixa", () => {
    const curta = { ...V2, frases: V2.frases.slice(0, 1) };
    expect(parseDissecacao(respostaV2(curta), { transcript: FALA }).dissecacao!.cobertura_baixa).toBe(true);
    // A tradução é medida pela original.
    const traduzida = { ...V2, frases: V2.frases.map((f) => ({ ...f, texto: "x", original: f.texto })) };
    expect(parseDissecacao(respostaV2(traduzida), { transcript: FALA }).dissecacao!.cobertura_baixa).toBe(false);
  });

  it("ligação quebrada mantém as listas e tira as ligações", () => {
    const voltaBloco = { ...V2, movimentos: [{ ...V2.movimentos[0], bloco: 2 }, { ...V2.movimentos[1], bloco: 1 }] };
    const indiceInexistente = { ...V2, frases: [{ ...V2.frases[0], movimento: 9 }, ...V2.frases.slice(1)] };
    for (const caso of [voltaBloco, indiceInexistente]) {
      const d = parseDissecacao(respostaV2(caso)).dissecacao!;
      expect(d.ligacoes).toBe(false);
      expect(d.frases.every((f: { movimento: unknown }) => f.movimento === null)).toBe(true);
      expect(d.movimentos.every((m: { bloco: unknown }) => m.bloco === null)).toBe(true);
      expect(d.blocos).toHaveLength(2);
    }
  });

  it("a lista leva só os campos curtos", () => {
    const d = parseDissecacao(respostaV2(V2)).dissecacao!;
    const r = resumoDaDissecacao(d);
    expect(r).not.toHaveProperty("frases");
    expect(r).not.toHaveProperty("movimentos");
    expect(r.blocos).toHaveLength(2);
  });

  it("o contrato do spyagent é um JSON válido de versão 2, que o parser aceita", () => {
    const md = fs.readFileSync(path.resolve(process.cwd(), "apps/ad-spy-worker/agent/spyagent.md"), "utf-8");
    const contrato = md.split("\n").find((l) => l.startsWith('{"versao":2'))!;
    expect(contrato).toBeDefined();
    expect(parseDissecacao("```json\n" + contrato + "\n```").dissecacao).toMatchObject({ versao: 2 });
  });
});

describe("estrutura para agentes de IA", () => {
  const d = parseDissecacao(respostaV2(V2)).dissecacao!;

  it("é a receita: blocos, movimentos e como funciona, sem as palavras da peça", () => {
    const txt = estruturaParaAgentes(d);
    expect(txt).toContain("Nível de consciência do público: consciente do problema.");
    expect(txt).toContain("1. Chama e qualifica o público");
    expect(txt).toContain("   1.1 Qualifica o público — Nomeia uma situação que só quem tem o problema reconhece.");
    expect(txt).toContain("2. Destrói a solução atual");
    expect(txt).not.toContain("vergonha de sorrir");
    expect(estruturaParaAgentes(DISSECACAO)).toBe("");
  });

  it("sem ligações, vai em duas listas", () => {
    const solta = parseDissecacao(respostaV2({ ...V2, movimentos: V2.movimentos.map((m) => ({ ...m, bloco: 7 })) })).dissecacao!;
    const txt = estruturaParaAgentes(solta);
    expect(txt).toContain("Blocos, na ordem:");
    expect(txt).toContain("Movimentos, na ordem:");
  });

  it("é o que o Composer manda; o texto do concorrente deixa de ir, o do cliente continua", () => {
    const cri = { titulo: "Lente", ad: { page_name: "Clínica Sorriso", ad_copy: "Tem vergonha de sorrir?" }, dissecacao: d, dissecacao_md: "x" };
    const conc = blocoCriativos([cri], 5000);
    expect(conc).toContain(estruturaParaAgentes(d));
    expect(conc).not.toContain("Texto do anúncio");
    expect(conc).not.toContain("Você tem vergonha");
    expect(blocoCriativos([{ ...cri, origem: "cliente" }], 5000)).toContain("Texto do anúncio: Tem vergonha de sorrir?");
  });
});

describe("dissecação versão 2 na tela", () => {
  const d = parseDissecacao(respostaV2(V2), { transcript: FALA }).dissecacao!;

  it("abre na Estrutura; o frase a frase e a análise técnica ficam nas outras abas", () => {
    render(<DissecacaoCriativo criativo={{ dissecacao: d, dissecacao_md: "" }} />);
    expect(screen.getByText("Chama e qualifica o público")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Frase a frase" }), { button: 0 });
    expect(screen.getByText("“A culpa não é sua.”")).toBeInTheDocument();
    expect(screen.getByText("Texto do anúncio")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Análise técnica" }), { button: 0 });
    expect(screen.getByText("Coloquial; omite preço.")).toBeInTheDocument();
  });

  it("a estrutura para agentes vem recolhida e, aberta, diz que é para agentes de IA", () => {
    render(<DissecacaoCriativo criativo={{ dissecacao: d, dissecacao_md: "" }} />);
    expect(screen.queryByText("Para uso de agentes de IA")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /estrutura para agentes de ia/i }));
    expect(screen.getByText("Para uso de agentes de IA")).toBeInTheDocument();
  });

  it("avisa quando o frase a frase cobre pouco da fala", () => {
    render(<DissecacaoCriativo criativo={{ dissecacao: { ...d, cobertura_baixa: true }, dissecacao_md: "" }} />);
    expect(screen.getByText(/pode ter pulado trechos/)).toBeInTheDocument();
  });

  it("a dissecação antiga continua aparecendo como antes", () => {
    render(<DissecacaoCriativo criativo={{ dissecacao: DISSECACAO as never, dissecacao_md: "" }} />);
    expect(screen.getByText("Pergunta sobre a dor, procedimento, convite.")).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });
});
