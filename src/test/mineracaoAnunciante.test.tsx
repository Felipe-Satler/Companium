/**
 * "Minerar este anunciante": uma busca pela página do anunciante na Biblioteca da Meta, em vez de
 * por palavra-chave.
 *
 * O que estes testes prendem:
 *
 *   - a trilha chama a rota do ANUNCIANTE com o id da página e o cursor dela — se caísse na busca
 *     por palavra-chave, a tela mostraria anúncios de outros anunciantes sem erro nenhum;
 *   - id de página que não é numérico (o @ de um perfil, um canal) não vira trilha nem gasta crédito;
 *   - o botão só aparece onde há o que minerar, e não dentro da busca do próprio anunciante;
 *   - voltar leva à busca por palavra-chave de origem, mesmo depois de minerar um segundo anunciante.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";

const scGet = vi.fn();
vi.mock("../../apps/ad-spy-worker/sources/scrapecreators.js", () => ({
  scGet: (...a: unknown[]) => scGet(...a),
  hasKey: () => true,
  requireKey: () => {},
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: { access_token: "tok" } }),
}));
vi.mock("@/hooks/useAdSpy", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useAdSpy")>("@/hooks/useAdSpy");
  return { ...actual, useSpyMedia: () => null };
});

import { fetchNextBlock } from "../../apps/ad-spy-worker/search.js";
import { lanesFor, parseAdvertiser } from "../../apps/ad-spy-worker/sources/index.js";
import { AdCard } from "@/components/marketing/mineracao/AdCard";
import { AdGrid } from "@/components/marketing/mineracao/AdGrid";
import { AnuncianteBanner } from "@/components/marketing/mineracao/AnuncianteBanner";
import { advertiserOf, advertiserRunInput, type SpyAd, type SpyRun } from "@/lib/adSpyApi";

const PAGE_ID = "104455566677";
const RUN_UUID = "0b0e6a52-8a57-4c0e-9d6c-3f3b3a1f2c11";

/** Linha crua da rota "Company Ads", no formato da Biblioteca. */
const linha = (i: number, over: Record<string, unknown> = {}) => ({
  ad_archive_id: String(1498059261982500 + i),
  page_id: PAGE_ID,
  page_name: "Clínica Vilar",
  is_active: true,
  start_date: 1_750_000_000,
  publisher_platform: ["INSTAGRAM"],
  snapshot: { body: { text: `Criativo ${i}` }, videos: [{ video_hd_url: `https://cdn/${i}.mp4` }] },
  ...over,
});

const deps = {
  upsertAds: async (_runId: string, ads: unknown[]) => ads.map((a, i) => ({ ...(a as object), id: i })),
  rehostImages: async () => {},
};

const runDoAnunciante = (settings: Record<string, unknown> = {}) => ({
  id: "run-a",
  tema: "Clínica Vilar",
  sources: ["meta_advertiser"],
  settings: { targetAds: 8, advertiser: { pageId: PAGE_ID, pageName: "Clínica Vilar" }, ...settings },
  search_state: {},
});

beforeEach(() => {
  scGet.mockReset();
});

describe("trilha do anunciante (worker)", () => {
  it("vira uma trilha própria, com o id da página", () => {
    const { lanes, skipped } = lanesFor(runDoAnunciante());
    expect(skipped).toEqual([]);
    expect(lanes).toHaveLength(1);
    expect(lanes[0]).toMatchObject({
      id: `meta_advertiser:${PAGE_ID}`,
      label: "Anúncios de Clínica Vilar",
      params: { pageId: PAGE_ID },
    });
  });

  it("sem id de página numérico não há trilha — e isso vira nota, não crédito gasto", () => {
    for (const advertiser of [undefined, {}, { pageId: "@clinicavidal" }, { pageId: "UCabc123" }, { pageId: "12" }]) {
      const { lanes, skipped } = lanesFor(runDoAnunciante({ advertiser }));
      expect(lanes).toEqual([]);
      expect(skipped[0]).toMatch(/id da página/i);
    }
  });

  it("valida o anunciante e só aceita busca de origem em formato de id", () => {
    expect(parseAdvertiser({ pageId: ` ${PAGE_ID} `, pageName: " Clínica Vilar ", fromRunId: RUN_UUID })).toEqual({
      pageId: PAGE_ID,
      pageName: "Clínica Vilar",
      fromRunId: RUN_UUID,
    });
    expect(parseAdvertiser({ pageId: PAGE_ID, fromRunId: "../outra" })?.fromRunId).toBeNull();
    expect(parseAdvertiser({ pageId: "abc" })).toBeNull();
    expect(parseAdvertiser(null)).toBeNull();
  });

  it("busca na rota do ANUNCIANTE, com o cursor da trilha, e cobra o crédito que a API diz", async () => {
    scGet.mockResolvedValueOnce({
      results: Array.from({ length: 10 }, (_, i) => linha(i)),
      cursor: "c1",
      credits_charged: 1,
    });
    const { lanes } = lanesFor(runDoAnunciante());
    const r1 = await fetchNextBlock({ run: runDoAnunciante(), lanes, userId: "u", deps });

    expect(scGet).toHaveBeenCalledTimes(1);
    const [rota, params] = scGet.mock.calls[0];
    expect(rota).toBe("/v1/facebook/adLibrary/company/ads");
    expect(params).toMatchObject({ pageId: PAGE_ID, status: "ALL" });
    expect(params.cursor ?? null).toBeNull();
    // A palavra-chave não entra: quem define o resultado é a página.
    expect(params).not.toHaveProperty("query");

    expect(r1.added).toBe(8);
    expect(r1.state.creditsUsed).toBe(1);
    expect(r1.state.buffer).toHaveLength(2);
    expect(r1.state.lanes[`meta_advertiser:${PAGE_ID}`]).toMatchObject({ cursor: "c1", exhausted: false });

    // O bloco seguinte continua de onde parou: manda o cursor, e a última página encerra a busca.
    scGet.mockResolvedValueOnce({ results: [linha(10), linha(11)], cursor: null, credits_charged: 1 });
    const r2 = await fetchNextBlock({
      run: { ...runDoAnunciante(), search_state: r1.state },
      lanes,
      userId: "u",
      deps,
    });
    expect(scGet.mock.calls[1][1]).toMatchObject({ pageId: PAGE_ID, cursor: "c1" });
    expect(r2.added).toBe(4);
    expect(r2.note).toMatch(/fim da busca/i);
  });

  it("as peças saem como anúncios Meta, marcadas com a trilha que as achou", async () => {
    scGet.mockResolvedValueOnce({ results: [linha(1)], cursor: null });
    const { lanes } = lanesFor(runDoAnunciante());
    const page = await lanes[0].provider.fetchPage({ pageId: PAGE_ID }, null, {});
    expect(page.ads[0]).toMatchObject({ source: "meta", pageId: PAGE_ID, foundVia: "anunciante" });
  });
});

// --- tela ---------------------------------------------------------------------------------------

function makeAd(id: number, over: Partial<SpyAd> = {}): SpyAd {
  return {
    id,
    run_id: "run-1",
    source: "meta",
    external_id: `14980592619825${id}`,
    page_name: "Clínica Vilar",
    page_id: PAGE_ID,
    page_profile_uri: null,
    permalink: null,
    ad_copy: `Criativo ${id}`,
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

function makeRun(over: Partial<SpyRun> = {}): SpyRun {
  return {
    id: RUN_UUID,
    tema: "oftalmologista",
    sources: ["meta"],
    settings: { country: "PT", transcribe: false, minDaysRunning: 60, minCollationCount: 5 },
    status: "awaiting_selection",
    stages: [],
    search: {
      exhausted: false,
      buffered: 0,
      creditsUsed: 1,
      pagesUsed: 1,
      found: 1,
      rejected: 0,
      target: 28,
      creditBudget: 70,
      note: null,
    },
    ...over,
  } as SpyRun;
}

const tela = (ui: React.ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <TooltipProvider>{ui}</TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

const botaoMinerar = () => screen.queryByRole("button", { name: /minerar os anúncios de/i });

describe("pedido da busca por anunciante", () => {
  it("só anúncio da Meta com id numérico de página tem anunciante minerável", () => {
    expect(advertiserOf(makeAd(1))).toEqual({ pageId: PAGE_ID, pageName: "Clínica Vilar" });
    expect(advertiserOf(makeAd(1, { page_id: null }))).toBeNull();
    expect(advertiserOf(makeAd(1, { source: "instagram", page_id: "clinicavidal" }))).toBeNull();
    // Mesmo com id numérico: no TikTok o id é de outra biblioteca.
    expect(advertiserOf(makeAd(1, { source: "tiktok" }))).toBeNull();
  });

  it("vai sem filtro de qualidade, herdando só o país e a transcrição da busca de origem", () => {
    const input = advertiserRunInput(makeAd(1), makeRun());
    expect(input).toMatchObject({ tema: "Clínica Vilar", sources: ["meta_advertiser"] });
    expect(input!.settings).toMatchObject({
      country: "PT",
      transcribe: false,
      status: "ALL",
      advertiser: { pageId: PAGE_ID, pageName: "Clínica Vilar", fromRunId: RUN_UUID },
    });
    // Os filtros da busca de origem NÃO vêm junto: esconderiam os criativos novos do anunciante.
    expect(input!.settings).not.toHaveProperty("minDaysRunning");
    expect(input!.settings).not.toHaveProperty("minCollationCount");
  });

  it("minerar um segundo anunciante a partir do primeiro ainda volta à busca de origem", () => {
    const buscaDoPrimeiro = makeRun({
      id: "1c1e6a52-8a57-4c0e-9d6c-3f3b3a1f2c22",
      sources: ["meta_advertiser"],
      settings: { country: "BR", advertiser: { pageId: "999999", pageName: "Outro", fromRunId: RUN_UUID } },
    } as Partial<SpyRun>);
    const input = advertiserRunInput(makeAd(1), buscaDoPrimeiro);
    expect(input!.settings.advertiser!.fromRunId).toBe(RUN_UUID);
  });
});

describe("botão no card", () => {
  it("aparece em anúncio Meta quando a tela sabe começar a busca, e entrega o anúncio", () => {
    const onMine = vi.fn();
    const ad = makeAd(1);
    tela(<AdCard ad={ad} selected={false} onMineAdvertiser={onMine} />);
    fireEvent.click(botaoMinerar()!);
    expect(onMine).toHaveBeenCalledWith(ad);
  });

  it("não aparece sem handler (Biblioteca), sem id de página, nem em post orgânico", () => {
    const { unmount } = tela(<AdCard ad={makeAd(1)} selected={false} />);
    expect(botaoMinerar()).toBeNull();
    unmount();

    const semId = tela(<AdCard ad={makeAd(2, { page_id: null })} selected={false} onMineAdvertiser={() => {}} />);
    expect(botaoMinerar()).toBeNull();
    semId.unmount();

    tela(
      <AdCard
        ad={makeAd(3, { source: "instagram", page_id: "clinicavidal" })}
        selected={false}
        onMineAdvertiser={() => {}}
      />,
    );
    expect(botaoMinerar()).toBeNull();
  });
});

describe("grid da busca por anunciante", () => {
  const props = {
    selectedIds: new Set<number>(),
    onToggle: () => {},
    onClearSelection: () => {},
    onLoadMore: () => {},
    isLoadingMore: false,
    onAnalyze: () => {},
    isAnalyzing: false,
    maxSelected: 30,
  };
  const runAnunciante = makeRun({
    sources: ["meta_advertiser"],
    settings: { advertiser: { pageId: PAGE_ID, pageName: "Clínica Vilar", fromRunId: RUN_UUID } },
  } as Partial<SpyRun>);

  it("dentro do grid do anunciante, o card não oferece minerar o mesmo anunciante de novo", () => {
    tela(<AdGrid {...props} run={runAnunciante} ads={[makeAd(1)]} onMineAdvertiser={() => {}} />);
    expect(botaoMinerar()).toBeNull();
    // Outro anunciante que apareça ali (não deveria, mas a rota é de terceiros) continua minerável.
    tela(<AdGrid {...props} run={runAnunciante} ads={[makeAd(2, { page_id: "555666777" })]} onMineAdvertiser={() => {}} />);
    expect(botaoMinerar()).not.toBeNull();
  });

  it("numa busca por palavra-chave o card oferece minerar", () => {
    tela(<AdGrid {...props} run={makeRun()} ads={[makeAd(1)]} onMineAdvertiser={() => {}} />);
    expect(botaoMinerar()).not.toBeNull();
  });
});

describe("cabeçalho do grid do anunciante", () => {
  const anunciante = { pageId: PAGE_ID, pageName: "Clínica Vilar", fromRunId: RUN_UUID };

  it("diz de quem é o grid, de qual busca veio, e avisa que inativos não aparecem", () => {
    const onBack = vi.fn();
    tela(<AnuncianteBanner anunciante={anunciante} temaDeOrigem="oftalmologista" onBack={onBack} />);
    expect(screen.getByRole("heading", { name: "Clínica Vilar" })).toBeInTheDocument();
    expect(screen.getByText(/grid do anunciante/i)).toBeInTheDocument();
    expect(screen.getByText(/continua guardada/i)).toBeInTheDocument();
    expect(screen.getByText(/quase nunca aparecem/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ver na biblioteca/i })).toHaveAttribute(
      "href",
      `https://www.facebook.com/ads/library/?view_all_page_id=${PAGE_ID}`,
    );
    // Dois caminhos de volta, o do topo com o nome da busca.
    fireEvent.click(screen.getByRole("button", { name: "Busca “oftalmologista”" }));
    fireEvent.click(screen.getByRole("button", { name: /voltar à busca original/i }));
    expect(onBack).toHaveBeenCalledTimes(2);
  });

  it("sem busca de origem, a saída é uma busca nova — nunca um grid sem saída", () => {
    tela(<AnuncianteBanner anunciante={{ ...anunciante, fromRunId: null }} temaDeOrigem={null} onBack={() => {}} />);
    expect(screen.getByRole("button", { name: /fazer nova busca/i })).toBeInTheDocument();
    expect(screen.queryByText(/continua guardada/i)).toBeNull();
  });
});
