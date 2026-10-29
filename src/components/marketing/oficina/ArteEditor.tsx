import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, ChevronRight, Copy, Download, Loader2, Save, Shuffle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CHAVE_ARTES_SALVAS, chaveDaArte, useImagensDaArte, useToken } from "@/hooks/useArtes";
import { ajustarArte, baixarSlide, salvarArquivo, type Arte } from "@/lib/artesApi";
import { PreviewDoSlide } from "@/posts/SlideDaArte";
import { getTemplate, type SlideDoPost } from "../../../../shared/post-templates";
import { ESTILOS_DE_FUNDO, sortearFundo, type EstiloDeFundo, type FundoDoPost } from "../../../../shared/fundos";
import { legendaComHashtags } from "./legenda";

/**
 * Uma arte pronta: o preview (o MESMO componente que o worker fotografa), o ajuste do texto e do alt
 * de cada página, o fundo, a legenda e as hashtags, e o download de cada página.
 *
 * O fundo abstrato é desenhado pelo template a partir da paleta e de uma semente (`shared/fundos.js`):
 * "Sortear variação" troca a semente, como o "Gerar paleta nova" do Brand kit troca as cores.
 */

const LARGURA_PREVIEW = 420;

export function ArteEditor({ arte }: { arte: Arte }) {
  const token = useToken();
  const qc = useQueryClient();
  const post = arte.post!;
  const template = getTemplate(post.template.id) ?? getTemplate("editorial")!;
  const [atual, setAtual] = useState(0);
  const [slides, setSlides] = useState<SlideDoPost[]>(post.slides);
  const [fundo, setFundo] = useState<FundoDoPost | null>(post.fundo ?? null);
  const [legenda, setLegenda] = useState(post.legenda);
  const [hashtags, setHashtags] = useState(post.hashtags.join(" "));
  const [sujo, setSujo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [baixando, setBaixando] = useState<number | "todos" | null>(null);

  useEffect(() => {
    if (sujo) return;
    setSlides(post.slides);
    setLegenda(post.legenda);
    setHashtags(post.hashtags.join(" "));
    setFundo(post.fundo ?? null);
  }, [post, sujo]);

  const imagens = useImagensDaArte(arte);

  const postNaTela = { ...post, slides, legenda, fundo };

  const trocarFundo = (estilo: EstiloDeFundo, granulado = fundo?.granulado ?? false) => {
    setFundo(estilo === "liso" ? null : sortearFundo(estilo, { granulado }));
    setSujo(true);
  };
  const slide = slides[atual];
  const layout = template.layouts[slide.papel];
  const avisosDaPagina = arte.avisos.filter((a) => a.slide === atual);
  const avisosGerais = arte.avisos.filter((a) => a.slide == null);

  const editarSlide = (campo: keyof SlideDoPost, valor: string) => {
    setSlides((l) => l.map((s, i) => (i === atual ? { ...s, [campo]: valor } : s)));
    setSujo(true);
  };

  const salvar = async () => {
    setSalvando(true);
    try {
      await ajustarArte(token, arte.id, {
        slides,
        legenda,
        hashtags: hashtags.split(/[\s,]+/).filter(Boolean),
        fundo,
      });
      setSujo(false);
      await qc.invalidateQueries({ queryKey: chaveDaArte(arte.id) });
      void qc.invalidateQueries({ queryKey: CHAVE_ARTES_SALVAS });
      toast.success("Ajustes salvos.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar os ajustes.");
    } finally {
      setSalvando(false);
    }
  };

  const baixar = async (indices: number[]) => {
    setBaixando(indices.length > 1 ? "todos" : indices[0]);
    try {
      for (const i of indices) {
        const { blob, nome, avisos } = await baixarSlide(token, arte.id, i);
        salvarArquivo(blob, nome);
        if (avisos.length) toast.warning(`Página ${i + 1}: ${avisos.map((a) => a.detalhe).join("; ")}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível gerar o arquivo.");
    } finally {
      setBaixando(null);
    }
  };

  const legendaFinal = legendaComHashtags(legenda, hashtags.split(/[\s,]+/));

  return (
    <div className="grid gap-6 lg:grid-cols-[auto_1fr]">
      <div className="space-y-3">
        <div className="overflow-hidden rounded-lg border border-border shadow-sm">
          <PreviewDoSlide
            post={postNaTela}
            indice={atual}
            marca={arte.marca}
            imagens={imagens}
            largura={LARGURA_PREVIEW}
          />
        </div>
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" disabled={atual === 0} onClick={() => setAtual((a) => a - 1)} aria-label="Página anterior">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs tabular-nums text-muted-foreground">
            página {atual + 1} de {slides.length} · {layout.label}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={atual === slides.length - 1}
            onClick={() => setAtual((a) => a + 1)}
            aria-label="Próxima página"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={sujo || baixando != null} onClick={() => baixar([atual])}>
            {baixando === atual ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
            Baixar esta página
          </Button>
          {slides.length > 1 && (
            <Button variant="outline" size="sm" disabled={sujo || baixando != null} onClick={() => baixar(slides.map((_, i) => i))}>
              {baixando === "todos" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
              Baixar todas
            </Button>
          )}
        </div>
        {sujo && <p className="text-[11px] text-muted-foreground">Salve os ajustes para baixar a versão nova.</p>}
      </div>

      <div className="min-w-0 space-y-4">
        {arte.desatualizada && (
          <p className="flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />O anúncio foi editado depois desta arte. Gere outra para
            acompanhar.
          </p>
        )}
        {avisosGerais.length > 0 && (
          <ul className="space-y-0.5 rounded-md border border-amber-500/40 bg-amber-500/5 p-2">
            {avisosGerais.map((a, i) => (
              <li key={i} className="flex items-center gap-1.5 text-xs">
                <AlertTriangle className="h-3 w-3 shrink-0 text-amber-600" />
                {a.detalhe}
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold">Fundo</p>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px]"
              disabled={!fundo}
              onClick={() => fundo && trocarFundo(fundo.estilo)}
            >
              <Shuffle className="mr-1 h-3 w-3" /> Sortear variação
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Estilo do fundo">
            {ESTILOS_DE_FUNDO.map((e) => {
              const ativo = (fundo?.estilo ?? "liso") === e.id;
              return (
                <button
                  key={e.id}
                  type="button"
                  role="radio"
                  aria-checked={ativo}
                  onClick={() => !ativo && trocarFundo(e.id)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${
                    ativo ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {e.label}
                </button>
              );
            })}
          </div>
          {fundo && (
            <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Checkbox
                checked={fundo.granulado}
                onCheckedChange={(v) => {
                  setFundo({ ...fundo, granulado: v === true });
                  setSujo(true);
                }}
              />
              Textura granulada
            </label>
          )}
          <p className="text-[11px] text-muted-foreground">
            Desenhado a partir da paleta da arte, sem IA. As formas são suaves de propósito: o texto continua legível.
          </p>
        </div>

        <div className="space-y-3 rounded-lg border border-border p-3">
          <p className="text-xs font-semibold">Página {atual + 1}</p>
          {layout.slots.map((s) => {
            const valor = String(slide[s.id] ?? "");
            const estourou = valor.length > s.limite;
            return (
              <div key={s.id} className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">
                    {s.label}
                    {s.obrigatorio ? "" : " (opcional)"}
                  </Label>
                  <span className={`text-[11px] tabular-nums ${estourou ? "text-destructive" : "text-muted-foreground"}`}>
                    {valor.length}/{s.limite}
                  </span>
                </div>
                <Textarea value={valor} rows={s.limite > 100 ? 3 : 2} onChange={(e) => editarSlide(s.id, e.target.value)} className="text-xs" />
              </div>
            );
          })}
          <div className="space-y-1">
            <Label className="text-xs">Texto alternativo (alt)</Label>
            <Textarea value={slide.alt} rows={2} onChange={(e) => editarSlide("alt", e.target.value)} className="text-xs" />
          </div>
          {avisosDaPagina.length > 0 && (
            <ul className="space-y-0.5">
              {avisosDaPagina.map((a, i) => (
                <li key={i} className="text-[11px] text-amber-600 dark:text-amber-400">
                  {a.detalhe}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-3 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold">Legenda</p>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[11px]"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(legendaFinal);
                  toast.success("Legenda copiada.");
                } catch {
                  toast.error("O navegador não deixou copiar. Selecione o texto e copie à mão.");
                }
              }}
            >
              <Copy className="mr-1 h-3 w-3" /> Copiar com hashtags
            </Button>
          </div>
          <Textarea
            value={legenda}
            rows={6}
            onChange={(e) => {
              setLegenda(e.target.value);
              setSujo(true);
            }}
            className="text-xs"
          />
          <div className="space-y-1">
            <Label className="text-xs">Hashtags (sem #, separadas por espaço)</Label>
            <Input
              value={hashtags}
              onChange={(e) => {
                setHashtags(e.target.value);
                setSujo(true);
              }}
              className="h-8 text-xs"
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Identificação: {post.identificacao.linha}
            {post.identificacao.naArte ? " — na arte" : ""}
            {post.identificacao.naLegenda ? " — na legenda" : ""}
            {!post.identificacao.naArte && !post.identificacao.naLegenda ? " — não incluída (a bio cumpre a regra)" : ""}
          </p>
        </div>

        <div className="flex justify-end">
          <Button size="sm" disabled={!sujo || salvando} onClick={salvar}>
            {salvando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
            Salvar ajustes
          </Button>
        </div>
      </div>
    </div>
  );
}
