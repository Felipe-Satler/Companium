/**
 * A leitura de especialidades do worker.
 *
 * Havia um bug que não dava erro: `v_cliente_especialidades` termina em `is_approved(auth.uid())`, e
 * predicado de view não é RLS — com `service_role` não existe `auth.uid()`, então a view devolve ZERO
 * linhas **em silêncio** e todo resumo nasce afirmando nada sobre especialidade. A correção é uma RPC
 * `SECURITY DEFINER`; o que este teste protege é o comportamento quando ela NÃO está lá, porque cair
 * calado de volta na view reproduz o bug original com a mesma cara de "ninguém cadastrou".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ESPECIALIDADES_RPC, readEspecialidades } from "../../apps/ad-spy-worker/db.js";

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const urlDe = (i: number) => String(fetchMock.mock.calls[i][0]);

describe("readEspecialidades", () => {
  it("usa a RPC, não a view", async () => {
    fetchMock.mockResolvedValue(ok([{ nome_identificador: "jose ramos", especialidades: ["Cirurgia Vascular"] }]));

    const rows = await readEspecialidades();

    expect(rows).toEqual([{ nome_identificador: "jose ramos", especialidades: ["Cirurgia Vascular"] }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(urlDe(0)).toContain(`rpc/${ESPECIALIDADES_RPC}`);
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    // Não encostou na view: é ela que volta vazia para o worker.
    expect(urlDe(0)).not.toContain("v_cliente_especialidades");
  });

  it("RPC ausente cai para a view MAS avisa — silêncio aqui é o bug de volta", async () => {
    // Migração não rodada: o PostgREST responde 404 para a função.
    fetchMock
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(ok([]));

    const rows = await readEspecialidades();

    expect(rows).toEqual([]);
    expect(urlDe(1)).toContain("v_cliente_especialidades");
    const aviso = (console.warn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(aviso).toContain(ESPECIALIDADES_RPC);
    expect(aviso).toMatch(/sem especialidade/i);
    // O aviso diz o que fazer, não só que falhou.
    expect(aviso).toMatch(/20260928_especialidades_worker/);
  });

  it("leitura vazia continua sendo vazia, não erro — o resumo sai sem especialidade", async () => {
    // `especialidadesIndisponiveis` (briefs.js) é quem transforma isso em "não afirme que não tem".
    fetchMock.mockResolvedValue(ok([]));
    await expect(readEspecialidades()).resolves.toEqual([]);
  });

  it("view também fora do ar não derruba a coleta", async () => {
    fetchMock.mockRejectedValue(new Error("rede fora"));
    await expect(readEspecialidades()).resolves.toEqual([]);
  });
});
