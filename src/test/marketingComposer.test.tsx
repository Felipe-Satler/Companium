/**
 * Marketing › Composer — a tela do resultado, o atalho do card e o estado otimista da mutação.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render as rtlRender,
  screen,
  fireEvent,
  waitFor,
  within,
  renderHook,
  cleanup,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ReactNode } from "react";
import { ComposicaoResultado } from "@/components/marketing/composer/ComposicaoResultado";
import { ordenarAnalises } from "@/components/marketing/composer/ordenarAnalises";
import { ComposicoesGrid } from "@/components/marketing/composer/ComposicoesGrid";
import { ComposerSubnav } from "@/components/marketing/composer/ComposerSubnav";
import { OrquestracaoPercurso } from "@/components/marketing/composer/OrquestracaoPercurso";
import type { Orquestracao } from "@/lib/orquestradorApi";
import { PipelineOrquestracao } from "@/components/marketing/composer/PipelineOrquestracao";
import { duracao } from "@/components/marketing/composer/tempoOrquestracao";
import { ClientBriefCard, type ClienteCard } from "@/components/marketing/clientes/ClientBriefCard";
import { MineracaoHeader } from "@/components/marketing/mineracao/MineracaoHeader";
import { AD_FORMATS, getFormato } from "../../shared/ad-formats";
import type { AnuncioComposto, Composicao, ComposicaoResumo } from "@/lib/adComposerApi";
import type { LibraryEntrySummary } from "@/lib/adSpyApi";

const criarMock = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: { access_token: "tok" } }),
}));

vi.mock("@/lib/adComposerApi", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/adComposerApi")>();
  return { ...real, criarComposicao: (...a: unknown[]) => criarMock(...a) };
});

import { useCreateComposition } from "@/hooks/useAdComposer";

/**
 * Router E QueryClient no wrapper: os cards e as linhas de composição trazem os controles de
 * voto/tag, que usam react-query. Eles não são o assunto deste arquivo — têm o seu —, mas sem o
 * provider o card nem renderiza.
 */
const render = (ui: ReactNode) =>
  rtlRender(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );

function composicao(over: Partial<Composicao> = {}): Composicao {
  return {
    id: "c1",
    cliente: "jose_ramos",
    nome_exibicao: "Dr. José Ramos - VascuMed",
    library_entry_id: "lib-1",
    analise_titulo: "Varizes — ângulos que sustentam",
    formato: "google_ads",
    formato_justificativa: "O material é todo de intenção de busca.",
    entradas: [
      { tipo: "brief", id: null, titulo: "Contexto Operacional" },
      { tipo: "relatorio", id: "r1", titulo: "Setembro" },
    ],
    extra_prompt: null,
    composicao_md: "A ideia é abrir pelo medo da cirurgia.",
    composicao: {
      headlines: ["Varizes sem cirurgia", "Avaliação com especialista", "Tratamento em 40 min"],
      descriptions: ["Consulta com cirurgião vascular.", "Agende hoje mesmo."],
    },
    avisos: [],
    fontes: { analise: true, brief: true, metricas: true },
    metricas: null,
    semana_de: "2026-09-07",
    semana_ate: "2026-09-13",
    status: "ok",
    error: null,
    agent_id: "composeragent",
    criado_por: "u1",
    criado_em: new Date().toISOString(),
    atualizado_em: new Date().toISOString(),
    canDelete: true,
    ...over,
  };
}

describe("ComposicaoResultado", () => {
  it("cada formato renderiza os campos da SUA spec", () => {
    for (const formato of AD_FORMATS.filter((f) => f.disponivel)) {
      const campos = Object.fromEntries(
        formato.campos.map((c) => [c.id, c.tipo === "lista" ? ["um", "dois"] : "texto"]),
      );
      const { unmount } = render(
        <ComposicaoResultado
          composicao={composicao({ formato: formato.id, composicao: campos })}
        />,
      );
      for (const campo of formato.campos) {
        expect(screen.getByText(campo.label, { exact: false })).toBeInTheDocument();
      }
      unmount();
    }
  });

  it("copiar um campo copia SÓ aquele campo", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<ComposicaoResultado composicao={composicao()} />);
    // Cada item da lista tem o seu próprio botão: ninguém cola os 3 títulos juntos no Ads Manager.
    fireEvent.click(screen.getByRole("button", { name: /copiar títulos 2/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Avaliação com especialista"));
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it("mostra o contador e destaca o que a plataforma RECUSA", () => {
    const longo = "Tratamento de varizes sem cirurgia"; // 34 > 30
    render(
      <ComposicaoResultado
        composicao={composicao({
          composicao: { headlines: [longo, "Ok", "Ok"], descriptions: ["a", "b"] },
          avisos: [
            {
              campo: "headlines",
              indice: 0,
              tipo: "excede_limite_rigido",
              detalhe: "34/30 caracteres",
            },
          ],
        })}
      />,
    );
    const contador = screen.getByText("34/30");
    expect(contador).toBeInTheDocument();
    expect(contador.className).toContain("text-destructive");
    expect(screen.getByText(/acima do limite que a plataforma aceita/i)).toBeInTheDocument();
  });

  it("diz com o que a ideia foi feita — inclusive o que faltou", () => {
    render(
      <ComposicaoResultado
        composicao={composicao({ fontes: { analise: true, brief: false, metricas: true } })}
      />,
    );
    // A fonte ausente continua na tela, riscada: some-la esconderia que a ideia saiu sem ela.
    expect(screen.getByTitle(/sem a resumo do cliente/i).className).toContain("line-through");
    expect(screen.getByTitle(/usou a análise da biblioteca/i)).toBeInTheDocument();
  });

  it("sem bloco estruturado, a prosa continua valendo", () => {
    render(<ComposicaoResultado composicao={composicao({ composicao: null })} />);
    expect(screen.getByText(/medo da cirurgia/)).toBeInTheDocument();
    expect(screen.getByText(/não devolveu o bloco estruturado/i)).toBeInTheDocument();
  });

  it("campo que o agente esqueceu aparece vazio, não some", () => {
    const formato = getFormato("google_ads")!;
    render(
      <ComposicaoResultado composicao={composicao({ composicao: { headlines: ["Só este"] } })} />,
    );
    expect(screen.getByText(formato.campos[1].label, { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/não devolveu este campo/i)).toBeInTheDocument();
  });

  it("mostra que está compondo desde o primeiro instante, antes de qualquer anúncio", () => {
    render(<ComposicaoResultado composicao={composicao({ status: "running", anuncios: [], plano: [] })} />);
    expect(screen.getByText(/compondo — escrevendo a ideia/i)).toBeInTheDocument();
    // Sem total ainda: barra indeterminada, sem porcentagem inventada.
    const barra = screen.getByRole("progressbar", { name: /compondo/i });
    expect(barra).not.toHaveAttribute("aria-valuenow");
    expect(screen.getByText(/lendo os insumos e decidindo o conjunto/i)).toBeInTheDocument();
    expect(screen.getByText(/há \d+ s|há \d+ min/)).toBeInTheDocument();
  });

  it("cancelada antes do primeiro anúncio não aparece como falha", () => {
    render(
      <ComposicaoResultado
        composicao={composicao({ status: "error", error: "Cancelada por quem pediu.", anuncios: [] })}
      />,
    );
    const aviso = screen.getByText(/composição cancelada/i);
    expect(aviso.className).not.toContain("destructive");
  });

  it("cancelada no meio mostra os prontos e diz que o conjunto ficou pela metade", () => {
    render(
      <ComposicaoResultado
        composicao={composicao({
          status: "ok",
          error: "Cancelada por quem pediu.",
          composicao: null,
          anuncios: [anuncio(), anuncio({ formato: "meta_ads", status: "error", composicao: null, error: "Cancelada por quem pediu." })],
          plano: [],
        })}
      />,
    );
    expect(screen.getByText(/cancelada — 1 de 2 anúncios ficaram prontos/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copiar títulos 1/i })).toBeInTheDocument();
  });

  it("enquanto o agente escreve, não finge que há resultado", () => {
    render(<ComposicaoResultado composicao={composicao({ status: "running" })} />);
    expect(screen.getByText(/escrevendo a ideia/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /copiar/i })).not.toBeInTheDocument();
  });

  it("erro do agente aparece em vez de uma tela vazia", () => {
    render(
      <ComposicaoResultado
        composicao={composicao({ status: "error", error: "agente fora do ar" })}
      />,
    );
    expect(screen.getByText("agente fora do ar")).toBeInTheDocument();
  });
});

/** Um anúncio de um conjunto, como o worker grava em `anuncios`. */
function anuncio(over: Partial<AnuncioComposto> = {}): AnuncioComposto {
  return {
    formato: "google_ads",
    angulo: "Quem pesquisa já decidiu tratar.",
    formato_justificativa: "Intenção de busca.",
    status: "ok",
    composicao_md: null,
    composicao: {
      headlines: ["Varizes sem cirurgia", "Avaliação com especialista", "Tratamento em 40 min"],
      descriptions: ["Consulta com cirurgião vascular.", "Agende hoje mesmo."],
    },
    avisos: [],
    error: null,
    ...over,
  };
}

describe("ComposicaoResultado — vários anúncios", () => {
  const conjunto = (anuncios: AnuncioComposto[], over: Partial<Composicao> = {}) =>
    composicao({
      anuncios,
      plano: anuncios.map((a) => ({ formato: a.formato, angulo: a.angulo, status: a.status })),
      composicao: null,
      ...over,
    });

  const stories = (over: Partial<AnuncioComposto> = {}) =>
    anuncio({
      formato: "instagram_stories",
      angulo: "O medo da anestesia, em três telas.",
      composicao: {
        sequencia: ["tela um", "tela dois", "tela três"],
        texto_na_tela: ["um", "dois", "três"],
        cta: "Agende a avaliação",
        direcao_visual: "Consultório, luz natural.",
      },
      ...over,
    });

  it("enquanto roda, diz quantos já estão prontos de quantos", () => {
    render(
      <ComposicaoResultado
        composicao={conjunto(
          [
            anuncio(),
            stories({ status: "running", composicao: null }),
            stories({ status: "pendente", composicao: null }),
          ],
          { status: "running" },
        )}
      />,
    );
    expect(screen.getByText("1 de 3")).toBeInTheDocument();
    const barra = screen.getByRole("progressbar");
    expect(barra).toHaveAttribute("aria-valuenow", "1");
    expect(barra).toHaveAttribute("aria-valuemax", "3");
    // O que já está pronto dá para ler e copiar sem esperar os outros.
    expect(screen.getByRole("button", { name: /copiar títulos 1/i })).toBeInTheDocument();
  });

  it("depois de pronta, o marcador some", () => {
    render(<ComposicaoResultado composicao={conjunto([anuncio(), stories()])} />);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("cada anúncio mostra os campos do formato DELE", () => {
    render(<ComposicaoResultado composicao={conjunto([anuncio(), stories()])} />);
    const abas = within(screen.getByRole("group", { name: /anúncios da composição/i }));
    expect(screen.getByText("Títulos", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText("Sequência de telas")).not.toBeInTheDocument();

    fireEvent.click(abas.getByRole("button", { name: /instagram stories/i }));
    expect(screen.getByText("Sequência de telas")).toBeInTheDocument();
    expect(screen.getByText("O medo da anestesia, em três telas.")).toBeInTheDocument();
    expect(screen.queryByText("Títulos", { exact: false })).not.toBeInTheDocument();
  });

  it("anúncio na fila diz que está na fila, sem campo vazio fingindo resultado", () => {
    render(
      <ComposicaoResultado
        composicao={conjunto(
          [anuncio(), stories({ status: "pendente", composicao: null })],
          { status: "running" },
        )}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /instagram stories/i }));
    expect(screen.getByText(/na fila/i)).toBeInTheDocument();
    expect(screen.queryByText(/não devolveu/i)).not.toBeInTheDocument();
  });

  it("um anúncio que falhou não esconde os outros", () => {
    render(
      <ComposicaoResultado
        composicao={conjunto([
          anuncio(),
          stories({ status: "error", composicao: null, error: "tempo esgotado" }),
        ])}
      />,
    );
    expect(screen.getByRole("button", { name: /copiar títulos 1/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /instagram stories/i }));
    expect(screen.getByText(/tempo esgotado/)).toBeInTheDocument();
  });

  it("com um anúncio só, não há abas para escolher", () => {
    render(<ComposicaoResultado composicao={conjunto([anuncio()])} />);
    expect(screen.queryByRole("group", { name: /anúncios da composição/i })).not.toBeInTheDocument();
  });
});

describe("ordenarAnalises", () => {
  const entrada = (id: string, especialidades: string[], criado_em: string) =>
    ({ id, titulo: id, tema: id, especialidades, criado_em }) as LibraryEntrySummary;

  it("põe na frente o que casa com a especialidade do cliente", () => {
    const lista = [
      entrada("harmonizacao", ["Harmonização Facial"], "2026-09-19"),
      entrada("varizes-antiga", ["Cirurgia Vascular"], "2026-01-01"),
      entrada("capilar", ["Capilar"], "2026-09-20"),
    ];
    const ordem = ordenarAnalises(lista, ["Cirurgia Vascular"]).map((x) => x.entry.id);
    // A que casa vem primeiro mesmo sendo a MAIS VELHA das três.
    expect(ordem[0]).toBe("varizes-antiga");
    // O resto continua acessível, mais recente primeiro.
    expect(ordem.slice(1)).toEqual(["capilar", "harmonizacao"]);
  });

  it("cliente sem especialidade não inventa recomendação", () => {
    const lista = [entrada("a", ["Capilar"], "2026-09-01")];
    expect(ordenarAnalises(lista, [])[0].casa).toBe(false);
  });
});

describe("ComposicoesGrid", () => {
  const item = (over: Partial<ComposicaoResumo> = {}): ComposicaoResumo => ({
    ...composicao(),
    ...over,
  });

  it("composição nos conceitos diz que espera os conceitos, sem fingir que está escrevendo", () => {
    render(
      <ComposicoesGrid
        compositions={[item({ status: "conceitos", plano: [] })]}
        onSelect={() => {}}
        onDelete={() => {}}
        apagando={null}
      />,
    );
    expect(screen.getByText("aguardando conceitos")).toBeInTheDocument();
    expect(screen.queryByText(/escrevendo/)).toBeNull();
  });

  it("mostra o formato e a análise de origem", () => {
    render(
      <ComposicoesGrid
        compositions={[item()]}
        onSelect={() => {}}
        onDelete={() => {}}
        apagando={null}
      />,
    );
    expect(screen.getByText(/Google Ads/)).toBeInTheDocument();
    expect(screen.getByText("Varizes — ângulos que sustentam")).toBeInTheDocument();
  });

  it("composição cuja análise foi apagada continua legível", () => {
    // `library_entry_id` vira NULL no delete da análise; o título copiado é o que sobra.
    render(
      <ComposicoesGrid
        compositions={[item({ library_entry_id: null })]}
        onSelect={() => {}}
        onDelete={() => {}}
        apagando={null}
      />,
    );
    expect(screen.getByText("Varizes — ângulos que sustentam")).toBeInTheDocument();
  });

  it("conta os usos do conjunto e diz quantos anúncios são", () => {
    render(
      <ComposicoesGrid
        compositions={[
          item({
            plano: [
              { formato: "instagram_reels", angulo: null, status: "ok" },
              { formato: "instagram_stories", angulo: null, status: "ok" },
              { formato: "instagram_stories", angulo: null, status: "ok" },
            ],
          }),
        ]}
        onSelect={() => {}}
        onDelete={() => {}}
        apagando={null}
      />,
    );
    expect(screen.getByText("3 anúncios")).toBeInTheDocument();
    expect(screen.getByText("Instagram Reels")).toBeInTheDocument();
    expect(screen.getByText("Instagram Stories ×2")).toBeInTheDocument();
  });

  it("composição em andamento mostra o progresso no card", () => {
    render(
      <ComposicoesGrid
        compositions={[
          item({
            status: "running",
            plano: [
              { formato: "instagram_reels", angulo: null, status: "ok" },
              { formato: "meta_ads", angulo: null, status: "running" },
            ],
          }),
        ]}
        onSelect={() => {}}
        onDelete={() => {}}
        apagando={null}
      />,
    );
    expect(screen.getByText(/1 de 2 prontos/)).toBeInTheDocument();
  });

  it("sem permissão, não oferece apagar", () => {
    render(
      <ComposicoesGrid
        compositions={[item({ canDelete: false })]}
        onSelect={() => {}}
        onDelete={() => {}}
        apagando={null}
      />,
    );
    expect(screen.queryByRole("button", { name: /apagar composição/i })).not.toBeInTheDocument();
  });
});

describe("atalho do card de Clientes", () => {
  const CLIENTE: ClienteCard = {
    padrao: "jose_ramos",
    nome: "Dr. José Ramos - VascuMed",
    especialidades: ["Cirurgia Vascular"],
    plano: "Escala",
    squad: "Marina",
    mesesDeCasa: 18,
  };

  it("leva à rota do Composer já com o cliente escolhido", () => {
    render(
      <ClientBriefCard
        cliente={CLIENTE}
        onOpen={() => {}}
        onRefresh={() => {}}
        isRefreshing={false}
      />,
    );
    const link = screen.getByRole("link", { name: /compor anúncio para/i });
    expect(link).toHaveAttribute("href", "/marketing/composer?cliente=jose_ramos");
  });

  it("o atalho não abre o detalhe junto (nem é botão dentro de botão)", () => {
    const onOpen = vi.fn();
    render(
      <ClientBriefCard
        cliente={CLIENTE}
        onOpen={onOpen}
        onRefresh={() => {}}
        isRefreshing={false}
      />,
    );
    const link = screen.getByRole("link", { name: /compor anúncio para/i });
    expect(link.closest("button")).toBeNull();
    fireEvent.click(link);
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("atalho de orquestrar no card de Clientes", () => {
  it("leva ao Orquestrador já com o cliente, sem abrir o detalhe", () => {
    const onOpen = vi.fn();
    render(
      <ClientBriefCard
        cliente={{ padrao: "jose_ramos", nome: "Dr. José Ramos", especialidades: [], plano: null, squad: null, mesesDeCasa: null }}
        onOpen={onOpen}
        onRefresh={() => {}}
        isRefreshing={false}
      />,
    );
    const link = screen.getByRole("link", { name: /orquestrar anúncios para/i });
    expect(link).toHaveAttribute("href", "/marketing/orquestrador?cliente=jose_ramos");
    fireEvent.click(link);
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("PipelineOrquestracao", () => {
  const etapa = (key: string, status: string, started_at: string | null, ended_at: string | null) =>
    ({ key, label: key, status, note: null, started_at, ended_at }) as Orquestracao["etapas"][number];

  it("mostra quanto cada etapa levou e marca a que está rodando", () => {
    render(
      <PipelineOrquestracao
        rodando={false}
        etapas={[
          etapa("numeros", "done", "2026-10-12T10:00:00Z", "2026-10-12T10:00:42Z"),
          etapa("plano", "done", "2026-10-12T10:00:42Z", "2026-10-12T10:03:47Z"),
          etapa("analise", "skipped", null, null),
          etapa("composicao", "pending", null, null),
        ]}
      />,
    );
    expect(screen.getByText("42 s")).toBeInTheDocument();
    expect(screen.getByText("3 min 05 s")).toBeInTheDocument();
    expect(screen.getByText("pulada")).toBeInTheDocument();
  });

  it("formata do segundo à hora, e não inventa tempo que não dá para calcular", () => {
    expect(duracao(5_000)).toBe("5 s");
    expect(duracao(65_000)).toBe("1 min 05 s");
    expect(duracao(4_320_000)).toBe("1 h 12 min");
    expect(duracao(NaN)).toBeNull();
    expect(duracao(-1)).toBeNull();
  });
});

describe("ComposerSubnav", () => {
  it("separa compor de reler, como a Mineração", () => {
    render(<ComposerSubnav activeTab="Composições Salvas" />);
    expect(screen.getByRole("button", { name: /nova composição/i })).not.toHaveAttribute(
      "aria-current",
    );
    expect(screen.getByRole("button", { name: /composições salvas/i })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

describe("MineracaoHeader", () => {
  it("ganha a aba Composer sem perder as anteriores", () => {
    render(<MineracaoHeader activeTab="Composer" />);
    expect(screen.getByRole("button", { name: /^mineração$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^central de clientes$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^composer$/i }).className).toContain("bg-primary");
  });

  it("o Orquestrador é um botão à parte, fora da pílula das abas", () => {
    render(<MineracaoHeader activeTab="Orquestrador" />);
    const botao = screen.getByRole("button", { name: /orquestrador/i });
    expect(botao).toHaveAttribute("aria-current", "page");
    // Fora do container das três abas: é outra coisa, não a quarta aba.
    expect(screen.getByRole("button", { name: /^composer$/i }).parentElement).not.toContainElement(botao);
  });
});

/**
 * A página inteira, com as fontes de dados mockadas.
 *
 * Os componentes acima são testados isolados; o que falta cobrir é a montagem: ler `?cliente=` da
 * URL, casar o cliente na lista de ativos e ligar os hooks. Um erro aí não aparece em nenhum teste
 * de componente — aparece na tela em branco.
 */
describe("MarketingComposer (página)", () => {
  /** Uma análise da Biblioteca como a listagem a devolve. */
  const analise = (over: Record<string, unknown> = {}) => ({
    id: "a1",
    run_id: null,
    tema: "antes e depois",
    titulo: "Antes e depois que converte",
    especialidades: ["Cirurgia Vascular"],
    saved_by: "u1",
    saved_by_name: "Augusto",
    criado_em: "2026-09-20T12:00:00.000Z",
    adCount: 12,
    coverAdIds: [1, 2, 3, 4],
    canDelete: false,
    favorito: false,
    ...over,
  });

  /** Uma análise de criativo como a listagem a devolve. */
  const criativo = (over: Record<string, unknown> = {}) => ({
    id: "c0a1f2e3-0000-4000-8000-000000000001",
    run_id: null,
    library_entry_id: null,
    ad_id: 7,
    titulo: "Lente — vergonha de sorrir",
    especialidades: ["Odontologia"],
    status: "done",
    etapa: null,
    error: null,
    dissecacao: {
      formato: "Vídeo vertical",
      estrutura: "Pergunta, procedimento, convite",
      anatomia_semantica: "Coloquial",
      anatomia_psicologica: "Vergonha de sorrir",
      nivel_consciencia: "consciente_problema",
    },
    saved_by: "u1",
    saved_by_name: "Augusto",
    criado_em: "2026-10-18T12:00:00.000Z",
    atualizado_em: "2026-10-18T12:00:00.000Z",
    canDelete: false,
    favorito: false,
    ad: { id: 7, source: "meta", found_via: null, page_name: "Clínica Sorriso", media_type: "video", thumb_path: null, ad_copy: "x" },
    ...over,
  });

  /** Um criativo do cliente como a aba Meta Ads o monta (só o que a lista lê). */
  const interno = (over: Record<string, unknown> = {}) => ({
    id: "ad-1",
    adId: "120211111111111",
    posicao: 1,
    nome: "Reel avanço capilar",
    campanha: "GROOHUB 003 - Leads",
    conjunto: "Conjunto",
    status: "ativo",
    thumbnail: null,
    media: null,
    headline: "Agende sua avaliação",
    videoUrl: null,
    videoPermalink: "https://www.facebook.com/122104211271391710/videos/1020689847343373",
    objetivo: "geracao_demanda",
    agg: { gasto: 500, resultado: 10, tipoResultado: "Conversas iniciadas", custoPorResultado: 50, impressoes: 20000, ctr: 1.5, cpc: 2, hookRate: 25, holdRate: 5 },
    ...over,
  });

  type Extras = {
    internos?: Record<string, unknown>[];
    criativos?: Record<string, unknown>[];
    criativoAberto?: Record<string, unknown> | null;
    analises?: Record<string, unknown>[];
    analiseAberta?: Record<string, unknown> | null;
    relatorioAberto?: Record<string, unknown> | null;
    /** Troca a lista de documentos do cliente (o padrão tem Estudo de Copy, outro e um de acesso). */
    documentos?: Record<string, unknown>[];
    /** A composição que a tela acompanha (sem isto, o hook de verdade). */
    composicao?: Record<string, unknown> | null;
  };

  /** O pedido de composição que a página manda — só o que ela monta, sem ir ao worker. */
  const criarMutate = vi.fn();
  const dissecarMutate = vi.fn();
  const atualizarMutate = vi.fn();

  async function montar(entrada = "/marketing/composer?cliente=jose_ramos", extras: Extras = {}) {
    vi.doMock("@/hooks/useAdComposer", async () => ({
      ...(await vi.importActual<typeof import("@/hooks/useAdComposer")>("@/hooks/useAdComposer")),
      useCreateComposition: () => ({ mutate: criarMutate, isPending: false }),
      ...("composicao" in extras
        ? { useComposition: () => ({ composition: extras.composicao, isLoading: false, error: null }) }
        : {}),
    }));
    vi.doMock("@/hooks/useMetaAdsCriativosData", () => ({
      useMetaAdsCriativosData: () => ({ anuncios: extras.internos ?? [], loading: false }),
    }));
    // O card da aba Meta Ads tem os próprios testes; aqui basta o nome dele na tela.
    vi.doMock("@/components/clientes/meta-ads/MetaAdsAnuncioCard", () => ({
      MetaAdsAnuncioCard: ({ anuncio }: { anuncio: { nome: string } }) => <div>{anuncio.nome}</div>,
      MetaAdsAnuncioDetailDialog: () => null,
    }));
    vi.doMock("@/components/DashboardLayout", () => ({
      DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    }));
    vi.doMock("@/hooks/useClientesVisiveis", () => ({ useClientesVisiveis: () => ({}) }));
    vi.doMock("@/hooks/useProjetosLista", () => ({
      useProjetosLista: () => ({
        index: { ativos: [{ padrao: "jose_ramos", nome: "Dr. José Ramos - VascuMed" }] },
        loading: false,
      }),
    }));
    vi.doMock("@/hooks/useEspecialidades", () => ({
      useEspecialidades: () => ({
        getEspecialidades: () => ["Cirurgia Vascular"],
        especialidadeOptions: ["Cirurgia Vascular", "Odontologia"],
        loading: false,
      }),
    }));
    vi.doMock("@/hooks/useAdSpy", () => ({
      useLibrary: () => ({ entries: extras.analises ?? [], isLoading: false }),
      useLibraryEntry: () => ({ entry: extras.analiseAberta ?? null, isLoading: false }),
      useCriativos: () => ({ criativos: extras.criativos ?? [], isLoading: false }),
      useCriativo: () => ({ criativo: extras.criativoAberto ?? null, isLoading: false }),
      useStartCriativoInterno: () => ({ mutate: dissecarMutate, isPending: false }),
      useAtualizarCriativo: () => ({ mutate: atualizarMutate, isPending: false }),
      // O mosaico de capas e o `AdCard` pedem a mídia por aqui. Sem miniatura eles mostram o
      // fallback, que é o que interessa ao teste.
      useSpyMedia: () => null,
    }));
    vi.doMock("@/hooks/useClientReports", () => ({
      useClientReports: () => ({
        relatorios: [
          {
            id: "r1",
            // Sem nome dado: a etapa de insumos cai para o rótulo do período.
            titulo: null,
            periodo_label: "Setembro",
            periodo_de: "2026-09-01",
            periodo_ate: "2026-09-30",
            prioridade: "gargalo",
            status: "ok",
          },
          {
            // COM nome: é por ele que a pessoa distingue dois relatórios do mesmo período, e esta é
            // a tela em que a escolha importa.
            id: "r2",
            titulo: "Setembro — depois da troca de oferta",
            periodo_label: "Setembro",
            periodo_de: "2026-09-01",
            periodo_ate: "2026-09-30",
            prioridade: "oportunidade",
            status: "ok",
          },
        ],
        isLoading: false,
      }),
      useClientReport: () => ({ relatorio: extras.relatorioAberto ?? null, isLoading: false }),
    }));
    vi.doMock("@/hooks/useClientDocs", () => ({
      useClientDocs: () => ({
        documentos: extras.documentos ?? [
          // O Estudo de Copy: em destaque no topo, e obrigatório para compor.
          { id: "d3", nome: "Estudo de Copy – Dr. José Ramos", local: "Clientes › X", via: "pagina", arquivado: false, tipo: "outro", temConteudo: true },
          // O Resumo Estratégico (Central de Copy): obrigatório e já marcado ao abrir.
          { id: "d4", nome: "Resumo Estratégico", caminho: ["Central de Copy - Dr. José Ramos"], local: "Central de Copy", via: "pagina", arquivado: false, tipo: "outro", temConteudo: true },
          // COM corpo: é o que aparece na lista principal e serve de insumo.
          { id: "d1", nome: "Estratégia 2026", local: "Clientes › X", via: "pasta", arquivado: false, tipo: "mapeamento_estrategico", temConteudo: true },
          // SEM corpo: fica na gaveta dos bloqueados, fechada por padrão.
          { id: "d2", nome: "Acessos", local: "Clientes › X", via: "pasta", arquivado: false, tipo: null, temConteudo: false },
        ],
        clickupIndisponivel: false,
        isLoading: false,
      }),
      useDocumentoConteudo: () => ({
        conteudoMd: null,
        clickupIndisponivel: true,
        motivo: "Não foi possível ler o conteúdo deste documento no ClickUp.",
        isLoading: false,
      }),
    }));

    const { default: MarketingComposer } = await import("@/pages/MarketingComposer");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rtlRender(
      <QueryClientProvider client={qc}>
        <TooltipProvider>
          <MemoryRouter initialEntries={[entrada]}>
            <MarketingComposer />
          </MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>,
    );
  }

  afterEach(() => {
    vi.doUnmock("@/components/DashboardLayout");
    vi.resetModules();
    // A tela guarda o rascunho no navegador; sem limpar, a seleção de um teste vazaria no seguinte.
    localStorage.clear();
  });

  it("abre na etapa de insumos quando o cliente vem no ?cliente=", async () => {
    await montar();
    // O cliente do link já aparece escolhido — sem isso o atalho do card não teria serventia.
    expect(await screen.findByText("Dr. José Ramos - VascuMed")).toBeInTheDocument();
    expect(screen.getByText(/com o que vamos compor/i)).toBeInTheDocument();
  });

  it("separa relatórios e documentos em colunas próprias", async () => {
    await montar();
    expect(await screen.findByRole("heading", { name: /relatórios/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /documentos/i })).toBeInTheDocument();
    // O sem nome aparece pelo rótulo do período. Checado pelo rótulo do botão porque "Setembro"
    // agora aparece duas vezes na coluna: como NOME deste e como PERÍODO do nomeado abaixo —
    // mesma regra do histórico da aba Relatório, onde o período só acompanha quem tem nome.
    expect(
      screen.getByRole("checkbox", { name: /usar "Setembro" na composição/i }),
    ).toBeInTheDocument();
    // O relatório nomeado aparece pelo NOME, não pelo período — senão dois relatórios do mesmo mês
    // ficam indistinguíveis justamente aqui, onde se escolhe qual alimenta a composição.
    expect(screen.getByText("Setembro — depois da troca de oferta")).toBeInTheDocument();
    // O Estudo de Copy em destaque; os outros documentos recolhidos por padrão.
    expect(screen.getByText("Estudo de Copy – Dr. José Ramos")).toBeInTheDocument();
    expect(screen.queryByText("Estratégia 2026")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /outros documentos \(1\)/i }));
    expect(screen.getByText("Estratégia 2026")).toBeInTheDocument();
    // Documento sem corpo não alimenta composição nenhuma: aqui, onde se ESCOLHE insumo, ele é
    // ruído e fica atrás do expansor.
    expect(screen.queryByText("Acessos")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /acesso\/credencial/i }));
    expect(screen.getByText("Acessos")).toBeInTheDocument();
  });

  it("Contexto Operacional vem LIGADO por padrão, e só ele e o Resumo Estratégico", async () => {
    await montar();
    const contexto = await screen.findByRole("checkbox", {
      name: /tirar "Contexto Operacional" da composição/i,
    });
    expect(contexto).toHaveAttribute("aria-checked", "true");
    // Dois: o Contexto e o Resumo Estratégico (marcado sozinho desde 26/10/2026). O insumo "números
    // da semana fechada" saiu em 02/10/2026 e quem leva número à composição é o Relatório.
    expect(await screen.findByText(/2 insumo\(s\) selecionado\(s\)/)).toBeInTheDocument();
    expect(screen.queryByText(/semana fechada/i)).not.toBeInTheDocument();
  });

  it("selecionar um insumo não abre o preview, e abrir não seleciona", async () => {
    await montar();
    const ligar = await screen.findByRole("checkbox", { name: /usar "Setembro" na composição/i });
    fireEvent.click(ligar);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Contexto + Resumo Estratégico (marcados ao abrir) + o relatório.
    expect(screen.getByText(/3 insumo\(s\) selecionado\(s\)/)).toBeInTheDocument();
  });

  it("documento sem conteúdo diz que não foi encontrado no servidor", async () => {
    // O corpo dos documentos do ClickUp ainda não é lido pelo worker; a tela precisa dizer isso em
    // vez de mostrar um painel vazio.
    await montar();
    fireEvent.click(await screen.findByText("Estudo de Copy – Dr. José Ramos"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/conteúdo não encontrado no servidor/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/não foi possível ler o conteúdo/i)).toBeInTheDocument();
  });

  // ============================================================================================
  // Os filtros da etapa de insumos.
  //
  // As duas listas são da equipe inteira e crescem sem parar: a Biblioteca tem análise de todo
  // nicho, e um cliente antigo acumula dezenas de relatórios. Sem recorte, o caminho mais curto
  // vira não escolher insumo nenhum — que é exatamente o que esta etapa existe para evitar.
  // ============================================================================================

  it("a análise aparece com a cara de Análises Salvas, não como linha de texto", async () => {
    // Escolher análise por um título escrito com pressa é escolher às cegas. O que a torna
    // reconhecível é o resto: a especialidade, quem salvou, quantos anúncios ela leu.
    await montar("/marketing/composer?cliente=jose_ramos", { analises: [analise()] });
    expect(await screen.findByText("Antes e depois que converte")).toBeInTheDocument();
    expect(screen.getByText("Tema: antes e depois")).toBeInTheDocument();
    expect(screen.getByText("Cirurgia Vascular")).toBeInTheDocument();
    expect(screen.getByText("Augusto")).toBeInTheDocument();
    expect(screen.getByText("12 anúncios")).toBeInTheDocument();
  });

  it("as minerações aparecem como “Minerações Salvas”, e logo abaixo as Análises de Criativos", async () => {
    await montar("/marketing/composer?cliente=jose_ramos", {
      analises: [analise()],
      criativos: [criativo(), criativo({ id: "c0a1f2e3-0000-4000-8000-000000000002", titulo: "Ainda rodando", status: "running" })],
    });
    const minerações = await screen.findByRole("heading", { name: /minerações salvas/i });
    const criativos = screen.getByRole("heading", { name: /análises de criativos/i });
    expect(minerações.compareDocumentPosition(criativos) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText(/análise da biblioteca/i)).toBeNull();
    // Só as que terminaram servem de insumo.
    expect(screen.getByText("Lente — vergonha de sorrir")).toBeInTheDocument();
    expect(screen.queryByText("Ainda rodando")).toBeNull();
    expect(screen.getByText("Consciente do problema")).toBeInTheDocument();
  });

  it("filtra as análises de criativo por favoritos e por categoria", async () => {
    await montar("/marketing/composer?cliente=jose_ramos", {
      criativos: [
        criativo({ id: "c0a1f2e3-0000-4000-8000-000000000001", titulo: "A favorita", favorito: true }),
        criativo({ id: "c0a1f2e3-0000-4000-8000-000000000002", titulo: "Da dermato", especialidades: ["Dermatologia"] }),
      ],
    });
    expect(await screen.findByText("Da dermato")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /só as análises de criativo favoritas/i }));
    expect(screen.getByText("A favorita")).toBeInTheDocument();
    expect(screen.queryByText("Da dermato")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /só as análises de criativo favoritas/i }));

    // O seletor de categorias dos criativos é o segundo: o primeiro é o das Minerações Salvas.
    fireEvent.click(screen.getAllByRole("button", { name: /todas as categorias/i }).at(-1)!);
    fireEvent.click(await screen.findByRole("checkbox", { name: /dermatologia/i }));
    expect(screen.getByText("Da dermato")).toBeInTheDocument();
    expect(screen.queryByText("A favorita")).toBeNull();
  });

  it("a análise de criativo escolhida vai na composição como insumo", async () => {
    await montar("/marketing/composer?cliente=jose_ramos", { analises: [analise()], criativos: [criativo()] });
    fireEvent.click(await screen.findByRole("checkbox", { name: /usar "Antes e depois que converte"/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /usar "Estudo de Copy – Dr\. José Ramos/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /usar "Lente — vergonha de sorrir"/i }));
    fireEvent.click(screen.getByRole("button", { name: /continuar/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^compor$/i }));
    const pedido = criarMutate.mock.calls.at(-1)?.[0];
    expect(pedido.entradas).toContainEqual({
      tipo: "criativo",
      id: "c0a1f2e3-0000-4000-8000-000000000001",
      titulo: "Lente — vergonha de sorrir",
    });
  });

  it("a chave “Criativos Internos do Cliente” troca a lista pelos criativos do cliente, com o selo de dissecação", async () => {
    await montar("/marketing/composer?cliente=jose_ramos", {
      criativos: [
        criativo(),
        criativo({ id: "c0a1f2e3-0000-4000-8000-000000000003", origem: "cliente", meta_ad_id: "120222222222222", status: "done" }),
      ],
      internos: [
        interno(),
        interno({ id: "ad-2", adId: "120222222222222", nome: "Reel já dissecado" }),
        interno({ id: "ad-3", adId: "120233333333333", nome: "Carrossel", videoPermalink: null }),
      ],
    });
    expect(await screen.findByText("Lente — vergonha de sorrir")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: /criativos internos do cliente/i }));
    // As dissecações de concorrentes saem; todos os criativos do cliente entram.
    expect(screen.queryByText("Lente — vergonha de sorrir")).toBeNull();
    expect(screen.getByText("Reel avanço capilar")).toBeInTheDocument();
    expect(screen.getByText("Não dissecado")).toBeInTheDocument();
    expect(screen.getByText("Dissecado")).toBeInTheDocument();
    expect(screen.getByText("Sem vídeo")).toBeInTheDocument();
    // Sem vídeo não pode ser escolhido.
    expect(screen.getByRole("checkbox", { name: /usar "Carrossel"/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/buscar criativo interno/i), { target: { value: "dissecado" } });
    expect(screen.queryByText("Reel avanço capilar")).toBeNull();
    expect(screen.getByText("Reel já dissecado")).toBeInTheDocument();
  });

  it("criativo interno sem dissecação: Compor pede a dissecação antes e mostra o passo, sem compor ainda", async () => {
    await montar("/marketing/composer?cliente=jose_ramos", {
      analises: [analise()],
      internos: [interno()],
      criativoAberto: criativo({ origem: "cliente", status: "running", etapa: "transcrevendo o vídeo", dissecacao: null }),
    });
    fireEvent.click(await screen.findByRole("checkbox", { name: /usar "Antes e depois que converte"/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /usar "Estudo de Copy – Dr\. José Ramos/i }));
    fireEvent.click(screen.getByRole("switch", { name: /criativos internos do cliente/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /usar "Reel avanço capilar"/i }));
    fireEvent.click(screen.getByRole("button", { name: /continuar/i }));
    criarMutate.mockClear();
    dissecarMutate.mockReset();
    dissecarMutate.mockImplementation((_v, opts) => opts.onSuccess({ id: "c0a1f2e3-0000-4000-8000-000000000001" }));
    fireEvent.click(await screen.findByRole("button", { name: /^compor$/i }));

    expect(dissecarMutate.mock.calls[0][0]).toMatchObject({ cliente: "jose_ramos", metaAdId: "120211111111111" });
    expect(criarMutate).not.toHaveBeenCalled();
    const passo = await screen.findByRole("region", { name: /preparando o criativo/i });
    expect(passo).toHaveTextContent(/antes de compor: dissecar “Reel avanço capilar”/i);
    // O passo atual gira; o anterior aparece feito.
    expect(screen.getByRole("status")).toHaveTextContent(/transcrevendo a fala/i);
  });

  it("dissecação pronta: escolher a especialidade salva e só então compõe, com os números se pedidos", async () => {
    await montar("/marketing/composer?cliente=jose_ramos", {
      analises: [analise()],
      internos: [interno()],
      criativoAberto: criativo({ origem: "cliente", status: "done", especialidades: [] }),
    });
    fireEvent.click(await screen.findByRole("checkbox", { name: /usar "Antes e depois que converte"/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /usar "Estudo de Copy – Dr\. José Ramos/i }));
    fireEvent.click(screen.getByRole("switch", { name: /criativos internos do cliente/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /usar "Reel avanço capilar"/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /incluir os números do criativo/i }));
    fireEvent.click(screen.getByRole("button", { name: /continuar/i }));
    criarMutate.mockClear();
    dissecarMutate.mockReset();
    dissecarMutate.mockImplementation((_v, opts) => opts.onSuccess({ id: "c0a1f2e3-0000-4000-8000-000000000001" }));
    atualizarMutate.mockReset();
    atualizarMutate.mockImplementation((_v, opts) => opts.onSuccess());
    fireEvent.click(await screen.findByRole("button", { name: /^compor$/i }));

    // A especialidade do cliente já vem escolhida: basta confirmar.
    fireEvent.click(await screen.findByRole("button", { name: /salvar e compor/i }));
    // O nome vem preenchido com o do anúncio, e vai junto com a especialidade.
    expect(atualizarMutate.mock.calls[0][0]).toEqual({
      id: "c0a1f2e3-0000-4000-8000-000000000001",
      especialidade: "Cirurgia Vascular",
      titulo: "Reel avanço capilar",
    });
    const pedido = criarMutate.mock.calls.at(-1)?.[0];
    expect(pedido.entradas).toContainEqual({
      tipo: "criativo",
      id: "c0a1f2e3-0000-4000-8000-000000000001",
      titulo: "Reel avanço capilar",
      numeros: expect.stringMatching(/investimento R\$ 500,00/),
    });
  });

  it("dissecação impossível: diz o motivo e deixa compor sem o criativo, com as outras análises", async () => {
    await montar("/marketing/composer?cliente=jose_ramos", {
      analises: [analise()],
      criativos: [criativo()],
      internos: [interno()],
      criativoAberto: criativo({
        origem: "cliente",
        status: "error",
        error: "Dissecação não é possível: o vídeo do anúncio não está público (o Facebook só o mostra com login).",
      }),
    });
    fireEvent.click(await screen.findByRole("checkbox", { name: /usar "Antes e depois que converte"/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /usar "Estudo de Copy – Dr\. José Ramos/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /usar "Lente — vergonha de sorrir"/i }));
    fireEvent.click(screen.getByRole("switch", { name: /criativos internos do cliente/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /usar "Reel avanço capilar"/i }));
    fireEvent.click(screen.getByRole("button", { name: /continuar/i }));
    criarMutate.mockClear();
    dissecarMutate.mockReset();
    dissecarMutate.mockImplementation((_v, opts) => opts.onSuccess({ id: "c0a1f2e3-0000-4000-8000-000000000009" }));
    fireEvent.click(await screen.findByRole("button", { name: /^compor$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/não está público/);
    fireEvent.click(screen.getByRole("button", { name: /compor sem o criativo/i }));
    const pedido = criarMutate.mock.calls.at(-1)?.[0];
    // Sai só o interno; a análise de concorrente escolhida continua indo.
    expect(pedido.entradas.filter((e: { tipo: string }) => e.tipo === "criativo").map((e: { id: string }) => e.id)).toEqual([
      "c0a1f2e3-0000-4000-8000-000000000001",
    ]);
  });

  it("dissecação impossível sem outra análise de criativo: só dá para voltar aos insumos", async () => {
    await montar("/marketing/composer?cliente=jose_ramos", {
      internos: [interno()],
      criativoAberto: criativo({ origem: "cliente", status: "error", error: "Dissecação não é possível: o vídeo não tem fala." }),
    });
    fireEvent.click(await screen.findByRole("checkbox", { name: /usar "Estudo de Copy – Dr\. José Ramos/i }));
    fireEvent.click(screen.getByRole("switch", { name: /criativos internos do cliente/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /usar "Reel avanço capilar"/i }));
    fireEvent.click(screen.getByRole("button", { name: /continuar/i }));
    criarMutate.mockClear();
    dissecarMutate.mockReset();
    dissecarMutate.mockImplementation((_v, opts) => opts.onSuccess({ id: "c0a1f2e3-0000-4000-8000-000000000009" }));
    fireEvent.click(await screen.findByRole("button", { name: /^compor$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/não tem fala/);
    expect(screen.queryByRole("button", { name: /compor sem o criativo/i })).toBeNull();
    expect(screen.getByText(/escolha outra nos insumos/i)).toBeInTheDocument();
    expect(criarMutate).not.toHaveBeenCalled();
  });

  it("filtra análises por favoritos", async () => {
    await montar("/marketing/composer?cliente=jose_ramos", {
      analises: [
        analise({ id: "a1", titulo: "A favorita", favorito: true }),
        analise({ id: "a2", titulo: "A outra", favorito: false }),
      ],
    });
    expect(await screen.findByText("A outra")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /favoritos/i }));
    expect(screen.getByText("A favorita")).toBeInTheDocument();
    expect(screen.queryByText("A outra")).not.toBeInTheDocument();
    // "1 de 2" diz que há mais coisa escondida pelo filtro — uma contagem solta não diria, e é a
    // diferença entre "só tem isso" e "filtrei demais".
    expect(screen.getByText(/\(1 de 2\)/)).toBeInTheDocument();
  });

  it("filtra análises por categoria", async () => {
    await montar("/marketing/composer?cliente=jose_ramos", {
      analises: [
        analise({ id: "a1", titulo: "Da vascular", especialidades: ["Cirurgia Vascular"] }),
        analise({ id: "a2", titulo: "Da harmonização", especialidades: ["Harmonização Facial"] }),
      ],
    });
    expect(await screen.findByText("Da harmonização")).toBeInTheDocument();

    // O seletor oferece só as categorias que as análises carregadas TÊM: oferecer uma que não
    // devolve nada é um filtro pior do que não oferecer.
    fireEvent.click(screen.getByRole("button", { name: /todas as categorias/i }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /cirurgia vascular/i }));

    expect(screen.getByText("Da vascular")).toBeInTheDocument();
    expect(screen.queryByText("Da harmonização")).not.toBeInTheDocument();
  });

  it("o filtro NÃO esconde a análise já escolhida", async () => {
    // Um insumo escolhido continua indo para a composição. Um card invisível que entra no prompt é
    // a pior combinação possível: quem lê a ideia depois não tem como saber com o que ela foi feita.
    await montar("/marketing/composer?cliente=jose_ramos", {
      analises: [
        analise({ id: "a1", titulo: "A escolhida", favorito: false }),
        analise({ id: "a2", titulo: "A outra", favorito: true }),
      ],
    });
    fireEvent.click(
      await screen.findByRole("checkbox", { name: /usar "A escolhida" na composição/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /favoritos/i }));

    expect(screen.getByText("A escolhida")).toBeInTheDocument();
    expect(screen.getByText("A outra")).toBeInTheDocument();
  });

  it("o \"Compor com esta análise\" (?analise=) abre com a análise já escolhida", async () => {
    await montar("/marketing/composer?cliente=jose_ramos&analise=a2", {
      analises: [
        analise({ id: "a1", titulo: "A primeira", favorito: false }),
        analise({ id: "a2", titulo: "A da Mineração", favorito: false }),
      ],
    });
    expect(
      await screen.findByRole("checkbox", { name: /tirar "A da Mineração" da composição/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /usar "A primeira" na composição/i })).toBeInTheDocument();
  });

  it("filtra relatórios por nome", async () => {
    await montar();
    const busca = await screen.findByLabelText(/buscar relatório por nome/i);
    fireEvent.change(busca, { target: { value: "troca de oferta" } });

    expect(screen.getByText("Setembro — depois da troca de oferta")).toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: /usar "Setembro" na composição/i }),
    ).not.toBeInTheDocument();
  });

  it("só deixa seguir com o Estudo de Copy E uma análise de criativo, e diz o que falta", async () => {
    await montar("/marketing/composer?cliente=jose_ramos", { analises: [analise()], criativos: [criativo()] });
    const continuar = await screen.findByRole("button", { name: /continuar/i });
    expect(continuar).toBeDisabled();
    expect(
      screen.getByText(/falta escolher o Estudo de Copy e ao menos uma análise de criativo/i),
    ).toBeInTheDocument();

    // Outro documento qualquer não serve no lugar do Estudo.
    fireEvent.click(screen.getByRole("button", { name: /outros documentos/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /usar "Estratégia 2026"/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /usar "Lente — vergonha de sorrir"/i }));
    expect(continuar).toBeDisabled();
    expect(screen.getByText(/falta escolher o Estudo de Copy$/i)).toBeInTheDocument();

    // A análise da Biblioteca é opcional.
    fireEvent.click(screen.getByRole("checkbox", { name: /usar "Estudo de Copy – Dr\. José Ramos/i }));
    expect(continuar).toBeEnabled();
    expect(screen.queryByText(/falta escolher/i)).not.toBeInTheDocument();
  });

  it("compor abre a etapa de Conceitos, e os conceitos aparecem nela", async () => {
    await montar("/marketing/composer?cliente=jose_ramos", {
      criativos: [criativo()],
      composicao: {
        id: "k1",
        cliente: "jose_ramos",
        status: "conceitos",
        canDelete: true,
        conceitos: [],
        catalogo_copy: null,
        insumos_insuficientes: null,
        plano: [],
        avisos: [],
      },
    });
    fireEvent.click(await screen.findByRole("checkbox", { name: /usar "Estudo de Copy – Dr\. José Ramos/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /usar "Lente — vergonha de sorrir"/i }));
    fireEvent.click(screen.getByRole("button", { name: /continuar/i }));
    criarMutate.mockImplementationOnce((_v, opts) => opts.onSuccess({ id: "k1" }));
    fireEvent.click(await screen.findByRole("button", { name: /^compor$/i }));

    expect(await screen.findByRole("heading", { name: /conceitos estratégicos/i })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/sugerindo um conceito estratégico por anúncio/);
    // O cabeçalho de etapas ganhou a etapa, entre a Intenção e o Resultado.
    const etapas = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    const i = etapas.findIndex((t) => /Conceitos/.test(t));
    expect(etapas[i - 1]).toMatch(/Intenção/);
    expect(etapas[i + 1]).toMatch(/Resultado/);
  });

  it("o Resumo Estratégico vem marcado, é obrigatório, e desmarcá-lo trava o compor", async () => {
    await montar("/marketing/composer?cliente=jose_ramos", { criativos: [criativo()] });
    const resumo = await screen.findByRole("checkbox", { name: /tirar "Resumo Estratégico"/i });
    expect(resumo).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("checkbox", { name: /usar "Estudo de Copy – Dr\. José Ramos/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /usar "Lente — vergonha de sorrir"/i }));
    const continuar = screen.getByRole("button", { name: /continuar/i });
    expect(continuar).toBeEnabled();

    fireEvent.click(resumo);
    expect(continuar).toBeDisabled();
    expect(screen.getByText(/falta escolher o Resumo Estratégico/i)).toBeInTheDocument();
  });

  it("cliente sem Resumo Estratégico: a coluna diz isso", async () => {
    await montar("/marketing/composer?cliente=jose_ramos", {
      criativos: [criativo()],
      documentos: [
        { id: "d3", nome: "Estudo de Copy – Dr. José Ramos", local: "Clientes › X", via: "pagina", arquivado: false, tipo: "outro", temConteudo: true },
      ],
    });
    expect(await screen.findByText(/não tem/i, { selector: "p" })).toHaveTextContent(
      /não tem Resumo Estratégico no ClickUp/,
    );
  });

  it("cliente sem Estudo de Copy: a coluna de documentos diz isso, e não dá para seguir", async () => {
    await montar("/marketing/composer?cliente=jose_ramos", {
      criativos: [criativo()],
      documentos: [
        { id: "d1", nome: "Estratégia 2026", local: "Clientes › X", via: "pasta", arquivado: false, tipo: "mapeamento_estrategico", temConteudo: true },
        { id: "d4", nome: "Resumo Estratégico", caminho: [], local: "Central de Copy", via: "pagina", arquivado: false, tipo: "outro", temConteudo: true },
      ],
    });
    expect(await screen.findByText(/não tem/i, { selector: "p" })).toHaveTextContent(
      /não tem Estudo de Copy no ClickUp/,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /usar "Lente — vergonha de sorrir"/i }));
    expect(screen.getByRole("button", { name: /continuar/i })).toBeDisabled();
  });

  it("várias análises de criativo vão juntas na composição, até o teto", async () => {
    const ids = Array.from({ length: 9 }, (_, i) => `c0a1f2e3-0000-4000-8000-00000000001${i}`);
    await montar("/marketing/composer?cliente=jose_ramos", {
      criativos: ids.map((id, i) => criativo({ id, titulo: `Criativo ${i + 1}` })),
    });
    fireEvent.click(await screen.findByRole("checkbox", { name: /usar "Estudo de Copy – Dr\. José Ramos/i }));
    for (let i = 1; i <= 8; i += 1) {
      fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(`usar "Criativo ${i}"`, "i") }));
    }
    expect(screen.getByText("8 de 8 escolhidas")).toBeInTheDocument();
    // No teto, o nono não liga.
    expect(screen.getByRole("checkbox", { name: /usar "Criativo 9"/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /continuar/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^compor$/i }));
    const pedido = criarMutate.mock.calls.at(-1)?.[0];
    expect(pedido.libraryEntryId).toBeNull();
    expect(pedido.entradas.filter((e: { tipo: string }) => e.tipo === "criativo")).toHaveLength(8);
  });

  it("busca documento pelo título ou pela pasta, sem esconder o já escolhido", async () => {
    await montar();
    fireEvent.click(await screen.findByRole("checkbox", { name: /usar "Estudo de Copy – Dr\. José Ramos/i }));
    const busca = screen.getByLabelText(/buscar documento/i);
    // A busca alcança os documentos recolhidos.
    fireEvent.change(busca, { target: { value: "estratégia" } });
    expect(screen.getByText("Estratégia 2026")).toBeInTheDocument();
    // O escolhido continua à vista mesmo sem casar com a busca.
    fireEvent.change(busca, { target: { value: "zzz" } });
    expect(screen.getByText("Estudo de Copy – Dr. José Ramos")).toBeInTheDocument();
    expect(screen.queryByText("Estratégia 2026")).not.toBeInTheDocument();
  });

  it("documento recolhido que foi escolhido continua à vista", async () => {
    await montar();
    fireEvent.click(await screen.findByRole("button", { name: /outros documentos/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /usar "Estratégia 2026"/i }));
    fireEvent.click(screen.getByRole("button", { name: /outros documentos/i }));
    expect(screen.getByRole("checkbox", { name: /tirar "Estratégia 2026"/i })).toBeInTheDocument();
  });

  it("ao sair e voltar, continua de onde estava", async () => {
    await montar("/marketing/composer?cliente=jose_ramos", { analises: [analise()], criativos: [criativo()] });
    fireEvent.click(await screen.findByRole("checkbox", { name: /usar "Antes e depois que converte"/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /usar "Estudo de Copy – Dr\. José Ramos/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /usar "Lente — vergonha de sorrir"/i }));
    fireEvent.click(screen.getByRole("button", { name: /continuar/i }));
    fireEvent.change(await screen.findByPlaceholderText(/4 anúncios sobre medo/i), {
      target: { value: "dois Stories" },
    });

    // Sai da tela (desmonta tudo) e volta pelo menu, sem `?cliente=`.
    cleanup();
    vi.resetModules();
    await montar("/marketing/composer", { analises: [analise()], criativos: [criativo()] });

    expect(await screen.findByDisplayValue("dois Stories")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /voltar aos insumos/i }));
    expect(
      await screen.findByRole("checkbox", { name: /tirar "Antes e depois que converte"/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /tirar "Estudo de Copy – Dr\. José Ramos/i })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /tirar "Lente — vergonha de sorrir"/i })).toBeInTheDocument();
  });

  it("link com OUTRO cliente começa do zero, sem trazer a seleção do anterior", async () => {
    localStorage.setItem(
      "companium:composer:rascunho",
      JSON.stringify({ cliente: "outro_cliente", etapa: "intencao", analiseId: "a1", documentos: ["d1"], intencao: "x" }),
    );
    await montar("/marketing/composer?cliente=jose_ramos", { analises: [analise()] });
    expect(await screen.findByText(/com o que vamos compor/i)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /usar "Antes e depois que converte"/i })).toBeInTheDocument();
  });

  it("filtro de nome que não casa diz que foi o filtro, não que não há relatório", async () => {
    // "Não conseguimos achar com esse filtro" e "este cliente não tem relatório" são fatos
    // diferentes sobre o cliente, e achatá-los nesta tela mandaria alguém gerar um relatório que
    // já existe.
    await montar();
    const busca = await screen.findByLabelText(/buscar relatório por nome/i);
    fireEvent.change(busca, { target: { value: "dezembro" } });

    expect(screen.getByText(/nenhum relatório com esses filtros/i)).toBeInTheDocument();
    expect(screen.queryByText(/ainda não tem relatório/i)).not.toBeInTheDocument();
  });

  // ============================================================================================
  // O preview, com o componente da tela de origem.
  // ============================================================================================

  it("o preview da análise mostra as caixas de seção, não markdown corrido", async () => {
    await montar("/marketing/composer?cliente=jose_ramos", {
      analises: [analise()],
      analiseAberta: {
        id: "a1",
        tema: "antes e depois",
        titulo: "Antes e depois que converte",
        analysis_md: "## Visão geral\n\nTexto da análise.",
        analysis: {
          publicos: [
            {
              fatia: "medo de cirurgia",
              demanda: "latente",
              por_que_segmentar: "chega pelo alívio, não pelo procedimento",
            },
          ],
          temas: [{ nome: "antes e depois", frequencia: 7 }],
          hooks: [{ texto: "Você sente peso nas pernas?", ad_id: 1 }],
        },
        ads: [],
      },
    });
    fireEvent.click(await screen.findByText("Antes e depois que converte"));

    const dialogo = await screen.findByRole("dialog");
    // O título da seção vem do `AnalysisReport`: é ele que separa público, ganchos e dissecação em
    // blocos. Markdown cru mostraria menos do que a tela de origem mostra.
    expect(dialogo).toHaveTextContent(/público/i);
    expect(dialogo).toHaveTextContent(/medo de cirurgia/i);
  });

  it("o preview do relatório mostra a prioridade e os números do snapshot", async () => {
    // A prosa (`relatorio_md`) é só uma parte do que o relatório é. Escolher um insumo vendo só ela
    // esconderia justamente os números que sustentam o diagnóstico.
    await montar("/marketing/composer?cliente=jose_ramos", {
      relatorioAberto: {
        id: "r1",
        cliente: "jose_ramos",
        titulo: "Setembro — depois da troca de oferta",
        periodo_de: "2026-09-01",
        periodo_ate: "2026-09-30",
        periodo_label: "Setembro",
        prioridade: "gargalo",
        avisos: [],
        status: "ok",
        error: null,
        relatorio_md: "Texto do diagnóstico.",
        relatorio: {
          leitura: "O mês caiu no meio.",
          problema: {
            prioridade: "gargalo",
            texto: "O custo por lead dobrou na segunda quinzena.",
            impacto: "Metade do orçamento rendeu um terço dos leads.",
          },
          causa: { texto: "A troca de oferta.", tipo: "correlacao", verificar: "Ver o criativo novo." },
          acao: { texto: "Voltar a oferta anterior.", responsavel: "gestor", prazo: "esta semana" },
          limitacoes: [],
        },
        snapshot: null,
        canDelete: true,
      },
    });
    fireEvent.click(await screen.findByText("Setembro — depois da troca de oferta"));

    const dialogo = await screen.findByRole("dialog");
    // A prioridade TIPADA e o menu de saídas são do `RelatorioResultado`: markdown corrido não
    // teria nenhum dos dois, e é por eles que se vê qual componente renderizou.
    expect(dialogo).toHaveTextContent(/gargalo/i);
    expect(dialogo).toHaveTextContent(/correlação/i);
    expect(within(dialogo).getByRole("button", { name: /^copiar$/i })).toBeInTheDocument();
    // Renomear é na aba de origem: aqui o relatório está sendo ESCOLHIDO, não editado.
    expect(
      within(dialogo).queryByRole("button", { name: /renomear|salvar nome/i }),
    ).not.toBeInTheDocument();
  });

  it("não oferece seletor de formato: quem escolhe é o agente", async () => {
    await montar();
    await screen.findByText(/com o que vamos compor/i);
    expect(screen.queryByText(/formato de destino/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/instagram reels/i)).not.toBeInTheDocument();
  });
});

describe("OrquestracaoPercurso", () => {
  const orquestracao = (over: Partial<Orquestracao> = {}): Orquestracao => ({
    id: "o1",
    cliente: "jose_ramos",
    nome_exibicao: "Dr. José Ramos",
    pedido: null,
    status: "running",
    error: null,
    etapas: [
      { key: "numeros", label: "Números do cliente", status: "done", note: "semana de 2026-09-28 a 2026-10-04", started_at: null, ended_at: null },
      { key: "plano", label: "Diagnóstico e plano", status: "done", note: null, started_at: null, ended_at: null },
      { key: "analise", label: "Análise de concorrentes", status: "error", note: "A busca não trouxe anúncios — a composição segue sem análise", started_at: null, ended_at: null },
      { key: "pedido", label: "Pedido ao Composer", status: "running", note: null, started_at: null, ended_at: null },
      { key: "composicao", label: "Composição", status: "pending", note: null, started_at: null, ended_at: null },
    ],
    run_id: null,
    library_entry_id: null,
    composition_id: null,
    criado_por: "u1",
    criado_em: new Date().toISOString(),
    atualizado_em: new Date().toISOString(),
    canDelete: true,
    diagnostico_md: "O agendamento caiu pela metade.",
    decisoes: {
      abordagem: "Qualificar melhor.",
      analise: { id: null, titulo: null, motivo: "nenhuma é do nicho", nova: false },
      mineracao: { nicho: "tratamento de varizes", contexto: null, pergunta: null, foco: null },
      relatorios: [{ id: "r1", titulo: "Setembro", motivo: "é o período do diagnóstico" }],
      documentos: [],
    },
    perguntas: [
      { para: "pesquisa", assunto: "palavras-chave do nicho", pergunta: "Nicho ou tema: varizes", resposta: "varizes", erro: null, em: "1" },
    ],
    metricas: { atual: { investimento: 3000, consultasAgendadas: 6, roas: null }, anterior: { consultasAgendadas: 12 } },
    semana_de: "2026-09-28",
    semana_ate: "2026-10-04",
    ...over,
  });

  it("mostra as cinco etapas desde o começo, com o que houve em cada uma", () => {
    render(<OrquestracaoPercurso orquestracao={orquestracao()} />);
    for (const rotulo of ["Números do cliente", "Diagnóstico e plano", "Pedido ao Composer", "Composição"]) {
      expect(screen.getByText(rotulo)).toBeInTheDocument();
    }
    // Etapa que falhou diz por quê — e que a composição seguiu.
    expect(screen.getByText(/segue sem análise/).className).toContain("text-destructive");
  });

  it("diz o que ele decidiu e por quê", () => {
    render(<OrquestracaoPercurso orquestracao={orquestracao()} />);
    expect(screen.getByText("Qualificar melhor.")).toBeInTheDocument();
    expect(screen.getByText(/pediu uma mineração de “tratamento de varizes”/i)).toBeInTheDocument();
    expect(screen.getByText("Setembro")).toBeInTheDocument();
    expect(screen.getByText(/é o período do diagnóstico/)).toBeInTheDocument();
  });

  it("número ausente é travessão, não zero", () => {
    render(<OrquestracaoPercurso orquestracao={orquestracao()} />);
    const linhaRoas = screen.getByText("ROAS").closest("tr")!;
    expect(within(linhaRoas).getAllByText("—")).toHaveLength(2);
  });

  it("registra a quem ele perguntou", () => {
    render(<OrquestracaoPercurso orquestracao={orquestracao()} />);
    expect(screen.getByText("pesquisa")).toBeInTheDocument();
    expect(screen.getByText("Nicho ou tema: varizes")).toBeInTheDocument();
  });
});
