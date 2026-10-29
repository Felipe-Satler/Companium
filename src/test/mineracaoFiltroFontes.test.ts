/**
 * Os sinais de qualidade por fonte, e a tag que a tela mostra para cada filtro.
 *
 * O teste de paridade é o que importa: a tela diz "este filtro vale para Meta e TikTok" a partir de
 * `FILTRO_FONTES`, e quem de fato filtra é o `makeQualityGate` do worker. Se os dois divergirem, a
 * tag mente — e a pessoa aperta um filtro achando que ele age numa fonte em que não age.
 */
import { describe, it, expect } from "vitest";
import {
  audienceLowerBound,
  makeQualityGate,
  metaDaysRunning,
  organicSignals,
} from "../../apps/ad-spy-worker/sources/shared.js";
import { normalize as normalizeInstagram } from "../../apps/ad-spy-worker/sources/instagram.js";
import {
  FILTRO_FONTES,
  fontesAtivas,
  TODAS,
  type TagFonte,
} from "@/components/marketing/mineracao/filtroFontes";

/** Uma peça de cada fonte com TODOS os sinais ruins: reprova em qualquer filtro que se aplique. */
const ruim: Record<TagFonte, Record<string, unknown>> = {
  meta: { source: "meta" },
  google: { source: "google" },
  instagram_ads: { source: "meta", foundVia: "instagram_ads" },
  tiktok: { source: "tiktok" },
  tiktok_organic: { source: "tiktok_organic" },
  instagram: { source: "instagram" },
  youtube: { source: "youtube" },
};
const sinaisRuins = {
  externalId: "x",
  adCopy: "texto suficiente para não cair no filtro de copy",
  daysRunning: 0,
  collationCount: 1,
  metrics: { views: 0, engagementRate: 0, viewsPerFollower: 0, estimatedAudience: "<1K" },
};

const FILTROS_DE_QUALIDADE = {
  minDaysRunning: 30,
  minCollationCount: 5,
  minTikTokAudience: 10_000,
  minViews: 1000,
  minEngagementPct: 1,
  minViewsPerFollower: 2,
} as const;

describe("a tag de cada filtro diz a verdade sobre o gate", () => {
  for (const [filtro, valor] of Object.entries(FILTROS_DE_QUALIDADE)) {
    for (const tag of TODAS) {
      const vale = FILTRO_FONTES[filtro as keyof typeof FILTRO_FONTES]!.includes(tag);
      it(`${filtro} ${vale ? "filtra" : "não toca"} ${tag}`, () => {
        const gate = makeQualityGate({ [filtro]: valor });
        expect(gate({ ...sinaisRuins, ...ruim[tag] }).ok).toBe(!vale);
      });
    }
  }

  it("as fontes marcadas viram as tags certas", () => {
    expect([...fontesAtivas(["meta", "instagram_ads", "instagram_reels", "youtube_channel"])].sort()).toEqual(
      ["instagram", "instagram_ads", "meta", "youtube"],
    );
  });
});

describe("sinais", () => {
  it("anúncio Meta INATIVO conta os dias só até o fim, não até hoje", () => {
    expect(metaDaysRunning("2026-01-01", "2026-01-04", false)).toBe(3);
    // Ativo, ou sem data de fim: até hoje, como antes.
    expect(metaDaysRunning("2026-01-01", "2026-01-04", true)).toBeGreaterThan(200);
    expect(metaDaysRunning("2026-01-01", null, false)).toBeGreaterThan(200);
  });

  it("engajamento por visualização; sem visualização, por seguidor — e diz qual", () => {
    expect(organicSignals({ views: 10_000, likes: 180, comments: 20, followers: 2_000 })).toEqual({
      engagementRate: 0.02,
      engagementBasis: "views",
      viewsPerFollower: 5,
    });
    expect(organicSignals({ views: null, likes: 90, comments: 10, followers: 5_000 })).toMatchObject({
      engagementRate: 0.02,
      engagementBasis: "followers",
      viewsPerFollower: null,
    });
    expect(organicSignals({ views: 100 })).toMatchObject({ engagementRate: null });
  });

  it("piso da faixa de alcance do TikTok", () => {
    expect(audienceLowerBound("10K-100K")).toBe(10_000);
    expect(audienceLowerBound("1M-10M")).toBe(1_000_000);
    expect(audienceLowerBound("<1K")).toBe(0);
    expect(audienceLowerBound("")).toBeNull();
  });

  it("post do feed de perfil herda os seguidores da raiz da resposta", () => {
    const ad = normalizeInstagram(
      { code: "ABCDE12", media_type: 2, play_count: 30_000, like_count: 600, user: { username: "drx" } },
      "perfil:@drx",
      { username: "drx", follower_count: 3_000 },
    );
    expect(ad!.metrics).toMatchObject({ followers: 3_000, viewsPerFollower: 10, engagementRate: 0.02 });
  });
});
