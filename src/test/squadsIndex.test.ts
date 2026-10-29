import { describe, it, expect } from "vitest";
import {
  FAIXAS_MATURIDADE,
  ProjetoRow,
  buildProjetosIndex,
  chavesCandidatas,
  clienteVisivel,
  faixaMaturidade,
  mesesDeCasa,
  resolveProjeto,
  CRM_MATURIDADE_FAIXAS,
  clienteNaFaixaMaturidadeCrm,
  crmMaturidadeJanela,
} from "@/data/squads";

function row(over: Partial<ProjetoRow> = {}): ProjetoRow {
  return {
    cliente: "Dr. José Ramos - VascuMed",
    data_inicio: "2024-09-12",
    status: "ATIVO",
    plano: "Pro",
    lider_revops: "Glória Figueira",
    crm: "Sim",
    ...over,
  };
}

describe("chaves candidatas do nome da planilha", () => {
  it("quebra 'Médico - Clínica' em nome inteiro, médico e clínica", () => {
    // O slug do dashboard é "Jose_Ramos", então o nome inteiro sozinho não casaria.
    expect(chavesCandidatas("Dr. José Ramos - VascuMed")).toEqual([
      "jose_ramos_-_vascumed",
      "jose_ramos",
      "vascumed",
    ]);
  });

  it("nome simples gera uma chave só", () => {
    expect(chavesCandidatas("VascuLare")).toEqual(["vasculare"]);
  });
});

describe("buildProjetosIndex", () => {
  it("acha o cliente pelo slug canônico do dashboard", () => {
    const idx = buildProjetosIndex([row()]);
    const p = resolveProjeto(idx, "Jose_Ramos");
    expect(p?.squad).toBe("Glória Figueira");
    expect(p?.plano).toBe("Pro");
    expect(p?.desde?.getFullYear()).toBe(2024);
  });

  it("acha também pelo nome da clínica", () => {
    const idx = buildProjetosIndex([row()]);
    expect(resolveProjeto(idx, "VascuMed")?.squad).toBe("Glória Figueira");
  });

  it("ignora acento, caixa e underscore no match", () => {
    const idx = buildProjetosIndex([row()]);
    expect(resolveProjeto(idx, "jose ramos")?.squad).toBe("Glória Figueira");
  });

  it("cliente ausente da planilha devolve null (fica sem squad)", () => {
    const idx = buildProjetosIndex([row()]);
    expect(resolveProjeto(idx, "Gustavo_Nobre")).toBeNull();
  });

  it("lista os squads em ordem alfabética, sem repetir e sem vazios", () => {
    const idx = buildProjetosIndex([
      row({ cliente: "A", lider_revops: "Renata Quintana" }),
      row({ cliente: "B", lider_revops: "Glória Figueira" }),
      row({ cliente: "C", lider_revops: "Renata Quintana" }),
      row({ cliente: "D", lider_revops: null }),
      row({ cliente: "E", lider_revops: "  " }),
    ]);
    expect(idx.squads).toEqual(["Glória Figueira", "Renata Quintana"]);
  });

  it("o squad de carteira sem status continua no filtro", () => {
    const idx = buildProjetosIndex([row({ cliente: "A", lider_revops: "Sem Status", status: null })]);
    expect(idx.squads).toEqual(["Sem Status"]);
  });

  it("não oferece no filtro o squad cuja carteira é toda inativa", () => {
    const idx = buildProjetosIndex([
      row({ cliente: "A", lider_revops: "Com Ativo", status: "ATIVO" }),
      row({ cliente: "B", lider_revops: "Só Inativo", status: "INATIVO" }),
    ]);
    expect(idx.squads).toEqual(["Com Ativo"]);
  });

  it("não inventa squad quando uma chave fraca serve a dois clientes", () => {
    // Dois "Dr. João Silva" em clínicas diferentes: a chave do médico vira ambígua e é
    // descartada — melhor ficar sem squad do que atribuir o squad do cliente errado.
    const idx = buildProjetosIndex([
      row({ cliente: "Dr. João Silva - Clínica Um", lider_revops: "Líder Um" }),
      row({ cliente: "Dr. João Silva - Clínica Dois", lider_revops: "Líder Dois" }),
    ]);
    expect(resolveProjeto(idx, "Joao_Silva")).toBeNull();
    expect(resolveProjeto(idx, "Clinica_Um")?.squad).toBe("Líder Um");
    expect(resolveProjeto(idx, "Clinica_Dois")?.squad).toBe("Líder Dois");
  });
});

describe("cliente com mais de um projeto", () => {
  const nome = "Dr. Rodolfo Ferraz - Vitalis & IBSV";

  it("tempo de casa é a entrada MAIS ANTIGA", () => {
    const idx = buildProjetosIndex([
      row({ cliente: nome, data_inicio: "2024-09-20", status: "INATIVO" }),
      row({ cliente: nome, data_inicio: "2022-03-01", status: "INATIVO" }),
    ]);
    expect(resolveProjeto(idx, "Rodolfo_Ferraz")?.desde?.getFullYear()).toBe(2022);
  });

  it("squad e plano saem do projeto ATIVO, não do antigo", () => {
    const idx = buildProjetosIndex([
      row({ cliente: nome, data_inicio: "2022-03-01", status: "INATIVO", lider_revops: "Antigo", plano: "Start" }),
      row({ cliente: nome, data_inicio: "2024-09-20", status: "ATIVO", lider_revops: "Atual", plano: "Pro" }),
    ]);
    const p = resolveProjeto(idx, "Rodolfo_Ferraz");
    expect(p?.squad).toBe("Atual");
    expect(p?.plano).toBe("Pro");
    expect(p?.ativo).toBe(true);
  });

  it("sem projeto ativo, vale o mais recente", () => {
    const idx = buildProjetosIndex([
      row({ cliente: nome, data_inicio: "2022-03-01", status: "INATIVO", lider_revops: "Antigo" }),
      row({ cliente: nome, data_inicio: "2024-09-20", status: "INATIVO", lider_revops: "Recente" }),
    ]);
    const p = resolveProjeto(idx, "Rodolfo_Ferraz");
    expect(p?.squad).toBe("Recente");
    expect(p?.ativo).toBe(false);
  });

  it("campo vazio no projeto de referência cai para outro projeto do mesmo cliente", () => {
    const idx = buildProjetosIndex([
      row({ cliente: nome, data_inicio: "2022-03-01", status: "INATIVO", plano: "Start", lider_revops: "Antigo" }),
      row({ cliente: nome, data_inicio: "2024-09-20", status: "ATIVO", plano: null, lider_revops: null }),
    ]);
    const p = resolveProjeto(idx, "Rodolfo_Ferraz");
    expect(p?.plano).toBe("Start");
    expect(p?.squad).toBe("Antigo");
  });

  it("'INATIVO' não é lido como ativo (contém 'ativo')", () => {
    const idx = buildProjetosIndex([row({ status: "INATIVO" })]);
    expect(resolveProjeto(idx, "Jose_Ramos")?.ativo).toBe(false);
  });
});

describe("linhas problemáticas", () => {
  it("ignora linha sem cliente", () => {
    const idx = buildProjetosIndex([row({ cliente: null }), row({ cliente: "  " })]);
    expect(idx.squads).toEqual([]);
    expect(idx.byKey.size).toBe(0);
  });

  it("data inválida não vira Invalid Date", () => {
    const idx = buildProjetosIndex([row({ data_inicio: "não é data" })]);
    expect(resolveProjeto(idx, "Jose_Ramos")?.desde).toBeNull();
  });

  it("a data não escorrega de dia por fuso", () => {
    const idx = buildProjetosIndex([row({ data_inicio: "2024-09-12" })]);
    const d = resolveProjeto(idx, "Jose_Ramos")!.desde!;
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2024, 9, 12]);
  });
});

describe("quem aparece na tela", () => {
  it("cliente INATIVO na planilha é escondido", () => {
    const idx = buildProjetosIndex([row({ status: "INATIVO" })]);
    expect(clienteVisivel(resolveProjeto(idx, "Jose_Ramos"))).toBe(false);
  });

  it("cliente ATIVO aparece", () => {
    const idx = buildProjetosIndex([row({ status: "ATIVO" })]);
    expect(clienteVisivel(resolveProjeto(idx, "Jose_Ramos"))).toBe(true);
  });

  it("cliente que não está na planilha continua aparecendo", () => {
    // Status desconhecido != inativo: a carteira aqui tem de bater com CRM/Meta/Google.
    const idx = buildProjetosIndex([row()]);
    expect(resolveProjeto(idx, "Gustavo_Nobre")).toBeNull();
    expect(clienteVisivel(resolveProjeto(idx, "Gustavo_Nobre"))).toBe(true);
  });

  it("basta UM projeto ativo p/ o cliente aparecer", () => {
    const nome = "Dr. Rodolfo Ferraz - Vitalis & IBSV";
    const idx = buildProjetosIndex([
      row({ cliente: nome, status: "INATIVO", data_inicio: "2022-01-01" }),
      row({ cliente: nome, status: "ATIVO", data_inicio: "2024-01-01" }),
    ]);
    expect(clienteVisivel(resolveProjeto(idx, "Rodolfo_Ferraz"))).toBe(true);
  });

  it("status em BRANCO na planilha não esconde o cliente", () => {
    // Desconhecido != inativo. Só sai quem a planilha classificou como inativo.
    const idx = buildProjetosIndex([row({ status: null })]);
    expect(clienteVisivel(resolveProjeto(idx, "Jose_Ramos"))).toBe(true);
    const branco = buildProjetosIndex([row({ status: "   " })]);
    expect(clienteVisivel(resolveProjeto(branco, "Jose_Ramos"))).toBe(true);
  });
});

describe("usa CRM?", () => {
  it("lê o Sim/Não da planilha", () => {
    expect(resolveProjeto(buildProjetosIndex([row({ crm: "Sim" })]), "Jose_Ramos")?.temCRM).toBe(true);
    expect(resolveProjeto(buildProjetosIndex([row({ crm: "Não" })]), "Jose_Ramos")?.temCRM).toBe(false);
  });

  it("campo vazio fica indefinido (não é 'sem CRM')", () => {
    expect(resolveProjeto(buildProjetosIndex([row({ crm: null })]), "Jose_Ramos")?.temCRM).toBeNull();
    expect(resolveProjeto(buildProjetosIndex([row({ crm: "  " })]), "Jose_Ramos")?.temCRM).toBeNull();
  });

  it("basta um projeto do cliente com CRM", () => {
    const nome = "Dr. Rodolfo Ferraz - Vitalis & IBSV";
    const idx = buildProjetosIndex([row({ cliente: nome, crm: "Não" }), row({ cliente: nome, crm: "Sim" })]);
    expect(resolveProjeto(idx, "Rodolfo_Ferraz")?.temCRM).toBe(true);
  });
});

describe("maturidade", () => {
  const hoje = new Date("2026-09-01T12:00:00");

  it("conta meses COMPLETOS, não viradas de mês do calendário", () => {
    // 20/08 → 01/09 ainda não fechou um mês.
    expect(mesesDeCasa(new Date("2026-08-20T00:00:00"), hoje)).toBe(0);
    expect(mesesDeCasa(new Date("2026-08-01T00:00:00"), hoje)).toBe(1);
  });

  it("põe cada tempo de casa na sua faixa", () => {
    const faixa = (iso: string) => faixaMaturidade(new Date(`${iso}T00:00:00`), hoje);
    expect(faixa("2026-08-15")).toBe("0-3"); // 0 meses
    expect(faixa("2026-06-01")).toBe("0-3"); // 3 meses
    expect(faixa("2026-05-01")).toBe("4-6"); // 4 meses
    expect(faixa("2026-03-01")).toBe("4-6"); // 6 meses
    expect(faixa("2026-02-01")).toBe("7-12"); // 7 meses
    expect(faixa("2025-09-01")).toBe("7-12"); // 12 meses
    expect(faixa("2025-08-01")).toBe("13+"); // 13 meses
    expect(faixa("2020-01-01")).toBe("13+");
  });

  it("sem data de início não tem faixa", () => {
    expect(faixaMaturidade(null, hoje)).toBeNull();
  });

  it("as faixas cobrem tudo, sem buraco nem sobreposição", () => {
    for (let m = 0; m <= 40; m++) {
      const cobertas = FAIXAS_MATURIDADE.filter((f) => m >= f.min && (f.max == null || m <= f.max));
      expect(cobertas.length).toBe(1);
    }
  });

  it("os rótulos estão em português", () => {
    expect(FAIXAS_MATURIDADE.map((f) => f.label)).toEqual([
      "0 a 3 meses",
      "4 a 6 meses",
      "7 a 12 meses",
      "13 meses ou mais",
    ]);
  });
});

describe("clientes ativos oferecidos na Administração", () => {
  it("lista só os ATIVOS, em ordem alfabética", () => {
    const idx = buildProjetosIndex([
      row({ cliente: "Dr. Zeta Silva - ClinZ", status: "ATIVO" }),
      row({ cliente: "Dr. Alfa Souza - ClinA", status: "ATIVO" }),
      row({ cliente: "Dr. Beta Lima - ClinB", status: "INATIVO" }),
    ]);
    expect(idx.ativos.map((c) => c.nome)).toEqual(["Dr. Alfa Souza - ClinA", "Dr. Zeta Silva - ClinZ"]);
  });

  it("o token gravado é o que casa com o slug do dashboard, não o nome inteiro", () => {
    // "Dr. José Ramos - VascuMed" no dashboard é "Jose_Ramos"; gravar o nome inteiro não
    // esconderia ninguém.
    const idx = buildProjetosIndex([row()]);
    expect(idx.ativos[0].padrao).toBe("jose_ramos");
  });

  it("cliente sem status não é oferecido como ativo", () => {
    const idx = buildProjetosIndex([row({ status: null })]);
    expect(idx.ativos).toEqual([]);
  });
});

describe("nome curto × nome longo (casos reais do __carteira)", () => {
  it("planilha com nome CURTO casa com o slug longo do dashboard", () => {
    // "Dr. Alcides" na planilha, "Alcides_Furtado" no dashboard.
    const idx = buildProjetosIndex([row({ cliente: "Dr. Alcides", lider_revops: "Líder A" })]);
    expect(resolveProjeto(idx, "Alcides_Furtado")?.squad).toBe("Líder A");
  });

  it("planilha com nome LONGO casa com o slug curto do dashboard", () => {
    // "Dr. Luís Felipe Pacheco" na planilha, "Luis_Pacheco" no dashboard.
    const idx = buildProjetosIndex([row({ cliente: "Dr. Luís Felipe Pacheco", lider_revops: "Líder B" })]);
    expect(resolveProjeto(idx, "Luis_Pacheco")?.squad).toBe("Líder B");
  });

  it("sobrenome extra na planilha não atrapalha", () => {
    // "Dr. Fábio Morais Filho" na planilha, "Fábio_Morais" no dashboard.
    const idx = buildProjetosIndex([row({ cliente: "Dr. Fábio Morais Filho", lider_revops: "Líder C" })]);
    expect(resolveProjeto(idx, "Fábio_Morais")?.squad).toBe("Líder C");
  });

  it("NÃO resolve quando o nome curto serve a vários clientes", () => {
    // Três "Dr. José" na carteira: "Jose" sozinho não pode escolher um deles.
    const idx = buildProjetosIndex([
      row({ cliente: "Dr. José Cordeiro", lider_revops: "L1" }),
      row({ cliente: "Dr. José Gaspar", lider_revops: "L2" }),
      row({ cliente: "Dr. José Paiva", lider_revops: "L3" }),
    ]);
    expect(resolveProjeto(idx, "Jose")).toBeNull();
    // mas o nome completo continua resolvendo certo
    expect(resolveProjeto(idx, "Jose_Gaspar")?.squad).toBe("L2");
  });

  it("clientes diferentes que dividem um sobrenome não se confundem", () => {
    const idx = buildProjetosIndex([
      row({ cliente: "Dr. Aurelio Oliveira", lider_revops: "L1" }),
      row({ cliente: "Dra. Helena Oliveira", lider_revops: "L2" }),
    ]);
    expect(resolveProjeto(idx, "Aurelio_Oliveira")?.squad).toBe("L1");
    expect(resolveProjeto(idx, "Helena_Oliveira")?.squad).toBe("L2");
    expect(resolveProjeto(idx, "Oliveira")).toBeNull(); // sozinho é ambíguo
  });
});

describe("maturidade do filtro CRM (faixas por tempo de dados, limite inferior)", () => {
  it("tem as 6 faixas pedidas, com rótulos", () => {
    expect(CRM_MATURIDADE_FAIXAS.map((f) => f.id)).toEqual(["prim3", "prim6", "prim12", "4a6", "7a12", "13+"]);
  });

  it("'primeiros 3 meses' (prim3) = cliente com ≥3 meses de dados", () => {
    expect(clienteNaFaixaMaturidadeCrm(2, "prim3")).toBe(false);
    expect(clienteNaFaixaMaturidadeCrm(3, "prim3")).toBe(true);
    expect(clienteNaFaixaMaturidadeCrm(4, "prim3")).toBe(true);
    expect(clienteNaFaixaMaturidadeCrm(48, "prim3")).toBe(true);
  });

  it("'primeiros 6 meses' (prim6) = cliente com ≥6 meses de dados", () => {
    expect(clienteNaFaixaMaturidadeCrm(5, "prim6")).toBe(false);
    expect(clienteNaFaixaMaturidadeCrm(6, "prim6")).toBe(true);
    expect(clienteNaFaixaMaturidadeCrm(7, "prim6")).toBe(true);
  });

  it("'primeiros 12 meses' (prim12) = cliente com ≥12 meses de dados (⊂ primeiros 6)", () => {
    expect(clienteNaFaixaMaturidadeCrm(11, "prim12")).toBe(false);
    expect(clienteNaFaixaMaturidadeCrm(12, "prim12")).toBe(true);
    expect(clienteNaFaixaMaturidadeCrm(13, "prim12")).toBe(true);
  });

  it("'entre 4 e 6 meses' (4a6) cobre 4..6", () => {
    expect(clienteNaFaixaMaturidadeCrm(3, "4a6")).toBe(false);
    expect(clienteNaFaixaMaturidadeCrm(4, "4a6")).toBe(true);
    expect(clienteNaFaixaMaturidadeCrm(6, "4a6")).toBe(true);
    expect(clienteNaFaixaMaturidadeCrm(7, "4a6")).toBe(false);
  });

  it("'entre 7 e 12 meses' (7a12) exclui os primeiros 6", () => {
    expect(clienteNaFaixaMaturidadeCrm(6, "7a12")).toBe(false);
    expect(clienteNaFaixaMaturidadeCrm(7, "7a12")).toBe(true);
    expect(clienteNaFaixaMaturidadeCrm(12, "7a12")).toBe(true);
    expect(clienteNaFaixaMaturidadeCrm(13, "7a12")).toBe(false);
  });

  it("'acima de 13 meses' (13+) é 13 em diante", () => {
    expect(clienteNaFaixaMaturidadeCrm(12, "13+")).toBe(false);
    expect(clienteNaFaixaMaturidadeCrm(13, "13+")).toBe(true);
    expect(clienteNaFaixaMaturidadeCrm(48, "13+")).toBe(true);
  });

  it("sem data de início (meses null) nunca casa nenhuma faixa", () => {
    expect(clienteNaFaixaMaturidadeCrm(null, "prim6")).toBe(false);
    expect(clienteNaFaixaMaturidadeCrm(null, "13+")).toBe(false);
  });
});

describe("janela de maturidade POR cliente (crmMaturidadeJanela)", () => {
  const desde = new Date("2026-01-15T00:00:00");
  const hoje = new Date("2026-10-16T00:00:00");
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  it("'primeiros 3 meses' = do início até o fim do 3º mês (inclusivo)", () => {
    const j = crmMaturidadeJanela("prim3", desde, hoje)!;
    expect(iso(j.from)).toBe("2026-01-15");
    expect(iso(j.to)).toBe("2026-04-14"); // 15/abr é exclusivo → último dia 14/abr
  });

  it("'primeiros 6 / 12 meses' sempre começam no início do cliente", () => {
    expect(iso(crmMaturidadeJanela("prim6", desde, hoje)!.from)).toBe("2026-01-15");
    expect(iso(crmMaturidadeJanela("prim6", desde, hoje)!.to)).toBe("2026-07-14");
    expect(iso(crmMaturidadeJanela("prim12", desde, hoje)!.from)).toBe("2026-01-15");
    expect(iso(crmMaturidadeJanela("prim12", desde, hoje)!.to)).toBe("2027-01-14");
  });

  it("'entre 4 e 6 meses' = a fatia start+3 .. start+6 (meses 4,5,6)", () => {
    const j = crmMaturidadeJanela("4a6", desde, hoje)!;
    expect(iso(j.from)).toBe("2026-04-15");
    expect(iso(j.to)).toBe("2026-07-14");
  });

  it("'entre 7 e 12 meses' = start+6 .. start+12", () => {
    const j = crmMaturidadeJanela("7a12", desde, hoje)!;
    expect(iso(j.from)).toBe("2026-07-15");
    expect(iso(j.to)).toBe("2027-01-14");
  });

  it("'acima de 13 meses' vai do 13º mês (start+12) até hoje, sem teto", () => {
    const antigo = new Date("2024-01-15T00:00:00");
    const j = crmMaturidadeJanela("13+", antigo, hoje)!;
    expect(iso(j.from)).toBe("2025-01-15");
    expect(iso(j.to)).toBe(iso(hoje));
  });

  it("janela vazia (cliente mais novo que o começo da faixa) → null", () => {
    // 13+ para quem só tem ~9 meses de casa: start+12 cai no futuro → sem janela.
    expect(crmMaturidadeJanela("13+", desde, hoje)).toBeNull();
    // 'entre 7 e 12' para quem tem ~9 meses: a janela começa em start+6 (ok) e termina
    // em start+12 (futuro) — mas o `to` é a data fixa start+12, não limitada a hoje, então
    // ainda devolve a fatia (o recorte dos dados até hoje acontece no pipeline).
    expect(crmMaturidadeJanela("7a12", desde, hoje)).not.toBeNull();
  });

  it("sem início conhecido → null", () => {
    expect(crmMaturidadeJanela("prim3", null, hoje)).toBeNull();
  });
});
