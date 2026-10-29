/**
 * O vocabulário de voto e tag.
 *
 * O que vale prender aqui não é a lista em si — é a **separação de papéis** que o desenho depende:
 * o voto diz se a peça presta, a tag diz o que fazer com ela. Se uma tag virar adjetivo de
 * qualidade, o sistema passa a ter dois votos, e o segundo é pior porque tem uma opinião só.
 */
import { describe, it, expect } from "vitest";
import {
  ALVOS,
  TAGS_AVALIACAO,
  TAG_IDS,
  alvoValido,
  getTag,
  normalizarVoto,
  tagValida,
} from "../../shared/avaliacao-tags.js";

describe("vocabulário de tags", () => {
  it("toda tag tem rótulo, ícone, cor e descrição", () => {
    // Cor sozinha não é sinal acessível: o ícone é o que sobrevive em escala de cinza e para quem
    // não distingue as cores. Tag sem ícone viraria um chip colorido sem significado.
    for (const t of TAGS_AVALIACAO) {
      expect(t.id, `${t.id}.id`).toMatch(/^[a-z_]+$/);
      expect(t.label.length, `${t.id}.label`).toBeGreaterThan(2);
      expect(t.icone.length, `${t.id}.icone`).toBeGreaterThan(2);
      expect(t.cor.length, `${t.id}.cor`).toBeGreaterThan(2);
      expect(t.descricao.endsWith("."), `${t.id}.descricao`).toBe(true);
    }
  });

  it("não há id nem cor repetidos", () => {
    // Duas tags com a mesma cor seriam indistinguíveis de relance, que é justamente o que o chip
    // colorido promete resolver.
    expect(new Set(TAG_IDS).size).toBe(TAG_IDS.length);
    const cores = TAGS_AVALIACAO.map((t) => t.cor);
    expect(new Set(cores).size).toBe(cores.length);
  });

  it("são seis, e isso é decisão", () => {
    // Vocabulário que ninguém decora é usado de forma inconsistente — e tag inconsistente é pior
    // que tag nenhuma, porque parece dado. Se este número crescer, foi escolha de alguém.
    expect(TAGS_AVALIACAO).toHaveLength(6);
  });

  it("nenhuma tag é adjetivo de qualidade — isso é papel do voto", () => {
    // A guarda da separação de papéis. "Bom", "ruim", "ótimo" aqui significariam um segundo voto.
    const proibidas = /\b(bom|boa|ruim|ótim|otim|péssim|pessim|excelent|fraco|forte)\w*/i;
    for (const t of TAGS_AVALIACAO) {
      expect(proibidas.test(t.label), `${t.id}.label`).toBe(false);
    }
  });

  it("tag desconhecida é ausência, nunca uma tag nova", () => {
    expect(tagValida("no_ar")).toBe(true);
    expect(tagValida("inventada")).toBe(false);
    expect(tagValida(null)).toBe(false);
    expect(getTag("inventada")).toBeNull();
  });

  it("as duas tags que espelham as regras do composeragent existem", () => {
    // `generico` e `risco_cfm` são as regras 2 e 3 do agente. Marcar quando ele as viola transforma
    // a tag em dado sobre o AGENTE, não só sobre a peça — e é o que torna o sistema útil para
    // calibrar o prompt depois.
    expect(TAG_IDS).toContain("generico");
    expect(TAG_IDS).toContain("risco_cfm");
  });
});

describe("normalizarVoto", () => {
  it("aceita 1 e -1, em número ou string", () => {
    expect(normalizarVoto(1)).toBe(1);
    expect(normalizarVoto("1")).toBe(1);
    expect(normalizarVoto(-1)).toBe(-1);
    expect(normalizarVoto("-1")).toBe(-1);
  });

  it("qualquer outra coisa é AUSÊNCIA de voto, não um valor", () => {
    // Inclusive 0: "votei neutro" e "não votei" seriam indistinguíveis na contagem, e a contagem é
    // a única coisa que a tela mostra. Lixo no payload faz o voto sumir, nunca gravar sem sentido.
    for (const v of [0, 2, -2, null, undefined, "", "sim", {}, NaN]) {
      expect(normalizarVoto(v), String(v)).toBeNull();
    }
  });
});

describe("alvoValido", () => {
  it("só os artefatos que o sistema cobre: análise, composição e (desde 17/10) criativo", () => {
    expect(ALVOS).toEqual(["analise", "composicao", "criativo"]);
    expect(alvoValido("analise")).toBe(true);
    expect(alvoValido("composicao")).toBe(true);
    expect(alvoValido("criativo")).toBe(true);
    expect(alvoValido("relatorio")).toBe(false);
    expect(alvoValido(null)).toBe(false);
  });
});
