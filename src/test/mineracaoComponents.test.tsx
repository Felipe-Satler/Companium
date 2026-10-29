import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { MineracaoHeader } from "@/components/marketing/mineracao/MineracaoHeader";
import { MineracaoSubnav } from "@/components/marketing/mineracao/MineracaoSubnav";
import { PipelineProgress } from "@/components/marketing/mineracao/PipelineProgress";
import { AnalysisReport } from "@/components/marketing/mineracao/AnalysisReport";
import { AdCard } from "@/components/marketing/mineracao/AdCard";
import { AdGrid } from "@/components/marketing/mineracao/AdGrid";
import { SaveToLibraryDialog } from "@/components/marketing/mineracao/SaveToLibraryDialog";
import { MineracaoForm } from "@/components/marketing/mineracao/MineracaoForm";
import type { SpyAd, SpyRun, SpyStage, SpyStageKey } from "@/lib/adSpyApi";

// O card agora baixa vídeo, e para isso lê o token da sessão.
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: { access_token: "tok" } }),
}));

// Imagens vêm do bucket privado por fetch autenticado -> blob URL. Em jsdom isso não existe, e o
// fallback (iniciais, ícone) é justamente o que interessa testar.
vi.mock("@/hooks/useAdSpy", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useAdSpy")>("@/hooks/useAdSpy");
  return { ...actual, useSpyMedia: () => null };
});

// A lista de especialidades vem do Supabase; no teste, uma lista fixa.
vi.mock("@/hooks/useEspecialidades", () => ({
  useEspecialidades: () => ({
    especialidadeOptions: ["Dermatologia", "Cirurgia Plástica", "Tricologia"],
    getEspecialidades: () => [],
    loading: false,
  }),
}));

// O grid NÃO pode observar a rolagem: buscar mais gasta crédito e tem de ser um clique. Este stub
// conta quem tentar — se alguém reintroduzir o carregamento automático, o teste abaixo acusa.
const observadoresCriados: unknown[] = [];
class IOStub {
  constructor(...args: unknown[]) {
    observadoresCriados.push(args);
  }
  observe() {}
  disconnect() {}
  unobserve() {}
}
Object.defineProperty(window, "IntersectionObserver", { writable: true, value: IOStub });

const withProviders = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>
      <TooltipProvider>{ui}</TooltipProvider>
    </MemoryRouter>
  </QueryClientProvider>
);

function stage(key: SpyStageKey, label: string, over: Partial<SpyStage> = {}): SpyStage {
  return { key, label, status: "pending", done: 0, total: null, started_at: null, ended_at: null, note: null, ...over };
}

function makeSearch(over: Partial<SpyRun["search"]> = {}): SpyRun["search"] {
  return {
    exhausted: false,
    buffered: 0,
    creditsUsed: 1,
    pagesUsed: 1,
    found: 0,
    rejected: 0,
    target: 12,
    creditBudget: 30,
    note: null,
    ...over,
  };
}

function makeRun(over: Partial<SpyRun> = {}): SpyRun {
  return {
    id: "run-1",
    user_id: "u-1",
    tema: "transplante capilar",
    sources: ["meta"],
    settings: {
      country: "BR",
      language: null,
      status: "ACTIVE",
      mediaType: "video",
      sortBy: "impressions",
      startDate: null,
      endDate: null,
      targetAds: 12,
      minDaysRunning: 30,
      minCollationCount: 0,
      maxPerAdvertiser: 3,
      minCopyChars: 40,
      transcribe: true,
    },
    extra_prompt: null,
    status: "awaiting_selection",
    stages: [
      stage("discover", "Busca", { status: "done" }),
      stage("download", "Download"),
      stage("transcribe", "Transcrição"),
      stage("analyze", "Análise"),
    ],
    cancel_requested: false,
    analysis_md: null,
    analysis: null,
    meta_provider: "scrapecreators",
    error: null,
    search: makeSearch(),
    criado_em: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  };
}

function makeAd(id: number, over: Partial<SpyAd> = {}): SpyAd {
  return {
    id,
    run_id: "run-1",
    source: "meta",
    external_id: `14980592619825${id}`,
    page_name: `Felipe Bueno ${id}`,
    page_id: "1114455566677",
    page_profile_uri: null,
    permalink: null,
    ad_copy: `Evolução transplante capilar ${id}`,
    title: null,
    cta_text: "Saiba mais",
    link_url: null,
    display_format: "VIDEO",
    publisher_platform: ["INSTAGRAM"],
    started_running_on: "2026-04-25",
    days_running: 145,
    media_type: "video",
    thumb_path: `p/${id}.jpg`,
    avatar_path: null,
    media_path: null,
    media_url: null,
    duration_sec: 30,
    transcript: null,
    transcript_lang: null,
    transcript_model: null,
    collation_count: 13,
    is_active: true,
    selected: false,
    criado_em: new Date().toISOString(),
    ...over,
  };
}

// ---------------------------------------------------------------------------------------------

describe("MarketingHeader (compartilhado com as páginas irmãs)", () => {
  it("mantém as abas das páginas irmãs e o caminho de volta para a Mineração", () => {
    render(<MemoryRouter><MarketingHeader activeTab="Paid Media" /></MemoryRouter>);
    for (const label of ["Paid Media", "Social", "PACE", "Metas"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: /mineração/i })).toBeInTheDocument();
  });
});

describe("MineracaoHeader", () => {
  it("tem as seções de Marketing, e NÃO as análises salvas (que viraram subnavegação)", () => {
    render(<MemoryRouter><MineracaoHeader activeTab="Mineração" /></MemoryRouter>);
    for (const label of [/^mineração$/i, /^central de clientes$/i, /^composer$/i]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: /biblioteca de análises/i })).not.toBeInTheDocument();
    for (const label of ["Paid Media", "Social", "PACE"]) {
      expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
    }
  });

  it("marca a aba ativa", () => {
    render(<MemoryRouter><MineracaoHeader activeTab="Composer" /></MemoryRouter>);
    expect(screen.getByRole("button", { name: /^composer$/i }).className).toContain("bg-primary");
    expect(screen.getByRole("button", { name: /^mineração$/i }).className).not.toContain("bg-primary");
  });
});

describe("MineracaoSubnav", () => {
  it("tem Nova Mineração, Minerações Salvas e Análises de Criativos, nessa ordem, e marca o atual", () => {
    render(<MemoryRouter><MineracaoSubnav activeTab="Minerações Salvas" /></MemoryRouter>);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Nova Mineração",
      "Minerações Salvas",
      "Análises de Criativos",
    ]);
    const salvas = screen.getByRole("button", { name: /minerações salvas/i });
    expect(salvas).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: /nova mineração/i })).not.toHaveAttribute("aria-current");
  });

  it("é visualmente secundária: não usa o azul da pílula do cabeçalho", () => {
    render(<MemoryRouter><MineracaoSubnav activeTab="Nova Mineração" /></MemoryRouter>);
    // Hierarquia só existe se as duas barras forem distinguíveis à primeira vista.
    expect(screen.getByRole("button", { name: /nova mineração/i }).className).not.toContain("bg-primary");
  });
});

describe("MineracaoForm", () => {
  /** Abre "Configurações de qualidade" e devolve o onStart espionado. */
  function abrirAvancado() {
    const onStart = vi.fn();
    render(withProviders(<MineracaoForm onStart={onStart} />));
    fireEvent.click(screen.getByRole("button", { name: /configurações de qualidade/i }));
    return onStart;
  }

  it("pede 12 anúncios por padrão e diz quanto isso pode custar", () => {
    render(withProviders(<MineracaoForm onStart={vi.fn()} />));
    expect(screen.getByLabelText(/quantidade a buscar/i)).toHaveTextContent("12");
    // 12/4 * 10 = 30. O número aparece ANTES de gastar, não depois.
    expect(screen.getByText(/gastar 30 créditos/i)).toBeInTheDocument();
  });

  it("os filtros de qualidade são campos de digitar, não sliders", () => {
    abrirAvancado();
    for (const nome of [
      /rodando há no mínimo/i,
      /mínimo de anúncios usando o criativo/i,
      /máximo por anunciante/i,
      /texto mínimo/i,
    ]) {
      expect(screen.getByLabelText(nome)).toHaveAttribute("type", "number");
    }
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });

  it("parte com só a replicação ligada: 5 no criativo e nenhum outro filtro", () => {
    abrirAvancado();
    // Longevidade desligada: somada à replicação, estreitava demais o funil.
    expect(screen.getByLabelText(/rodando há no mínimo/i)).toHaveValue(0);
    expect(screen.getByLabelText(/mínimo de anúncios usando o criativo/i)).toHaveValue(5);
    expect(screen.getByLabelText(/máximo por anunciante/i)).toHaveValue(0);
    expect(screen.getByLabelText(/texto mínimo/i)).toHaveValue(0);
  });

  it("os dois campos lado a lado começam na mesma altura", () => {
    // jsdom não calcula layout, então o que dá para garantir é a causa: rótulo `flex` é caixa de
    // bloco e mede o conteúdo; <label> inline herda a altura da linha da div e fica alguns pixels
    // mais alto. Misturar os dois num grid de duas colunas foi o que desalinhou os campos.
    render(withProviders(<MineracaoForm onStart={vi.fn()} />));
    const esquerda = screen.getByText(/quantidade a buscar/i);
    const direita = screen.getByText(/mínimo de anúncios usando o criativo/i);
    expect(esquerda.className).toBe(direita.className);
    expect(esquerda.className).toContain("flex");
  });

  it("as duas de sempre ficam à mão, sem abrir as configurações de qualidade", () => {
    render(withProviders(<MineracaoForm onStart={vi.fn()} />));
    expect(screen.getByLabelText(/quantidade a buscar/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/mínimo de anúncios usando o criativo/i)).toBeInTheDocument();
    // O resto continua guardado.
    expect(screen.queryByLabelText(/máximo por anunciante/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/texto mínimo/i)).not.toBeInTheDocument();
  });

  it("cada filtro diz a que fonte vale, e apaga quando nenhuma fonte dele está marcada", () => {
    abrirAvancado();
    const campo = (rotulo: RegExp) => screen.getByLabelText(rotulo).closest("[data-filtro]") as HTMLElement;

    // Só Meta marcada (o padrão): o filtro de engajamento é de orgânico, então apaga e explica.
    const engajamento = campo(/engajamento mínimo/i);
    expect(engajamento).toHaveAttribute("data-aplica", "nao");
    expect(engajamento).toHaveTextContent(/nenhuma fonte marcada usa este filtro/i);
    expect(engajamento.querySelector("[aria-label^='Vale para']")).toHaveAttribute(
      "aria-label",
      "Vale para: TikTok, Instagram, YouTube",
    );
    // A longevidade vale para a Meta: acesa.
    expect(campo(/rodando há no mínimo/i)).toHaveAttribute("data-aplica", "sim");

    // Marcar o Instagram acende o engajamento.
    fireEvent.click(screen.getByRole("radio", { name: /^instagram$/i }));
    expect(campo(/engajamento mínimo/i)).toHaveAttribute("data-aplica", "sim");
    // Uma fonte por vez: com o Instagram escolhido, a Meta saiu, e a longevidade apagou.
    expect(campo(/rodando há no mínimo/i)).toHaveAttribute("data-aplica", "nao");
  });

  it("só uma fonte por vez, na ordem Meta Ads, Google Ads, TikTok Ads, Instagram, TikTok, YouTube Shorts", () => {
    const onStart = vi.fn();
    render(withProviders(<MineracaoForm onStart={onStart} isStarting={false} />));
    const grupo = screen.getByRole("radiogroup", { name: /fonte/i });
    const opcoes = within(grupo).getAllByRole("radio");
    expect(opcoes.map((o) => o.textContent)).toEqual([
      "Meta Ads",
      "Google Ads",
      "TikTok Ads",
      "Instagram",
      "TikTok",
      "YouTube Shorts",
    ]);
    expect(screen.getByRole("radio", { name: /^meta ads$/i })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("radio", { name: /^tiktok ads$/i }));
    expect(opcoes.filter((o) => o.getAttribute("aria-checked") === "true").map((o) => o.textContent)).toEqual([
      "TikTok Ads",
    ]);
    fireEvent.change(screen.getByLabelText(/tema de interesse/i), { target: { value: "lentes" } });
    fireEvent.click(screen.getByRole("button", { name: /buscar anúncios/i }));
    // "TikTok Ads" é a Biblioteca de Anúncios: a fonte `tiktok`, sozinha.
    expect(onStart.mock.calls[0][0].sources).toEqual(["tiktok"]);
  });

  it("Google Ads: pelo tema por padrão; anunciantes e sites exige ao menos um alvo", () => {
    const onStart = vi.fn();
    render(withProviders(<MineracaoForm onStart={onStart} isStarting={false} />));
    fireEvent.change(screen.getByLabelText(/tema de interesse/i), { target: { value: "implante" } });
    fireEvent.click(screen.getByRole("radio", { name: /^google ads$/i }));
    expect(screen.getByText(/não busca por palavra-chave/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /anunciantes e sites/i }));
    expect(screen.getByRole("button", { name: /buscar anúncios/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/anunciantes e sites/i, { selector: "textarea" }), {
      target: { value: "clinicaexemplo.com.br" },
    });
    fireEvent.click(screen.getByRole("button", { name: /buscar anúncios/i }));
    expect(onStart.mock.calls[0][0].sources).toEqual(["google", "google_advertiser"]);
    expect(onStart.mock.calls[0][0].settings.googleAdvertisers).toEqual(["clinicaexemplo.com.br"]);
  });

  it("YouTube Shorts voltou: shorts por palavra-chave por padrão", () => {
    const onStart = vi.fn();
    render(withProviders(<MineracaoForm onStart={onStart} isStarting={false} />));
    fireEvent.change(screen.getByLabelText(/tema de interesse/i), { target: { value: "implante" } });
    fireEvent.click(screen.getByRole("radio", { name: /^youtube shorts$/i }));
    fireEvent.click(screen.getByRole("button", { name: /buscar anúncios/i }));
    expect(onStart.mock.calls[0][0].sources).toEqual(["youtube_shorts"]);
  });

  it("Instagram é só orgânico: não oferece mais o modo de anúncios", () => {
    render(withProviders(<MineracaoForm onStart={vi.fn()} isStarting={false} />));
    fireEvent.click(screen.getByRole("radio", { name: /^instagram$/i }));
    expect(screen.queryByRole("checkbox", { name: /^anúncios/i })).toBeNull();
    expect(screen.getByRole("checkbox", { name: /reels por palavra-chave/i })).toBeInTheDocument();
  });

  it("TikTok é só orgânico: vídeos por padrão, e cada modo vira a sua fonte", () => {
    const onStart = vi.fn();
    render(withProviders(<MineracaoForm onStart={onStart} isStarting={false} />));
    fireEvent.change(screen.getByLabelText(/tema de interesse/i), { target: { value: "lentes" } });
    fireEvent.click(screen.getByRole("radio", { name: /^tiktok$/i }));
    expect(screen.queryByRole("checkbox", { name: /^anúncios/i })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /vídeos da hashtag/i }));
    fireEvent.click(screen.getByRole("button", { name: /buscar anúncios/i }));
    // Sem a Biblioteca de Anúncios junto: ela é a fonte "TikTok Ads", escolhida à parte.
    expect(onStart.mock.calls[0][0].sources).toEqual(["tiktok_videos", "tiktok_hashtag"]);
    expect(onStart.mock.calls[0][0].settings).toMatchObject({ tiktokHashtag: null, tiktokProfiles: [] });
  });

  it("TikTok › Perfis e links exige ao menos um alvo, e manda os que foram colados", () => {
    const onStart = vi.fn();
    render(withProviders(<MineracaoForm onStart={onStart} isStarting={false} />));
    fireEvent.change(screen.getByLabelText(/tema de interesse/i), { target: { value: "lentes" } });
    fireEvent.click(screen.getByRole("radio", { name: /^tiktok$/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /perfis e links/i }));
    expect(screen.getByRole("button", { name: /buscar anúncios/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/perfis e links/i, { selector: "textarea" }), {
      target: { value: "@dra.exemplo\nhttps://vm.tiktok.com/ZMabc123/" },
    });
    fireEvent.click(screen.getByRole("button", { name: /buscar anúncios/i }));
    expect(onStart.mock.calls[0][0].sources).toContain("tiktok_profile");
    expect(onStart.mock.calls[0][0].settings.tiktokProfiles).toEqual(["@dra.exemplo", "https://vm.tiktok.com/ZMabc123/"]);
  });

  it("manda os filtros digitados, e mídia de todos os tipos por padrão", () => {
    const onStart = abrirAvancado();
    fireEvent.change(screen.getByLabelText(/tema de interesse/i), {
      target: { value: "transplante capilar" },
    });
    fireEvent.change(screen.getByLabelText(/rodando há no mínimo/i), { target: { value: "120" } });
    fireEvent.click(screen.getByRole("button", { name: /buscar anúncios/i }));

    expect(onStart).toHaveBeenCalledOnce();
    expect(onStart.mock.calls[0][0].settings).toMatchObject({
      targetAds: 12,
      minDaysRunning: 120,
      minCollationCount: 5,
      maxPerAdvertiser: 0,
      minCopyChars: 0,
      mediaType: "all",
    });
  });
});

describe("AdCard", () => {
  /**
   * Abre o menu "Abrir". Pelo teclado de propósito: o Radix abre no `pointerdown`, e o jsdom não
   * tem PointerEvent — além de que abrir por teclado é o caminho que precisa funcionar de verdade.
   */
  function abrirMenu() {
    fireEvent.keyDown(screen.getByRole("button", { name: /abrir o anúncio em outro lugar/i }), {
      key: "Enter",
    });
  }

  it("mostra as métricas no formato da Biblioteca da Meta", () => {
    render(withProviders(<AdCard ad={makeAd(1)} selected={false} onToggle={() => {}} />));
    expect(screen.getByText(/145 dias/i)).toBeInTheDocument();
    expect(screen.getByText("Ativo")).toBeInTheDocument();
    expect(screen.getByText(/identificação da biblioteca/i)).toBeInTheDocument();
    expect(screen.getByText(/13 anúncios/)).toBeInTheDocument();
    expect(screen.getByText(/usam esse criativo e esse texto/)).toBeInTheDocument();
    expect(screen.getByText("Patrocinado")).toBeInTheDocument();
  });

  it("mostra o título do anúncio no card, não só no detalhe", () => {
    render(withProviders(<AdCard ad={makeAd(1, { title: "Transplante capilar sem raspar" })} selected={false} />));
    expect(screen.getByText("Transplante capilar sem raspar")).toBeInTheDocument();
  });

  it("não fala de replicação quando só 1 anúncio usa o criativo", () => {
    render(withProviders(<AdCard ad={makeAd(1, { collation_count: 1 })} selected={false} />));
    expect(screen.queryByText(/usam esse criativo/)).not.toBeInTheDocument();
  });

  it("tem os dois botões: selecionar e ver na origem", () => {
    const onToggle = vi.fn();
    render(withProviders(<AdCard ad={makeAd(7)} selected={false} onToggle={onToggle} />));
    fireEvent.click(screen.getByRole("checkbox", { name: /selecionar para a análise/i }));
    expect(onToggle).toHaveBeenCalledWith(7);
    abrirMenu();
    const origem = screen.getByRole("menuitem", { name: /anúncio na biblioteca/i });
    // Montado do external_id — não do permalink guardado, que é uma URL de busca.
    expect(origem).toHaveAttribute(
      "href",
      "https://www.facebook.com/ads/library/?id=149805926198257",
    );
    expect(origem).toHaveAttribute("target", "_blank");
    // E os outros caminhos pedidos no menu.
    for (const nome of [/todos os anúncios do anunciante/i, /perfil do anunciante/i]) {
      expect(screen.getByRole("menuitem", { name: nome })).toBeInTheDocument();
    }
  });

  it("oferece baixar o vídeo só quando há arquivo para baixar", () => {
    // Vídeo com link da CDN: dá para baixar.
    const { unmount } = render(
      withProviders(<AdCard ad={makeAd(9, { media_url: "https://cdn/x.mp4" })} selected={false} />),
    );
    expect(screen.getByRole("button", { name: /baixar o vídeo/i })).toBeInTheDocument();
    unmount();

    // Só a cópia durável no bucket também serve.
    const so = render(
      withProviders(<AdCard ad={makeAd(10, { media_path: "u/r/10.mp4" })} selected={false} />),
    );
    expect(screen.getByRole("button", { name: /baixar o vídeo/i })).toBeInTheDocument();
    so.unmount();

    // Vídeo sem arquivo nenhum, e imagem: nada para baixar.
    const sem = render(withProviders(<AdCard ad={makeAd(11)} selected={false} />));
    expect(screen.queryByRole("button", { name: /baixar o vídeo/i })).not.toBeInTheDocument();
    sem.unmount();

    render(
      withProviders(
        <AdCard
          ad={makeAd(12, { media_type: "image", media_url: "https://cdn/x.jpg" })}
          selected={false}
        />,
      ),
    );
    expect(screen.queryByRole("button", { name: /baixar o vídeo/i })).not.toBeInTheDocument();
  });

  it("o bloco do anúncio abre o detalhe, com o texto inteiro", () => {
    const copyLonga = "Evolução transplante capilar ".repeat(20).trim();
    render(withProviders(<AdCard ad={makeAd(3, { ad_copy: copyLonga })} selected={false} />));
    // Na grade o texto vive cortado (line-clamp); o detalhe é onde ele aparece inteiro.
    fireEvent.click(screen.getByRole("button", { name: /ver o anúncio completo/i }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(copyLonga)).toBeInTheDocument();
    // Mesmos controles do card, e não botões largos: o "Abrir" do detalhe também é menu.
    fireEvent.keyDown(
      within(dialog).getByRole("button", { name: /abrir o anúncio em outro lugar/i }),
      { key: "Enter" },
    );
    expect(screen.getByRole("menuitem", { name: /anúncio na biblioteca/i })).toHaveAttribute(
      "href",
      "https://www.facebook.com/ads/library/?id=149805926198253",
    );
  });

  it("o detalhe toca o vídeo quando o link da CDN ainda vale", () => {
    const mediaUrl = "https://scontent.xx.fbcdn.net/v/video.mp4?oe=abc";
    const { container } = render(
      withProviders(<AdCard ad={makeAd(8, { media_url: mediaUrl })} selected={false} />),
    );
    fireEvent.click(screen.getByRole("button", { name: /ver o anúncio completo/i }));
    expect(container.ownerDocument.querySelector("video")).toHaveAttribute("src", mediaUrl);
  });

  it("ignora o permalink guardado: o da fonte é uma URL de BUSCA, não do anúncio", () => {
    // Uma URL de busca da Biblioteca (com `search_type`/`sort_data`), que é o que a fonte guarda
    // no `permalink`. O link do card tem de ser montado pelo id, não herdado daqui.
    const deBusca =
      "https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL" +
      "&id=1498059261982517&is_targeted_country=false&media_type=all&search_type=page" +
      "&sort_data[mode]=total_impressions&sort_data[direction]=desc";
    render(withProviders(<AdCard ad={makeAd(5, { permalink: deBusca })} selected={false} />));
    abrirMenu();
    const href = screen
      .getByRole("menuitem", { name: /anúncio na biblioteca/i })
      .getAttribute("href") ?? "";
    expect(href).toBe("https://www.facebook.com/ads/library/?id=149805926198255");
    expect(href).not.toContain("search_type");
  });

  it("sem id numérico válido, não oferece link nenhum", () => {
    render(withProviders(<AdCard ad={makeAd(4, { external_id: "undefined" })} selected={false} />));
    expect(screen.queryByRole("link", { name: /ver na biblioteca/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /abrir o criativo/i })).not.toBeInTheDocument();
  });

  it("no teto de seleção, desabilita marcar mais — mas deixa desmarcar", () => {
    const { rerender } = render(withProviders(<AdCard ad={makeAd(1)} selected={false} onToggle={() => {}} selectDisabled />));
    expect(screen.getByRole("checkbox")).toBeDisabled();
    rerender(withProviders(<AdCard ad={makeAd(1)} selected onToggle={() => {}} selectDisabled />));
    expect(screen.getByRole("checkbox")).not.toBeDisabled();
  });

  it("sem onToggle é só leitura (Biblioteca), com o número de citação", () => {
    render(withProviders(<AdCard ad={makeAd(1)} selected={false} citeIndex={4} />));
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByText("#4")).toBeInTheDocument();
  });

  it("usa as iniciais quando não há avatar", () => {
    render(withProviders(<AdCard ad={makeAd(1, { page_name: "Felipe Bueno" })} selected={false} />));
    expect(screen.getByText("FB")).toBeInTheDocument();
  });
});

describe("AdGrid", () => {
  const baseProps = {
    selectedIds: new Set<number>(),
    onToggle: () => {},
    onClearSelection: () => {},
    onLoadMore: () => {},
    isLoadingMore: false,
    onAnalyze: () => {},
    isAnalyzing: false,
    maxSelected: 30,
  };

  it("com seleção, oferece a análise e a dispara", () => {
    const onAnalyze = vi.fn();
    render(withProviders(
      <AdGrid {...baseProps} run={makeRun()} ads={[makeAd(1), makeAd(2)]} selectedIds={new Set([1, 2])} onAnalyze={onAnalyze} />,
    ));
    expect(screen.getAllByText("2 selecionados").length).toBeGreaterThan(0);
    const botoes = screen.getAllByRole("button", { name: /analisar selecionados/i });
    fireEvent.click(botoes[0]);
    expect(onAnalyze).toHaveBeenCalledOnce();
  });

  it("a análise também fica acima do grid, não só na barra flutuante", () => {
    // A barra flutuante já foi invisível uma vez: era `sticky` dentro de um `<main overflow-auto>`
    // que nunca rola, então ela caía no fim da página, abaixo de todos os cards. Um botão antes do
    // grid não depende de posicionamento nenhum.
    const { container } = render(withProviders(
      <AdGrid {...baseProps} run={makeRun()} ads={[makeAd(1), makeAd(2)]} selectedIds={new Set([1, 2])} />,
    ));
    const grid = container.querySelector(".grid");
    const primeiro = screen.getAllByRole("button", { name: /analisar selecionados/i })[0];
    expect(grid).toBeTruthy();
    // DOCUMENT_POSITION_FOLLOWING: o grid vem DEPOIS do botão.
    expect(primeiro.compareDocumentPosition(grid!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // E a barra flutuante não pode voltar a ser `sticky`.
    expect(container.querySelector(".sticky")).toBeNull();
  });

  it("com a barra flutuante na tela, o conteúdo reserva espaço embaixo", () => {
    // A barra é `fixed` e centralizada, bem em cima do "Buscar mais anúncios" do rodapé.
    const { container, rerender } = render(withProviders(
      <AdGrid {...baseProps} run={makeRun()} ads={[makeAd(1)]} selectedIds={new Set([1])} />,
    ));
    expect((container.firstChild as HTMLElement).className).toContain("pb-24");
    rerender(withProviders(<AdGrid {...baseProps} run={makeRun()} ads={[makeAd(1)]} />));
    expect((container.firstChild as HTMLElement).className).not.toContain("pb-24");
  });

  it("avisa quando os anúncios vêm do stub de desenvolvimento", () => {
    const { rerender } = render(withProviders(
      <AdGrid {...baseProps} run={makeRun({ meta_provider: "stub" })} ads={[makeAd(1)]} />,
    ));
    expect(screen.getByText(/dados de exemplo/i)).toBeInTheDocument();
    rerender(withProviders(
      <AdGrid {...baseProps} run={makeRun({ meta_provider: "scrapecreators" })} ads={[makeAd(1)]} />,
    ));
    expect(screen.queryByText(/dados de exemplo/i)).not.toBeInTheDocument();
  });

  it("com a busca parada, mostra o balanço: achados, descartados e créditos", () => {
    render(withProviders(
      <AdGrid
        {...baseProps}
        run={makeRun({
          search: makeSearch({ found: 9, rejected: 47, creditsUsed: 23, target: 12, creditBudget: 30 }),
        })}
        ads={[makeAd(1)]}
      />,
    ));
    const balanco = screen.getByText(/descartado/i);
    expect(balanco).toHaveTextContent("9");
    expect(balanco).toHaveTextContent("12");
    expect(balanco).toHaveTextContent("47");
    expect(balanco).toHaveTextContent("23");
    expect(balanco).toHaveTextContent("30");
  });

  it("enquanto busca, não mostra balanço — os números ainda estão mudando", () => {
    render(withProviders(
      <AdGrid
        {...baseProps}
        run={makeRun({ status: "searching", search: makeSearch({ found: 3, rejected: 20 }) })}
        ads={[makeAd(1)]}
      />,
    ));
    expect(screen.queryByText(/descartado/i)).not.toBeInTheDocument();
  });

  it("mostra os filtros que a run guardou, inclusive quando o de replicação está desligado", () => {
    const { rerender } = render(withProviders(
      <AdGrid {...baseProps} run={makeRun()} ads={[makeAd(1)]} />,
    ));
    expect(screen.getByText("sem filtro de replicação")).toBeInTheDocument();
    rerender(withProviders(
      <AdGrid
        {...baseProps}
        run={makeRun({ settings: { ...makeRun().settings, minCollationCount: 6 } })}
        ads={[makeAd(1)]}
      />,
    ));
    expect(screen.getByText("6+ anúncios com o criativo")).toBeInTheDocument();
  });

  it("sem seleção, nada de barra", () => {
    render(withProviders(<AdGrid {...baseProps} run={makeRun()} ads={[makeAd(1)]} />));
    expect(screen.queryByRole("button", { name: /analisar selecionados/i })).not.toBeInTheDocument();
  });

  it("nunca busca sozinho: rolar não pode gastar crédito", () => {
    const onLoadMore = vi.fn();
    observadoresCriados.length = 0;
    render(withProviders(
      <AdGrid {...baseProps} run={makeRun()} ads={[makeAd(1), makeAd(2)]} onLoadMore={onLoadMore} />,
    ));
    // Nenhum IntersectionObserver: não existe gatilho de rolagem para disparar por acidente.
    expect(observadoresCriados).toHaveLength(0);
    expect(onLoadMore).not.toHaveBeenCalled();
    // E o caminho para continuar é sempre o botão, dizendo quanto pode custar.
    expect(screen.getByRole("button", { name: /buscar mais/i })).toBeInTheDocument();
    expect(screen.getByText(/até 30 créditos/i)).toBeInTheDocument();
  });

  it("bloco incompleto vira decisão explícita: mostra a nota e um botão, não carrega sozinho", () => {
    const onLoadMore = vi.fn();
    const note = "Bloco incompleto: 3 página(s) (3 crédito(s)) trouxeram só 2 anúncio(s)";
    render(withProviders(
      <AdGrid {...baseProps} run={makeRun({ search: makeSearch({ creditsUsed: 3, pagesUsed: 3, note }) })} ads={[makeAd(1)]} onLoadMore={onLoadMore} />,
    ));
    expect(screen.getByText(/bloco incompleto/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /buscar mais/i }));
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it("busca esgotada: diz que acabou e não oferece buscar mais", () => {
    render(withProviders(
      <AdGrid {...baseProps} run={makeRun({ search: makeSearch({ exhausted: true, creditsUsed: 2, pagesUsed: 2, note: "Fim da busca: não há mais anúncios que atendam aos filtros." }) })} ads={[makeAd(1)]} />,
    ));
    expect(screen.getByText(/fim da busca/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /buscar mais/i })).not.toBeInTheDocument();
  });

  it("enquanto busca, mostra quanto já gastou", () => {
    render(withProviders(
      <AdGrid
        {...baseProps}
        run={makeRun({ status: "searching", search: makeSearch({ creditsUsed: 3, pagesUsed: 3 }) })}
        ads={[makeAd(1)]}
      />,
    ));
    expect(screen.getByText(/3 créditos usados até agora/i)).toBeInTheDocument();
  });

  it("durante a análise, os cards não podem ser remarcados", () => {
    render(withProviders(<AdGrid {...baseProps} run={makeRun({ status: "running" })} ads={[makeAd(1)]} selectedIds={new Set([1])} />));
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});

describe("PipelineProgress", () => {
  const analysisStages = (over: Partial<Record<SpyStageKey, Partial<SpyStage>>>) =>
    makeRun().stages.map((s) => ({ ...s, ...(over[s.key] || {}) }));

  it("mostra só as etapas da análise — a busca tem o próprio progresso no grid", () => {
    render(<PipelineProgress run={makeRun({ status: "running", stages: analysisStages({ download: { status: "running", done: 2, total: 5 } }) })} />);
    for (const label of ["Download", "Transcrição", "Análise"]) expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByText("Busca")).not.toBeInTheDocument();
    expect(screen.getByText("2/5")).toBeInTheDocument();
  });

  it("oferece cancelar enquanto analisa", () => {
    const onCancel = vi.fn();
    render(<PipelineProgress run={makeRun({ status: "running" })} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /cancelar/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("em falha, oferece refazer e diz que a seleção continua salva", () => {
    const onReanalyze = vi.fn();
    render(<PipelineProgress run={makeRun({ status: "error", error: "a saída do agente não é JSON" })} onReanalyze={onReanalyze} />);
    expect(screen.getByText(/continuam salvos/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /refazer análise/i }));
    expect(onReanalyze).toHaveBeenCalledOnce();
  });
});

describe("AnalysisReport", () => {
  const comPaineis = () =>
    render(
      <AnalysisReport
        analysisMd={"## Leitura geral\n\nVende por **prova social**."}
        analysis={{ temas: [{ nome: "Prova social", frequencia: 7, exemplos: [1, 3] }] }}
        actions={<button>Salvar na Biblioteca</button>}
      />,
    );

  it("mostra os painéis primeiro e guarda o texto atrás de um clique", () => {
    comPaineis();
    // Painel à vista; o relatório em texto, não.
    expect(screen.getByText("Prova social")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /salvar na biblioteca/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /leitura geral/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /ler o relatório em texto/i }));
    expect(screen.getByRole("heading", { name: /leitura geral/i })).toBeInTheDocument();
  });

  it("os painéis vêm ANTES do texto no documento", () => {
    const { container } = comPaineis();
    fireEvent.click(screen.getByRole("button", { name: /ler o relatório em texto/i }));
    const painel = screen.getByText("Prova social");
    const texto = screen.getByRole("heading", { name: /leitura geral/i });
    expect(container).toBeTruthy();
    expect(painel.compareDocumentPosition(texto) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("sem painéis, o texto já vem aberto — senão o card ficaria vazio", () => {
    render(<AnalysisReport analysisMd={"## Leitura geral\n\nTexto."} analysis={null} />);
    expect(screen.getByRole("heading", { name: /leitura geral/i })).toBeInTheDocument();
  });

  it("não mostra mais a dissecação por anúncio — nem a de análises antigas, no painel ou no texto", () => {
    // Desde 17/10/2026 a dissecação é pedida peça a peça, em Análises de Criativos.
    render(
      <AnalysisReport
        analysisMd={"## Leitura geral\n\nTexto.\n\n## Dissecação\n\n| # | Formato |\n|---|---|\n| 3 | Depoimento |\n\n## Ganchos\n\nUm gancho."}
        analysis={{
          dissecacoes: [{ ad_id: 3, formato: "Depoimento", anatomia_psicologica: "ataca o medo" }],
          temas: [{ nome: "Medo", exemplos: [3] }],
        }}
      />,
    );
    expect(screen.queryByText(/dissecação por anúncio/i)).toBeNull();
    expect(screen.queryByText(/ataca o medo/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /ler o relatório em texto/i }));
    expect(screen.getByRole("heading", { name: /leitura geral/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /ganchos/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /dissecação/i })).toBeNull();
    expect(screen.queryByText("Depoimento")).toBeNull();
  });

  it("marca qual fatia de público é demanda imediata", () => {
    render(
      <AnalysisReport
        analysisMd="x"
        analysis={{
          publicos: [
            { fatia: "Quem já fez e ficou artificial", demanda: "imediata", por_que_segmentar: "ninguém cobre", exemplos: [1] },
            { fatia: "Quem ainda nem cogitou", demanda: "latente", evidencia: "só anúncio novo" },
          ],
        }}
      />,
    );
    expect(screen.getByText(/quem já fez e ficou artificial/i)).toBeInTheDocument();
    expect(screen.getByText(/demanda imediata/i)).toBeInTheDocument();
    expect(screen.getByText(/demanda latente/i)).toBeInTheDocument();
    expect(screen.getByText(/ninguém cobre/i)).toBeInTheDocument();
  });

  it("análise antiga só com dissecação conta como sem painéis: o texto vem aberto", () => {
    render(
      <AnalysisReport
        analysisMd={"## Leitura geral\n\nTexto."}
        analysis={{ dissecacoes: [{ ad_id: 1, formato: "x" }] }}
      />,
    );
    expect(screen.getByRole("heading", { name: /leitura geral/i })).toBeInTheDocument();
  });

  it("sanitiza o markdown do agente (é saída de modelo)", () => {
    render(<AnalysisReport analysisMd={'Texto <img src=x onerror="window.__pwned=1"> fim.'} analysis={null} />);
    expect(document.querySelector("img")?.getAttribute("onerror") ?? null).toBeNull();
    expect(document.querySelector("script")).toBeNull();
  });

  it("diz explicitamente quando o bloco JSON não veio", () => {
    render(<AnalysisReport analysisMd="Relatório completo." analysis={null} />);
    expect(screen.getByText(/não devolveu o bloco estruturado/i)).toBeInTheDocument();
  });
});

describe("SaveToLibraryDialog", () => {
  it("exige o segmento para salvar", () => {
    const onSave = vi.fn();
    render(<SaveToLibraryDialog open onOpenChange={() => {}} defaultTitle="transplante capilar" selectedCount={5} onSave={onSave} isSaving={false} />);
    expect(screen.getByRole("button", { name: /^salvar$/i })).toBeDisabled();
    expect(screen.getByText(/obrigatório/i)).toBeInTheDocument();
  });

  it("aceita UM segmento, e é ele que vai junto com o título digitado", () => {
    const onSave = vi.fn();
    render(<SaveToLibraryDialog open onOpenChange={() => {}} defaultTitle="transplante capilar" selectedCount={5} onSave={onSave} isSaving={false} />);
    // Digitar de verdade: conferir só o default deixou passar o campo de título APAGADO.
    fireEvent.change(screen.getByLabelText(/^título$/i), {
      target: { value: "Capilar — ângulos que seguram 90 dias" },
    });
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "Tricologia" }));
    // O popover é `modal` (senão a trava de rolagem do diálogo impede rolar a lista), e enquanto
    // está aberto ele torna o resto do diálogo inerte. Fechar primeiro é o fluxo real.
    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: /^salvar$/i }));
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0][0]).toEqual({
      titulo: "Capilar — ângulos que seguram 90 dias",
      especialidade: "Tricologia",
    });
  });

  it("escolher outro segmento SUBSTITUI o anterior, não soma", () => {
    const onSave = vi.fn();
    render(<SaveToLibraryDialog open onOpenChange={() => {}} defaultTitle="x" selectedCount={1} onSave={onSave} isSaving={false} />);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "Dermatologia" }));
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "Tricologia" }));
    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: /^salvar$/i }));
    expect(onSave.mock.calls[0][0].especialidade).toBe("Tricologia");
  });

  it("diz quantos anúncios vão junto e que a equipe toda vê", () => {
    render(<SaveToLibraryDialog open onOpenChange={() => {}} defaultTitle="x" selectedCount={5} onSave={() => {}} isSaving={false} />);
    expect(screen.getByText(/5 anúncios selecionados/i)).toBeInTheDocument();
    expect(screen.getByText(/toda a equipe/i)).toBeInTheDocument();
  });
});
