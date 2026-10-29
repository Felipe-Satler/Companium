// A etapa de Conceitos Estratégicos na tela (20/10/2026): o que cada card mostra, as ações de quem
// compõe, o diálogo de insumos insuficientes e quando a tela pergunta de novo ao worker.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

const aprovar = { mutate: vi.fn(), isPending: false };
const rejeitar = { mutateAsync: vi.fn(async () => ({ ok: true })), isPending: false };
const seguir = { mutate: vi.fn(), isPending: false };
const confirmar = { mutate: vi.fn(), isPending: false };
vi.mock("@/hooks/useAdComposer", () => ({
  useConceitosComposicao: () => ({ aprovar, rejeitar, seguir, confirmar }),
}));

import { ConceitosComposicao } from "@/components/marketing/composer/ConceitosComposicao";
import { lerAcompanhados } from "@/lib/acompanhamento";
import { estaTrabalhando, type CatalogoCopy, type Composicao, type SlotConceito } from "@/lib/adComposerApi";

const CATALOGO: CatalogoCopy = {
  estudo: { page_id: "p1", nome: "Estudo de Copy – Dr. Otavio" },
  identificacao: { nome: "Dr. Otavio", crm: "00000/MS", rqe: null, rqe_texto: "Não possui" },
  assinatura: "Dr. Otavio | CRM: 00000/MS",
  tem_rqe: false,
  estudo_tem_preco: true,
  avatares: [
    { id: "A1", n: 1, nome: "O Empresário Discreto", nivel: "consciente_solucao", nivel_original: "Consciente da Solução (Nível 3)", perfil: "", dor: "" },
    { id: "A3", n: 3, nome: "A Mulher com Raleamento", nivel: "consciente_solucao", nivel_original: "Consciente do Mecanismo (Nível 4)", perfil: "", dor: "" },
  ],
  faltando: [],
  angulos: [{ id: "G1", nome: "Sem raspar a cabeça", descricao: "Medo de aparecer raspado", trechos: ["pânico de ter que raspar a cabeça a zero"] }],
  criativos: [
    { id: "C1", criativo_id: "c-1", nome: "Sem raspar", nivel: "consciente_solucao" },
    { id: "C2", criativo_id: "c-2", nome: "Antes de desistir", nivel: "consciente_problema" },
  ],
};

const conceito = (over: Partial<NonNullable<SlotConceito["conceito"]>> = {}) => ({
  avatar_id: "A1",
  nivel: "consciente_solucao" as const,
  angulo_id: "G1",
  criativo_ref: "C1",
  justificativa: "O Estudo põe o medo de raspar no centro.",
  ...over,
});

const slot = (over: Partial<SlotConceito> = {}): SlotConceito => ({
  n: 0,
  formato_saida: "instagram_reels",
  status: "sugerido",
  conceito: conceito(),
  reciclado: false,
  rejeitados: [],
  error: null,
  ...over,
});

const composicao = (over: Partial<Composicao> = {}) =>
  ({
    id: "k1",
    status: "conceitos",
    canDelete: true,
    conceitos: [slot()],
    catalogo_copy: CATALOGO,
    insumos_insuficientes: null,
    ...over,
  }) as Composicao;

beforeEach(() => {
  aprovar.mutate.mockReset();
  rejeitar.mutateAsync.mockClear();
  seguir.mutate.mockReset();
  confirmar.mutate.mockReset();
});

describe("ConceitosComposicao", () => {
  it("antes da primeira sugestão, diz o que está acontecendo", () => {
    render(<ConceitosComposicao composicao={composicao({ conceitos: [] })} onEscolherMaisInsumos={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent(/sugerindo um conceito estratégico por anúncio/);
  });

  it("o card mostra as quatro partes, o uso e de onde o ângulo veio", () => {
    render(<ConceitosComposicao composicao={composicao()} onEscolherMaisInsumos={vi.fn()} />);
    const card = screen.getByRole("listitem", { name: "Conceito do anúncio 1" });
    expect(card).toHaveTextContent("Anúncio 1 · Instagram Reels");
    expect(card).toHaveTextContent("O Empresário Discreto");
    expect(card).toHaveTextContent("Consciente da solução");
    expect(card).toHaveTextContent("Sem raspar a cabeça");
    expect(card).toHaveTextContent("Sem raspar");
    expect(card).toHaveTextContent("O Estudo põe o medo de raspar no centro.");
    fireEvent.click(within(card).getByRole("button", { name: /de onde veio no estudo/i }));
    expect(card).toHaveTextContent("“pânico de ter que raspar a cabeça a zero”");
  });

  it("sinaliza nível diferente do Estudo, estrutura de outro nível, o rótulo 'Mecanismo' e a reciclagem", () => {
    const slots = [
      slot({ conceito: conceito({ nivel: "consciente_problema" }) }),
      slot({ n: 1, conceito: conceito({ avatar_id: "A3", criativo_ref: "C2" }) }),
      slot({ n: 2, formato_saida: "meta_ads", conceito: conceito({ avatar_id: "A3", criativo_ref: "C2" }), reciclado: true }),
    ];
    render(<ConceitosComposicao composicao={composicao({ conceitos: slots })} onEscolherMaisInsumos={vi.fn()} />);
    const [a1, a2, a3] = screen.getAllByRole("listitem", { name: /conceito do anúncio/i });
    expect(a1).toHaveTextContent("diferente do Estudo (Consciente da solução)");
    expect(a2).toHaveTextContent("o Estudo diz “Consciente do Mecanismo (Nível 4)”");
    expect(a2).toHaveTextContent("estrutura feita para consciente do problema");
    expect(a3).toHaveTextContent("Reciclado: mesmo conceito do anúncio 2, em outro formato de saída.");
  });

  it("aprovar e rejeitar com motivo", async () => {
    render(<ConceitosComposicao composicao={composicao()} onEscolherMaisInsumos={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /aprovar/i }));
    expect(aprovar.mutate).toHaveBeenCalledWith(0, expect.anything());

    fireEvent.click(screen.getByRole("button", { name: /^rejeitar$/i }));
    fireEvent.change(screen.getByLabelText(/motivo da rejeição do anúncio 1/i), { target: { value: "sem falar de reunião" } });
    fireEvent.click(screen.getByRole("button", { name: /rejeitar e pedir outro/i }));
    expect(rejeitar.mutateAsync).toHaveBeenCalledWith({ n: 0, motivo: "sem falar de reunião" });
  });

  it("só começa a compor com TODOS os conceitos aprovados", () => {
    const { rerender } = render(
      <ConceitosComposicao
        composicao={composicao({ conceitos: [slot({ status: "aprovado" }), slot({ n: 1 })] })}
        onEscolherMaisInsumos={vi.fn()}
      />,
    );
    const comecar = screen.getByRole("button", { name: /começar composição/i });
    expect(comecar).toBeDisabled();
    expect(screen.getByText(/1 de 2 conceitos aprovado/)).toBeInTheDocument();
    rerender(
      <ConceitosComposicao
        composicao={composicao({ conceitos: [slot({ status: "aprovado" }), slot({ n: 1, status: "aprovado" })] })}
        nome="Dr. Otavio"
        onEscolherMaisInsumos={vi.fn()}
      />,
    );
    confirmar.mutate.mockImplementationOnce((_v: unknown, opts: { onSuccess: () => void }) => opts.onSuccess());
    fireEvent.click(screen.getByRole("button", { name: /começar composição/i }));
    expect(confirmar.mutate).toHaveBeenCalled();
    // A escrita leva minutos: a composição volta a ser acompanhada, para o aviso de "anúncios prontos".
    expect(lerAcompanhados()).toContainEqual({ tipo: "composicao", id: "k1", nome: "Dr. Otavio" });
  });

  it("insumos insuficientes: o diálogo abre e oferece as duas saídas", () => {
    const voltar = vi.fn();
    render(
      <ConceitosComposicao
        composicao={composicao({
          conceitos: [slot(), slot({ n: 1, status: "pendente", conceito: null })],
          insumos_insuficientes: { motivo: "O Estudo só sustenta um ângulo.", sugestao: "Escolha outra análise de criativo.", bloqueante: false, seguir: false },
        })}
        onEscolherMaisInsumos={voltar}
      />,
    );
    const dialogo = screen.getByRole("dialog");
    expect(dialogo).toHaveTextContent("O Estudo só sustenta um ângulo.");
    expect(dialogo).toHaveTextContent("Escolha outra análise de criativo.");
    fireEvent.click(within(dialogo).getByRole("button", { name: /seguir assim mesmo/i }));
    expect(seguir.mutate).toHaveBeenCalled();
    fireEvent.click(within(dialogo).getByRole("button", { name: /escolher mais insumos/i }));
    expect(voltar).toHaveBeenCalled();
    // O anúncio sem conceito diz que espera a decisão. (Com o diálogo modal aberto, o resto da
    // página sai da árvore de acessibilidade — daí o `hidden`.)
    expect(screen.getByRole("listitem", { name: "Conceito do anúncio 2", hidden: true })).toHaveTextContent(/Decida entre escolher mais insumos/);
  });

  it("bloqueante: só dá para voltar aos insumos", () => {
    render(
      <ConceitosComposicao
        composicao={composicao({
          conceitos: [],
          insumos_insuficientes: { motivo: "O Estudo de Copy não tem a seção Avatares Base.", sugestao: "", bloqueante: true, seguir: false },
        })}
        onEscolherMaisInsumos={vi.fn()}
      />,
    );
    const dialogo = screen.getByRole("dialog");
    expect(dialogo).toHaveTextContent("Não dá para sugerir conceitos");
    expect(within(dialogo).queryByRole("button", { name: /seguir assim mesmo/i })).toBeNull();
  });

  it("anúncio sem conceito diferente oferece tentar de novo", () => {
    render(
      <ConceitosComposicao
        composicao={composicao({ conceitos: [slot({ status: "erro", conceito: null, error: "Não consegui um conceito diferente." })] })}
        onEscolherMaisInsumos={vi.fn()}
      />,
    );
    expect(screen.getByText("Não consegui um conceito diferente.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /tentar de novo/i }));
    expect(rejeitar.mutateAsync).toHaveBeenCalledWith({ n: 0, motivo: "" });
  });

  it("Estudo fora do modelo: diz que os avatares vieram do agente, e marca o nível que ele inferiu", () => {
    const catalogo = {
      ...CATALOGO,
      avatares_origem: "agente" as const,
      avatares: [{ ...CATALOGO.avatares[0], nivel_original: "", nivel_inferido: true }, CATALOGO.avatares[1]],
    };
    render(<ConceitosComposicao composicao={composicao({ catalogo_copy: catalogo })} onEscolherMaisInsumos={vi.fn()} />);
    expect(screen.getByText(/não segue o modelo padrão/)).toHaveTextContent("os 2 avatares foram identificados pelo agente");
    expect(screen.getByRole("listitem", { name: "Conceito do anúncio 1" })).toHaveTextContent(
      "o Estudo não diz o nível: inferido pelo agente",
    );
  });

  it("quem não pediu a composição vê os conceitos, sem os botões", () => {
    render(<ConceitosComposicao composicao={composicao({ canDelete: false })} onEscolherMaisInsumos={vi.fn()} />);
    expect(screen.getByText("O Empresário Discreto")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /aprovar/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /começar composição/i })).toBeNull();
  });
});

describe("quando a tela pergunta de novo ao worker", () => {
  it("nos conceitos, só enquanto o agente sugere", () => {
    expect(estaTrabalhando({ status: "conceitos", conceitos: [], insumos_insuficientes: null })).toBe(true);
    expect(estaTrabalhando({ status: "conceitos", conceitos: [slot({ status: "gerando", conceito: null })] })).toBe(true);
    // Esperando quem compõe aprovar — pode levar horas: não pergunta.
    expect(estaTrabalhando({ status: "conceitos", conceitos: [slot()] })).toBe(false);
    expect(
      estaTrabalhando({ status: "conceitos", conceitos: [], insumos_insuficientes: { motivo: "", sugestao: "", bloqueante: true, seguir: false } }),
    ).toBe(false);
    // Na lista, que não traz os conceitos, nunca.
    expect(estaTrabalhando({ status: "conceitos" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Fase 7: Composições Salvas e o anúncio pronto
// ---------------------------------------------------------------------------------------------

import { TooltipProvider } from "@/components/ui/tooltip";
import { ComposicaoResultado } from "@/components/marketing/composer/ComposicaoResultado";

describe("o anúncio pronto mostra o conceito e os avisos dele", () => {
  it("linha do conceito e a lista do que conferir antes de publicar", () => {
    const anuncio = {
      formato: "instagram_reels",
      angulo: "Sem raspar a cabeça — O Empresário Discreto",
      status: "ok" as const,
      formato_justificativa: null,
      composicao_md: null,
      composicao: { gancho: "g", roteiro: "r", texto_na_tela: ["a", "b"], legenda: "l", direcao_visual: "d" },
      avisos: [
        { campo: "roteiro", indice: null, tipo: "duracao_acima_do_funil", detalhe: "~48s estimados; o funil de meio pede até 40s" },
        { campo: null, indice: null, tipo: "especialista_sem_rqe", detalhe: "chama de especialista, mas o médico não tem RQE" },
      ],
      error: null,
      conceito: conceito(),
    };
    render(
      <TooltipProvider>
        <ComposicaoResultado
          composicao={{ ...composicao({ status: "revisao" }), anuncios: [anuncio], plano: [anuncio], avisos: anuncio.avisos } as never}
        />
      </TooltipProvider>,
    );
    expect(screen.getByText(/O Empresário Discreto · consciente da solução · Sem raspar a cabeça · Sem raspar/)).toBeInTheDocument();
    const lista = screen.getByRole("list", { name: /conferir antes de publicar/i });
    expect(lista).toHaveTextContent("Duração: ~48s estimados; o funil de meio pede até 40s");
    expect(lista).toHaveTextContent("RQE: chama de especialista, mas o médico não tem RQE");
  });
});
