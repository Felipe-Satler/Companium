/**
 * Semana travada, agregação por cliente e lista de ativos — o miolo do resumo.
 *
 * Dois erros caros e silenciosos moram aqui: (1) uma conta de anúncio que não casa zera o
 * investimento do cliente, e o agente escreve que ele parou de investir; (2) uma janela que
 * escorrega faz o mesmo texto descrever semanas diferentes conforme o dia em que roda.
 */
import { describe, it, expect } from "vitest";
import {
  agregar,
  clientesAtivos,
  mesesDeCasa,
  precisaAtualizar,
  semanasFechadas,
} from "../../apps/ad-spy-worker/briefs.js";

describe("semanasFechadas", () => {
  // Semana de 07/09 (segunda) a 13/09 (domingo) de 2026; a anterior, 31/08 a 06/09.
  const ESPERADO = {
    de: "2026-09-07",
    ate: "2026-09-13",
    deAnterior: "2026-08-31",
    ateAnterior: "2026-09-06",
  };

  it("devolve a MESMA janela em qualquer dia da semana corrente", () => {
    // É a propriedade que sustenta a ideia toda: pedir o resumo na terça ou no sábado tem de
    // descrever exatamente as mesmas semanas, senão o texto muda de assunto sozinho.
    const dias = [
      "2026-09-14T09:00:00Z", // segunda
      "2026-09-16T13:00:00Z", // quarta
      "2026-09-19T23:30:00Z", // sábado
      "2026-09-20T02:00:00Z", // domingo de madrugada
    ];
    for (const d of dias) {
      expect(semanasFechadas(new Date(d))).toEqual(ESPERADO);
    }
  });

  it("nunca inclui a semana em curso", () => {
    const j = semanasFechadas(new Date("2026-09-16T13:00:00Z"));
    // A semana corrente começa em 14/09: nada da janela pode alcançá-la.
    expect(j.ate < "2026-09-14").toBe(true);
  });

  it("as duas janelas são semanas inteiras e encostadas", () => {
    const j = semanasFechadas(new Date("2026-09-16T13:00:00Z"));
    const dias = (a: string, b: string) =>
      (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000;
    expect(dias(j.de, j.ate)).toBe(6);
    expect(dias(j.deAnterior, j.ateAnterior)).toBe(6);
    expect(dias(j.ateAnterior, j.de)).toBe(1);
  });

  it("começa na segunda", () => {
    const j = semanasFechadas(new Date("2026-09-16T13:00:00Z"));
    expect(new Date(`${j.de}T00:00:00Z`).getUTCDay()).toBe(1); // segunda
    expect(new Date(`${j.ate}T00:00:00Z`).getUTCDay()).toBe(0); // domingo
  });

  it("usa o fuso de São Paulo, não o do servidor", () => {
    // 22h de domingo em Brasília já é segunda em UTC. Sem o fuso explícito, a janela pularia uma
    // semana inteira — e ninguém perceberia, porque o texto continuaria plausível.
    const domingoNoite = new Date("2026-09-14T01:00:00Z"); // 13/09 22:00 em São Paulo
    expect(semanasFechadas(domingoNoite)).toEqual({
      de: "2026-08-31",
      ate: "2026-09-06",
      deAnterior: "2026-08-24",
      ateAnterior: "2026-08-30",
    });
  });
});

describe("agregar", () => {
  const crmRows = [
    { client: "Fábio_Morais", event_type: "lead", qtd: 10, valor: 0 },
    { client: "fabio_morais", event_type: "lead", qtd: 5, valor: 0 },
    { client: "Fábio_Morais", event_type: "consulta_agendada", qtd: 4, valor: 400 },
    { client: "Fábio_Morais", event_type: "consulta_realizada", qtd: 3, valor: 300 },
    { client: "Fábio_Morais", event_type: "proc_realizado", qtd: 1, valor: 5000 },
    { client: "Fábio_Morais", event_type: "proc_agendado", qtd: 2, valor: 9000 },
  ];

  it("soma eventos do CRM juntando variações de acento e caixa", () => {
    const m = agregar({ crmRows, adsRows: [] }).get("fabio_morais");
    expect(m.leadsCRM).toBe(15);
    expect(m.consultasAgendadas).toBe(4);
  });

  it("faturamento usa realizadas + realizados por padrão", () => {
    const m = agregar({ crmRows, adsRows: [] }).get("fabio_morais");
    expect(m.faturamentoBruto).toBe(300 + 5000);
  });

  it("respeita a base escolhida por cliente", () => {
    const basisPor = new Map([
      ["fabio_morais", { consulta: "agendadas", procedimento: "agendados" }],
    ]);
    const m = agregar({ crmRows, adsRows: [], basisPor }).get("fabio_morais");
    expect(m.faturamentoBruto).toBe(400 + 9000);
  });

  it("casa a conta de anúncio pelo alias — o caso que zeraria o investimento", () => {
    // "CA 1.1.1 - Dr. Fábio Vascular" só vira Fábio_Morais via ADS_CLIENT_ALIASES.
    const adsRows = [
      { Client: "CA 1.1.1 - Dr. Fábio Vascular", Valor_usado_BRL: 1000, Lead: 7, Mensagens_iniciadas: 3 },
    ];
    const m = agregar({ crmRows, adsRows }).get("fabio_morais");
    expect(m.investimento).toBe(1000);
    expect(m.leadsTrafego).toBe(10);
  });

  it("ROAS é null sem investimento, nunca Infinity", () => {
    const m = agregar({ crmRows, adsRows: [] }).get("fabio_morais");
    expect(m.roas).toBeNull();
  });

  it("ROAS divide faturamento por investimento", () => {
    const adsRows = [
      { Client: "CA 1.1.1 - Dr. Fábio Vascular", Valor_usado_BRL: 1060, Lead: 0, Mensagens_iniciadas: 0 },
    ];
    const m = agregar({ crmRows, adsRows }).get("fabio_morais");
    expect(m.roas).toBeCloseTo(5300 / 1060, 6);
  });

  it("valor nulo ou texto não vira NaN", () => {
    const m = agregar({
      crmRows: [{ client: "X", event_type: "lead", qtd: null, valor: "abc" }],
      adsRows: [{ Client: "X", Valor_usado_BRL: null, Lead: undefined, Mensagens_iniciadas: "2" }],
    }).get("x");
    expect(m.leadsCRM).toBe(0);
    expect(m.investimento).toBe(0);
    expect(m.leadsTrafego).toBe(2);
  });
});


describe("clientesAtivos", () => {
  const linhas = [
    { cliente: "Dr. José Ramos - VascuMed", status: "ATIVO", plano: "", lider_revops: "Marina", data_inicio: "2025-06-01", crm: "Sim" },
    { cliente: "Dr. José Ramos - VascuMed", status: "ATIVO", plano: "Escala", lider_revops: "", data_inicio: "2025-03-01", crm: "" },
    { cliente: "Clínica Encerrada", status: "INATIVO", plano: "Base", lider_revops: "Ana", data_inicio: "2024-01-01", crm: "Não" },
  ];

  it("INATIVO não entra — 'inativo' contém 'ativo' e a âncora existe por isso", () => {
    const nomes = clientesAtivos(linhas).map((c) => c.nome);
    expect(nomes).toContain("Dr. José Ramos - VascuMed");
    expect(nomes).not.toContain("Clínica Encerrada");
  });

  it("a chave é a mesma que o frontend usa em index.ativos (parte do médico)", () => {
    const [c] = clientesAtivos(linhas);
    expect(c.padrao).toBe("jose_ramos");
    // A clínica continua entre as candidatas, para somar métrica gravada sob ela.
    expect(c.chaves).toContain("vascumed");
  });

  it("campo vazio numa linha cai para outra linha do mesmo cliente", () => {
    const [c] = clientesAtivos(linhas);
    expect(c.plano).toBe("Escala");
    expect(c.squad).toBe("Marina");
  });

  it("tempo de casa conta do projeto MAIS ANTIGO", () => {
    const [c] = clientesAtivos(linhas);
    expect(c.desde).toBe("2025-03-01");
  });

  it("CRM: basta uma linha dizer Sim", () => {
    expect(clientesAtivos(linhas)[0].temCRM).toBe(true);
  });
});

describe("mesesDeCasa", () => {
  it("conta meses completos", () => {
    expect(mesesDeCasa("2025-03-01", new Date("2026-09-18T12:00:00Z"))).toBe(18);
    // Ainda não fechou o mês.
    expect(mesesDeCasa("2026-08-20", new Date("2026-09-18T12:00:00Z"))).toBe(0);
  });

  it("sem data, null — não zero", () => {
    expect(mesesDeCasa(null)).toBeNull();
  });
});

describe("precisaAtualizar", () => {
  const SEMANA = "2026-09-13";
  const pronto = { status: "ok", semana_ate: SEMANA };

  it("pula quem já tem resumo DESTA semana fechada", () => {
    // O ponto todo da janela fixa: reescrever daria a mesma conclusão e só gastaria tokens.
    expect(precisaAtualizar(pronto, SEMANA)).toBe(false);
  });

  it("escreve quando a janela virou", () => {
    expect(precisaAtualizar({ ...pronto, semana_ate: "2026-09-06" }, SEMANA)).toBe(true);
  });

  it("escreve para quem nunca teve resumo", () => {
    expect(precisaAtualizar(undefined, SEMANA)).toBe(true);
    expect(precisaAtualizar(null, SEMANA)).toBe(true);
  });

  it("tenta de novo quem terminou em erro — é justamente quem precisa", () => {
    expect(precisaAtualizar({ status: "error", semana_ate: SEMANA }, SEMANA)).toBe(true);
  });

  it("não considera em dia um resumo que ficou preso em 'running'", () => {
    // Worker reiniciado no meio da escrita deixa a linha em running para sempre; o job seguinte
    // tem de retomar, senão aquele cliente nunca mais recebe resumo.
    expect(precisaAtualizar({ status: "running", semana_ate: SEMANA }, SEMANA)).toBe(true);
  });

  it("resumo sem semana gravada (versão antiga) é reescrito", () => {
    expect(precisaAtualizar({ status: "ok", semana_ate: null }, SEMANA)).toBe(true);
  });
});
