// A revisão da composição na tela: os botões em cada anúncio, o editor com contador ao vivo, o
// pedido ao agente, o desfazer, e o "Salvar composição" que fecha tudo.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AnuncioComposto, Composicao } from "@/lib/adComposerApi";
import { estaTrabalhando } from "@/lib/adComposerApi";
import { ComposicaoResultado, type AcoesRevisao } from "@/components/marketing/composer/ComposicaoResultado";

const editar = vi.fn();
const revisar = vi.fn();
const desfazer = vi.fn();
const salvar = vi.fn();

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useAdComposer", () => ({
  useRevisaoComposicao: () => ({
    editar: { mutateAsync: (...a: unknown[]) => editar(...a) },
    revisar: { mutateAsync: (...a: unknown[]) => revisar(...a) },
    desfazer: { mutateAsync: (...a: unknown[]) => desfazer(...a) },
    salvar: { mutateAsync: (...a: unknown[]) => salvar(...a), isSuccess: false },
  }),
}));

import { RevisaoComposicao } from "@/components/marketing/composer/RevisaoComposicao";

const anuncio = (over: Partial<AnuncioComposto> = {}): AnuncioComposto => ({
  formato: "google_ads",
  angulo: "Quem pesquisa já decidiu tratar.",
  formato_justificativa: null,
  status: "ok",
  composicao_md: null,
  composicao: { headlines: ["Varizes sem cirurgia", "Avaliação", "Agende"], descriptions: ["Consulta.", "Hoje."] },
  avisos: [],
  error: null,
  ...over,
});

const composicao = (over: Partial<Composicao> = {}): Composicao =>
  ({
    id: "c1",
    cliente: "jose_ramos",
    nome_exibicao: "Dr. José Ramos",
    status: "revisao",
    error: null,
    composicao_md: null,
    composicao: null,
    anuncios: [anuncio()],
    plano: [{ formato: "google_ads", angulo: null, status: "ok" }],
    versoes: [],
    fontes: { analise: true, brief: true },
    avisos: [],
    canDelete: true,
    criado_em: new Date().toISOString(),
    ...over,
  }) as Composicao;

const acoes = (over: Partial<AcoesRevisao> = {}): AcoesRevisao => ({
  editar: (...a) => editar(...a),
  revisar: (...a) => revisar(...a),
  desfazer: (...a) => desfazer(...a),
  podeDesfazer: () => false,
  ...over,
});

beforeEach(() => {
  for (const m of [editar, revisar, desfazer, salvar]) m.mockReset().mockResolvedValue({ ok: true });
});

describe("revisão de um anúncio", () => {
  it("em revisão, quem pode revisar vê Editar e Pedir revisão; desfazer só com versão anterior", () => {
    const { rerender } = render(<ComposicaoResultado composicao={composicao()} acoes={acoes()} />);
    expect(screen.getByRole("button", { name: /^editar$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pedir revisão ao agente/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /desfazer/i })).not.toBeInTheDocument();

    rerender(<ComposicaoResultado composicao={composicao()} acoes={acoes({ podeDesfazer: () => true })} />);
    fireEvent.click(screen.getByRole("button", { name: /desfazer/i }));
    expect(desfazer).toHaveBeenCalledWith(0);
  });

  it("sem as ações (quem só olha) ou já salva, não há botão de revisão", () => {
    const { rerender } = render(<ComposicaoResultado composicao={composicao()} />);
    expect(screen.queryByRole("button", { name: /^editar$/i })).not.toBeInTheDocument();
    rerender(<ComposicaoResultado composicao={composicao({ status: "ok" })} acoes={acoes()} />);
    expect(screen.queryByRole("button", { name: /^editar$/i })).not.toBeInTheDocument();
  });

  it("o editor conta caracteres enquanto se digita e salva os campos do formato", async () => {
    render(<ComposicaoResultado composicao={composicao()} acoes={acoes()} />);
    fireEvent.click(screen.getByRole("button", { name: /^editar$/i }));

    const titulo1 = screen.getByLabelText("Títulos 1");
    fireEvent.change(titulo1, { target: { value: "Tratamento de varizes sem cirurgia" } });
    // 34 > 30, e o Google RECUSA acima disso: o contador acusa na hora, antes de salvar.
    const contador = screen.getByText("34/30");
    expect(contador.className).toContain("text-destructive");

    fireEvent.click(screen.getByRole("button", { name: /acrescentar em títulos/i }));
    fireEvent.click(screen.getByRole("button", { name: /salvar edição/i }));
    await waitFor(() => expect(editar).toHaveBeenCalledTimes(1));
    const [indice, campos] = editar.mock.calls[0];
    expect(indice).toBe(0);
    expect(campos.headlines[0]).toBe("Tratamento de varizes sem cirurgia");
    expect(campos.headlines).toHaveLength(4);
  });

  it("pedir revisão manda o texto ao agente para AQUELE anúncio", async () => {
    render(<ComposicaoResultado composicao={composicao()} acoes={acoes()} />);
    fireEvent.click(screen.getByRole("button", { name: /pedir revisão ao agente/i }));
    fireEvent.change(screen.getByLabelText(/pedido de revisão/i), { target: { value: "gancho mais direto" } });
    fireEvent.click(screen.getByRole("button", { name: /enviar ao agente/i }));
    await waitFor(() => expect(revisar).toHaveBeenCalledWith(0, "gancho mais direto"));
  });

  it("enquanto o agente revisa, o anúncio continua à vista e a tela diz o que foi pedido", () => {
    render(
      <ComposicaoResultado
        composicao={composicao({
          anuncios: [anuncio({ status: "running", ultima_revisao: "gancho mais direto" })],
        })}
        acoes={acoes()}
      />,
    );
    expect(screen.getByText(/o agente está revisando este anúncio/i)).toBeInTheDocument();
    expect(screen.getByText(/gancho mais direto/)).toBeInTheDocument();
    expect(screen.getByText("Varizes sem cirurgia")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^editar$/i })).not.toBeInTheDocument();
  });

  it("revisão que falhou aparece como aviso, sem esconder o anúncio", () => {
    render(
      <ComposicaoResultado
        composicao={composicao({
          anuncios: [anuncio({ error: "A revisão falhou (tempo esgotado) — o anúncio ficou como estava." })],
        })}
        acoes={acoes()}
      />,
    );
    expect(screen.getByText(/a revisão falhou/i)).toBeInTheDocument();
    expect(screen.getByText("Varizes sem cirurgia")).toBeInTheDocument();
  });
});

describe("RevisaoComposicao", () => {
  it("mostra que não está salva e salva com um clique", async () => {
    render(<RevisaoComposicao composicao={composicao()} />);
    expect(screen.getByText(/em revisão — ainda não foi salva/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /salvar composição/i }));
    await waitFor(() => expect(salvar).toHaveBeenCalledTimes(1));
  });

  it("não deixa salvar com o agente revisando um anúncio", () => {
    render(
      <RevisaoComposicao
        composicao={composicao({
          anuncios: [anuncio({ status: "running" })],
          plano: [{ formato: "google_ads", angulo: null, status: "running" }],
        })}
      />,
    );
    expect(screen.getByRole("button", { name: /salvar composição/i })).toBeDisabled();
  });

  it("quem não pediu vê o selo, sem salvar nem editar", () => {
    render(<RevisaoComposicao composicao={composicao({ canDelete: false })} />);
    const aviso = screen.getByText(/em revisão — ainda não foi salva/i).parentElement!;
    expect(within(aviso).getByText(/quem pediu esta composição ainda está revisando/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /salvar composição/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^editar$/i })).not.toBeInTheDocument();
  });

  it("composição salva não mostra a faixa de revisão", () => {
    render(<RevisaoComposicao composicao={composicao({ status: "ok" })} />);
    expect(screen.queryByText(/em revisão/i)).not.toBeInTheDocument();
  });
});

describe("estaTrabalhando — o que decide o polling", () => {
  it("rodando, ou em revisão com um anúncio sendo revisado", () => {
    expect(estaTrabalhando({ status: "running" })).toBe(true);
    expect(estaTrabalhando({ status: "revisao", plano: [{ formato: null, angulo: null, status: "ok" }] })).toBe(false);
    expect(estaTrabalhando({ status: "revisao", plano: [{ formato: null, angulo: null, status: "running" }] })).toBe(true);
    expect(estaTrabalhando({ status: "ok", plano: [{ formato: null, angulo: null, status: "running" }] })).toBe(false);
  });
});
