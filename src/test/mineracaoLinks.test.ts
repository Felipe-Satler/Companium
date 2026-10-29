/**
 * Para onde dá para ir a partir de um anúncio.
 *
 * O menu "Abrir" só pode oferecer caminho que leva a algum lugar: `link_url` e `page_profile_uri`
 * vêm de dados de terceiros e podem estar vazios, quebrados ou apontar para outro esquema.
 */
import { describe, it, expect } from "vitest";
import { adOpenLinks, type SpyAd } from "@/lib/adSpyApi";

function ad(over: Partial<SpyAd> = {}): SpyAd {
  return {
    id: 1,
    run_id: "r1",
    source: "meta",
    external_id: "1498059261982517",
    page_name: "Felipe Bueno",
    page_id: "1114455566677",
    page_profile_uri: null,
    permalink: null,
    ad_copy: "x",
    title: null,
    cta_text: null,
    link_url: null,
    display_format: "VIDEO",
    publisher_platform: null,
    started_running_on: null,
    days_running: null,
    media_type: "video",
    thumb_path: null,
    avatar_path: null,
    media_path: null,
    media_url: null,
    duration_sec: null,
    transcript: null,
    transcript_lang: null,
    transcript_model: null,
    collation_count: null,
    is_active: null,
    selected: false,
    criado_em: new Date().toISOString(),
    ...over,
  };
}

const porChave = (a: SpyAd) => Object.fromEntries(adOpenLinks(a).map((l) => [l.key, l]));

describe("adOpenLinks", () => {
  it("leva ao anúncio e a todos os anúncios do anunciante", () => {
    const l = porChave(ad());
    expect(l.biblioteca.href).toBe("https://www.facebook.com/ads/library/?id=1498059261982517");
    expect(l.anunciante.href).toBe(
      "https://www.facebook.com/ads/library/?view_all_page_id=1114455566677",
    );
  });

  it("sem perfil guardado, monta o do Facebook pelo page_id", () => {
    expect(porChave(ad()).perfil).toMatchObject({
      href: "https://www.facebook.com/1114455566677",
      label: "Perfil do anunciante no Facebook",
    });
  });

  it("o rótulo do perfil segue o que a URL é de fato", () => {
    const insta = porChave(ad({ page_profile_uri: "https://www.instagram.com/clinicax/" }));
    expect(insta.perfil.label).toMatch(/Instagram/);
    const face = porChave(ad({ page_profile_uri: "https://www.facebook.com/clinicax" }));
    expect(face.perfil.label).toMatch(/Facebook/);
  });

  it("mostra o domínio do site do anúncio, para saber aonde se está indo", () => {
    expect(porChave(ad({ link_url: "https://www.clinicax.com.br/lp?utm=1" })).site.label).toBe(
      "Site do anúncio (clinicax.com.br)",
    );
  });

  it("recusa URL que não é http(s) — os dados vêm de terceiros", () => {
    for (const ruim of ["javascript:alert(1)", "data:text/html,x", "  ", "ftp://x.com"]) {
      const l = porChave(ad({ link_url: ruim, page_profile_uri: ruim }));
      expect(l.site).toBeUndefined();
      // O perfil cai no link montado pelo page_id, nunca no valor recusado.
      expect(l.perfil.href).toBe("https://www.facebook.com/1114455566677");
    }
  });

  it("sem id e sem anunciante, não inventa caminho nenhum", () => {
    expect(adOpenLinks(ad({ external_id: "undefined", page_id: null, link_url: null }))).toEqual([]);
  });
});
