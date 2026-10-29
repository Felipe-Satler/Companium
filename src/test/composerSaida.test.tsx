// Como o resultado SAI da ferramenta: o texto exportado de um anúncio e do conjunto, e o aviso de
// que uma composição ou orquestração terminou enquanto a pessoa estava em outro lugar.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AnuncioComposto, Composicao } from "@/lib/adComposerApi";
import {
  anuncioParaTexto,
  anunciosProntos,
  composicaoParaTexto,
  nomeDoArquivo,
} from "@/lib/exportarComposicao";
import { acompanhar, lerAcompanhados, soltar } from "@/lib/acompanhamento";

const obterOrquestracao = vi.fn();
const toastSuccess = vi.fn();
const toastMessage = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ session: { access_token: "tok" } }) }));
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), message: (...a: unknown[]) => toastMessage(...a) },
}));
vi.mock("@/lib/orquestradorApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/orquestradorApi")>()),
  obterOrquestracao: (...a: unknown[]) => obterOrquestracao(...a),
}));

import { AvisoDeConclusao } from "@/components/marketing/AvisoDeConclusao";

const anuncio = (over: Partial<AnuncioComposto> = {}): AnuncioComposto => ({
  formato: "google_ads",
  angulo: "Quem pesquisa já decidiu tratar.",
  formato_justificativa: null,
  status: "ok",
  composicao_md: null,
  composicao: { headlines: ["Varizes sem cirurgia", "Cirurgião vascular"], descriptions: ["Agende hoje."] },
  avisos: [{ campo: "headlines", indice: 0, tipo: "excede_limite_rigido", detalhe: "34/30 caracteres" }],
  error: null,
  ...over,
});

const composicao = (anuncios: AnuncioComposto[]) =>
  ({
    id: "c1",
    cliente: "jose_ramos",
    nome_exibicao: "Dr. José Ramos - VascuMed",
    analise_titulo: "Varizes — ângulos",
    composicao_md: "A ideia do conjunto é o medo da cirurgia.",
    anuncios,
    status: "ok",
    criado_em: "2026-10-13T12:00:00.000Z",
  }) as Composicao;

describe("exportar a composição", () => {
  it("um anúncio vira texto com o uso, o ângulo e cada campo na ordem da spec", () => {
    const txt = anuncioParaTexto(anuncio());
    expect(txt).toContain("## Google Ads (busca)");
    expect(txt).toContain("_Quem pesquisa já decidiu tratar._");
    expect(txt).toContain("### Títulos\n1. Varizes sem cirurgia\n2. Cirurgião vascular");
    expect(txt.indexOf("### Títulos")).toBeLessThan(txt.indexOf("### Descrições"));
  });

  it("campo que o agente esqueceu sai como travessão, não some do documento", () => {
    const txt = anuncioParaTexto(anuncio({ composicao: { headlines: ["Só este"] } }));
    expect(txt).toContain("### Descrições\n—");
  });

  it("o conjunto leva o cabeçalho, a ideia e só os anúncios prontos, numerados", () => {
    const c = composicao([
      anuncio(),
      anuncio({ formato: "instagram_stories", status: "error", composicao: null }),
      anuncio({ formato: "meta_ads", composicao: { primary_text: "Texto.", headline: "Título" } }),
    ]);
    expect(anunciosProntos(c)).toHaveLength(2);
    const txt = composicaoParaTexto(c);
    expect(txt).toContain("# Anúncios — Dr. José Ramos - VascuMed");
    expect(txt).toContain("2 anúncios · análise: Varizes — ângulos");
    expect(txt).toContain("medo da cirurgia");
    expect(txt).toContain("## 1. Google Ads (busca)");
    expect(txt).toContain("## 2. Meta Ads (anúncio)");
    expect(txt).not.toContain("Instagram Stories");
    // Aviso de limite é para quem cola no gerenciador; num documento é ruído.
    expect(txt).not.toContain("34/30");
  });

  it("o nome do arquivo não leva acento nem espaço", () => {
    expect(nomeDoArquivo(composicao([anuncio()]))).toBe("anuncios-dr-jose-ramos-vascumed-2026-10-13.md");
  });
});

describe("acompanhamento — o que este navegador espera terminar", () => {
  beforeEach(() => localStorage.clear());

  it("guarda sem duplicar e solta pelo id", () => {
    acompanhar({ tipo: "orquestracao", id: "o1", nome: "A" });
    acompanhar({ tipo: "orquestracao", id: "o1", nome: "A" });
    acompanhar({ tipo: "composicao", id: "c1", nome: "B" });
    expect(lerAcompanhados().map((x) => x.id)).toEqual(["o1", "c1"]);
    soltar("o1");
    expect(lerAcompanhados().map((x) => x.id)).toEqual(["c1"]);
  });

  it("armazenamento corrompido vira lista vazia, não erro", () => {
    localStorage.setItem("companium:acompanhando", "{não é json");
    expect(lerAcompanhados()).toEqual([]);
  });
});

describe("AvisoDeConclusao", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    for (const m of [obterOrquestracao, toastSuccess, toastMessage]) m.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  const montar = () => render(<MemoryRouter><AvisoDeConclusao /></MemoryRouter>);
  const passar = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  it("sem nada para acompanhar, não faz requisição nenhuma", async () => {
    montar();
    await passar(30000);
    expect(obterOrquestracao).not.toHaveBeenCalled();
  });

  it("enquanto roda fica quieto; ao terminar avisa UMA vez e para de perguntar", async () => {
    acompanhar({ tipo: "orquestracao", id: "o1", nome: "Dr. José Ramos" });
    obterOrquestracao.mockResolvedValue({ orquestracao: { status: "running", error: null } });
    montar();
    await passar(8000);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(lerAcompanhados()).toHaveLength(1);

    obterOrquestracao.mockResolvedValue({ orquestracao: { status: "ok", error: null } });
    await passar(8000);
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(toastSuccess.mock.calls[0][0]).toBe("Orquestração concluída — Dr. José Ramos");
    expect(lerAcompanhados()).toEqual([]);

    const chamadas = obterOrquestracao.mock.calls.length;
    await passar(30000);
    expect(obterOrquestracao.mock.calls.length).toBe(chamadas);
  });

  it("cancelada é dita como cancelada, não como falha", async () => {
    acompanhar({ tipo: "orquestracao", id: "o1", nome: "X" });
    obterOrquestracao.mockResolvedValue({
      orquestracao: { status: "error", error: "Cancelada por quem disparou." },
    });
    montar();
    await passar(8000);
    expect(toastMessage.mock.calls[0][0]).toBe("Orquestração cancelada — X");
  });

  it("uma falha de rede não faz perder o aviso; só desiste depois de várias seguidas", async () => {
    acompanhar({ tipo: "orquestracao", id: "o1", nome: "X" });
    obterOrquestracao.mockRejectedValue(new Error("rede"));
    montar();
    await passar(8000 * 4);
    expect(lerAcompanhados()).toHaveLength(1);
    await passar(8000);
    expect(lerAcompanhados()).toEqual([]);
  });
});
