/**
 * Brand kit: o gerador de paleta e a limpeza do kit que vem da tela.
 *
 * Os dois módulos são de `shared/` e puros — o mesmo código roda na tela, no worker e aqui.
 */
import { describe, it, expect } from "vitest";
import {
  avisosDaPaleta,
  contraste,
  gerarPaleta,
  hexParaOklch,
  normalizarHex,
  oklchParaHex,
  textoSobre,
} from "../../shared/paleta.js";
import {
  kitVazio,
  linhaDeIdentificacao,
  normalizarBrandKit,
  normalizarInstagram,
  temIdentificacao,
} from "../../shared/brand-kit.js";
import { kitCompleto, tipoDaImagem } from "../../apps/ad-spy-worker/brand-kit-rotas.js";

/** Um sorteio determinístico (LCG), para a paleta gerada ser a mesma em toda execução. */
function sorteio(semente = 42) {
  let s = semente;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe("paleta", () => {
  it("normaliza hex curto, sem # e minúsculo; recusa o resto", () => {
    expect(normalizarHex("abc")).toBe("#AABBCC");
    expect(normalizarHex("#1a2B3c")).toBe("#1A2B3C");
    expect(normalizarHex("azul")).toBeNull();
    expect(normalizarHex("#12345")).toBeNull();
    expect(normalizarHex(null)).toBeNull();
  });

  it("ida e volta pelo OKLCH devolve a mesma cor", () => {
    for (const hex of ["#1A2B3C", "#FF6600", "#FFFFFF", "#000000", "#3A7D44"]) {
      expect(oklchParaHex(hexParaOklch(hex)!)).toBe(hex);
    }
  });

  it("contraste WCAG: branco x preto é 21, igual x igual é 1", () => {
    expect(contraste("#FFFFFF", "#000000")).toBeCloseTo(21, 5);
    expect(contraste("#777777", "#777777")).toBeCloseTo(1, 5);
    expect(contraste("azul", "#000000")).toBeNull();
  });

  it("texto sobre fundo escuro é claro, e vice-versa", () => {
    expect(textoSobre("#102030")).toBe("#FFFFFF");
    expect(textoSobre("#F5F2EA")).not.toBe("#FFFFFF");
  });

  it("a paleta gerada passa no contraste mínimo", () => {
    const r = sorteio(7);
    for (let i = 0; i < 30; i += 1) {
      const p = gerarPaleta({ aleatorio: r });
      expect(avisosDaPaleta(p)).toEqual([]);
      expect(normalizarHex(p.primaria)).toBe(p.primaria);
    }
  });

  it("mantém as cores travadas exatamente como vieram", () => {
    const p = gerarPaleta({ travadas: { primaria: "#0b3d91", terciaria: "#fafafa" }, aleatorio: sorteio(1) });
    expect(p.primaria).toBe("#0B3D91");
    expect(p.terciaria).toBe("#FAFAFA");
    expect(p.secundaria).not.toBe(p.primaria);
  });

  it("gera em volta do matiz da primária travada", () => {
    const base = hexParaOklch("#0B3D91")!;
    const p = gerarPaleta({ travadas: { primaria: "#0B3D91" }, aleatorio: sorteio(3) });
    // A terciária é o fundo claro com um toque do matiz da primária.
    const terciaria = hexParaOklch(p.terciaria)!;
    const diferenca = Math.abs(((terciaria.h - base.h + 540) % 360) - 180);
    expect(diferenca).toBeLessThan(25);
  });

  it("avisa quando a paleta do cliente tem contraste ruim, sem recusar", () => {
    const avisos = avisosDaPaleta({ primaria: "#F0E68C", secundaria: "#FFFF00", terciaria: "#FFFFF0" });
    expect(avisos.map((a) => a.par)).toContain("primaria_na_terciaria");
  });
});

describe("normalizarBrandKit", () => {
  it("limpa campos, valida cores, fontes e UF, e tira não-número do CRM", () => {
    const { kit, erros } = normalizarBrandKit({
      cliente: "dr_fulano",
      nome_clinica: "  Clínica   Sono  ",
      paleta: { primaria: "0b3d91", secundaria: "", terciaria: null },
      fontes: { titulo: "Playfair Display", texto: "Inter" },
      contatos: { instagram: "https://www.instagram.com/Clinica.Sono/", site: "https://clinicasono.com.br/", email: "Oi@Clinica.com" },
      enderecos: [{ rotulo: "Centro", linha: "Rua A, 10" }, { rotulo: "vazio", linha: "  " }],
      identificacao: { nome: "Dr. Fulano", crm: "CRM/RS 12.345", uf: "rs", rqe: "" },
      bio_conferida: true,
      imagens: { logo: "outro-cliente/logo.png" },
    });
    expect(erros).toEqual([]);
    expect(kit.nome_clinica).toBe("Clínica Sono");
    expect(kit.paleta).toEqual({ primaria: "#0B3D91", secundaria: null, terciaria: null });
    expect(kit.fontes.titulo).toBe("Playfair Display");
    expect(kit.contatos.instagram).toBe("clinica.sono");
    expect(kit.contatos.site).toBe("clinicasono.com.br");
    expect(kit.contatos.email).toBe("oi@clinica.com");
    expect(kit.enderecos).toEqual([{ rotulo: "Centro", linha: "Rua A, 10" }]);
    expect(kit.identificacao).toMatchObject({ crm: "12345", uf: "RS" });
    expect(kit.bio_conferida).toBe(true);
    // Caminho de imagem vindo do navegador é ignorado: só o upload grava imagem.
    expect(kit.imagens.logo).toBeNull();
  });

  it("devolve o que recusou, campo a campo", () => {
    const { erros } = normalizarBrandKit({
      paleta: { primaria: "azul" },
      fontes: { titulo: "Comic Sans MS" },
      contatos: { email: "sem-arroba", instagram: "@@@" },
      identificacao: { crm: "abc", uf: "XX" },
    });
    expect(erros.map((e) => e.campo).sort()).toEqual(
      ["contatos.email", "contatos.instagram", "fontes.titulo", "identificacao.crm", "identificacao.uf", "paleta.primaria"].sort()
    );
  });

  it("bio conferida só com true de verdade", () => {
    expect(normalizarBrandKit({ bio_conferida: "true" }).kit.bio_conferida).toBe(false);
  });

  it("normaliza o @ do Instagram", () => {
    expect(normalizarInstagram("@dr.fulano")).toBe("dr.fulano");
    expect(normalizarInstagram("instagram.com/dr_fulano?igsh=x")).toBe("dr_fulano");
    expect(normalizarInstagram("nome com espaço")).toBe("");
  });
});

describe("identificação", () => {
  it("monta a linha com UF e RQE", () => {
    expect(linhaDeIdentificacao({ nome: "Dr. Fulano", crm: "12345", uf: "RS", rqe: "678" })).toBe(
      "Dr. Fulano | CRM/RS 12345 | RQE 678"
    );
  });

  it('sem RQE e com a regra ligada, escreve "NÃO ESPECIALISTA"', () => {
    expect(linhaDeIdentificacao({ nome: "Dr. Fulano", crm: "12345", uf: "RS", rqe: "" }, { naoEspecialista: true })).toBe(
      "Dr. Fulano | CRM/RS 12345 | NÃO ESPECIALISTA"
    );
  });

  it("temIdentificacao pede nome, CRM e UF", () => {
    expect(temIdentificacao({ identificacao: { nome: "A", crm: "1", uf: "SP", rqe: "", pos_graduacao: "" } })).toBe(true);
    expect(temIdentificacao({ identificacao: { nome: "A", crm: "1", uf: "", rqe: "", pos_graduacao: "" } })).toBe(false);
    expect(temIdentificacao(null)).toBe(false);
  });
});

describe("rotas do brand kit (partes puras)", () => {
  it("reconhece a imagem pelos bytes, não pelo nome", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const webp = Buffer.from("RIFF0000WEBPVP8 ", "ascii");
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">', "utf8");
    expect(tipoDaImagem(png)).toBe("image/png");
    expect(tipoDaImagem(jpg)).toBe("image/jpeg");
    expect(tipoDaImagem(webp)).toBe("image/webp");
    expect(tipoDaImagem(svg)).toBeNull();
  });

  it("completa a linha do banco com a forma inteira do kit", () => {
    expect(kitCompleto("x", null)).toEqual(kitVazio("x"));
    const k = kitCompleto("x", { paleta: { primaria: "#000000" }, imagens: { logo: "a.png" } });
    expect(k.paleta).toEqual({ primaria: "#000000", secundaria: null, terciaria: null });
    expect(k.imagens).toEqual({ logo: "a.png", logo_escuro: null, foto_medico: null });
    expect(k.contatos.whatsapp).toBe("");
  });
});
