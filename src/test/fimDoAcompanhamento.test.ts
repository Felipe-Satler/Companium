// O aviso de conclusão no canto da tela: o que ele diz de uma composição ou orquestração que estava
// sendo acompanhada. O caso que motivou o arquivo: na etapa de Conceitos Estratégicos (20/10/2026)
// ele dizia "Composição falhou" segundos depois de compor, com a composição sugerindo normalmente.
import { describe, it, expect } from "vitest";
import { fimDaComposicao, fimDaOrquestracao } from "@/lib/fimDoAcompanhamento";
import type { Composicao, SlotConceito } from "@/lib/adComposerApi";
import type { Orquestracao } from "@/lib/orquestradorApi";

const slot = (status: SlotConceito["status"]) => ({ n: 0, formato_saida: "instagram_reels", status, conceito: null, reciclado: false, rejeitados: [], error: null });
const comp = (over: Partial<Composicao>) => ({ id: "k1", status: "conceitos", conceitos: [], insumos_insuficientes: null, ...over }) as Composicao;

describe("fimDaComposicao", () => {
  it("enquanto o agente sugere os conceitos, NÃO avisa — e muito menos que falhou", () => {
    expect(fimDaComposicao(comp({}), "Dr. Otavio")).toBeNull();
    expect(fimDaComposicao(comp({ conceitos: [slot("sugerido"), slot("gerando")] }), "Dr. Otavio")).toBeNull();
  });

  it("conceitos sugeridos: chama para aprovar, como coisa boa", () => {
    expect(fimDaComposicao(comp({ conceitos: [slot("sugerido"), slot("aprovado")] }), "Dr. Otavio")).toEqual({
      titulo: "Conceitos prontos para aprovação — Dr. Otavio",
      ok: true,
      destino: "/marketing/composer/salvas?composicao=k1",
    });
    // Insumo insuficiente que deixa seguir também é a vez de quem compõe decidir.
    const insuf = { motivo: "x", sugestao: "", bloqueante: false, seguir: false };
    expect(fimDaComposicao(comp({ conceitos: [slot("pendente")], insumos_insuficientes: insuf }), "Dr. Otavio")?.ok).toBe(true);
  });

  it("insumo que bloqueia: diz por quê, sem chamar de falha da composição", () => {
    const bloq = { motivo: "Não foi possível ler o Estudo de Copy escolhido.", sugestao: "", bloqueante: true, seguir: false };
    expect(fimDaComposicao(comp({ insumos_insuficientes: bloq }), "Dr. Otavio")).toMatchObject({
      titulo: "Composição parada nos insumos — Dr. Otavio: Não foi possível ler o Estudo de Copy escolhido.",
      ok: false,
    });
  });

  it("o resto continua como era: escrevendo não avisa; pronta chama para revisar; erro é falha", () => {
    expect(fimDaComposicao(comp({ status: "running" }), "X")).toBeNull();
    expect(fimDaComposicao(comp({ status: "revisao" }), "X")?.titulo).toBe("Anúncios prontos para revisão — X");
    expect(fimDaComposicao(comp({ status: "error" }), "X")).toMatchObject({ titulo: "Composição falhou — X", ok: false });
  });
});

describe("fimDaOrquestracao", () => {
  const orq = (over: Partial<Orquestracao>) => ({ id: "o1", status: "running", error: null, ...over }) as Orquestracao;

  it("parada nos conceitos chama para aprovar, em vez de dizer que falhou", () => {
    expect(fimDaOrquestracao(orq({ status: "conceitos" }), "Dr. Otavio")).toEqual({
      titulo: "Conceitos prontos para aprovação — Dr. Otavio",
      ok: true,
      destino: "/marketing/orquestrador?orquestracao=o1",
    });
    expect(fimDaOrquestracao(orq({ status: "running" }), "X")).toBeNull();
    expect(fimDaOrquestracao(orq({ status: "error", error: "x" }), "X")?.titulo).toBe("Orquestração falhou — X");
  });
});
