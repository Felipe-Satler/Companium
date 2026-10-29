import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MetasTabela } from "@/components/clientes/metas/MetasTabela";
import { MetasMultiSelect } from "@/components/clientes/metas/MetasMultiSelect";
import { MetasPizzas } from "@/components/clientes/metas/MetasPizzas";
import { MetasBarras } from "@/components/clientes/metas/MetasBarras";
import { MetaClientRow, buildCells } from "@/utils/metasStatus";
import { MetaKey, MetaValues } from "@/hooks/useClientesMetas";
import { CRMClientRow } from "@/utils/crmCalculations";

// recharts mede o container real; em jsdom ele tem 0px e o gráfico não pinta. Fixamos um
// tamanho para o ResponsiveContainer, que é o padrão usado para testar recharts.
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <actual.ResponsiveContainer width={400} height={200}>
        {children as never}
      </actual.ResponsiveContainer>
    ),
  };
});

const crmRow: CRMClientRow = {
  client: "Cliente_A",
  especialidade: "",
  investimento: 800,
  leadsTrafego: 0,
  leadsTrafegoMeta: 0,
  leadsTrafegoGoogle: 0,
  leadsCRM: 50,
  consultasAgendadas: 0,
  cacGeral: 0,
  valorConsultasAgendadas: 0,
  consultasRealizadas: 0,
  valorConsultasRealizadas: 0,
  procedimentosAgendados: 0,
  valorProcedimentosAgendados: 0,
  procedimentosRealizados: 0,
  valorProcedimentosRealizados: 0,
  faturamentoBrutoRealizados: 5000,
  roas: 6.25,
};

function metas(values: Partial<Record<string, number>>): MetaValues {
  const out = {} as MetaValues;
  for (const k of ["investimento", "leadsCRM", "faturamento"]) {
    out[k as keyof MetaValues] = { value: values[k] ?? null, kind: k === "leadsCRM" ? "count" : "currency" };
  }
  return out;
}

const rows: MetaClientRow[] = [
  {
    client: "Cliente_A",
    squad: null,
    plano: null,
    desde: null,
    cells: buildCells(crmRow, metas({ investimento: 1000, leadsCRM: 40 }), ["investimento", "leadsCRM", "faturamento"]),
  },
];

describe("MetasTabela", () => {
  it("mostra o real com a % da meta ao lado, e '-' quando não há meta", () => {
    render(<MetasTabela rows={rows} fields={["investimento", "leadsCRM", "faturamento"]} />);

    // Investimento: 800 de um teto de 1000 = 80%
    expect(screen.getByText("80%")).toBeTruthy();
    // Leads: 50 de 40 = 125%
    expect(screen.getByText("125%")).toBeTruthy();
    // Faturamento sem meta cadastrada → "-"
    expect(screen.getByText("-")).toBeTruthy();
  });

  it("pinta verde dentro da meta e vermelho fora", () => {
    render(<MetasTabela rows={rows} fields={["investimento", "leadsCRM", "faturamento"]} />);
    expect(screen.getByText("80%").className).toContain("emerald"); // custo abaixo do teto
    expect(screen.getByText("125%").className).toContain("emerald"); // entrega acima do alvo
    expect(screen.getByText("-").className).toContain("amber");
  });

  it("troca o nome do cliente de underscore para espaço", () => {
    render(<MetasTabela rows={rows} fields={["leadsCRM"]} />);
    expect(screen.getByText("Cliente A")).toBeTruthy();
  });

  it("avisa quando não há cliente para os filtros", () => {
    render(<MetasTabela rows={[]} fields={["leadsCRM"]} />);
    expect(screen.getByText(/Nenhum cliente para os filtros/)).toBeTruthy();
  });

  it("congela a coluna do cliente com fundo sólido", () => {
    render(<MetasTabela rows={rows} fields={["leadsCRM"]} />);
    const cell = screen.getByText("Cliente A");
    expect(cell.className).toContain("sticky");
    expect(cell.className).toContain("left-0");
    // Sem fundo opaco o conteúdo rolando apareceria por baixo da coluna congelada.
    expect(cell.className).toContain("bg-background");
  });

  it("já mostra os valores de meta por padrão", () => {
    render(<MetasTabela rows={rows} fields={["investimento"]} />);
    expect(screen.getByText(/^meta /).textContent).toContain("1.000");
  });

  it("o olho esconde os valores de meta", () => {
    render(<MetasTabela rows={rows} fields={["investimento"]} />);
    fireEvent.click(screen.getByRole("button", { name: /Metas/ }));
    expect(screen.queryByText(/^meta /)).toBeNull();
    // e volta a mostrar ao clicar de novo
    fireEvent.click(screen.getByRole("button", { name: /Metas/ }));
    expect(screen.getByText(/^meta /)).toBeTruthy();
  });

  it("reordena as colunas de métrica pelas setas do cabeçalho", () => {
    render(<MetasTabela rows={rows} fields={["investimento", "leadsCRM", "faturamento"]} />);
    const headers = () => screen.getAllByRole("columnheader").map((h) => h.textContent?.trim());
    expect(headers().slice(3)).toEqual(["Investimento", "Leads CRM", "Faturamento"]);

    fireEvent.click(screen.getByRole("button", { name: "Mover Leads CRM para a esquerda" }));
    expect(headers().slice(3)).toEqual(["Leads CRM", "Investimento", "Faturamento"]);

    fireEvent.click(screen.getByRole("button", { name: "Mover Investimento para a direita" }));
    expect(headers().slice(3)).toEqual(["Leads CRM", "Faturamento", "Investimento"]);
  });

  it("não deixa mover para fora das pontas", () => {
    render(<MetasTabela rows={rows} fields={["investimento", "leadsCRM"]} />);
    expect(screen.getByRole("button", { name: "Mover Investimento para a esquerda" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Mover Leads CRM para a direita" }).hasAttribute("disabled")).toBe(true);
  });

  it("restaura a ordem original", () => {
    render(<MetasTabela rows={rows} fields={["investimento", "leadsCRM"]} />);
    expect(screen.queryByRole("button", { name: /Ordem original/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mover Leads CRM para a esquerda" }));
    fireEvent.click(screen.getByRole("button", { name: /Ordem original/ }));
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent?.trim()).slice(3)).toEqual([
      "Investimento",
      "Leads CRM",
    ]);
  });

  it("sem filtro do gráfico não há botão de limpar", () => {
    render(<MetasTabela rows={rows} fields={["leadsCRM"]} />);
    expect(screen.queryByRole("button", { name: "Limpar filtro" })).toBeNull();
  });

  it("com filtro do gráfico mostra o que está filtrado e o botão que limpa", () => {
    const onLimpar = vi.fn();
    render(
      <MetasTabela rows={rows} fields={["leadsCRM"]} filtroLabel="Leads CRM · Dentro da meta" onLimparFiltro={onLimpar} />,
    );
    expect(screen.getByText(/Leads CRM · Dentro da meta — 1 cliente/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Limpar filtro" }));
    expect(onLimpar).toHaveBeenCalledTimes(1);
  });

  it("mantém a ordem escolhida quando uma métrica é desligada no filtro", () => {
    const { rerender } = render(<MetasTabela rows={rows} fields={["investimento", "leadsCRM", "faturamento"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Mover Faturamento para a esquerda" }));
    // Faturamento passou para o meio; ao tirar Investimento, a ordem relativa sobrevive.
    rerender(<MetasTabela rows={rows} fields={["leadsCRM", "faturamento"]} />);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent?.trim()).slice(3)).toEqual([
      "Faturamento",
      "Leads CRM",
    ]);
  });
});

describe("MetasMultiSelect", () => {
  const opts = [
    { id: "a", label: "Squad A" },
    { id: "b", label: "Squad B" },
  ];

  it("diz 'todos' no botão enquanto nada está marcado", () => {
    render(
      <MetasMultiSelect
        title="Squads"
        options={opts}
        selected={[]}
        onChange={vi.fn()}
        placeholder="Todos os squads"
        pluralNoun="squads"
      />,
    );
    expect(screen.getByRole("button", { name: /Todos os squads/ })).toBeTruthy();
  });

  it("mostra o nome quando há um só, e a contagem quando há vários", () => {
    const { rerender } = render(
      <MetasMultiSelect
        title="Squads"
        options={opts}
        selected={["a"]}
        onChange={vi.fn()}
        placeholder="Todos os squads"
        pluralNoun="squads"
      />,
    );
    expect(screen.getByRole("button", { name: /Squad A/ })).toBeTruthy();
    rerender(
      <MetasMultiSelect
        title="Squads"
        options={opts}
        selected={["a", "b"]}
        onChange={vi.fn()}
        placeholder="Todos os squads"
        pluralNoun="squads"
      />,
    );
    expect(screen.getByRole("button", { name: /2 squads/ })).toBeTruthy();
  });

  it("marca uma opção pelo checkbox do menu", () => {
    const onChange = vi.fn();
    render(
      <MetasMultiSelect
        title="Squads"
        options={opts}
        selected={[]}
        onChange={onChange}
        placeholder="Todos os squads"
        pluralNoun="squads"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Todos os squads/ }));
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(onChange).toHaveBeenCalledWith(["a"]);
  });

  it("desmarca uma já marcada", () => {
    const onChange = vi.fn();
    render(
      <MetasMultiSelect
        title="Squads"
        options={opts}
        selected={["a", "b"]}
        onChange={onChange}
        placeholder="Todos os squads"
        pluralNoun="squads"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /2 squads/ }));
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(onChange).toHaveBeenCalledWith(["b"]);
  });

  it("limpa a seleção de uma vez", () => {
    const onChange = vi.fn();
    render(
      <MetasMultiSelect
        title="Squads"
        options={opts}
        selected={["a"]}
        onChange={onChange}
        placeholder="Todos os squads"
        pluralNoun="squads"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Squad A/ }));
    fireEvent.click(screen.getByRole("button", { name: "Limpar" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("desabilitado não abre o menu", () => {
    const onChange = vi.fn();
    render(
      <MetasMultiSelect
        title="Squads"
        options={opts}
        selected={[]}
        onChange={onChange}
        placeholder="Todos os squads"
        pluralNoun="squads"
        disabled
        hint="fonte ainda não conectada"
      />,
    );
    const trigger = screen.getByRole("button", { name: /Todos os squads/ });
    expect(trigger.hasAttribute("disabled")).toBe(true);
    fireEvent.click(trigger);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

// O card é o ancestral .neu-card do título; dentro dele a 1ª div com width inline é a coluna
// da pizza e a 2ª é o painel de detalhe que anima.
const cardDe = (titulo: string) => screen.getByText(titulo).closest(".neu-card") as HTMLElement;
const divsComLargura = (titulo: string) =>
  [...cardDe(titulo).querySelectorAll<HTMLElement>(":scope > div[style*='width']")];
const colunaPizza = (titulo: string) => divsComLargura(titulo)[0];
const painelDe = (titulo: string) => divsComLargura(titulo)[1];

describe("MetasPizzas", () => {
  it("sempre rende a pizza geral, e uma por squad quando há squad", () => {
    const comSquad: MetaClientRow[] = [
      { ...rows[0], squad: "s2" },
      { ...rows[0], client: "Cliente_B", squad: "s1" },
    ];
    const { container } = render(
      <MetasPizzas rows={comSquad} squadLabels={new Map([["s1", "Squad 1"], ["s2", "Squad 2"]])} />,
    );
    expect(screen.getByText("Todos os clientes")).toBeTruthy();
    expect(screen.getByText("Squad 1")).toBeTruthy();
    expect(screen.getByText("Squad 2")).toBeTruthy();
    // A fileira rola na horizontal em vez de espremer as pizzas.
    expect(container.querySelector(".overflow-x-auto")).toBeTruthy();
  });

  it("resume no centro quantos CLIENTES estão na meta", () => {
    // O Cliente A não estourou nenhuma métrica (investimento 80% de custo e leads 125% estão
    // ok; faturamento é sem meta) → 1 de 1 cliente dentro = 100%.
    render(<MetasPizzas rows={rows} squadLabels={new Map()} />);
    expect(within(cardDe("Todos os clientes")).getByText("100%")).toBeTruthy();
  });

  it("um cliente fora em uma métrica já cai no grupo 'fora'", () => {
    const fora: MetaClientRow[] = [
      {
        ...rows[0],
        cells: buildCells(crmRow, metas({ investimento: 500, leadsCRM: 40 }), ["investimento", "leadsCRM"]),
      },
    ];
    // investimento 800 num teto de 500 = estourou; leads seguem em dia → cliente conta como fora.
    render(<MetasPizzas rows={fora} squadLabels={new Map()} />);
    expect(within(cardDe("Todos os clientes")).getByText("0%")).toBeTruthy();
  });

  it("todas as pizzas têm o mesmo tamanho", () => {
    // Tamanhos diferentes fariam a maior parecer "mais cheia" na comparação lado a lado.
    const comSquad: MetaClientRow[] = [{ ...rows[0], squad: "s1" }];
    render(<MetasPizzas rows={comSquad} squadLabels={new Map([["s1", "Squad 1"]])} />);
    expect(colunaPizza("Todos os clientes").style.width).toBe("216px");
    expect(colunaPizza("Squad 1").style.width).toBe("216px");
  });

  it("começa fechada e abre ao clicar, listando os clientes de cada grupo", () => {
    render(<MetasPizzas rows={rows} squadLabels={new Map()} />);
    const gatilho = screen.getByRole("button", { name: /Todos os clientes/ });
    expect(gatilho.getAttribute("aria-expanded")).toBe("false");
    expect(painelDe("Todos os clientes").style.width).toBe("0px");

    fireEvent.click(gatilho);
    expect(gatilho.getAttribute("aria-expanded")).toBe("true");
    expect(painelDe("Todos os clientes").style.width).toBe("236px");
    // Cada cliente entra em UM grupo só (o veredito dele), então aparece uma vez.
    expect(within(painelDe("Todos os clientes")).getAllByText("Cliente A").length).toBe(1);
  });

  it("mostra quantas métricas puseram o cliente naquele grupo", () => {
    render(<MetasPizzas rows={rows} squadLabels={new Map()} />);
    fireEvent.click(screen.getByRole("button", { name: /Todos os clientes/ }));
    const painel = painelDe("Todos os clientes");
    // "Dentro da meta" tem 2 métricas do Cliente A; "Sem meta definida" tem 1.
    const dentro = within(painel).getByText("Dentro da meta").closest("div")!.parentElement!;
    expect(within(dentro).getByText("2")).toBeTruthy();
  });

  it("clicar de novo fecha", () => {
    render(<MetasPizzas rows={rows} squadLabels={new Map()} />);
    const gatilho = screen.getByRole("button", { name: /Todos os clientes/ });
    fireEvent.click(gatilho);
    fireEvent.click(gatilho);
    expect(gatilho.getAttribute("aria-expanded")).toBe("false");
    expect(painelDe("Todos os clientes").style.width).toBe("0px");
  });

  it("só uma pizza fica aberta por vez", () => {
    const comSquad: MetaClientRow[] = [
      { ...rows[0], squad: "s1" },
      { ...rows[0], client: "Cliente_B", squad: "s2" },
    ];
    render(<MetasPizzas rows={comSquad} squadLabels={new Map([["s1", "Squad 1"], ["s2", "Squad 2"]])} />);
    fireEvent.click(screen.getByRole("button", { name: /Squad 1/ }));
    expect(painelDe("Squad 1").style.width).toBe("236px");
    fireEvent.click(screen.getByRole("button", { name: /Squad 2/ }));
    expect(painelDe("Squad 1").style.width).toBe("0px");
    expect(painelDe("Squad 2").style.width).toBe("236px");
  });

  it("a animação some para quem pediu menos movimento", () => {
    render(<MetasPizzas rows={rows} squadLabels={new Map()} />);
    expect(painelDe("Todos os clientes").className).toContain("motion-reduce:transition-none");
  });
});

describe("MetasBarras", () => {
  const fields: MetaKey[] = ["investimento", "leadsCRM"];

  it("cola as barras da mesma métrica e afasta os grupos", () => {
    const { container } = render(<MetasBarras rows={rows} fields={fields} squadLabels={new Map()} />);
    // Sem gráfico por squad quando nenhum cliente tem squad.
    expect(screen.queryByText("Por squad")).toBeNull();
    expect(container.querySelector(".recharts-bar")).toBeTruthy();
  });

  it("rende um gráfico menor por squad, além do geral", () => {
    const comSquad: MetaClientRow[] = [
      { ...rows[0], squad: "s1" },
      { ...rows[0], client: "Cliente_B", squad: "s2" },
    ];
    render(
      <MetasBarras
        rows={comSquad}
        fields={fields}
        squadLabels={new Map([["s1", "Squad 1"], ["s2", "Squad 2"]])}
      />,
    );
    expect(screen.getByText("Por squad")).toBeTruthy();
    expect(screen.getByText("Squad 1")).toBeTruthy();
    expect(screen.getByText("Squad 2")).toBeTruthy();
  });

  it("o detalhamento começa fechado e abre para baixo ao clicar numa barra", () => {
    const { container } = render(<MetasBarras rows={rows} fields={fields} squadLabels={new Map()} />);
    const painel = () => container.querySelector<HTMLElement>("div[style*='grid-template-rows']")!;
    expect(painel().style.gridTemplateRows).toBe("0fr");
    expect(screen.queryByText(/por cliente/)).toBeNull();

    // Clica numa barra do gráfico (o retângulo da métrica).
    fireEvent.click(container.querySelectorAll(".recharts-bar-rectangle")[0]);
    expect(painel().style.gridTemplateRows).toBe("1fr");
    // Abre a lista da métrica clicada, com as três colunas de grupo.
    expect(screen.getByText(/por cliente/)).toBeTruthy();
    expect(screen.getAllByText("Dentro da meta").length).toBeGreaterThan(0);
    expect(screen.getByText("Cliente A")).toBeTruthy();
  });

  it("clicar na mesma barra de novo fecha o detalhamento", () => {
    const { container } = render(<MetasBarras rows={rows} fields={fields} squadLabels={new Map()} />);
    const barra = () => container.querySelectorAll(".recharts-bar-rectangle")[0];
    fireEvent.click(barra());
    fireEvent.click(barra());
    expect(container.querySelector<HTMLElement>("div[style*='grid-template-rows']")!.style.gridTemplateRows).toBe("0fr");
  });

  it("clicar numa barra pede o filtro da tabela pela métrica e pela cor clicadas", () => {
    const onFiltrar = vi.fn();
    const { container } = render(
      <MetasBarras rows={rows} fields={fields} squadLabels={new Map()} onFiltrar={onFiltrar} />,
    );
    // A primeira barra é a verde ("dentro da meta") da primeira métrica.
    fireEvent.click(container.querySelectorAll(".recharts-bar-rectangle")[0]);
    expect(onFiltrar).toHaveBeenCalledWith({ field: "investimento", status: "ok", squad: null });
    expect(screen.getByText(/por cliente/)).toBeTruthy();
  });

  it("barra de um gráfico de squad manda o squad junto no filtro", () => {
    const onFiltrar = vi.fn();
    const comSquad: MetaClientRow[] = [{ ...rows[0], squad: "s1" }];
    render(
      <MetasBarras rows={comSquad} fields={fields} squadLabels={new Map([["s1", "Squad 1"]])} onFiltrar={onFiltrar} />,
    );
    const card = screen.getByText("Squad 1").parentElement!;
    fireEvent.click(card.querySelectorAll(".recharts-bar-rectangle")[0]);
    expect(onFiltrar).toHaveBeenCalledWith({ field: "investimento", status: "ok", squad: "s1" });
  });

  it("a animação de abrir some para quem pediu menos movimento", () => {
    const { container } = render(<MetasBarras rows={rows} fields={fields} squadLabels={new Map()} />);
    const painel = container.querySelector<HTMLElement>("div[style*='grid-template-rows']")!;
    expect(painel.className).toContain("motion-reduce:transition-none");
  });

  it("dispõe os gráficos de squad em duas colunas", () => {
    const comSquad: MetaClientRow[] = [{ ...rows[0], squad: "s1" }];
    const { container } = render(
      <MetasBarras rows={comSquad} fields={fields} squadLabels={new Map([["s1", "Squad 1"]])} />,
    );
    expect(container.querySelector(".lg\\:grid-cols-2")).toBeTruthy();
  });
});
