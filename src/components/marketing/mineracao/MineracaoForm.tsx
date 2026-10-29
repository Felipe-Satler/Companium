import { useState, type ReactNode } from "react";
import {
  ChevronDown,
  FlaskConical,
  Hash,
  Info,
  Loader2,
  Pickaxe,
  Search,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeywordProbe } from "@/components/marketing/mineracao/KeywordProbe";
import { BlocoFiltros, CampoFiltro } from "@/components/marketing/mineracao/FonteTags";
import { fontesAtivas } from "@/components/marketing/mineracao/filtroFontes";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SpySettings, SpySourceId, StartRunInput } from "@/lib/adSpyApi";

/**
 * As fontes. UMA por busca: cada busca é de uma plataforma só, e o grid não mistura pago com
 * orgânico — comparar um anúncio pela longevidade com um post pelas visualizações é comparar réguas
 * diferentes.
 *
 * Instagram, TikTok e YouTube Shorts aqui são só ORGÂNICOS (o que o nicho publica e o que engaja).
 * Os anúncios deles vêm de "Meta Ads" (a Biblioteca da Meta já traz os que rodam no Instagram) e de
 * "TikTok Ads". O worker continua aceitando "Instagram › Anúncios"; só não é oferecido aqui.
 *
 * Google Ads não busca por palavra-chave: o Centro de Transparência só procura ANUNCIANTES. Os modos
 * dele dizem isso.
 */
type Plataforma = "meta" | "google" | "tiktok_ads" | "instagram" | "tiktok" | "youtube";
const SOURCES: { id: Plataforma; label: string; hint: string }[] = [
  { id: "meta", label: "Meta Ads", hint: "Biblioteca de Anúncios do Facebook/Instagram" },
  {
    id: "google",
    label: "Google Ads",
    hint: "Centro de Transparência de Anúncios do Google — busca por anunciante, não por palavra-chave",
  },
  { id: "tiktok_ads", label: "TikTok Ads", hint: "Biblioteca de Anúncios do TikTok" },
  {
    id: "instagram",
    label: "Instagram",
    hint: "Posts e reels ORGÂNICOS — o que o nicho publica e engaja, não anúncios",
  },
  {
    id: "tiktok",
    label: "TikTok",
    hint: "Vídeos ORGÂNICOS — o que o nicho publica e engaja, não anúncios",
  },
  {
    id: "youtube",
    label: "YouTube Shorts",
    hint: "Shorts ORGÂNICOS — o que o nicho publica e engaja, não anúncios",
  },
];

/** "tema" = a fonte `google` (anunciantes com o tema no nome); "advertiser" = `google_advertiser`. */
type ModoGoogle = "tema" | "advertiser";
const MODOS_GOOGLE: { id: ModoGoogle; label: string; hint: string }[] = [
  {
    id: "tema",
    label: "Anunciantes com o tema no nome",
    hint: "Acha anunciantes cujo NOME tem o tema e traz os anúncios dos 3 mais ativos.",
  },
  { id: "advertiser", label: "Anunciantes e sites", hint: "Os anúncios de anunciantes específicos." },
];

type ModoYoutube = "shorts" | "hashtag" | "channel";
const MODOS_YOUTUBE: { id: ModoYoutube; label: string; hint: string }[] = [
  { id: "shorts", label: "Shorts por palavra-chave", hint: "Busca o tema nos shorts públicos." },
  { id: "hashtag", label: "Shorts da hashtag", hint: "Shorts marcados com a hashtag." },
  { id: "channel", label: "Canais e links", hint: "Os shorts de canais específicos, ou shorts colados." },
];

type ModoInstagram = "reels" | "hashtag" | "profile";
const MODOS_INSTAGRAM: { id: ModoInstagram; label: string; hint: string }[] = [
  { id: "reels", label: "Reels por palavra-chave", hint: "Busca o tema nos reels públicos." },
  { id: "hashtag", label: "Posts da hashtag", hint: "Posts e reels marcados com a hashtag." },
  { id: "profile", label: "Perfis e links", hint: "O feed de perfis específicos, ou posts colados." },
];

type ModoTiktok = "videos" | "hashtag" | "profile";
const MODOS_TIKTOK: { id: ModoTiktok; label: string; hint: string }[] = [
  { id: "videos", label: "Vídeos por palavra-chave", hint: "Busca o tema nos vídeos públicos." },
  { id: "hashtag", label: "Vídeos da hashtag", hint: "Vídeos marcados com a hashtag." },
  { id: "profile", label: "Perfis e links", hint: "Os vídeos de perfis específicos, ou vídeos colados." },
];

type Modo = { id: string; label: string; hint: string };

/**
 * Os modos de uma fonte com mais de um jeito de buscar (Google, Instagram, TikTok, YouTube): checkboxes, e os campos que só aparecem com
 * o modo marcado — hashtag e alvos (perfis/canais e links). Um componente para as duas, para elas
 * não divergirem.
 */
function PainelModos({
  idBase,
  intro,
  modos,
  ativos,
  onToggle,
  hashtag,
  alvos,
}: {
  idBase: string;
  intro: ReactNode;
  modos: Modo[];
  ativos: string[];
  onToggle: (id: string) => void;
  /** Sem `hashtag`, a fonte não tem modo de hashtag (Google). */
  hashtag?: { modo: string; valor: string; onChange: (v: string) => void; doTema: string };
  alvos: {
    modo: string;
    rotulo: string;
    valor: string;
    onChange: (v: string) => void;
    placeholder: string;
    dica: string;
  };
}) {
  const efetiva = hashtag ? hashtag.valor.replace(/^#+/, "").trim() || hashtag.doTema : "";
  return (
    <div className="neu-inset space-y-3 rounded-lg p-3">
      <p className="text-[11px] text-muted-foreground">{intro}</p>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {modos.map((m) => (
          <label key={m.id} className="flex cursor-pointer items-start gap-2 text-xs">
            <Checkbox checked={ativos.includes(m.id)} onCheckedChange={() => onToggle(m.id)} className="mt-0.5" />
            <span>
              <span className="font-medium">{m.label}</span>
              <span className="block text-[11px] text-muted-foreground">{m.hint}</span>
            </span>
          </label>
        ))}
      </div>

      {hashtag && ativos.includes(hashtag.modo) && (
        <div className="space-y-1.5">
          <Label htmlFor={`spy-${idBase}-hashtag`} className={ROTULO}>
            Hashtag
          </Label>
          <div className="relative max-w-xs">
            <Hash className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              id={`spy-${idBase}-hashtag`}
              value={hashtag.valor}
              onChange={(e) => hashtag.onChange(e.target.value)}
              placeholder={hashtag.doTema || "harmonizacaofacial"}
              className="pl-8"
              maxLength={100}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            {hashtag.valor.trim()
              ? `Vai buscar #${efetiva}.`
              : efetiva
                ? `Vazio = #${efetiva}, tirada do tema.`
                : "Vazio = tirada do tema."}
          </p>
        </div>
      )}

      {ativos.includes(alvos.modo) && (
        <div className="space-y-1.5">
          <Label htmlFor={`spy-${idBase}-alvos`} className={ROTULO}>
            {alvos.rotulo}
          </Label>
          <Textarea
            id={`spy-${idBase}-alvos`}
            value={alvos.valor}
            onChange={(e) => alvos.onChange(e.target.value)}
            rows={2}
            placeholder={alvos.placeholder}
          />
          <p className="text-[11px] text-muted-foreground">{alvos.dica}</p>
        </div>
      )}
    </div>
  );
}

/** Espelha `hashtagFromTema` do worker, só para mostrar qual hashtag vai ser buscada. */
const hashtagDoTema = (tema: string) =>
  tema
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");

/** Uma entrada por linha, vírgula ou espaço. O worker valida e normaliza; aqui só se separa. */
const alvosDe = (texto: string) =>
  texto
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);

/**
 * Classe única de rótulo, e ela é `flex` de propósito.
 *
 * Um <label> solto é inline: a altura da linha vem do strut da div que o contém, não do próprio
 * texto. Um rótulo `flex` é caixa de bloco e mede exatamente o conteúdo. Misturar os dois num grid
 * de duas colunas desalinha os campos na vertical por alguns pixels — foi o que aconteceu com
 * "Quantidade de anúncios a buscar" ao lado de "Mínimo de anúncios usando o criativo".
 */
const ROTULO = "flex items-center gap-1.5 text-xs font-medium";

/** O "i" com explicação ao lado de um rótulo. */
function Dica({ children }: { children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="h-3 w-3 text-muted-foreground" />
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{children}</TooltipContent>
    </Tooltip>
  );
}

/** Degraus do filtro de alcance do TikTok — os pisos das faixas que a biblioteca usa. */
const ALCANCES_TIKTOK: [number, string][] = [
  [0, "Sem filtro"],
  [1_000, "1 mil ou mais"],
  [10_000, "10 mil ou mais"],
  [100_000, "100 mil ou mais"],
  [1_000_000, "1 milhão ou mais"],
  [10_000_000, "10 milhões ou mais"],
];

/** Múltiplos de 4: é a unidade do orçamento de créditos. */
const QUANTIDADES = [4, 8, 12, 16, 20, 24, 32, 40] as const;

/** Espelha `creditBudget()` do worker: (N/4) * 10. Aqui só para dizer o número antes de gastar. */
const creditosDe = (n: number) => Math.max(1, Math.ceil(n / 4) * 10);

const DEFAULTS: SpySettings = {
  country: "BR",
  language: null,
  status: "ACTIVE",
  mediaType: "all",
  sortBy: "impressions",
  startDate: null,
  endDate: null,
  // Replicação: o anunciante que roda a MESMA peça em 5+ anúncios está colocando dinheiro nela.
  // Junto com a longevidade, é o que separa pesquisa útil de ruído — vale mais gastar crédito
  // atrás de poucos anúncios bons do que encher o grid com peça que ninguém repetiu.
  // Múltiplo de 4: o orçamento de créditos é por grupo de 4 (12 anúncios = 30 créditos).
  targetAds: 12,
  minCollationCount: 5,
  // Desligado por padrão. Longevidade é sinal forte, mas somada à replicação estreita demais o
  // funil: as duas juntas gastavam o orçamento inteiro para trazer pouca coisa.
  minDaysRunning: 0,
  // Sem teto por anunciante: quem replica muito é exatamente quem interessa ver, e os dois filtros
  // acima já cortam o volume.
  maxPerAdvertiser: 0,
  minCopyChars: 0,
  transcribe: true,
  // Instagram: sem piso de visualizações por padrão — o nicho de clínica tem reels bons com
  // poucos milhares, e um piso alto esvazia a trilha.
  minViews: 0,
  // Sinais de qualidade novos: desligados por padrão, como a longevidade. Ligados juntos com a
  // replicação, estreitavam o funil a ponto de gastar o orçamento para trazer pouca coisa.
  minEngagementPct: 0,
  minViewsPerFollower: 0,
  minTikTokAudience: 0,
  instagramHashtag: null,
  instagramProfiles: [],
  youtubeHashtag: null,
  youtubeChannels: [],
};

type Props = {
  onStart: (input: StartRunInput) => void;
  isStarting?: boolean;
  disabled?: boolean;
  disabledReason?: string | null;
};

export function MineracaoForm({ onStart, isStarting, disabled, disabledReason }: Props) {
  const [tema, setTema] = useState("");
  const [plataforma, setPlataforma] = useState<Plataforma>("meta");
  const [modosIg, setModosIg] = useState<ModoInstagram[]>(["reels", "hashtag"]);
  const [hashtag, setHashtag] = useState("");
  const [perfisTexto, setPerfisTexto] = useState("");
  const [modosTt, setModosTt] = useState<ModoTiktok[]>(["videos"]);
  const [modosGg, setModosGg] = useState<ModoGoogle[]>(["tema"]);
  const [anunciantesGgTexto, setAnunciantesGgTexto] = useState("");
  const [modosYt, setModosYt] = useState<ModoYoutube[]>(["shorts"]);
  const [hashtagYt, setHashtagYt] = useState("");
  const [canaisTexto, setCanaisTexto] = useState("");
  const [hashtagTt, setHashtagTt] = useState("");
  const [perfisTtTexto, setPerfisTtTexto] = useState("");
  const [settings, setSettings] = useState<SpySettings>(DEFAULTS);
  const [extraPrompt, setExtraPrompt] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [sondaAberta, setSondaAberta] = useState(false);

  const set = <K extends keyof SpySettings>(key: K, value: SpySettings[K]) =>
    setSettings((s) => ({ ...s, [key]: value }));

  const toggleModo = (id: ModoInstagram) =>
    setModosIg((cur) => (cur.includes(id) ? cur.filter((m) => m !== id) : [...cur, id]));
  const toggleModoTt = (id: ModoTiktok) =>
    setModosTt((cur) => (cur.includes(id) ? cur.filter((m) => m !== id) : [...cur, id]));

  const comInstagram = plataforma === "instagram";
  const comTiktok = plataforma === "tiktok";
  const comGoogle = plataforma === "google";
  const comYoutube = plataforma === "youtube";
  const anunciantesGg = alvosDe(anunciantesGgTexto);
  const canais = alvosDe(canaisTexto);
  const alterna = <T,>(set: (f: (cur: T[]) => T[]) => void, id: T) =>
    set((cur) => (cur.includes(id) ? cur.filter((m) => m !== id) : [...cur, id]));
  const perfisTt = alvosDe(perfisTtTexto);
  const perfis = alvosDe(perfisTexto);

  // O que vai em `sources`: a plataforma, com Instagram e TikTok abertos nos modos marcados (cada
  // modo é uma trilha no worker). "TikTok Ads" é a fonte `tiktok`, a Biblioteca de Anúncios.
  const sources: SpySourceId[] =
    plataforma === "instagram"
      ? modosIg.map((m) => `instagram_${m}` as SpySourceId)
      : plataforma === "tiktok"
        ? modosTt.map((m) => `tiktok_${m}` as SpySourceId)
        : plataforma === "youtube"
          ? modosYt.map((m) => `youtube_${m}` as SpySourceId)
          : plataforma === "google"
            ? modosGg.map((m) => (m === "tema" ? "google" : "google_advertiser"))
            : plataforma === "tiktok_ads"
              ? ["tiktok"]
              : ["meta"];
  const varias = sources.length > 1;
  const organico = comInstagram || comTiktok || comYoutube;
  const ativas = fontesAtivas(sources);

  // O que falta para buscar, em português — melhor que um botão cinza sem explicação.
  const pendencia =
    comInstagram && !modosIg.length
      ? "Marque ao menos um modo de busca do Instagram."
      : comInstagram && modosIg.includes("profile") && !perfis.length
        ? "Informe ao menos um @perfil ou link, ou desmarque “Perfis e links”."
        : comTiktok && !modosTt.length
          ? "Marque ao menos um modo de busca do TikTok."
          : comTiktok && modosTt.includes("profile") && !perfisTt.length
            ? "Informe ao menos um @perfil ou link do TikTok, ou desmarque “Perfis e links”."
            : comGoogle && !modosGg.length
              ? "Marque ao menos um modo de busca do Google Ads."
              : comGoogle && modosGg.includes("advertiser") && !anunciantesGg.length
                ? "Informe ao menos um anunciante ou site, ou desmarque “Anunciantes e sites”."
                : comYoutube && !modosYt.length
                  ? "Marque ao menos um modo de busca do YouTube."
                  : comYoutube && modosYt.includes("channel") && !canais.length
                    ? "Informe ao menos um @canal ou link do YouTube, ou desmarque “Canais e links”."
                    : null;

  const canSubmit = tema.trim().length > 1 && !pendencia && !disabled && !isStarting;

  const submit = () => {
    if (!canSubmit) return;
    onStart({
      tema: tema.trim(),
      sources,
      settings: {
        ...settings,
        instagramHashtag: comInstagram && modosIg.includes("hashtag") ? hashtag.trim() || null : null,
        instagramProfiles: comInstagram && modosIg.includes("profile") ? perfis : [],
        tiktokHashtag: comTiktok && modosTt.includes("hashtag") ? hashtagTt.trim() || null : null,
        tiktokProfiles: comTiktok && modosTt.includes("profile") ? perfisTt : [],
        youtubeHashtag: comYoutube && modosYt.includes("hashtag") ? hashtagYt.trim() || null : null,
        youtubeChannels: comYoutube && modosYt.includes("channel") ? canais : [],
        googleAdvertisers: comGoogle && modosGg.includes("advertiser") ? anunciantesGg : [],
      },
      extraPrompt: extraPrompt.trim(),
    });
  };

  return (
    <div className="neu-card rounded-xl p-5 space-y-5">
      <div className="flex items-center gap-2">
        <Pickaxe className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Nova mineração</h2>
      </div>

      {/* Tema */}
      <div className="space-y-2">
        <Label htmlFor="spy-tema" className={ROTULO}>
          Tema de interesse
        </Label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="spy-tema"
            value={tema}
            onChange={(e) => setTema(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="ex.: harmonização facial, implante dentário, lentes de contato dental"
            className="pl-9"
            maxLength={200}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          O termo é buscado no texto dos anúncios, não no nome do anunciante.
        </p>

        {/* Etapa opcional, recolhida: quem já sabe o termo não esbarra nela; quem não sabe gasta
            1 crédito por palavra em vez do orçamento inteiro para descobrir. */}
        <Collapsible open={sondaAberta} onOpenChange={setSondaAberta}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-md py-1 text-xs font-medium text-primary hover:underline"
            >
              <FlaskConical className="h-3.5 w-3.5" />
              {sondaAberta ? "Fechar o teste de palavras-chave" : "Não sei qual termo usar"}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <KeywordProbe settings={settings} nicho={tema} onUsarTermo={setTema} fontesDaBusca={sources} />
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Fontes */}
      <div className="space-y-2">
        <Label id="spy-fonte-rotulo" className={ROTULO}>
          Fonte
        </Label>
        {/* Uma fonte por busca: escolher outra troca, não soma. */}
        <div role="radiogroup" aria-labelledby="spy-fonte-rotulo" className="flex flex-wrap gap-2">
          {SOURCES.map((s) => {
            const active = plataforma === s.id;
            return (
              <Tooltip key={s.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setPlataforma(s.id)}
                    className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      active
                        ? "bg-primary text-primary-foreground"
                        : "border border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
                    }`}
                  >
                    {s.label}
                  </button>
                </TooltipTrigger>
                <TooltipContent>{s.hint}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        {comGoogle && (
          <PainelModos
            idBase="gg"
            intro={
              <>
                O Centro de Transparência do Google <strong>não busca por palavra-chave</strong>, só por
                anunciante. A listagem traz a imagem e as datas; o texto e o vídeo vêm do detalhe, lido
                só para os anúncios que você selecionar (1 crédito cada). Vídeo de Google Ads é do
                YouTube, e a transcrição é a legenda dele.
              </>
            }
            modos={MODOS_GOOGLE}
            ativos={modosGg}
            onToggle={(id) => alterna(setModosGg, id as ModoGoogle)}
            alvos={{
              modo: "advertiser",
              rotulo: "Anunciantes e sites",
              valor: anunciantesGgTexto,
              onChange: setAnunciantesGgTexto,
              placeholder: "clinicaconcorrente.com.br\nhttps://adstransparency.google.com/advertiser/AR…",
              dica: "Um por linha: o site do anunciante, o id dele (AR…) ou o link da página dele no Centro de Transparência. Até 10. Cada um gasta crédito à parte.",
            }}
          />
        )}

        {comInstagram && (
          <PainelModos
            idBase="ig"
            intro={
              <>
                Conteúdo <strong>orgânico</strong>: o que o nicho publica e o que engaja — aqui o sinal de
                desempenho é visualização e engajamento, não tempo no ar. Os anúncios que rodam no
                Instagram vêm em “Meta Ads”.
              </>
            }
            modos={MODOS_INSTAGRAM}
            ativos={modosIg}
            onToggle={(id) => toggleModo(id as ModoInstagram)}
            hashtag={{ modo: "hashtag", valor: hashtag, onChange: setHashtag, doTema: hashtagDoTema(tema) }}
            alvos={{
              modo: "profile",
              rotulo: "Perfis e links",
              valor: perfisTexto,
              onChange: setPerfisTexto,
              placeholder: "@clinica.concorrente\nhttps://www.instagram.com/reel/…",
              dica: "Um por linha: @perfil para varrer o feed, ou o link de um post/reel para trazer só ele. Até 10. Cada um gasta crédito à parte.",
            }}
          />
        )}

        {comTiktok && (
          <PainelModos
            idBase="tt"
            intro={
              <>
                Vídeos <strong>orgânicos</strong>: o que o nicho publica e o que engaja — aqui o sinal de
                desempenho é visualização e engajamento, não tempo no ar. Os anúncios vêm em “TikTok
                Ads”. O país só diz de onde a busca é feita; o TikTok não filtra os vídeos por país.
              </>
            }
            modos={MODOS_TIKTOK}
            ativos={modosTt}
            onToggle={(id) => toggleModoTt(id as ModoTiktok)}
            hashtag={{ modo: "hashtag", valor: hashtagTt, onChange: setHashtagTt, doTema: hashtagDoTema(tema) }}
            alvos={{
              modo: "profile",
              rotulo: "Perfis e links",
              valor: perfisTtTexto,
              onChange: setPerfisTtTexto,
              placeholder: "@clinica.concorrente\nhttps://www.tiktok.com/@perfil/video/…",
              dica: "Um por linha: @perfil para trazer os vídeos mais populares dele, ou o link de um vídeo para trazer só ele. Até 10. Cada um gasta crédito à parte.",
            }}
          />
        )}

        {comYoutube && (
          <PainelModos
            idBase="yt"
            intro={
              <>
                YouTube Shorts é conteúdo <strong>orgânico</strong>. O YouTube não entrega o arquivo do
                vídeo, então a transcrição é a <strong>legenda</strong> do próprio YouTube (muitas vezes
                automática), buscada só para os shorts que você selecionar.
              </>
            }
            modos={MODOS_YOUTUBE}
            ativos={modosYt}
            onToggle={(id) => alterna(setModosYt, id as ModoYoutube)}
            hashtag={{ modo: "hashtag", valor: hashtagYt, onChange: setHashtagYt, doTema: hashtagDoTema(tema) }}
            alvos={{
              modo: "channel",
              rotulo: "Canais e links",
              valor: canaisTexto,
              onChange: setCanaisTexto,
              placeholder: "@canalconcorrente\nhttps://www.youtube.com/shorts/…",
              dica: "Um por linha: @canal para trazer os shorts mais vistos dele, ou o link de um short para trazer só ele. Até 10. Cada um gasta crédito à parte.",
            }}
          />
        )}

      </div>

      {/* As duas que se mexe a cada busca ficam à mão; o resto vive em "Configurações de
          qualidade", que quase não se abre. */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Quantidade — define também o teto de gasto da busca */}
        <CampoFiltro
          filtro="targetAds"
          ativas={ativas}
          rotulo={
            <Label htmlFor="spy-quantidade" className={ROTULO}>
              Quantidade a buscar
            </Label>
          }
        >
          <Select value={String(settings.targetAds)} onValueChange={(v) => set("targetAds", Number(v))}>
            <SelectTrigger id="spy-quantidade">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {QUANTIDADES.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} {organico ? "peças" : "anúncios"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CampoFiltro>

        <CampoFiltro
          filtro="minCollationCount"
          ativas={ativas}
          rotulo={
            <Label htmlFor="spy-colacao" className={ROTULO}>
              Mínimo de anúncios usando o criativo
              <Dica>
                Replicação: a Biblioteca da Meta mostra quantos anúncios usam o mesmo criativo e
                texto. Um anunciante replicando a peça em vários anúncios está escalando — é o
                segundo sinal público mais forte, depois da longevidade. A maioria tem 1: filtros
                altos trazem poucos resultados e cada bloco pode custar mais créditos.
              </Dica>
            </Label>
          }
        >
          <Input
            id="spy-colacao"
            type="number"
            min={0}
            max={1000}
            value={settings.minCollationCount}
            onChange={(e) => set("minCollationCount", Number(e.target.value) || 0)}
          />
          <p className="text-[11px] text-muted-foreground">0 ou 1 = sem filtro.</p>
        </CampoFiltro>
      </div>

      <p className="text-[11px] text-muted-foreground">
        A busca para quando achar {settings.targetAds} {organico ? "peças" : "anúncios"} que passem nos
        filtros ou quando gastar {creditosDe(settings.targetAds)} créditos — o que vier primeiro.
        {varias && " O orçamento é um só, dividido entre os modos de busca."}
      </p>

      {/* Configurações de qualidade */}
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-md px-1 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <span className="flex items-center gap-1.5">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Configurações de qualidade
            </span>
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
            />
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent className="pt-3">
          <div className="neu-inset space-y-6 rounded-lg p-4">
            <BlocoFiltros
              titulo="Anúncios pagos"
              descricao={
                <>
                  As bibliotecas de anúncios não expõem CTR, custo nem conversão. O que é público:
                  há quanto tempo o anúncio roda (ninguém paga meses por anúncio ruim — só ~22%
                  passam de 30 dias), quantas cópias o anunciante fez dele e, no TikTok, a faixa de
                  alcance.
                </>
              }
            >
              <CampoFiltro
                filtro="minDaysRunning"
                ativas={ativas}
                rotulo={
                  <Label htmlFor="spy-dias" className={ROTULO}>
                    Rodando há no mínimo (dias)
                    <Dica>
                      Longevidade: o principal sinal público de desempenho. 30 dias é o corte usado
                      no mercado para "anúncio que se pagou"; 90, para os campeões. Anúncio inativo
                      conta só até o último dia em que rodou.
                    </Dica>
                  </Label>
                }
              >
                <Input
                  id="spy-dias"
                  type="number"
                  min={0}
                  max={3650}
                  value={settings.minDaysRunning}
                  onChange={(e) => set("minDaysRunning", Number(e.target.value) || 0)}
                />
                <p className="text-[11px] text-muted-foreground">0 = sem filtro. 30 = já se pagou.</p>
              </CampoFiltro>

              <CampoFiltro
                filtro="minTikTokAudience"
                ativas={ativas}
                rotulo={
                  <Label htmlFor="spy-alcance" className={ROTULO}>
                    Alcance estimado mínimo
                    <Dica>
                      A Biblioteca do TikTok informa o alcance em faixas ("10K-100K"). O filtro usa o
                      piso da faixa. Anúncio sem faixa informada é reprovado quando o filtro está
                      ligado.
                    </Dica>
                  </Label>
                }
              >
                <Select
                  value={String(settings.minTikTokAudience ?? 0)}
                  onValueChange={(v) => set("minTikTokAudience", Number(v))}
                >
                  <SelectTrigger id="spy-alcance">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ALCANCES_TIKTOK.map(([n, rotulo]) => (
                      <SelectItem key={n} value={String(n)}>
                        {rotulo}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CampoFiltro>

              <CampoFiltro filtro="status" ativas={ativas} rotulo={<Label className={ROTULO}>Status</Label>}>
                <Select
                  value={settings.status}
                  onValueChange={(v) => set("status", v as SpySettings["status"])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Ativos</SelectItem>
                    <SelectItem value="ALL">Ativos e inativos</SelectItem>
                    <SelectItem value="INACTIVE">Só inativos</SelectItem>
                  </SelectContent>
                </Select>
              </CampoFiltro>
            </BlocoFiltros>

            <BlocoFiltros
              titulo="Conteúdo orgânico"
              descricao={
                <>
                  Num post, a data é só a idade — a prova é o engajamento. Referência de mercado
                  (2025): Reels e Shorts de marcas ficam perto de 0,4–0,6% de engajamento por
                  visualização; acima de 1% é forte.
                </>
              }
            >
              <CampoFiltro
                filtro="minViews"
                ativas={ativas}
                rotulo={
                  <Label htmlFor="spy-views" className={ROTULO}>
                    Mínimo de visualizações
                  </Label>
                }
              >
                <Input
                  id="spy-views"
                  type="number"
                  min={0}
                  step={1000}
                  value={settings.minViews ?? 0}
                  onChange={(e) => set("minViews", Number(e.target.value) || 0)}
                />
                <p className="text-[11px] text-muted-foreground">
                  0 = sem filtro. Volume absoluto — favorece contas grandes.
                </p>
              </CampoFiltro>

              <CampoFiltro
                filtro="minEngagementPct"
                ativas={ativas}
                rotulo={
                  <Label htmlFor="spy-engajamento" className={ROTULO}>
                    Engajamento mínimo (%)
                    <Dica>
                      (curtidas + comentários) ÷ visualizações. Diz se quem viu reagiu — e não depende
                      do tamanho da conta. Em foto ou carrossel do Instagram, que não têm
                      visualizações, é calculado sobre os seguidores.
                    </Dica>
                  </Label>
                }
              >
                <Input
                  id="spy-engajamento"
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={settings.minEngagementPct ?? 0}
                  onChange={(e) => set("minEngagementPct", Number(e.target.value) || 0)}
                />
                <p className="text-[11px] text-muted-foreground">0 = sem filtro. 1% já é acima da média.</p>
              </CampoFiltro>

              <CampoFiltro
                filtro="minViewsPerFollower"
                ativas={ativas}
                rotulo={
                  <Label htmlFor="spy-multiplicador" className={ROTULO}>
                    Visualizações ÷ seguidores (mínimo)
                    <Dica>
                      Quanto o post foi além da própria base — o "outlier score" das ferramentas de
                      pesquisa de conteúdo. Um perfil de 5 mil seguidores com 50 mil visualizações (10×)
                      achou algo que vale estudar; um de 2 milhões com as mesmas 50 mil, não. Só o
                      Instagram traz os seguidores junto do post.
                    </Dica>
                  </Label>
                }
              >
                <Input
                  id="spy-multiplicador"
                  type="number"
                  min={0}
                  max={1000}
                  step={0.5}
                  value={settings.minViewsPerFollower ?? 0}
                  onChange={(e) => set("minViewsPerFollower", Number(e.target.value) || 0)}
                />
                <p className="text-[11px] text-muted-foreground">
                  0 = sem filtro. 1 = alcançou o tamanho da base; 3+ = viralizou para fora dela.
                </p>
              </CampoFiltro>
            </BlocoFiltros>

            <BlocoFiltros
              titulo="Todas as fontes"
              descricao="Recorte e formato da busca. Não medem qualidade — controlam quais anúncios entram na análise."
            >
              <CampoFiltro
                filtro="maxPerAdvertiser"
                ativas={ativas}
                rotulo={
                  <Label htmlFor="spy-por-anunciante" className={ROTULO}>
                    Máximo por anunciante ou perfil
                  </Label>
                }
              >
                <Input
                  id="spy-por-anunciante"
                  type="number"
                  min={0}
                  max={50}
                  value={settings.maxPerAdvertiser}
                  onChange={(e) => set("maxPerAdvertiser", Number(e.target.value) || 0)}
                />
                <p className="text-[11px] text-muted-foreground">
                  0 = sem limite. Evita que uma conta grande domine a análise.
                </p>
              </CampoFiltro>

              <CampoFiltro
                filtro="minCopyChars"
                ativas={ativas}
                rotulo={
                  <Label htmlFor="spy-texto-minimo" className={ROTULO}>
                    Texto mínimo (caracteres)
                  </Label>
                }
              >
                <Input
                  id="spy-texto-minimo"
                  type="number"
                  min={0}
                  max={5000}
                  value={settings.minCopyChars}
                  onChange={(e) => set("minCopyChars", Number(e.target.value) || 0)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Descarta peças sem texto de verdade (no short, conta o título).
                </p>
              </CampoFiltro>

              <CampoFiltro filtro="mediaType" ativas={ativas} rotulo={<Label className={ROTULO}>Tipo de mídia</Label>}>
                <Select
                  value={settings.mediaType}
                  onValueChange={(v) => set("mediaType", v as SpySettings["mediaType"])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="video">Só vídeo</SelectItem>
                    <SelectItem value="image">Só imagem</SelectItem>
                    <SelectItem value="all">Todos</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Vídeo é de onde sai a transcrição. Com "só imagem", reels e shorts ficam de fora.
                </p>
              </CampoFiltro>

              <CampoFiltro filtro="country" ativas={ativas} rotulo={<Label className={ROTULO}>País</Label>}>
                <Input
                  value={settings.country}
                  onChange={(e) => set("country", e.target.value.toUpperCase().slice(0, 2))}
                  maxLength={2}
                  className="uppercase"
                />
              </CampoFiltro>

              <CampoFiltro filtro="sortBy" ativas={ativas} rotulo={<Label className={ROTULO}>Ordenar por</Label>}>
                <Select
                  value={settings.sortBy}
                  onValueChange={(v) => set("sortBy", v as SpySettings["sortBy"])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="impressions">Mais vistos / mais impressões</SelectItem>
                    <SelectItem value="relevancy">Mais relevantes</SelectItem>
                  </SelectContent>
                </Select>
              </CampoFiltro>

              <CampoFiltro
                filtro="transcribe"
                ativas={ativas}
                className="sm:col-span-2"
                rotulo={<Label className={ROTULO}>Transcrever os vídeos</Label>}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] text-muted-foreground">
                    A transcrição roda no nosso servidor. Desligar deixa a análise só com os
                    textos — bem mais pobre, já que o gancho costuma estar no áudio. O YouTube não
                    entra aqui: a transcrição dele é sempre a legenda do próprio YouTube.
                  </p>
                  <Switch checked={settings.transcribe} onCheckedChange={(v) => set("transcribe", v)} />
                </div>
              </CampoFiltro>
            </BlocoFiltros>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Prompt extra */}
      <div className="space-y-2">
        <Label htmlFor="spy-extra" className={ROTULO}>
          <Sparkles className="h-3.5 w-3.5" />
          Instruções extras para a análise
          <span className="font-normal text-muted-foreground">(opcional)</span>
        </Label>
        <Textarea
          id="spy-extra"
          value={extraPrompt}
          onChange={(e) => setExtraPrompt(e.target.value)}
          rows={3}
          maxLength={4000}
          placeholder="ex.: foque em objeções de preço e compare o tom dos anúncios de clínica grande com os de consultório pequeno"
        />
      </div>

      {disabled && disabledReason && (
        <p className="text-xs text-muted-foreground">{disabledReason}</p>
      )}
      {!disabled && pendencia && <p className="text-xs text-muted-foreground">{pendencia}</p>}

      <Button onClick={submit} disabled={!canSubmit} className="w-full sm:w-auto">
        {isStarting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Buscando…
          </>
        ) : (
          <>
            <Pickaxe className="mr-2 h-4 w-4" />
            Buscar anúncios
          </>
        )}
      </Button>
    </div>
  );
}
