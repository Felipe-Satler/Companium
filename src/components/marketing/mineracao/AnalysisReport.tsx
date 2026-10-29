import { useState } from "react";
import {
  Anchor,
  ChevronDown,
  FileText,
  Target,
  Hash,
  Lightbulb,
  LayoutTemplate,
  Quote,
  ThumbsUp,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useSanitizedMarkdown } from "@/hooks/useSanitizedMarkdown";
import type { SpyAnalysis, SpyPublico } from "@/lib/adSpyApi";
import {
  SECOES_SO_DE_ANUNCIO,
  semDissecacao,
  semSecoes,
} from "@/components/marketing/mineracao/relatorioTexto";

function SectionCard({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Hash;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="neu-inset rounded-lg p-4">
      <h4 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </h4>
      {children}
    </div>
  );
}

/** Small chip listing the ads a claim is based on. */
function AdRefs({ ids }: { ids?: number[] }) {
  if (!ids?.length) return null;
  return (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
      {ids.map((n) => (
        <span
          key={n}
          className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-primary"
        >
          #{n}
        </span>
      ))}
    </span>
  );
}

/** As fatias de público, na ordem em que o agente as recomendou. */
function Publicos({ fatias }: { fatias: SpyPublico[] }) {
  return (
    <SectionCard icon={Target} title="Fatias de público">
      <ul className="space-y-3">
        {fatias.map((p, i) => (
          <li key={i}>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-sm font-medium">{p.fatia}</span>
              {p.demanda && (
                // Demanda imediata é onde se segmenta primeiro — merece destaque, não um rótulo
                // igual ao das outras.
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    p.demanda === "imediata"
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  demanda {p.demanda}
                </span>
              )}
              <AdRefs ids={p.exemplos} />
            </div>
            {p.por_que_segmentar && (
              <p className="mt-0.5 text-xs text-muted-foreground">{p.por_que_segmentar}</p>
            )}
            {p.evidencia && (
              <p className="mt-0.5 text-[11px] text-muted-foreground/80">{p.evidencia}</p>
            )}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

/** Se há algum painel para desenhar. O pai também precisa saber: sem painel, o texto é tudo. */
function temPaineis(analysis: SpyAnalysis | null): boolean {
  if (!analysis) return false;
  const { temas, palavras, hooks, formatos, o_que_funciona, sugestoes, publicos } = analysis;
  return Boolean(
    publicos?.length ||
      temas?.length ||
      palavras?.length ||
      hooks?.length ||
      formatos?.length ||
      o_que_funciona?.length ||
      sugestoes?.length,
  );
}

function StructuredPanels({ analysis }: { analysis: SpyAnalysis }) {
  const { temas, palavras, hooks, formatos, o_que_funciona, sugestoes, publicos } = analysis;
  if (!temPaineis(analysis)) return null;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {!!publicos?.length && <Publicos fatias={publicos} />}
      {!!temas?.length && (
        <SectionCard icon={Hash} title="Temas recorrentes">
          <ul className="space-y-2.5">
            {temas.map((t, i) => (
              <li key={i}>
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium">{t.nome}</span>
                  {typeof t.frequencia === "number" && (
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {t.frequencia}×
                    </span>
                  )}
                  <AdRefs ids={t.exemplos} />
                </div>
                {t.porque_funciona && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{t.porque_funciona}</p>
                )}
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {!!palavras?.length && (
        <SectionCard icon={Quote} title="Palavras fortes">
          <div className="flex flex-wrap gap-1.5">
            {palavras.map((p, i) => (
              <span
                key={i}
                title={p.contexto || undefined}
                className="rounded-md border border-border px-2 py-1 text-xs"
              >
                {p.termo}
                {typeof p.ocorrencias === "number" && (
                  <span className="ml-1 tabular-nums text-muted-foreground">
                    {p.ocorrencias}
                  </span>
                )}
              </span>
            ))}
          </div>
        </SectionCard>
      )}

      {!!hooks?.length && (
        <SectionCard icon={Anchor} title="Ganchos">
          <ul className="space-y-2">
            {hooks.map((h, i) => (
              <li key={i} className="text-xs">
                <span className="italic">“{h.texto}”</span>
                {h.tipo && (
                  <span className="ml-1 text-muted-foreground">({h.tipo})</span>
                )}
                <AdRefs ids={h.ad_id ? [h.ad_id] : undefined} />
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {!!formatos?.length && (
        <SectionCard icon={LayoutTemplate} title="Formatos">
          <ul className="space-y-2">
            {formatos.map((f, i) => (
              <li key={i}>
                <span className="text-sm font-medium">{f.padrao}</span>
                {f.evidencia && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{f.evidencia}</p>
                )}
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {!!o_que_funciona?.length && (
        <SectionCard icon={ThumbsUp} title="O que parece funcionar">
          <ul className="list-inside list-disc space-y-1 text-xs">
            {o_que_funciona.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </SectionCard>
      )}

      {!!sugestoes?.length && (
        <SectionCard icon={Lightbulb} title="Sugestões">
          <ul className="space-y-2.5">
            {sugestoes.map((s, i) => (
              <li key={i}>
                <div className="flex items-baseline gap-1">
                  <span className="text-sm font-medium">{s.titulo}</span>
                  <AdRefs ids={s.baseado_em} />
                </div>
                {s.detalhe && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{s.detalhe}</p>
                )}
              </li>
            ))}
          </ul>
        </SectionCard>
        )}
      </div>
    </div>
  );
}

type Props = {
  analysisMd: string | null;
  analysis: SpyAnalysis | null;
  /** Botões no cabeçalho (Salvar na Biblioteca, Refazer análise…). */
  actions?: React.ReactNode;
  /**
   * Análise de conteúdo orgânico: sem fatias de público, "o que parece funcionar" e sugestões, que
   * são leituras de anúncio. Vale também para análises antigas que ainda as tenham.
   */
  organico?: boolean;
};

/** Usado tanto na Mineração (análise recém-feita) quanto na Biblioteca (análise salva). */
export function AnalysisReport({ analysisMd, analysis: bruta, actions, organico = false }: Props) {
  const analysis =
    organico && bruta ? { ...bruta, publicos: [], o_que_funciona: [], sugestoes: [] } : bruta;
  const texto = semDissecacao(analysisMd);
  const html = useSanitizedMarkdown(organico ? semSecoes(texto, SECOES_SO_DE_ANUNCIO) : texto);
  const paineis = temPaineis(analysis);
  // Recolhido quando há painéis: eles são a leitura rápida, e o texto é para quem quer o porquê.
  // Sem painéis, o texto é a análise inteira — esconder deixaria um card vazio.
  const [textoAberto, setTextoAberto] = useState(!paineis);

  if (!analysisMd && !analysis) return null;

  return (
    <div className="neu-card rounded-xl p-5 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Análise</h2>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>

      {analysis && <StructuredPanels analysis={analysis} />}

      {!paineis && analysisMd && (
        <p className="text-xs text-muted-foreground">
          O agente não devolveu o bloco estruturado, então não há painéis — o relatório em texto
          está completo.
        </p>
      )}

      {html && (
        <Collapsible open={textoAberto} onOpenChange={setTextoAberto}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-md px-1 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <span>{textoAberto ? "Ocultar relatório em texto" : "Ler o relatório em texto"}</span>
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${textoAberto ? "rotate-180" : ""}`}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <div
              // `prose` comes from @tailwindcss/typography, already a dependency.
              className="prose prose-sm dark:prose-invert max-w-none prose-headings:font-semibold prose-headings:text-foreground prose-p:text-muted-foreground prose-li:text-muted-foreground prose-strong:text-foreground"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
