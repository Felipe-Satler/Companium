/**
 * A visão em lista das composições salvas: agrupada por cliente, expansível.
 *
 * A grade de cards responde "o que foi composto ultimamente"; esta responde "o que já compusemos
 * para ESTE cliente", que é a pergunta de quem vai compor de novo. Os casos abaixo prendem as duas
 * coisas de que essa promessa depende: a ordem alfabética ser pelo NOME que a pessoa lê, e o grupo
 * fechado não ter as composições no DOM.
 */
import { describe, it, expect, vi } from "vitest";
import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// A linha traz os controles de voto/tag, que usam sessão e react-query. Eles não são o assunto deste
// arquivo (têm o seu), mas sem o provider a linha nem renderiza.
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: { access_token: "tok" } }),
}));
import {
  ORDENACOES,
  agruparPorCliente,
  ordenacaoPor,
} from "@/components/marketing/composer/agruparComposicoes";
import { ComposicoesLista } from "@/components/marketing/composer/ComposicoesLista";
import {
  VISAO_PADRAO,
  visaoDoArmazenado,
} from "@/components/marketing/composer/visaoComposicoes";
import type { ComposicaoResumo } from "@/lib/adComposerApi";

const render = (ui: ReactNode) =>
  rtlRender(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {ui}
    </QueryClientProvider>,
  );

const c = (over: Partial<ComposicaoResumo> = {}): ComposicaoResumo =>
  ({
    id: "x",
    cliente: "jose_ramos",
    nome_exibicao: "Dr. José Ramos",
    library_entry_id: null,
    analise_titulo: null,
    formato: null,
    formato_justificativa: null,
    entradas: [],
    extra_prompt: null,
    avisos: [],
    fontes: null,
    status: "ok",
    error: null,
    criado_por: "u1",
    criado_em: "2026-09-01T12:00:00.000Z",
    atualizado_em: "2026-09-01T12:00:00.000Z",
    canDelete: true,
    ...over,
  }) as ComposicaoResumo;

describe("agruparPorCliente", () => {
  it("ordena alfabeticamente pelo NOME, não pelo slug", () => {
    // É a única coisa que a visão promete: achar o cliente pela letra. Ordenar pelo slug poria
    // "Dr. Ana" sob a letra do slug (`ana_...`) e "Bruno" antes dela.
    const grupos = agruparPorCliente([
      c({ id: "1", cliente: "zuleica_prado", nome_exibicao: "Dra. Ana Zuleica" }),
      c({ id: "2", cliente: "ana_bruno", nome_exibicao: "Dr. Bruno Aguiar" }),
    ]);
    expect(grupos.map((g) => g.nome)).toEqual(["Dr. Bruno Aguiar", "Dra. Ana Zuleica"]);
  });

  it("acento e caixa não criam duas posições para o mesmo nome", () => {
    const grupos = agruparPorCliente([
      c({ id: "1", cliente: "a", nome_exibicao: "Ótica Vista" }),
      c({ id: "2", cliente: "b", nome_exibicao: "Oficina" }),
      c({ id: "3", cliente: "c", nome_exibicao: "odonto" }),
    ]);
    expect(grupos.map((g) => g.nome)).toEqual(["odonto", "Oficina", "Ótica Vista"]);
  });

  it("junta as composições do mesmo cliente", () => {
    const grupos = agruparPorCliente([c({ id: "1" }), c({ id: "2" }), c({ id: "3", cliente: "outro", nome_exibicao: "Zé" })]);
    expect(grupos).toHaveLength(2);
    expect(grupos.find((g) => g.cliente === "jose_ramos")!.composicoes).toHaveLength(2);
  });

  it("o nome vem da primeira linha que tiver um", () => {
    // Linha antiga pode não ter `nome_exibicao`; cair para o slug quando OUTRA linha do grupo sabe
    // o nome seria perder informação que já está na mão.
    const grupos = agruparPorCliente([
      c({ id: "1", nome_exibicao: null }),
      c({ id: "2", nome_exibicao: "Dr. José Ramos" }),
    ]);
    expect(grupos[0].nome).toBe("Dr. José Ramos");
  });

  it("dentro do cliente, o padrão é mais recente primeiro", () => {
    const grupos = agruparPorCliente([
      c({ id: "velha", criado_em: "2026-01-01T00:00:00.000Z" }),
      c({ id: "nova", criado_em: "2026-09-01T00:00:00.000Z" }),
    ]);
    expect(grupos[0].composicoes.map((x) => x.id)).toEqual(["nova", "velha"]);
  });

  it("data inválida não vira 1970 e embaralha a lista", () => {
    const grupos = agruparPorCliente([
      c({ id: "ok", criado_em: "2026-09-01T00:00:00.000Z" }),
      c({ id: "lixo", criado_em: "não é data" }),
    ]);
    expect(grupos[0].composicoes[0].id).toBe("ok");
  });

  it("os outros critérios ordenam, e o id desconhecido cai no padrão", () => {
    const lista = [
      c({ id: "velha", criado_em: "2026-01-01T00:00:00.000Z" }),
      c({ id: "nova", criado_em: "2026-09-01T00:00:00.000Z" }),
    ];
    expect(agruparPorCliente(lista, "antigas")[0].composicoes.map((x) => x.id)).toEqual([
      "velha",
      "nova",
    ]);
    // Estado salvo velho ou URL de outra versão não pode quebrar a tela.
    expect(ordenacaoPor("inventado").id).toBe(ORDENACOES[0].id);
  });

  it("todo critério oferecido sabe ordenar — nenhuma opção morta no seletor", () => {
    const lista = [c({ id: "1" }), c({ id: "2", criado_em: "2026-05-01T00:00:00.000Z" })];
    for (const o of ORDENACOES) {
      const grupos = agruparPorCliente(lista, o.id);
      expect(grupos[0].composicoes, o.id).toHaveLength(2);
    }
  });
});

describe("qual visão abre", () => {
  it("a LISTA é o padrão do site", () => {
    // O pedido explícito, e a regressão que já aconteceu: enquanto o padrão vivia só no
    // `localStorage`, "lista é o padrão" valia para quem já tinha clicado e para mais ninguém.
    expect(VISAO_PADRAO).toBe("lista");
    expect(visaoDoArmazenado(null)).toBe("lista");
    expect(visaoDoArmazenado(undefined)).toBe("lista");
  });

  it("o armazenamento guarda a EXCEÇÃO, não a preferência", () => {
    // Só `cards` desvia. Valor de uma versão anterior ou lixo cai no padrão em vez de quebrar.
    expect(visaoDoArmazenado("cards")).toBe("cards");
    expect(visaoDoArmazenado("lista")).toBe("lista");
    expect(visaoDoArmazenado("grade")).toBe("lista");
    expect(visaoDoArmazenado("")).toBe("lista");
  });
});

describe("ComposicoesLista", () => {
  const props = { onSelect: () => {}, onDelete: () => {}, apagando: null };

  it("mostra o cliente e a contagem sem abrir, e NÃO as composições", () => {
    // Fechado tem de informar: a contagem é o que faz o grupo valer a pena antes do clique. E o
    // conteúdo fica fora do DOM, não só escondido por CSS.
    render(
      <ComposicoesLista
        {...props}
        compositions={[c({ id: "1", extra_prompt: "foco em anestesia" }), c({ id: "2" })]}
      />,
    );
    expect(screen.getByText("Dr. José Ramos")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.queryByText(/foco em anestesia/)).not.toBeInTheDocument();
  });

  it("clicar no nome expande e mostra as composições daquele cliente", () => {
    render(
      <ComposicoesLista {...props} compositions={[c({ id: "1", extra_prompt: "foco em anestesia" })]} />,
    );
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText(/foco em anestesia/)).toBeInTheDocument();
  });

  it("nada abre sozinho", () => {
    // Abrir o primeiro grupo "para não parecer vazio" daria a impressão de que aquele cliente é
    // especial, com a carteira inteira na tela.
    render(<ComposicoesLista {...props} compositions={[c({ id: "1" }), c({ id: "2", cliente: "outro", nome_exibicao: "Zé" })]} />);
    expect(screen.queryAllByRole("button", { expanded: true })).toHaveLength(0);
  });

  it("abrir um grupo não abre os outros", () => {
    render(
      <ComposicoesLista
        {...props}
        compositions={[
          c({ id: "1", extra_prompt: "do josé" }),
          c({ id: "2", cliente: "outro", nome_exibicao: "Zé", extra_prompt: "do zé" }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Dr\. José Ramos/ }));
    expect(screen.getByText(/do josé/)).toBeInTheDocument();
    expect(screen.queryByText(/do zé/)).not.toBeInTheDocument();
  });

  it("composição sem pedido diz isso — nesta visão o pedido é o que distingue uma da outra", () => {
    render(<ComposicoesLista {...props} compositions={[c({ id: "1", extra_prompt: null })]} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("sem pedido específico")).toBeInTheDocument();
  });

  it("clicar numa composição abre aquela, não o grupo", () => {
    const onSelect = vi.fn();
    render(<ComposicoesLista {...props} onSelect={onSelect} compositions={[c({ id: "abc", extra_prompt: "p" })]} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    fireEvent.click(screen.getByText(/“p”/));
    expect(onSelect).toHaveBeenCalledWith("abc");
  });

  it("sem permissão, não há botão de apagar", () => {
    render(<ComposicoesLista {...props} compositions={[c({ id: "1", canDelete: false })]} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.queryByRole("button", { name: /apagar/i })).not.toBeInTheDocument();
  });
});
