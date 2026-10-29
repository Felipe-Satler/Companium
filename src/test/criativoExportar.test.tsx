// A análise de criativo para fora da tela: copiar (Markdown, texto e os recortes), as etapas
// enquanto roda, e o "Aprovar" do Composer respondendo no clique.
import { describe, it, expect, vi } from "vitest";
import { render, screen, renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ session: { access_token: "tok" } }) }));
const aprovarConceito = vi.fn();
vi.mock("@/lib/adComposerApi", async () => ({
  ...(await vi.importActual<typeof import("@/lib/adComposerApi")>("@/lib/adComposerApi")),
  aprovarConceito: (...a: unknown[]) => aprovarConceito(...a),
}));

import {
  criativoParaMarkdown,
  criativoParaTexto,
  estruturaComoTexto,
  fraseAFraseComoTexto,
  recortesDoCriativo,
} from "@/components/marketing/mineracao/criativoExportar";
import { PassosDoCriativo } from "@/components/marketing/mineracao/PassosDoCriativo";
import { useConceitosComposicao } from "@/hooks/useAdComposer";
import type { SpyCriativo, SpyDissecacaoCriativo } from "@/lib/adSpyApi";

const V2: SpyDissecacaoCriativo = {
  versao: 2,
  formato: "Vídeo vertical.",
  estrutura: "Chama o público → Destrói a solução atual",
  anatomia_semantica: "Coloquial; omite preço.",
  anatomia_psicologica: "Ataca a vergonha.",
  nivel_consciencia: "consciente_problema",
  frases: [
    { origem: "fala", texto: "Você tem vergonha de sorrir?", original: "", funcoes: ["qualifica o público"], explicacao: "Faz quem tem o problema se reconhecer.", movimento: 1 },
    { origem: "texto", texto: "Agende sua avaliação.", original: "", funcoes: ["faz CTA"], explicacao: "Diz o próximo passo.", movimento: null },
  ],
  movimentos: [{ n: 1, nome: "Qualifica o público", como_funciona: "Nomeia uma situação que só quem tem o problema reconhece.", bloco: 1 }],
  blocos: [{ n: 1, nome: "Chama o público" }],
  ligacoes: true,
};
const criativo = (dissecacao: SpyDissecacaoCriativo | null, over: Partial<SpyCriativo> = {}) =>
  ({
    titulo: "Lente — vergonha de sorrir",
    ad: { page_name: "Clínica Sorriso" },
    especialidades: ["Odontologia"],
    criado_em: "2026-10-20T12:00:00Z",
    status: "done",
    dissecacao,
    dissecacao_md: "## Formato\nTexto do agente.",
    ...over,
  }) as SpyCriativo;

describe("copiar a análise de criativo", () => {
  it("Markdown: nome, origem, estruturas, frase a frase e a análise técnica", () => {
    const md = criativoParaMarkdown(criativo(V2));
    expect(md.split("\n")[0]).toBe("# Lente — vergonha de sorrir");
    expect(md).toContain("Clínica Sorriso · Odontologia · analisado em 20/10/2026");
    expect(md).toContain("## Estrutura simplificada\n1. Chama o público");
    expect(md).toContain('> "Você tem vergonha de sorrir?"');
    expect(md).toContain("→ **qualifica o público**: Faz quem tem o problema se reconhecer.");
    expect(md).toContain("### Texto do anúncio");
    expect(md).toContain("## Nível de consciência\nConsciente do problema");
  });

  it("texto: o mesmo documento, sem marca de markdown (para WhatsApp)", () => {
    const t = criativoParaTexto(criativo(V2));
    expect(t).toContain("ESTRUTURA SIMPLIFICADA");
    expect(t).toContain("→ qualifica o público: Faz quem tem o problema se reconhecer.");
    expect(t).not.toMatch(/\*\*|^#/m);
  });

  it("análise antiga (sem o v2) e sem o bloco estruturado continuam copiáveis", () => {
    const v1 = { ...V2, versao: undefined, frases: undefined, movimentos: undefined, blocos: undefined };
    expect(criativoParaMarkdown(criativo(v1))).toContain("## Estrutura\nChama o público → Destrói a solução atual");
    expect(criativoParaMarkdown(criativo(null))).toContain("## Formato\nTexto do agente.");
    expect(recortesDoCriativo(criativo(v1))).toEqual({ estrutura: false, fraseAFrase: false, agentes: false });
    expect(recortesDoCriativo(criativo(V2))).toEqual({ estrutura: true, fraseAFrase: true, agentes: true });
  });

  it("os recortes", () => {
    expect(estruturaComoTexto(V2)).toBe("ESTRUTURA SIMPLIFICADA\n1. Chama o público\n\nESTRUTURA INVISÍVEL\nQualifica o público");
    expect(fraseAFraseComoTexto(V2)).toContain('"Agende sua avaliação."\n→ faz CTA: Diz o próximo passo.');
  });
});

describe("as etapas enquanto a análise roda", () => {
  it("diz em que etapa está, de quantas, o que acontece nela e há quanto tempo", () => {
    const desde = new Date(Date.now() - 95_000).toISOString();
    render(<PassosDoCriativo etapa="transcrevendo o vídeo" desde={desde} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Etapa 2 de 3");
    expect(status).toHaveTextContent(/nesta etapa há 1 min 3\d s/);
    expect(status).toHaveTextContent("Transcrevendo a fala");
    expect(status).toHaveTextContent("o vídeo é baixado e a fala vira texto");
    expect(status).toHaveTextContent("Buscando o anúncio na fonte");
  });

  it("criativo do cliente busca o vídeo no Facebook; sem etapa gravada, a primeira é a atual", () => {
    render(<PassosDoCriativo etapa={null} interno />);
    expect(screen.getByRole("status")).toHaveTextContent("Etapa 1 de 3");
    expect(screen.getByRole("status")).toHaveTextContent("Buscando o vídeo no Facebook");
  });
});

describe("Aprovar um conceito responde no clique", () => {
  const COMP = {
    id: "k1",
    status: "conceitos",
    conceitos: [{ n: 0, formato_saida: "instagram_reels", status: "sugerido", conceito: {}, reciclado: false, rejeitados: [], error: null }],
  };
  const montar = () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    qc.setQueryData(["marketing-composition", "k1"], { composition: COMP });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useConceitosComposicao("k1"), { wrapper });
    const slot = () => (qc.getQueryData(["marketing-composition", "k1"]) as { composition: typeof COMP }).composition.conceitos[0].status;
    return { result, slot };
  };

  it("o card fica aprovado antes de o worker responder", async () => {
    let responder: (v: unknown) => void = () => {};
    aprovarConceito.mockImplementationOnce(() => new Promise((r) => (responder = r)));
    const { result, slot } = montar();
    act(() => result.current.aprovar.mutate(0));
    await waitFor(() => expect(slot()).toBe("aprovado"));
    act(() => responder({ ok: true }));
  });

  it("se o worker recusar, volta como estava", async () => {
    aprovarConceito.mockRejectedValueOnce(new Error("Esta composição não está mais na etapa de conceitos."));
    const { result, slot } = montar();
    act(() => result.current.aprovar.mutate(0));
    await waitFor(() => expect(result.current.aprovar.isError).toBe(true));
    expect(slot()).toBe("sugerido");
  });
});
