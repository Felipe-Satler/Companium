// O arquivo central de credenciais: só as três chaves do Supabase passam, ele ganha da cópia local,
// e a ausência dele não muda nada.
import { describe, it, expect, vi } from "vitest";
import { aplicarCredenciaisCentrais, lerArquivoCentral } from "../../shared/credenciais-supabase.js";

describe("credenciais do Supabase do arquivo central", () => {
  const texto = [
    "# credenciais",
    'SUPABASE_URL="https://central.supabase.co"',
    "export SUPABASE_SERVICE_KEY=nova",
    "SUPABASE_ANON_KEY='anon'",
    "PORT=9999",
    "PATH=/tmp",
    "",
  ].join("\n");

  it("lê só as três chaves do Supabase, tirando aspas e o export", () => {
    expect(lerArquivoCentral(texto)).toEqual({
      SUPABASE_URL: "https://central.supabase.co",
      SUPABASE_SERVICE_KEY: "nova",
      SUPABASE_ANON_KEY: "anon",
    });
  });

  it("o arquivo central ganha da cópia local, e PORT/PATH de lá não passam", () => {
    const env: Record<string, string> = { SUPABASE_SERVICE_KEY: "velha", PORT: "18901", PATH: "/usr/bin" };
    const log = vi.fn();
    const aplicadas = aplicarCredenciaisCentrais({ env, ler: () => texto, log });
    expect(aplicadas.sort()).toEqual(["SUPABASE_ANON_KEY", "SUPABASE_SERVICE_KEY", "SUPABASE_URL"]);
    expect(env).toMatchObject({ SUPABASE_SERVICE_KEY: "nova", PORT: "18901", PATH: "/usr/bin" });
    // O log diz QUAIS chaves, nunca o valor.
    expect(log.mock.calls[0][0]).not.toContain("nova");
  });

  it("sem o arquivo (dev, testes), nada muda", () => {
    const env: Record<string, string> = { SUPABASE_SERVICE_KEY: "local" };
    const aplicadas = aplicarCredenciaisCentrais({
      env,
      ler: () => {
        throw new Error("ENOENT");
      },
      log: vi.fn(),
    });
    expect(aplicadas).toEqual([]);
    expect(env.SUPABASE_SERVICE_KEY).toBe("local");
  });

  it("chave vazia no arquivo central não apaga a cópia local", () => {
    const env: Record<string, string> = { SUPABASE_SERVICE_KEY: "local" };
    aplicarCredenciaisCentrais({ env, ler: () => "SUPABASE_SERVICE_KEY=\n", log: vi.fn() });
    expect(env.SUPABASE_SERVICE_KEY).toBe("local");
  });
});
