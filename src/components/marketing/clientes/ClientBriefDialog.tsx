import { AlertTriangle, CalendarRange, Clock, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BrandKitTab } from "@/components/marketing/clientes/BrandKitTab";
import { DocumentosTab } from "@/components/marketing/clientes/DocumentosTab";
import { RelatorioTab } from "@/components/marketing/clientes/RelatorioTab";
import { useSanitizedMarkdown } from "@/hooks/useSanitizedMarkdown";
import type { ClientBrief } from "@/lib/clientBriefsApi";
import type { ClienteCard } from "@/components/marketing/clientes/ClientBriefCard";

const GRAVIDADE: Record<string, string> = {
  alta: "border-destructive/40 bg-destructive/5",
  media: "border-amber-500/40 bg-amber-500/5",
  baixa: "border-border bg-muted/40",
};

type Props = {
  cliente: ClienteCard | null;
  brief?: ClientBrief;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => void;
};

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

function val(v: number | null | undefined, tipo: "money" | "num" | "ratio" = "num") {
  if (!Number.isFinite(v as number)) return "—";
  if (tipo === "money") return BRL.format(v as number);
  if (tipo === "ratio") return (v as number).toFixed(1);
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(v as number);
}

/** dd/mm a partir de YYYY-MM-DD, sem passar por Date (evita o deslocamento de fuso). */
function diaMes(iso: string | null) {
  if (!iso) return "?";
  const [, m, d] = iso.split("-");
  return d && m ? `${d}/${m}` : iso;
}

/**
 * O Contexto Operacional inteiro: como a operação do cliente roda, segundo o ClickUp.
 *
 * **Não fala de número** — quem faz leitura de resultado é o Relatório, com o período escolhido e as
 * metas dele. A grade de métricas abaixo só aparece em linha ANTIGA, gravada quando o resumo ainda
 * analisava uma semana fechada; ela desaparece sozinha conforme os textos são reescritos. É a
 * presença de `metricas.atual` que diz de qual das duas gerações a linha é, e é ela que escolhe o
 * rótulo da semana: "semana analisada" (linha antiga) ou "situação apurada" (linha nova).
 */
export function ClientBriefDialog({ cliente, brief, open, onOpenChange, onRefresh }: Props) {
  const html = useSanitizedMarkdown(brief?.brief_md ?? null);
  if (!cliente) return null;

  const riscos = brief?.brief?.riscos ?? [];
  const m = brief?.metricas?.atual;
  const rodando = brief?.status === "running";
  const atualizado = brief?.atualizado_em
    ? new Date(brief.atualizado_em).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        ALTURA FIXA, e não "até 90vh".
        
        Antes o diálogo crescia conforme o conteúdo chegava: abrir num cliente fazia a caixa saltar
        duas ou três vezes enquanto o resumo, a lista de documentos e o histórico carregavam, e cada
        aba tinha um tamanho diferente — trocar de aba mexia a janela inteira debaixo do cursor. Com
        altura fixa, o que rola é o PAINEL de dentro; a moldura fica parada.

        O teto em `52rem` existe para o diálogo não virar uma faixa de 1800px num monitor grande,
        onde 90vh é muito mais do que qualquer uma das abas precisa.
      */}
      <DialogContent className="flex h-[min(90vh,52rem)] w-[95vw] max-w-3xl flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle className="pr-6 text-base">{cliente.nome}</DialogTitle>
        </DialogHeader>

        <div className="flex shrink-0 flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          {cliente.especialidades.map((e) => (
            <span key={e} className="rounded-md bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
              {e}
            </span>
          ))}
          {[cliente.plano, cliente.squad].filter(Boolean).map((t) => (
            <span key={t as string}>{t}</span>
          ))}
          {brief?.semana_de && (
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 font-medium">
              <CalendarRange className="h-3 w-3" />
              {m ? "semana de " : "situação apurada em "}
              {diaMes(brief.semana_de)} a {diaMes(brief.semana_ate)}
            </span>
          )}
          {atualizado && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              escrito em {atualizado}
            </span>
          )}
        </div>

        {/* Quatro abas, um assunto cada: o Contexto Operacional (ClickUp interpretado pelo agente,
            sem número), o Relatório (números de um período escolhido) e os Documentos (lista crua de
            Docs do ClickUp, sem agente nenhum no caminho). Misturar os assuntos no mesmo texto era o
            que limitava os dois primeiros; a terceira existe porque uma lista de links não é
            diagnóstico e não deveria passar por um LLM. A quarta, Brand kit (27/10/2026), é o que as
            artes estáticas do cliente podem usar — dado que a equipe digita, sem agente. */}
        {/* `min-h-0` nos dois níveis é o que faz a rolagem existir: um item de flex tem
            `min-height: auto` por padrão e se recusa a encolher abaixo do conteúdo, então sem isto
            o painel cresce, empurra o diálogo e a barra de rolagem interna nunca aparece. */}
        <Tabs defaultValue="contexto" className="flex min-h-0 w-full flex-1 flex-col">
          <TabsList className="grid w-full shrink-0 grid-cols-4">
            <TabsTrigger value="contexto" className="text-xs">
              Contexto Operacional
            </TabsTrigger>
            <TabsTrigger value="relatorio" className="text-xs">
              Relatório
            </TabsTrigger>
            <TabsTrigger value="documentos" className="text-xs">
              Documentos
            </TabsTrigger>
            <TabsTrigger value="brand-kit" className="text-xs">
              Brand kit
            </TabsTrigger>
          </TabsList>

          <TabsContent value="brand-kit" className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
            <BrandKitTab cliente={cliente.padrao} />
          </TabsContent>

          <TabsContent value="documentos" className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
            {/* `padrao` é o slug canônico, a mesma chave do resumo e do relatório. */}
            <DocumentosTab cliente={cliente.padrao} />
          </TabsContent>

          <TabsContent value="relatorio" className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
            {/* Monta os hooks de número só quando a aba está aberta — cada período pagina o CRM. */}
            <RelatorioTab cliente={cliente} />
          </TabsContent>

          <TabsContent value="contexto" className="mt-3 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            {rodando && (
              <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> o agente está escrevendo…
              </p>
            )}

            {brief?.status === "error" && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {brief.error}
              </p>
            )}

            {riscos.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Riscos e alertas
                </h4>
                {riscos.map((r) => (
                  <div key={r.titulo} className={`rounded-lg border p-3 ${GRAVIDADE[r.gravidade] ?? GRAVIDADE.baixa}`}>
                    <p className="flex items-center gap-1.5 text-sm font-semibold">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {r.titulo}
                    </p>
                    {r.detalhe && <p className="mt-1 text-xs text-muted-foreground">{r.detalhe}</p>}
                  </div>
                ))}
              </div>
            )}

            {html ? (
              <div
                className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-sm prose-headings:font-semibold"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            ) : (
              !rodando && (
                <p className="text-sm text-muted-foreground">
                  Nenhum resumo escrito ainda para este cliente.
                </p>
              )
            )}

            {m && (
              <div className="rounded-lg border border-border p-3">
                {/* Só em linha do formato antigo. Some quando o texto for reescrito — e o rótulo diz
                    isso, para ninguém achar que a grade "desapareceu" por bug. */}
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Números da semana analisada ({diaMes(brief?.semana_de ?? null)} a{" "}
                  {diaMes(brief?.semana_ate ?? null)}) — texto no formato antigo; a leitura de resultado
                  agora é do Relatório
                </p>
                <dl className="grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
                  {[
                    ["Investido", val(m.investimento, "money")],
                    ["Leads CRM", val(m.leadsCRM)],
                    ["Tráfego", val(m.leadsTrafego)],
                    ["Agendadas", val(m.consultasAgendadas)],
                    ["Faturamento", val(m.faturamentoBruto, "money")],
                    ["ROAS", val(m.roas, "ratio")],
                  ].map(([rotulo, valor]) => (
                    <div key={rotulo}>
                      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{rotulo}</dt>
                      <dd className="text-xs font-semibold tabular-nums">{valor}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {brief?.fontes?.clickup === false && (
              <p className="rounded-lg border border-border p-3 text-[11px] text-muted-foreground">
                Escrito sem acesso ao ClickUp — a situação das frentes pode estar incompleta.
              </p>
            )}

                <div className="flex justify-end">
                  <Button variant="outline" size="sm" onClick={onRefresh} disabled={rodando}>
                    <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${rodando ? "animate-spin" : ""}`} />
                    Atualizar agora
                  </Button>
                </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
