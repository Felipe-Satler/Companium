/**
 * A janela de comparação do relatório, agora que ela pode ser escolhida à mão.
 *
 * O campo que este teste protege é `comparavel`. Ele não descreve a janela: ele AUTORIZA uma
 * conclusão. `montarSnapshot` o transforma no aviso `comparacao_incompativel` e o prompt do agente
 * o usa para proibir conclusão a partir de contagem — "os leads caíram pela metade" comparando 15
 * dias contra 30 é exatamente a frase que ele existe para impedir.
 *
 * Enquanto a janela vinha da regra compartilhada, o tamanho era garantido. Com escolha livre, deixa
 * de ser — e é por isso que este arquivo existe.
 */
import { describe, it, expect } from "vitest";
import { montarComparacao } from "@/utils/comparacaoRelatorio";
import { janelaComparavel } from "../../shared/relatorio-metricas";

const AGOSTO = { de: "2026-08-01", ate: "2026-08-31" };

describe("montarComparacao — quando é a janela que a regra sugeriu", () => {
  const sugestao = janelaComparavel({ ...AGOSTO, kind: "month" });

  it("viaja a REGRA inteira, não uma cópia aproximada", () => {
    // Quem não mexe no seletor tem de gerar exatamente o relatório que gerava antes: é a regra que
    // o worker confere, e `regra`/`motivo` saem dela.
    const c = montarComparacao({ periodo: AGOSTO, de: sugestao!.de, ate: sugestao!.ate, sugestao });
    expect(c.regra).toBe("mes_anterior");
    expect(c.motivo).toBe(sugestao!.motivo);
    expect(c.comparavel).toBe(sugestao!.comparavel);
  });

  it("ganha o rótulo legível do período", () => {
    const c = montarComparacao({ periodo: AGOSTO, de: sugestao!.de, ate: sugestao!.ate, sugestao });
    expect(c.label).toBe("Julho 2026");
  });
});

describe("montarComparacao — quando alguém escolheu à mão", () => {
  const sugestao = janelaComparavel({ ...AGOSTO, kind: "month" });

  it("janela do MESMO tamanho continua comparável", () => {
    // Julho tem 31 dias, como agosto: comparar contagem é legítimo.
    const c = montarComparacao({ periodo: AGOSTO, de: "2026-06-01", ate: "2026-07-01", sugestao });
    expect(c.regra).toBe("manual");
    expect(c.dias).toBe(31);
    expect(c.comparavel).toBe(true);
  });

  it("janela MENOR marca comparavel: false — é o que proíbe a conclusão errada", () => {
    const c = montarComparacao({ periodo: AGOSTO, de: "2026-07-01", ate: "2026-07-15", sugestao });
    expect(c.comparavel).toBe(false);
    expect(c.motivo).toMatch(/não são comparáveis/i);
    expect(c.motivo).toContain("15 dia(s) contra 31");
  });

  it("janela MAIOR também não é comparável", () => {
    const c = montarComparacao({ periodo: AGOSTO, de: "2026-06-01", ate: "2026-07-31", sugestao });
    expect(c.comparavel).toBe(false);
  });

  it("diz no motivo que foi escolhida à mão", () => {
    // O motivo aparece na tela e viaja ao prompt: "mês anterior" e "alguém escolheu" pedem
    // leituras diferentes de quem recebe o relatório.
    const c = montarComparacao({ periodo: AGOSTO, de: "2026-05-01", ate: "2026-05-31", sugestao });
    expect(c.motivo).toMatch(/escolhido à mão/i);
  });

  it("sem sugestão (período solto), ainda monta e ainda julga o tamanho", () => {
    const periodo = { de: "2026-08-10", ate: "2026-08-20" }; // 11 dias
    const c = montarComparacao({ periodo, de: "2026-07-10", ate: "2026-07-20", sugestao: null });
    expect(c.regra).toBe("manual");
    expect(c.comparavel).toBe(true);
    expect(c.dias).toBe(11);
  });

  it("janela invertida não vira 'comparável' por acidente", () => {
    // `diasNoPeriodo` devolve null quando o fim vem antes do início; cair em 0 === 0 e dizer
    // "comparável" seria o pior desfecho possível para uma entrada inválida.
    const c = montarComparacao({ periodo: { de: "2026-08-31", ate: "2026-08-01" }, de: "2026-07-31", ate: "2026-07-01", sugestao: null });
    expect(c.comparavel).toBe(false);
  });
});
