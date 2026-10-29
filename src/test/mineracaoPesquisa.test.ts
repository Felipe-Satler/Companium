/**
 * Leitura da resposta do agente de pesquisa.
 *
 * O agente só PROPÕE: quem mede é a sonda, e cada termo testado custa 1 crédito. Então o parse
 * nunca pode completar o que o agente não disse — um termo inventado aqui vira crédito gasto e,
 * pior, direciona a busca inteira.
 */
import { describe, it, expect } from "vitest";
import { buildPesquisaPrompt, parsePesquisaReply } from "../../apps/ad-spy-worker/pesquisa.js";

const resposta = (json: unknown, prosa = "Mercado anuncia por técnica, não por preço.") =>
  `${prosa}\n\n\`\`\`json\n${JSON.stringify(json)}\n\`\`\``;

describe("parsePesquisaReply", () => {
  it("lê termos, concorrentes e vocabulário, e guarda a prosa", () => {
    const out = parsePesquisaReply(
      resposta({
        termos: [
          { termo: "sem raspagem", porque: "é como o mercado chama", confianca: "visto", onde: "anúncio da Clínica X" },
          { termo: "fue", porque: "nome da técnica", confianca: "inferido" },
        ],
        concorrentes: [{ nome: "Clínica X", onde: "instagram.com/clinicax" }],
        vocabulario: ["linha frontal", "densidade"],
        fontes: { web: true },
      }),
    );
    expect(out.termos).toHaveLength(2);
    expect(out.termos[0]).toMatchObject({ termo: "sem raspagem", confianca: "visto" });
    expect(out.concorrentes[0].nome).toBe("Clínica X");
    expect(out.vocabulario).toEqual(["linha frontal", "densidade"]);
    expect(out.fontes.web).toBe(true);
    expect(out.resumoMd).toContain("Mercado anuncia por técnica");
    expect(out.semBlocoJson).toBe(false);
  });

  it("sem bloco JSON, devolve zero termo e NÃO finge que pesquisou", () => {
    const out = parsePesquisaReply("Não consegui pesquisar agora.");
    expect(out.termos).toEqual([]);
    expect(out.semBlocoJson).toBe(true);
    expect(out.fontes.web).toBe(false);
    expect(out.resumoMd).toContain("Não consegui");
  });

  it("`fontes.web` só é true quando o agente afirma — nada de inferir", () => {
    for (const fontes of [undefined, {}, { web: "sim" }, { web: 1 }]) {
      expect(parsePesquisaReply(resposta({ termos: [], fontes })).fontes.web).toBe(false);
    }
  });

  it("confiança desconhecida vira palpite, o grau mais cauteloso", () => {
    const out = parsePesquisaReply(
      resposta({ termos: [{ termo: "fue", confianca: "altíssima" }], fontes: { web: true } }),
    );
    expect(out.termos[0].confianca).toBe("palpite");
  });

  it("descarta frase de busca: termo longo não casa com texto de anúncio", () => {
    const out = parsePesquisaReply(
      resposta({
        termos: [
          { termo: "melhor clínica de transplante capilar em são paulo zona sul" },
          { termo: "fue" },
        ],
        fontes: { web: true },
      }),
    );
    expect(out.termos.map((t) => t.termo)).toEqual(["fue"]);
  });

  it("tira repetido e corta em 5 — cada termo testado é 1 crédito", () => {
    const out = parsePesquisaReply(
      resposta({
        termos: [
          { termo: "fue" },
          { termo: "FUE" },
          ...["a1", "a2", "a3", "a4", "a5"].map((termo) => ({ termo })),
        ],
        fontes: { web: true },
      }),
    );
    expect(out.termos).toHaveLength(5);
    expect(out.termos.map((t) => t.termo)).toEqual(["fue", "a1", "a2", "a3", "a4"]);
  });
});

describe("buildPesquisaPrompt", () => {
  it("manda só o que varia: o contexto fixo vive na definição do agente", () => {
    const p = buildPesquisaPrompt({ nicho: "transplante capilar", contexto: "" });
    expect(p).toContain("transplante capilar");
    expect(p).not.toContain("Contexto do cliente");
    expect(p.length).toBeLessThan(300);
  });

  it("inclui o contexto do cliente quando existe", () => {
    const p = buildPesquisaPrompt({ nicho: "x", contexto: "Clínica premium, público 45+" });
    expect(p).toContain("Contexto do cliente");
    expect(p).toContain("público 45+");
  });
});
