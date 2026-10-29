import { useMemo, useState } from "react";
import { AlertTriangle, FlaskConical, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePesquisarTermos, useProbeTerms } from "@/hooks/useAdSpy";
import {
  compactNumber,
  MAX_PROBE_CALLS,
  PROBE_SOURCES,
  type ProbeResult,
  type SpySettings,
  type SpySourceId,
  type TermoSugerido,
} from "@/lib/adSpyApi";

const ORGANICAS = new Set<string>(PROBE_SOURCES.filter((f) => f.organico).map((f) => f.id));

/** Espelha MAX_PROBE_TERMS do worker. O worker é quem impõe; aqui é só a UI. */
const MAX_TERMOS = 5;

/** Vírgula ou quebra de linha, porque as duas são jeitos naturais de listar. */
function parseTermos(raw: string): string[] {
  const lista = raw
    .split(/[\n,;]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);
  return [...new Set(lista)].slice(0, MAX_TERMOS);
}

function Placar({ r, onUsar }: { r: ProbeResult; onUsar: () => void }) {
  const organica = ORGANICAS.has(r.fonte ?? "");
  const termo = (
    <td className="py-2 pr-2 font-medium">
      {r.termo}
      {r.consulta && <div className="text-[11px] font-normal text-muted-foreground">{r.consulta}</div>}
    </td>
  );
  if (r.erro) {
    return (
      <tr className="border-t border-border">
        {termo}
        <td colSpan={4} className="py-2 text-destructive">
          {r.erro}
        </td>
      </tr>
    );
  }

  // O motivo que mais reprovou é o que indica qual filtro relaxar.
  const principal = Object.entries(r.motivos).sort((a, b) => b[1] - a[1])[0];

  return (
    <tr className="border-t border-border">
      {termo}
      <td className="py-2 pr-2 tabular-nums">
        <span className={r.passaram ? "font-semibold text-foreground" : "text-muted-foreground"}>
          {r.passaram}
        </span>
        <span className="text-muted-foreground"> de {r.retornados}</span>
        {principal && r.passaram < r.retornados && (
          <div className="text-[11px] text-muted-foreground">
            maioria caiu por: {principal[0]}
          </div>
        )}
      </td>
      <td className="py-2 pr-2 tabular-nums">{r.anunciantes}</td>
      <td className="py-2 pr-2 tabular-nums">
        {organica ? (compactNumber(r.medianaViews) ?? "—") : (r.medianaDias ?? "—")}
      </td>
      <td className="py-2 text-right">
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onUsar}>
          Usar
        </Button>
      </td>
    </tr>
  );
}

/**
 * Etapa opcional: testar palavras-chave antes de gastar o orçamento.
 *
 * A Biblioteca de Anúncios casa o termo com o TEXTO do anúncio, não com intenção de busca — um
 * termo que soa perfeito costuma voltar vazio porque anunciante nenhum escreve aquilo na copy.
 * Descobrir isso com a busca cheia custa (N/4)*10 créditos; aqui custa 1 por termo.
 *
 * O placar usa os MESMOS filtros da busca, então "passaram" é literalmente o que a busca traria
 * daquela página.
 */
const SELO: Record<TermoSugerido["confianca"], { texto: string; classe: string }> = {
  visto: { texto: "visto em anúncio", classe: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  inferido: { texto: "jargão do nicho", classe: "bg-muted text-muted-foreground" },
  palpite: { texto: "palpite", classe: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
};

export function KeywordProbe({
  settings,
  nicho,
  onUsarTermo,
  fontesDaBusca = ["meta"],
}: {
  settings: SpySettings;
  /** O que está no campo de tema — ponto de partida da pesquisa. */
  nicho: string;
  onUsarTermo: (termo: string) => void;
  /** Fontes marcadas no formulário: as que buscam por palavra-chave já vêm marcadas na sonda. */
  fontesDaBusca?: SpySourceId[];
}) {
  const [texto, setTexto] = useState("");
  // Começa com as fontes da busca (a pergunta natural é "este termo rende ONDE vou buscar?"), e a
  // pessoa troca à vontade. Sem nenhuma fonte de palavra-chave marcada, Meta.
  const [fontes, setFontes] = useState<SpySourceId[]>(() => {
    const daBusca = PROBE_SOURCES.map((f) => f.id).filter((id) => fontesDaBusca.includes(id));
    return daBusca.length ? daBusca : ["meta"];
  });
  const toggleFonte = (id: SpySourceId) =>
    setFontes((cur) => (cur.includes(id) ? cur.filter((f) => f !== id) : [...cur, id]));
  const probe = useProbeTerms();
  const pesquisa = usePesquisarTermos();
  const termos = useMemo(() => parseTermos(texto), [texto]);

  const sugerir = () => {
    if (!nicho.trim()) {
      toast.error("Escreva o nicho no campo de tema para o agente pesquisar.");
      return;
    }
    pesquisa.mutate(
      { nicho: nicho.trim() },
      {
        onSuccess: (r) => {
          // Já cai no campo da sonda: sugerir e medir é um fluxo só.
          if (r.termos.length) setTexto(r.termos.map((t) => t.termo).join(", "));
          else toast.message("O agente não devolveu termos — veja o que ele respondeu abaixo.");
        },
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : "Não foi possível pesquisar"),
      },
    );
  };

  // O custo é palavra × fonte: 3 palavras em 2 fontes são 6 páginas, 6 créditos.
  const custo = termos.length * fontes.length;
  const acimaDoTeto = custo > MAX_PROBE_CALLS;

  const testar = () => {
    if (!termos.length || !fontes.length || acimaDoTeto) return;
    probe.mutate(
      { termos, settings, fontes },
      {
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : "Não foi possível testar as palavras"),
      },
    );
  };

  const resultados = probe.data?.resultados;
  // Um bloco por fonte, na ordem em que vieram: compara-se termo com termo DENTRO de uma fonte.
  const grupos = useMemo(() => {
    const m = new Map<string | null, ProbeResult[]>();
    for (const r of resultados ?? []) {
      const k = r.fonte ?? null;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return [...m.entries()].map(([fonte, linhas]) => ({ fonte, linhas }));
  }, [resultados]);

  return (
    <div className="neu-inset space-y-3 rounded-lg p-4">
      <div className="space-y-2">
        <Label htmlFor="spy-sonda" className="flex items-center gap-1.5 text-xs font-medium">
          <FlaskConical className="h-3.5 w-3.5" />
          Testar palavras-chave
        </Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id="spy-sonda"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="transplante capilar, fue, sem raspagem"
            className="min-w-[220px] flex-1"
          />
          <Button
            variant="outline"
            onClick={testar}
            disabled={!termos.length || !fontes.length || acimaDoTeto || probe.isPending}
          >
            {probe.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Testar {termos.length || ""}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Fontes do teste">
          <span className="text-[11px] text-muted-foreground">Testar em:</span>
          {PROBE_SOURCES.map((f) => {
            const ativo = fontes.includes(f.id);
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={ativo}
                onClick={() => toggleFonte(f.id)}
                className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
                  ativo
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Uma página por palavra em cada fonte: {custo} crédito{custo === 1 ? "" : "s"} no total
          (até {MAX_TERMOS} palavras e {MAX_PROBE_CALLS} créditos por teste). Separe por vírgula.
          Mostra quantos passariam nos filtros que você escolheu — sem iniciar busca.
        </p>
        {acimaDoTeto && (
          <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
            {termos.length} palavras × {fontes.length} fontes passa do máximo de {MAX_PROBE_CALLS}{" "}
            créditos por teste. Tire palavras ou fontes.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button variant="ghost" size="sm" onClick={sugerir} disabled={pesquisa.isPending}>
          {pesquisa.isPending ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-1.5 h-4 w-4" />
          )}
          Sugerir palavras-chave
        </Button>
        <span className="text-[11px] text-muted-foreground">
          O agente pesquisa o nicho na web. Não gasta crédito — as sugestões caem no campo acima
          para você testar as que quiser.
        </span>
      </div>

      {pesquisa.data && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          {!pesquisa.data.fontes.web && (
            <p className="flex items-start gap-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              O agente não conseguiu pesquisar na web: trate os termos como palpite e confie no
              placar da sonda, não neles.
            </p>
          )}
          {pesquisa.data.resumoMd && (
            <p className="whitespace-pre-line text-xs text-muted-foreground">
              {pesquisa.data.resumoMd}
            </p>
          )}
          <ul className="space-y-1.5">
            {pesquisa.data.termos.map((t) => (
              <li key={t.termo} className="text-xs">
                <span className="font-medium">{t.termo}</span>
                <span className={`ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium ${SELO[t.confianca].classe}`}>
                  {SELO[t.confianca].texto}
                </span>
                {t.porque && <span className="text-muted-foreground"> — {t.porque}</span>}
                {t.onde && <span className="text-muted-foreground"> ({t.onde})</span>}
              </li>
            ))}
          </ul>
          {pesquisa.data.vocabulario.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Outras expressões do nicho: {pesquisa.data.vocabulario.join(" · ")}
            </p>
          )}
        </div>
      )}

      {grupos.length > 0 && (
        <div className="space-y-3 overflow-x-auto">
          {grupos.map(({ fonte, linhas }) => {
            const info = PROBE_SOURCES.find((f) => f.id === fonte);
            const organica = ORGANICAS.has(fonte ?? "");
            return (
              <div key={fonte ?? "única"}>
                {info && grupos.length > 1 && (
                  <p className="pb-1 text-xs font-semibold">{info.label}</p>
                )}
                <table className="w-full text-left text-xs">
                  <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="pb-1 pr-2 font-medium">Palavra</th>
                      <th className="pb-1 pr-2 font-medium">Passam nos filtros</th>
                      <th className="pb-1 pr-2 font-medium">{organica ? "Perfis" : "Anunciantes"}</th>
                      <th className="pb-1 pr-2 font-medium">
                        {organica ? "Visualizações (mediana)" : "Dias (mediana)"}
                      </th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((r) => (
                      <Placar key={`${fonte}-${r.termo}`} r={r} onUsar={() => onUsarTermo(r.termo)} />
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
          {probe.data && (
            <p className="pt-2 text-[11px] text-muted-foreground">
              {probe.data.creditsUsed} crédito{probe.data.creditsUsed === 1 ? "" : "s"} usado
              {probe.data.creditsUsed === 1 ? "" : "s"} no teste.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
