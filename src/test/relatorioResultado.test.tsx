import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { RelatorioResultado } from "@/components/marketing/clientes/RelatorioResultado";
import type { Relatorio } from "@/lib/clientReportsApi";
import type { RelatorioSnapshot } from "@/utils/relatorioSnapshot";

const snapshot: RelatorioSnapshot = {
  versao: 1,
  geradoEm: "2026-09-01T12:00:00.000Z",
  origem: "frontend",
  escopo: { cliente: "diego", medico: "", origem: [], procedimento: [] },
  basisFaturamento: { consulta: "agendadas", procedimento: "realizados" },
  periodo: { de: "2026-08-01", ate: "2026-08-31", dias: 31, kind: "month", label: "Agosto/2026" },
  comparacao: {
    de: "2026-07-01", ate: "2026-07-31", dias: 31, regra: "mes_anterior",
    motivo: "mês anterior", comparavel: true, label: "Julho/2026",
  },
  metricas: [],
  funil: { orcamentoParado: { count: 0, valor: 0 }, origem: [] },
  marketing: {
    disponivel: true,
    totalAnuncios: 2,
    conta: { hookRate: 19.75, holdRate: 1.47, cliques: 3100, cpc: 1.12, gasto: 3488, resultadosMeta: 200, custoResultadoMeta: 17.44 },
    criativos: [
      { codigo: "V009", adId: "9", formato: "video", objetivo: "geracao_demanda", status: "ativo", hookRate: 24.08, holdRate: 1.03, cpl: 14.26, resultados: 96, tipoResultado: "Cadastros", thumbnail: "https://x/v009.jpg", link: "https://www.facebook.com/reel/9", gasto: 1369.92, impressoes: 40000, analise: null },
      { codigo: "IM007", adId: "im", formato: "estatico", objetivo: "geracao_demanda", status: "ativo", hookRate: null, holdRate: null, cpl: null, resultados: 0, tipoResultado: "Conversas iniciadas", thumbnail: null, link: null, gasto: 200, impressoes: 10000, analise: null },
    ],
  },
  fontes: { crm: true, ads: true, metas: true, overrides: false },
  avisos: [],
};

const relatorio = {
  id: "r1", cliente: "diego", nome_exibicao: "Dr. Diego Rezende",
  periodo_de: "2026-08-01", periodo_ate: "2026-08-31", periodo_kind: "month", periodo_label: "Agosto/2026",
  comparacao_de: "2026-07-01", comparacao_ate: "2026-07-31", comparacao_regra: "mes_anterior",
  prioridade: "oportunidade", avisos: [], fontes: null, status: "ok", error: null,
  criado_por: null, criado_em: "2026-09-01", atualizado_em: "2026-09-01", canDelete: false,
  comparacao_motivo: "mês anterior", observacao: null, relatorio_md: "# x",
  relatorio: {
    leitura: "Leitura da conta.",
    problema: { prioridade: "oportunidade", texto: "Escalar o V009.", impacto: "y", criativos: ["V009", "V008"] },
    causa: { texto: "correlação.", tipo: "correlacao", verificar: null },
    acao: { texto: "testar variação.", responsavel: "Marina Arantes", prazo: "a definir" },
    limitacoes: ["sem CRM"],
  },
  snapshot,
  snapshot_versao: 1, origem_numeros: "frontend", agent_id: "relatoriomarketingagent",
} as unknown as Relatorio;

describe("RelatorioResultado (marketing)", () => {
  it("usa os títulos de marketing", () => {
    render(<RelatorioResultado relatorio={relatorio} />);
    expect(screen.getByText("Leitura do Relatório")).toBeTruthy();
    expect(screen.getByText("Solução ou ação")).toBeTruthy();
  });

  it("mostra a seção de criativo com Hook, custo/resultado e os 3 estados", () => {
    render(<RelatorioResultado relatorio={relatorio} />);
    expect(screen.getByText("Desempenho por criativo (Meta)")).toBeTruthy();
    // Escopado À TABELA: o mesmo criativo aparece também no carrossel acima, e uma busca global
    // encontraria os dois. Escopar é mais preciso do que era antes — garante que o número está na
    // tabela, que é quem compara anúncio com anúncio.
    const tabela = within(screen.getByRole("table"));
    // Hook do V009 (vídeo) renderizado com 2 casas.
    expect(tabela.getByText("24,08%")).toBeTruthy();
    // Estático → Hook/Hold "n/a" (não é falha de retenção).
    expect(tabela.getAllByText("n/a").length).toBeGreaterThan(0);
    // Custo/resultado de anúncio sem resultado → "não calc." (nem zero, nem em branco).
    expect(tabela.getByText("não calc.")).toBeTruthy();
    // O tipo de resultado do anúncio aparece (não chamamos tudo de "lead").
    expect(tabela.getByText(/Conversas iniciadas/)).toBeTruthy();
  });

  it("renderiza a miniatura do criativo quando há thumbnail", () => {
    render(<RelatorioResultado relatorio={relatorio} />);
    // Duas miniaturas do mesmo anúncio existem de propósito (carrossel + tabela); esta asserção é
    // sobre a da TABELA.
    const img = within(screen.getByRole("table")).getByAltText("V009") as HTMLImageElement;
    expect(img.tagName).toBe("IMG");
    // Passa pelo proxy de imagem (weserv) com a URL do Meta embutida.
    expect(img.src).toContain("images.weserv.nl");
  });

  it("renderiza os chips de criativo citados na prioridade", () => {
    render(<RelatorioResultado relatorio={relatorio} />);
    // V008 só aparece como chip (não está na tabela) → prova o chip.
    expect(screen.getByText("V008")).toBeTruthy();
  });

  it("período simples: sem comparável, a tabela de números não tem a coluna Comparável", () => {
    const metrica = {
      id: "leadsTrafego", label: "Leads de tráfego", unidade: "contagem", direcao: "higher", grupo: "Leads",
      a: { valor: 200, disponivel: true, corrigido: false }, b: null,
      meta: { a: null, b: null }, delta: null,
    };
    const simples = {
      ...relatorio,
      snapshot: { ...snapshot, comparacao: null, metricas: [metrica] },
    } as unknown as Relatorio;
    render(<RelatorioResultado relatorio={simples} />);
    // A tabela (dentro do <details>) mostra o período, mas não o cabeçalho "Comparável".
    expect(screen.getByText("Leads de tráfego")).toBeTruthy();
    expect(screen.queryByText("Comparável")).toBeNull();
  });
});

/**
 * O menu de saídas do relatório.
 *
 * O que ele tem de acertar não é abrir: é **não oferecer o que não existe** e **não dizer "copiado"
 * quando o que houve foi um download**. Os dois erros só aparecem na mão de quem ia colar.
 */
describe("MenuExportarRelatorio", () => {
  const abrirMenu = async () => {
    const gatilho = screen.getByRole("button", { name: /^copiar$/i });
    // Abre pelo TECLADO. O `pointerdown` do Radix não chega a abrir no jsdom (não há captura de
    // ponteiro de verdade), e o caminho do teclado é o mesmo código de abertura — além de ser o
    // caminho que precisa funcionar para quem não usa mouse.
    fireEvent.keyDown(gatilho, { key: "Enter" });
    return screen.findByRole("menu");
  };

  it("o gatilho é 'Copiar', e as saídas estão dentro dele", async () => {
    render(<RelatorioResultado relatorio={relatorio} />);
    const menu = await abrirMenu();
    for (const rotulo of [
      "Copiar Markdown",
      "Copiar Texto",
      "Copiar tabela de criativos (PNG)",
      "Copiar tabela de números (PNG)",
      "Exportar Relatório (PDF)",
    ]) {
      expect(within(menu).getByRole("menuitem", { name: rotulo })).toBeTruthy();
    }
  });

  it("a tabela que este relatório NÃO tem fica desabilitada, não some", async () => {
    // Menu que muda de tamanho conforme o relatório faz quem usa procurar o item que viu ontem.
    // Desabilitado, a pessoa vê que a opção existe e que este relatório não a tem.
    const semNumeros = {
      ...relatorio,
      snapshot: { ...snapshot, metricas: [] },
    } as unknown as Relatorio;
    render(<RelatorioResultado relatorio={semNumeros} />);
    const menu = await abrirMenu();
    expect(
      within(menu).getByRole("menuitem", { name: "Copiar tabela de números (PNG)" }),
    ).toHaveAttribute("data-disabled");
    // A de criativos existe neste relatório e continua clicável.
    expect(
      within(menu).getByRole("menuitem", { name: "Copiar tabela de criativos (PNG)" }),
    ).not.toHaveAttribute("data-disabled");
  });

  it("Markdown e Texto copiam coisas DIFERENTES", async () => {
    // Se os dois entregassem a mesma string, o item novo seria enfeite — e quem colou no WhatsApp
    // continuaria vendo asteriscos.
    const escrito: string[] = [];
    Object.assign(navigator, {
      clipboard: { writeText: async (t: string) => void escrito.push(t) },
    });

    render(<RelatorioResultado relatorio={relatorio} />);
    const menu = await abrirMenu();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Copiar Markdown" }));
    await screen.findByRole("button", { name: /^copiar$/i });

    const menu2 = await abrirMenu();
    fireEvent.click(within(menu2).getByRole("menuitem", { name: "Copiar Texto" }));
    await waitFor(() => expect(escrito).toHaveLength(2));

    expect(escrito[0]).toMatch(/\*\*/);
    expect(escrito[1]).not.toMatch(/\*\*/);
  });
});
