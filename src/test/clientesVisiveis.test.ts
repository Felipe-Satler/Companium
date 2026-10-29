import { describe, it, expect, afterEach } from "vitest";
import { isExcludedClient } from "@/data/clienteAliases";
import {
  filtroAtivosLigado,
  incluirInativosLigado,
  setClientesOcultos,
  setIncluirInativos,
  setResolvedorAtivos,
} from "@/data/clientesVisiveisStore";

// O store é estado de MÓDULO (é o que deixa isExcludedClient síncrono), então cada teste
// precisa devolvê-lo ao estado neutro para não contaminar o seguinte.
afterEach(() => {
  setResolvedorAtivos(null);
  setClientesOcultos([]);
  setIncluirInativos(false);
});

const ATIVOS = new Set(["gustavo_nobre", "vasculare"]);
const ligarPlanilha = () =>
  setResolvedorAtivos((canonical) => ATIVOS.has(canonical.toLowerCase().replace(/\s+/g, "_")));

describe("fail-safe: sem a planilha carregada", () => {
  it("o filtro por ATIVO fica desligado", () => {
    expect(filtroAtivosLigado()).toBe(false);
  });

  it("ninguém é escondido por status — a tela fica como era antes", () => {
    // Este é o comportamento que protege o dashboard de uma falha de rede ou da policy de
    // RLS não aplicada: melhor mostrar demais do que esvaziar todos os filtros.
    expect(isExcludedClient("Gustavo_Nobre")).toBe(false);
    expect(isExcludedClient("Cliente_Que_Nao_Existe_Na_Planilha")).toBe(false);
  });

  it("não sobrou exclusão hardcoded: sem fonte carregada, ninguém é escondido", () => {
    // As constantes do clienteAliases foram esvaziadas — "cliente encerrado" agora é a
    // planilha que diz, e o resto virou tabela editável. Se as duas fontes falharem, a tela
    // mostra a carteira inteira (mostrar demais é recuperável; esvaziar o dashboard não).
    expect(isExcludedClient("Integralis")).toBe(false);
    expect(isExcludedClient("Alan_Sampaio", "google")).toBe(false);
  });
});

describe("com a planilha carregada", () => {
  it("cliente ATIVO passa", () => {
    ligarPlanilha();
    expect(filtroAtivosLigado()).toBe(true);
    expect(isExcludedClient("Gustavo_Nobre")).toBe(false);
  });

  it("cliente fora da planilha é escondido", () => {
    ligarPlanilha();
    expect(isExcludedClient("Cliente_Fantasma")).toBe(true);
  });

  it("vale para o nome CRU da conta de Ads, não só p/ o slug", () => {
    ligarPlanilha();
    // canonicalizeAdsClient tira "Dr.", " - CA 1.1.1" e " | Groohub" antes de comparar.
    expect(isExcludedClient("Dr. Gustavo Nobre - CA 1.1.1 | Groohub")).toBe(false);
    expect(isExcludedClient("Dr. Fulano Fantasma - CA 2.0 | Groohub")).toBe(true);
  });
});

describe("lista editável na Administração (clientes_ocultos)", () => {
  it("esconde um cliente mesmo ele estando ATIVO na planilha", () => {
    ligarPlanilha();
    expect(isExcludedClient("VascuLare")).toBe(false);
    setClientesOcultos([{ padrao: "vasculare", canal: null, exato: false }]);
    expect(isExcludedClient("VascuLare")).toBe(true);
  });

  it("regra de um canal só vale naquele canal", () => {
    setClientesOcultos([{ padrao: "gustavo_nobre", canal: "google", exato: false }]);
    expect(isExcludedClient("Gustavo_Nobre", "google")).toBe(true);
    expect(isExcludedClient("Gustavo_Nobre", "meta")).toBe(false);
    expect(isExcludedClient("Gustavo_Nobre", "crm")).toBe(false);
  });

  it("casa palavra INTEIRA, não pedaço no meio do nome", () => {
    setClientesOcultos([{ padrao: "icv", canal: null, exato: false }]);
    expect(isExcludedClient("Clinica_ICV")).toBe(true);
    expect(isExcludedClient("Medicva")).toBe(false); // contém "icv" no meio
  });

  it("modo exato só pega o nome idêntico", () => {
    setClientesOcultos([{ padrao: "luis_felipe", canal: null, exato: true }]);
    expect(isExcludedClient("Luis_Felipe")).toBe(true);
    expect(isExcludedClient("Luis_Felipe_Pacheco")).toBe(false);
  });
});

describe("botão Ativos × Histórico", () => {
  it("começa em Ativos", () => {
    expect(incluirInativosLigado()).toBe(false);
  });

  it("Histórico traz de volta quem a planilha não considera ativo", () => {
    ligarPlanilha();
    expect(isExcludedClient("Cliente_Fantasma")).toBe(true);

    setIncluirInativos(true);
    expect(isExcludedClient("Cliente_Fantasma")).toBe(false);
    expect(filtroAtivosLigado()).toBe(false); // o recorte por status está suspenso

    setIncluirInativos(false);
    expect(isExcludedClient("Cliente_Fantasma")).toBe(true);
  });

  it("Histórico NÃO desfaz a trava manual da Administração", () => {
    // O botão é sobre status do contrato; conta de teste continua escondida nos dois modos —
    // senão o "Histórico" viraria uma porta dos fundos para o que foi escondido de propósito.
    ligarPlanilha();
    setClientesOcultos([{ padrao: "vasculare", canal: null, exato: false }]);
    expect(isExcludedClient("VascuLare")).toBe(true);
    setIncluirInativos(true);
    expect(isExcludedClient("VascuLare")).toBe(true);
  });

  it("no Histórico, cliente ATIVO continua aparecendo", () => {
    ligarPlanilha();
    setIncluirInativos(true);
    expect(isExcludedClient("Gustavo_Nobre")).toBe(false);
  });
});
