/**
 * A tela do Relatório: os quatro blocos, o chip de prioridade e a tabela de números.
 *
 * O teste mais importante deste arquivo é o de AUDITORIA: a tela tem de renderizar os números do
 * `snapshot` gravado, não de um hook ao vivo. Um relatório de agosto lido em dezembro precisa mostrar
 * agosto — recalcular faria o texto e a tabela discordarem assim que o banco mudasse, que é
 * exatamente o bug que o snapshot existe para evitar.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { RelatorioResultado } from "@/components/marketing/clientes/RelatorioResultado";
import type { Relatorio, RelatorioResumo } from "@/lib/clientReportsApi";
import type { MetricaSnapshot } from "@/utils/relatorioSnapshot";

const criarMock = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: { access_token: "tok" } }),
}));

vi.mock("@/lib/clientReportsApi", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/clientReportsApi")>();
  return {
    ...real,
    criarRelatorio: (...a: unknown[]) => criarMock(...a),
    listarRelatorios: () => Promise.resolve({ relatorios: [] }),
    obterRelatorio: () => Promise.resolve({ relatorio: null }),
  };
});

import { useCreateClientReport } from "@/hooks/useClientReports";

const render = (ui: ReactNode) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

const metrica = (over: Record<string, unknown> = {}): MetricaSnapshot =>
  ({
  id: "leadsCRM",
  label: "Leads CRM",
  unidade: "contagem",
  direcao: "higher",
  grupo: "Leads",
  a: { valor: 48, disponivel: true, corrigido: false },
  b: { valor: 40, disponivel: true, corrigido: false },
  meta: { a: { valor: 60, origem: "clientes_meta:rateio", status: "off", pct: 80 }, b: null },
    delta: { abs: 8, pct: 20, favoravel: "melhorou" },
    ...over,
  }) as MetricaSnapshot;

function relatorio(over: Partial<Relatorio> = {}): Relatorio {
  return {
    id: "r1",
    cliente: "jose_ramos",
    nome_exibicao: "Dr. José Ramos - VascuMed",
    periodo_de: "2026-08-01",
    periodo_ate: "2026-08-31",
    periodo_kind: "month",
    periodo_label: "Agosto 2026",
    comparacao_de: "2026-07-01",
    comparacao_ate: "2026-07-31",
    comparacao_regra: "mes_anterior",
    comparacao_motivo: "O período é um mês civil e as metas são mensais.",
    observacao: null,
    prioridade: "gargalo",
    avisos: [],
    fontes: { crm: true, ads: true, metas: true },
    status: "ok",
    error: null,
    criado_por: "u1",
    criado_em: new Date().toISOString(),
    atualizado_em: new Date().toISOString(),
    canDelete: true,
    relatorio_md: "## Leitura crítica\n\nOs leads subiram.",
    relatorio: {
      leitura: "Os leads do CRM subiram 20%, mas a consulta agendada caiu.",
      problema: {
        prioridade: "gargalo",
        texto: "Conversão de lead para consulta",
        impacto: "8 consultas abaixo da meta rateada",
      },
      causa: {
        texto: "O tempo de primeira resposta subiu na mesma semana",
        tipo: "correlacao",
        verificar: "Tempo de primeira resposta por origem",
      },
      acao: { texto: "Medir o tempo de resposta por 7 dias", responsavel: "Marina", prazo: "05/09" },
      limitacoes: ["Julho tem 31 dias e agosto 31: comparável"],
    },
    snapshot: {
      versao: 1,
      geradoEm: "2026-09-01T10:00:00.000Z",
      origem: "frontend",
      escopo: { cliente: "jose_ramos", medico: "", origem: [], procedimento: [] },
      basisFaturamento: { consulta: "realizadas", procedimento: "realizados" },
      periodo: { de: "2026-08-01", ate: "2026-08-31", dias: 31, kind: "month", label: "Agosto 2026" },
      comparacao: {
        de: "2026-07-01",
        ate: "2026-07-31",
        dias: 31,
        regra: "mes_anterior",
        motivo: "…",
        comparavel: true,
        label: "Julho 2026",
      },
      metricas: [metrica()],
      funil: { orcamentoParado: { count: 5, valor: 12000 }, origem: [] },
      fontes: { crm: true, ads: true, metas: true, overrides: false },
      avisos: [],
    },
    snapshot_versao: 1,
    origem_numeros: "frontend",
    agent_id: "relatorioagent",
    ...over,
  } as Relatorio;
}

describe("RelatorioResultado", () => {
  it("renderiza os quatro blocos com o chip de prioridade", () => {
    render(<RelatorioResultado relatorio={relatorio()} />);
    expect(screen.getByText("Gargalo")).toBeInTheDocument();
    expect(screen.getByText(/os leads do crm subiram 20%/i)).toBeInTheDocument();
    expect(screen.getByText("Conversão de lead para consulta")).toBeInTheDocument();
    expect(screen.getByText(/tempo de primeira resposta subiu/i)).toBeInTheDocument();
    expect(screen.getByText(/medir o tempo de resposta/i)).toBeInTheDocument();
    // O tipo da explicação aparece no título: causa comprovada, correlação e hipótese não são a
    // mesma coisa, e a spec exige a distinção.
    expect(screen.getByText(/correlação/i)).toBeInTheDocument();
  });

  it("mostra responsável e prazo, inclusive 'a definir'", () => {
    render(
      <RelatorioResultado
        relatorio={relatorio({
          relatorio: {
            ...relatorio().relatorio!,
            acao: { texto: "Medir", responsavel: "a definir", prazo: "a definir" },
          },
        })}
      />,
    );
    expect(screen.getByText(/Responsável: a definir · Prazo: a definir/)).toBeInTheDocument();
  });

  it("prioridade não classificada é dita, não escondida", () => {
    const r = relatorio();
    render(
      <RelatorioResultado
        relatorio={relatorio({
          prioridade: null,
          relatorio: { ...r.relatorio!, problema: { ...r.relatorio!.problema, prioridade: null } },
        })}
      />,
    );
    expect(screen.getByText(/prioridade não classificada/i)).toBeInTheDocument();
    expect(screen.queryByText("Gargalo")).not.toBeInTheDocument();
  });

  it("os avisos de máquina aparecem em destaque", () => {
    render(
      <RelatorioResultado
        relatorio={relatorio({
          avisos: [
            { codigo: "dados_parciais", detalhe: "O período termina hoje: dados podem estar incompletos." },
          ],
        })}
      />,
    );
    expect(screen.getByText(/dados podem estar incompletos/i)).toBeInTheDocument();
  });

  it("AUDITORIA: os números vêm do snapshot gravado, não de um hook ao vivo", async () => {
    // O snapshot diz 48; qualquer recálculo hoje daria outro número. E o guarda é mais forte do que
    // parece: este teste NÃO monta QueryClientProvider, então no dia em que alguém puser um hook de
    // dados dentro deste componente, ele quebra aqui em vez de quebrar a confiança em produção.
    render(<RelatorioResultado relatorio={relatorio()} />);
    fireEvent.click(screen.getByText(/números que embasaram/i));
    expect(await screen.findByText("48")).toBeInTheDocument();
    expect(screen.getByText("40")).toBeInTheDocument();
    expect(screen.getByText(/valores como estavam quando o relatório foi gerado/i)).toBeInTheDocument();
    // E a base de faturamento, sem a qual o número não é reproduzível.
    expect(screen.getByText(/consultas realizadas, procedimentos realizados/i)).toBeInTheDocument();
  });

  it("na tabela, 'sem informação' não vira zero", () => {
    const r = relatorio();
    render(
      <RelatorioResultado
        relatorio={relatorio({
          snapshot: {
            ...r.snapshot!,
            metricas: [metrica({ a: { valor: null, disponivel: false }, b: { valor: null, disponivel: false }, delta: null })],
          },
        })}
      />,
    );
    fireEvent.click(screen.getByText(/números que embasaram/i));
    expect(screen.getAllByText("sem informação").length).toBeGreaterThan(0);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("marca na tabela o número corrigido à mão", () => {
    const r = relatorio();
    render(
      <RelatorioResultado
        relatorio={relatorio({
          snapshot: { ...r.snapshot!, metricas: [metrica({ a: { valor: 48, disponivel: true, corrigido: true } })] },
        })}
      />,
    );
    fireEvent.click(screen.getByText(/números que embasaram/i));
    expect(screen.getByTitle(/correção manual lançada no CRM/i)).toBeInTheDocument();
  });

  it("enquanto o agente escreve, não finge que há diagnóstico", () => {
    render(<RelatorioResultado relatorio={relatorio({ status: "running", relatorio: null })} />);
    expect(screen.getByText(/escrevendo o diagnóstico/i)).toBeInTheDocument();
    expect(screen.queryByText("Gargalo")).not.toBeInTheDocument();
  });

  it("erro aparece em vez de tela vazia", () => {
    render(
      <RelatorioResultado relatorio={relatorio({ status: "error", error: "agente fora do ar", relatorio: null })} />,
    );
    expect(screen.getByText("agente fora do ar")).toBeInTheDocument();
  });

  it("sem bloco estruturado, a prosa sobrevive e a tela diz que não há prioridade", () => {
    render(<RelatorioResultado relatorio={relatorio({ relatorio: null, prioridade: null })} />);
    expect(screen.getByText(/não devolveu o bloco estruturado/i)).toBeInTheDocument();
    expect(screen.getByText(/os leads subiram/i)).toBeInTheDocument();
  });

  it("mostra a regra que escolheu o período comparável", () => {
    render(<RelatorioResultado relatorio={relatorio()} />);
    expect(screen.getByText(/as metas são mensais/i)).toBeInTheDocument();
    expect(screen.getByText(/contra 2026-07-01 a 2026-07-31/)).toBeInTheDocument();
  });
});

describe("useCreateClientReport", () => {
  let qc: QueryClient;
  const KEY = ["marketing-relatorios", "jose_ramos"];
  const pedido = {
    cliente: "jose_ramos",
    snapshot: relatorio().snapshot!,
  };

  beforeEach(() => {
    criarMock.mockReset().mockResolvedValue({ id: "r9", status: "running" });
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );

  it("marca 'running' na hora — é o que religa o polling", async () => {
    qc.setQueryData(KEY, { relatorios: [] });
    const { result } = renderHook(() => useCreateClientReport(), { wrapper });
    result.current.mutate(pedido);
    await waitFor(() => {
      const lista = qc.getQueryData<{ relatorios: RelatorioResumo[] }>(KEY)?.relatorios;
      expect(lista?.[0]?.status).toBe("running");
      expect(lista?.[0]?.periodo_de).toBe("2026-08-01");
    });
  });

  it("falha desfaz a linha otimista", async () => {
    criarMock.mockRejectedValue(new Error("worker fora do ar"));
    qc.setQueryData(KEY, { relatorios: [] });
    const { result } = renderHook(() => useCreateClientReport(), { wrapper });
    result.current.mutate(pedido);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(qc.getQueryData<{ relatorios: RelatorioResumo[] }>(KEY)?.relatorios).toEqual([]);
  });
});

describe("ClientBriefDialog — as duas abas", () => {
  it("monta as duas abas, e a de Relatório não dispara leitura de número sem período", async () => {
    // O guarda real: `useCRMClienteData` e `useClientesData` não têm `enabled` e, com data vazia,
    // buscam a base INTEIRA sem filtro de período. Por isso quem lê número mora num componente que só
    // é montado depois de escolher o período. Se alguém remontar aquilo no corpo da aba, abrir o
    // diálogo de um cliente volta a varrer o histórico completo do CRM.
    const { ClientBriefDialog } = await import("@/components/marketing/clientes/ClientBriefDialog");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rtlRender(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ClientBriefDialog
            cliente={{
              padrao: "jose_ramos",
              nome: "Dr. José Ramos - VascuMed",
              especialidades: ["Cirurgia Vascular"],
              plano: "Escala",
              squad: "Marina",
              mesesDeCasa: 18,
            }}
            open
            onOpenChange={() => {}}
            onRefresh={() => {}}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("tab", { name: /contexto operacional/i })).toBeInTheDocument();
    const abaRelatorio = screen.getByRole("tab", { name: /^relatório$/i });
    expect(abaRelatorio).toBeInTheDocument();

    // Radix troca de aba no mousedown, não no click: `fireEvent.click` sozinho deixa a aba ativa
    // onde estava (conferido — o data-state não mudava).
    fireEvent.mouseDown(abaRelatorio);
    fireEvent.click(abaRelatorio);
    // Sem período escolhido: o botão existe e está desabilitado, e não há o que carregar.
    const botao = await screen.findByRole("button", { name: /gerar relatório/i });
    expect(botao).toBeDisabled();
    expect(screen.queryByText(/carregando os números/i)).not.toBeInTheDocument();
    // Mount pesado em jsdom (o diálogo puxa todo o grafo de hooks de número/criativo, ~5s) —
    // timeout explícito para não flakar no default de 5000ms.
  }, 15000);

  it("o painel das abas é de altura FIXA e rola por dentro", async () => {
    // ⚠️ Teste de CLASSE, que normalmente não presta — aqui ele é a única opção, e justifica-se:
    // o que está sendo protegido é puro layout, e jsdom não calcula layout nenhum. A medição de
    // verdade foi feita no navegador (as três abas dão 768×810 e o painel 632px em todas).
    //
    // O que pode sumir em silêncio é o `min-h-0`: um item de flex tem `min-height: auto` e se
    // recusa a encolher abaixo do conteúdo, então sem ele o painel cresce, empurra o diálogo e a
    // rolagem interna nunca acontece — exatamente o salto que esta mudança veio tirar. Nada quebra,
    // só volta a saltar.
    const { ClientBriefDialog } = await import("@/components/marketing/clientes/ClientBriefDialog");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rtlRender(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ClientBriefDialog
            cliente={{ padrao: "jose_ramos", nome: "Dr. José Ramos", especialidades: [], plano: null, squad: null, mesesDeCasa: 1 }}
            open
            onOpenChange={() => {}}
            onRefresh={() => {}}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const dialogo = await screen.findByRole("dialog");
    // Altura FIXA, não "até": `max-h` deixava o diálogo crescer conforme o conteúdo chegava.
    expect(dialogo.className).toMatch(/\bh-\[min\(90vh,52rem\)\]/);
    expect(dialogo.className).not.toMatch(/\bmax-h-/);
    expect(dialogo.className).toMatch(/\boverflow-hidden\b/);

    const painel = screen.getByRole("tabpanel");
    for (const classe of ["min-h-0", "flex-1", "overflow-y-auto"]) {
      expect(painel.className, `o painel perdeu ${classe}`).toContain(classe);
    }
  }, 15000);
});

/**
 * O carrossel de criativos.
 *
 * Três coisas que importam: a imagem sai do snapshot GRAVADO (não de hook ao vivo), criativo sem
 * destino não finge ser clicável, e canal sem fonte de dados aparece dito — senão quem olha conclui
 * que o cliente não anuncia no Google, quando o que falta é o dado.
 */
describe("RelatorioCriativos", () => {
  const criativo = (over: Record<string, unknown> = {}) => ({
    codigo: "VAR-012 depoimento",
    adId: "120200000000001",
    formato: "video",
    objetivo: "geracao_demanda",
    status: "ativo",
    hookRate: 28.4,
    holdRate: 9.1,
    resultados: 18,
    tipoResultado: "Cadastros",
    cpl: 67,
    thumbnail: "https://storage.supabase.co/t.jpg",
    link: "https://www.facebook.com/reel/123",
    gasto: 1200,
    impressoes: 30000,
    analise: null,
    ...over,
  });

  const mkt = (over: Record<string, unknown> = {}) =>
    ({
      disponivel: true,
      totalAnuncios: 1,
      conta: {},
      criativos: [criativo()],
      ...over,
    }) as never;

  it("mostra cada criativo com código e métrica do tipo dominante", async () => {
    const { RelatorioCriativos } = await import("@/components/marketing/clientes/RelatorioCriativos");
    render(<RelatorioCriativos mkt={mkt()} />);
    expect(screen.getByText("VAR-012 depoimento")).toBeInTheDocument();
    // "Cadastros", não "leads": conta otimizada para mensagem não tem cadastro, e achatar o rótulo
    // faria o número parecer zero.
    expect(screen.getByText(/18 Cadastros/)).toBeInTheDocument();
  });

  it("criativo com destino é link externo; sem destino NÃO é clicável", async () => {
    const { RelatorioCriativos } = await import("@/components/marketing/clientes/RelatorioCriativos");
    render(
      <RelatorioCriativos
        mkt={mkt({
          totalAnuncios: 2,
          criativos: [criativo(), criativo({ adId: "2", codigo: "Sem vídeo", link: null, formato: "estatico" })],
        })}
      />,
    );
    const links = screen.getAllByRole("link");
    // Um só: o que tem permalink. Âncora morta sugeriria que o clique faz algo.
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "https://www.facebook.com/reel/123");
    expect(links[0]).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(screen.getByText("Sem vídeo")).toBeInTheDocument();
  });

  it("marca estático — sem isso, Hook/Hold perto de zero parece anúncio ruim", async () => {
    const { RelatorioCriativos } = await import("@/components/marketing/clientes/RelatorioCriativos");
    render(<RelatorioCriativos mkt={mkt({ criativos: [criativo({ formato: "estatico" })] })} />);
    expect(screen.getByText("estático")).toBeInTheDocument();
  });

  it("diz quantos ficaram de fora quando a lista é de salientes", async () => {
    const { RelatorioCriativos } = await import("@/components/marketing/clientes/RelatorioCriativos");
    render(<RelatorioCriativos mkt={mkt({ totalAnuncios: 61 })} />);
    expect(screen.getByText(/1 salientes de 61/i)).toBeInTheDocument();
  });

  it("canal sem fonte aparece como 'em breve', não omitido", async () => {
    const { RelatorioCriativos } = await import("@/components/marketing/clientes/RelatorioCriativos");
    render(<RelatorioCriativos mkt={mkt()} />);
    expect(screen.getByText(/Google Ads: em breve/i)).toBeInTheDocument();
    expect(screen.getByText(/Instagram orgânico: em breve/i)).toBeInTheDocument();
  });

  it("'não conseguimos ler' é diferente de 'nenhum anúncio rodou'", async () => {
    const { RelatorioCriativos } = await import("@/components/marketing/clientes/RelatorioCriativos");
    const { unmount } = render(
      <RelatorioCriativos mkt={mkt({ disponivel: false, totalAnuncios: 0, criativos: [] })} />,
    );
    expect(screen.getByText(/diferente de não haver anúncio/i)).toBeInTheDocument();
    unmount();
    render(<RelatorioCriativos mkt={mkt({ disponivel: true, totalAnuncios: 0, criativos: [] })} />);
    expect(screen.getByText(/nenhum anúncio.*rodou/i)).toBeInTheDocument();
  });
});
