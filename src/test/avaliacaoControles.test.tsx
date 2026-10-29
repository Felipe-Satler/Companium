/**
 * Os controles de voto e tag — o mesmo componente nas duas telas.
 *
 * Duas coisas aqui são fáceis de errar e caras de descobrir depois: **clicar no voto que já está
 * marcado tem de TIRAR o voto** (senão não há como desfazer um clique errado, e "votei por engano" é
 * mais comum que "mudei de ideia"), e **trocar de positivo para negativo move DOIS pontos**, não um.
 * O otimismo da tela é o que faz o contador parecer certo antes da resposta — e o que o faz mentir
 * se a conta estiver errada.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const votarMock = vi.fn();
const tagMock = vi.fn();

const toastErro = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: { access_token: "tok" } }),
}));

vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastErro(...a) } }));

vi.mock("@/lib/avaliacoesApi", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/avaliacoesApi")>();
  return {
    ...real,
    votar: (...a: unknown[]) => votarMock(...a),
    definirTag: (...a: unknown[]) => tagMock(...a),
    listarAvaliacoes: async () => ({ itens: {} }),
  };
});

import { AvaliacaoControles, TagChip } from "@/components/marketing/AvaliacaoControles";
import type { AvaliacaoItem } from "@/lib/avaliacoesApi";

const aval = (over: Partial<AvaliacaoItem> = {}): AvaliacaoItem => ({
  positivos: 0,
  negativos: 0,
  saldo: 0,
  meuVoto: null,
  tag: null,
  ...over,
});

let qc: QueryClient;
const render = (ui: ReactNode) => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return rtlRender(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

const positivo = () => screen.getByRole("button", { name: /votar positivamente|tirar meu voto positivo/i });
const negativo = () => screen.getByRole("button", { name: /votar negativamente|tirar meu voto negativo/i });

beforeEach(() => {
  votarMock.mockReset().mockResolvedValue({ ok: true });
  tagMock.mockReset().mockResolvedValue({ ok: true, tag: null });
  toastErro.mockReset();
});

describe("voto", () => {
  it("mostra a contagem dos dois lados", () => {
    render(<AvaliacaoControles alvo="analise" id="a1" avaliacao={aval({ positivos: 3, negativos: 1 })} />);
    expect(positivo()).toHaveTextContent("3");
    expect(negativo()).toHaveTextContent("1");
  });

  it("zero não vira '0' na tela", () => {
    // Um "0" ao lado do polegar parece nota, não contagem. Ausência de voto é ausência de número.
    render(<AvaliacaoControles alvo="analise" id="a1" avaliacao={aval()} />);
    expect(positivo()).toHaveTextContent(/^$/);
  });

  it("clicar vota", async () => {
    render(<AvaliacaoControles alvo="analise" id="a1" avaliacao={aval()} />);
    fireEvent.click(positivo());
    // `mutate` é assíncrono no react-query: asserção logo após o clique corre antes da chamada.
    await waitFor(() => expect(votarMock).toHaveBeenCalledWith("tok", "analise", "a1", 1));
  });

  it("clicar no voto JÁ MARCADO tira o voto", async () => {
    // É a única forma de desfazer um clique errado.
    render(<AvaliacaoControles alvo="analise" id="a1" avaliacao={aval({ positivos: 1, meuVoto: 1 })} />);
    fireEvent.click(positivo());
    await waitFor(() => expect(votarMock).toHaveBeenCalledWith("tok", "analise", "a1", null));
  });

  it("o botão do meu voto aparece marcado", () => {
    // Sem isto a pessoa não sabe se já votou e vota de novo achando que não contou.
    render(<AvaliacaoControles alvo="analise" id="a1" avaliacao={aval({ meuVoto: -1, negativos: 1 })} />);
    expect(negativo()).toHaveAttribute("aria-pressed", "true");
    expect(positivo()).toHaveAttribute("aria-pressed", "false");
  });

  it("o alvo vai na chamada — é o MESMO componente para os dois artefatos", async () => {
    render(<AvaliacaoControles alvo="composicao" id="c9" avaliacao={aval()} />);
    fireEvent.click(negativo());
    await waitFor(() => expect(votarMock).toHaveBeenCalledWith("tok", "composicao", "c9", -1));
  });

  it("item sem avaliação nenhuma renderiza e é votável", async () => {
    // `avaliacao` ausente é o caso comum: o mapa só traz quem já tem voto ou tag.
    render(<AvaliacaoControles alvo="analise" id="novo" />);
    fireEvent.click(positivo());
    await waitFor(() => expect(votarMock).toHaveBeenCalledWith("tok", "analise", "novo", 1));
  });
});

describe("contagem otimista", () => {
  /** Monta o cache como a tela o teria e devolve o item depois da mutação. */
  const comCache = async (inicial: AvaliacaoItem, clicar: () => void) => {
    render(<AvaliacaoControles alvo="analise" id="a1" avaliacao={inicial} />);
    qc.setQueryData(["marketing-avaliacoes", "analise"], { itens: { a1: inicial } });
    clicar();
    await waitFor(() => expect(votarMock).toHaveBeenCalled());
    return (
      qc.getQueryData<{ itens: Record<string, AvaliacaoItem> }>(["marketing-avaliacoes", "analise"])
        ?.itens.a1
    );
  };

  it("trocar de positivo para negativo move DOIS pontos", async () => {
    // O erro clássico: somar o novo voto sem descontar o antigo, e o saldo mentir até o refetch.
    const r = await comCache(aval({ positivos: 5, negativos: 2, saldo: 3, meuVoto: 1 }), () =>
      fireEvent.click(negativo()),
    );
    expect(r).toMatchObject({ positivos: 4, negativos: 3, saldo: 1, meuVoto: -1 });
  });

  it("tirar o voto desconta sem somar no outro lado", async () => {
    const r = await comCache(aval({ positivos: 5, negativos: 2, saldo: 3, meuVoto: 1 }), () =>
      fireEvent.click(positivo()),
    );
    expect(r).toMatchObject({ positivos: 4, negativos: 2, saldo: 2, meuVoto: null });
  });

  it("votar pela primeira vez soma um", async () => {
    const r = await comCache(aval({ positivos: 2, negativos: 0, saldo: 2 }), () =>
      fireEvent.click(positivo()),
    );
    expect(r).toMatchObject({ positivos: 3, saldo: 3, meuVoto: 1 });
  });

  it("falha AVISA, não só desfaz", async () => {
    // Este é o bug reportado como "clicar não parece estar funcionando": o contador subia, voltava,
    // e nada explicava por quê. A mensagem do `spyRequest` é específica (ela sabe dizer "o worker
    // está rodando versão antiga"), e engoli-la era jogar fora justamente o diagnóstico.
    votarMock.mockRejectedValue(new Error("O worker da Mineração não conhece esta rota"));
    render(<AvaliacaoControles alvo="analise" id="a1" avaliacao={aval()} />);
    fireEvent.click(positivo());
    await waitFor(() => expect(toastErro).toHaveBeenCalled());
    expect(String(toastErro.mock.calls[0][0])).toMatch(/não conhece esta rota/i);
  });

  // NÃO há caso de UI para a falha da TAG: abrir o `DropdownMenu` do Radix no jsdom exige
  // polyfill de pointer capture, e o `onError` dela é o mesmo do voto — seriam três polyfills para
  // reprovar a mesma linha. O caso do voto acima cobre a regra; se um dia os dois divergirem, é a
  // divergência que precisa de teste, não o andaime.

  it("se a requisição falhar, a contagem volta — a tela não mente", async () => {
    votarMock.mockRejectedValue(new Error("worker fora do ar"));
    const r = await comCache(aval({ positivos: 5, negativos: 2, saldo: 3, meuVoto: 1 }), () =>
      fireEvent.click(negativo()),
    );
    await waitFor(() => {
      const atual = qc.getQueryData<{ itens: Record<string, AvaliacaoItem> }>([
        "marketing-avaliacoes",
        "analise",
      ])?.itens.a1;
      expect(atual).toMatchObject({ positivos: 5, negativos: 2, meuVoto: 1 });
    });
    expect(r).toBeDefined();
  });
});

describe("tag", () => {
  it("sem tag, o gatilho convida a definir uma", () => {
    render(<AvaliacaoControles alvo="analise" id="a1" avaliacao={aval()} />);
    expect(screen.getByRole("button", { name: /definir tag/i })).toBeInTheDocument();
  });

  it("com tag, o gatilho mostra qual é", () => {
    render(<AvaliacaoControles alvo="analise" id="a1" avaliacao={aval({ tag: "no_ar" })} />);
    expect(screen.getByRole("button", { name: /tag: no ar/i })).toBeInTheDocument();
  });
});

describe("TagChip", () => {
  it("traz cor, ícone e RÓTULO — cor sozinha não é sinal acessível", () => {
    const { container } = rtlRender(<TagChip tag="risco_cfm" />);
    expect(screen.getByText("Risco CFM")).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.firstElementChild?.className).toContain("red");
  });

  it("tag desconhecida não desenha nada, em vez de um chip sem sentido", () => {
    const { container } = rtlRender(<TagChip tag="inventada" />);
    expect(container.firstChild).toBeNull();
  });

  it("sem tag, nada", () => {
    const { container } = rtlRender(<TagChip tag={null} />);
    expect(container.firstChild).toBeNull();
  });
});
