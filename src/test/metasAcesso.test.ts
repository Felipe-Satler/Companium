import { describe, it, expect } from "vitest";

/**
 * Regra de acesso à tela de Metas, isolada do AuthContext para poder ser exercitada sem
 * Supabase. Espelha EXATAMENTE a linha do fetchStatus:
 *   setCanViewMetas(admin || !isClientUser || roles.includes("metas_viewer"))
 * Se as duas divergirem, este teste perde o sentido — mudou uma, mude a outra.
 */
function canViewMetas(opts: { admin?: boolean; isClientUser?: boolean; roles?: string[] }): boolean {
  const { admin = false, isClientUser = false, roles = [] } = opts;
  return admin || !isClientUser || roles.includes("metas_viewer");
}

describe("acesso à tela de Metas", () => {
  it("usuário externo (cliente) NÃO entra por padrão", () => {
    expect(canViewMetas({ isClientUser: true })).toBe(false);
  });

  it("usuário externo entra quando ganha o papel metas_viewer", () => {
    expect(canViewMetas({ isClientUser: true, roles: ["metas_viewer"] })).toBe(true);
  });

  it("outro papel não serve de atalho para o externo", () => {
    expect(canViewMetas({ isClientUser: true, roles: ["cronograma_viewer", "crm_editor"] })).toBe(false);
  });

  it("equipe Groohub entra por padrão, sem papel nenhum", () => {
    expect(canViewMetas({})).toBe(true);
  });

  it("admin entra sempre, mesmo vinculado a um cliente", () => {
    expect(canViewMetas({ admin: true, isClientUser: true })).toBe(true);
  });
});
