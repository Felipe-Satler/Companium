/**
 * Regras de identificação do médico na arte (Res. CFM 2.336/2023, como a equipe as adotou).
 *
 * Cada caso aqui é uma linha da lista no topo de `shared/regras-identificacao.js`: mudar uma regra é
 * mudar o arquivo E o teste dela.
 */
import { describe, it, expect } from "vitest";
import {
  citaPosGraduacao,
  escolhasPermitidas,
  exigenciaDeIdentificacao,
  ondeIdentificar,
  precisaNaoEspecialista,
} from "../../shared/regras-identificacao.js";

describe("exigenciaDeIdentificacao", () => {
  it("1. orgânico com bio conferida: opcional", () => {
    expect(exigenciaDeIdentificacao({ uso: "organico", bioConferida: true }).exigencia).toBe("opcional");
  });

  it("2. orgânico sem bio conferida: obrigatória na arte", () => {
    expect(exigenciaDeIdentificacao({ uso: "organico", bioConferida: false }).exigencia).toBe("obrigatoria_na_arte");
  });

  it("3. circula fora do Instagram: obrigatória na arte, mesmo com bio e mesmo pago", () => {
    expect(exigenciaDeIdentificacao({ uso: "organico", bioConferida: true, circulaFora: true }).exigencia).toBe(
      "obrigatoria_na_arte"
    );
    expect(exigenciaDeIdentificacao({ uso: "pago", circulaFora: true }).exigencia).toBe("obrigatoria_na_arte");
  });

  it("4. vídeo: obrigatória na peça", () => {
    expect(exigenciaDeIdentificacao({ uso: "organico", bioConferida: true, midia: "video" }).exigencia).toBe(
      "obrigatoria_na_arte"
    );
  });

  it("5. pago: na arte ou na legenda, com ou sem bio", () => {
    expect(exigenciaDeIdentificacao({ uso: "pago", bioConferida: true }).exigencia).toBe("arte_ou_legenda");
    expect(exigenciaDeIdentificacao({ uso: "pago" }).exigencia).toBe("arte_ou_legenda");
  });

  it("sempre explica o motivo", () => {
    expect(exigenciaDeIdentificacao({ uso: "pago" }).motivo).toMatch(/legenda/);
  });
});

describe("ondeIdentificar", () => {
  it("obrigatória na arte ignora a escolha de tirar da arte", () => {
    expect(ondeIdentificar("obrigatoria_na_arte", "nenhum")).toEqual({ naArte: true, naLegenda: false, erro: null });
    expect(ondeIdentificar("obrigatoria_na_arte", "legenda").naArte).toBe(true);
  });

  it("pago: arte ou legenda; 'nenhum' é erro e cai na legenda", () => {
    expect(ondeIdentificar("arte_ou_legenda", "arte")).toEqual({ naArte: true, naLegenda: false, erro: null });
    expect(ondeIdentificar("arte_ou_legenda", "legenda")).toEqual({ naArte: false, naLegenda: true, erro: null });
    const r = ondeIdentificar("arte_ou_legenda", "nenhum");
    expect(r.erro).toBeTruthy();
    expect(r.naLegenda).toBe(true);
  });

  it("opcional respeita 'nenhum'", () => {
    expect(ondeIdentificar("opcional", "nenhum")).toEqual({ naArte: false, naLegenda: false, erro: null });
  });

  it("as escolhas da tela seguem a exigência", () => {
    expect(escolhasPermitidas("obrigatoria_na_arte")).toEqual(["arte"]);
    expect(escolhasPermitidas("arte_ou_legenda")).toEqual(["arte", "legenda"]);
    expect(escolhasPermitidas("opcional")).toContain("nenhum");
  });
});

describe("6. NÃO ESPECIALISTA", () => {
  it("reconhece a pós pela palavra, com ou sem acento e hífen", () => {
    expect(citaPosGraduacao("Sou pós-graduado em Medicina do Sono")).toBe(true);
    expect(citaPosGraduacao("POS GRADUACAO em nutrologia")).toBe(true);
    expect(citaPosGraduacao("Uma conversa sobre o sono")).toBe(false);
  });

  it("reconhece a pós pelo nome cadastrado no kit", () => {
    expect(citaPosGraduacao("Formação em Medicina do Sono pelo HC", "Medicina do Sono")).toBe(true);
  });

  it("só se aplica a quem não tem RQE, e só onde a pós é citada", () => {
    const textos = { arte: ["Seu ronco tem nome", "Pós-graduado em Medicina do Sono"], legenda: "Agende sua avaliação." };
    expect(precisaNaoEspecialista({ rqe: "", pos_graduacao: "Medicina do Sono" }, textos)).toEqual({
      naArte: true,
      naLegenda: false,
    });
    expect(precisaNaoEspecialista({ rqe: "123", pos_graduacao: "Medicina do Sono" }, textos)).toEqual({
      naArte: false,
      naLegenda: false,
    });
  });
});
