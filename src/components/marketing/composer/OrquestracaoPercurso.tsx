import { AlertTriangle, Check, Loader2, Minus, UserRound } from "lucide-react";
import { useSanitizedMarkdown } from "@/hooks/useSanitizedMarkdown";
import {
  foiCancelada,
  type EtapaOrquestracao,
  type InsumoEscolhido,
  type NumerosSemana,
  type Orquestracao,
} from "@/lib/orquestradorApi";

/**
 * O percurso de uma orquestração: o que o orquestrador leu, decidiu e perguntou.
 *
 * Existe porque ninguém aprova as escolhas dele antes de virarem anúncio. Sem esta tela o piloto
 * automático entregaria anúncios que só dá para aceitar; com ela dá para discordar da abordagem, da
 * análise escolhida ou de um relatório que entrou — e refazer à mão em Nova Composição.
 */

function IconeEtapa({ status }: { status: EtapaOrquestracao["status"] }) {
  if (status === "running") return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
  if (status === "aguardando") return <UserRound className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />;
  if (status === "done") return <Check className="h-3.5 w-3.5 text-primary" />;
  if (status === "error") return <AlertTriangle className="h-3.5 w-3.5 text-destructive" />;
  if (status === "skipped") return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
  return <span className="h-3.5 w-3.5 rounded-full border border-border" />;
}

/** As etapas, todas visíveis desde o começo: o que falta é informação, não surpresa. */
export function EtapasOrquestracao({ etapas }: { etapas: EtapaOrquestracao[] }) {
  return (
    <ol className="space-y-1.5">
      {etapas.map((e) => (
        <li
          key={e.key}
          className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${
            e.status === "running" ? "border-primary bg-primary/5" : "border-border bg-card"
          }`}
        >
          <span className="mt-0.5 shrink-0">
            <IconeEtapa status={e.status} />
          </span>
          <div className="min-w-0">
            <p
              className={`text-xs font-semibold ${
                e.status === "pending" ? "text-muted-foreground" : ""
              }`}
            >
              {e.label}
            </p>
            {e.note && (
              <p
                className={`mt-0.5 text-[11px] leading-snug ${
                  e.status === "error" ? "text-destructive" : "text-muted-foreground"
                }`}
              >
                {e.note}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const NUM = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
// Ausente é travessão, nunca zero — a mesma regra dos prompts.
const dinheiro = (v?: number | null) => (typeof v === "number" && Number.isFinite(v) ? BRL.format(v) : "—");
const contagem = (v?: number | null) => (typeof v === "number" && Number.isFinite(v) ? NUM.format(v) : "—");
const razao = (v?: number | null) =>
  typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(2).replace(".", ",")}x` : "—";

const LINHAS: [keyof NumerosSemana, string, (v?: number | null) => string][] = [
  ["investimento", "Investimento", dinheiro],
  ["leadsTrafego", "Leads no tráfego", contagem],
  ["leadsCRM", "Leads no CRM", contagem],
  ["consultasAgendadas", "Consultas agendadas", contagem],
  ["faturamentoBruto", "Faturamento bruto", dinheiro],
  ["roas", "ROAS", razao],
];

function Numeros({ orquestracao }: { orquestracao: Orquestracao }) {
  const atual = orquestracao.metricas?.atual;
  if (!atual) return null;
  const anterior = orquestracao.metricas?.anterior;
  return (
    <section className="space-y-1.5">
      <h3 className="text-xs font-semibold">
        Os números que ele leu
        {orquestracao.semana_de && (
          <span className="ml-1.5 font-normal text-muted-foreground">
            semana de {orquestracao.semana_de} a {orquestracao.semana_ate}
          </span>
        )}
      </h3>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[11px] text-muted-foreground">
            <th className="py-1 font-medium">Métrica</th>
            <th className="py-1 text-right font-medium">Semana</th>
            <th className="py-1 text-right font-medium">Anterior</th>
          </tr>
        </thead>
        <tbody>
          {LINHAS.map(([chave, rotulo, fmt]) => (
            <tr key={chave} className="border-t border-border">
              <td className="py-1">{rotulo}</td>
              <td className="py-1 text-right tabular-nums">{fmt(atual[chave])}</td>
              <td className="py-1 text-right tabular-nums text-muted-foreground">
                {fmt(anterior?.[chave])}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Escolhidos({ titulo, itens }: { titulo: string; itens: InsumoEscolhido[] }) {
  if (!itens.length) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {titulo}
      </p>
      <ul className="mt-1 space-y-1">
        {itens.map((i) => (
          <li key={i.id} className="text-xs">
            <span className="font-medium">{i.titulo || i.id}</span>
            {i.motivo && <span className="text-muted-foreground"> — {i.motivo}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function OrquestracaoPercurso({ orquestracao }: { orquestracao: Orquestracao }) {
  const html = useSanitizedMarkdown(orquestracao.diagnostico_md);
  const d = orquestracao.decisoes ?? {};
  const perguntas = orquestracao.perguntas ?? [];

  return (
    <div className="space-y-5">
      {foiCancelada(orquestracao) ? (
        // Parar foi uma decisão de quem disparou, não uma falha: sem vermelho.
        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-sm text-muted-foreground">
            Cancelada. O que já estava pronto continua salvo.
          </p>
        </div>
      ) : orquestracao.status === "error" ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-sm text-destructive">
            {orquestracao.error || "A orquestração falhou."}
          </p>
        </div>
      ) : null}

      <EtapasOrquestracao etapas={orquestracao.etapas ?? []} />

      <Numeros orquestracao={orquestracao} />

      {html && (
        <section className="space-y-1.5">
          <h3 className="text-xs font-semibold">Diagnóstico</h3>
          <div
            className="prose prose-sm max-w-none dark:prose-invert [&_p]:text-[13px] [&_p]:leading-relaxed"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </section>
      )}

      {(d.abordagem || d.analise || d.relatorios?.length || d.documentos?.length) && (
        <section className="space-y-3">
          <h3 className="text-xs font-semibold">O que ele decidiu</h3>
          {d.abordagem && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">
                Abordagem
              </p>
              <p className="mt-0.5 text-[13px] leading-snug">{d.abordagem}</p>
            </div>
          )}
          {d.analise && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Análise de concorrentes
              </p>
              <p className="mt-1 text-xs">
                <span className="font-medium">
                  {d.analise.id
                    ? `${d.analise.nova ? "Nova, minerada agora" : "Da Biblioteca"}: ${d.analise.titulo ?? d.analise.id}`
                    : d.mineracao
                      ? `Pediu uma mineração de “${d.mineracao.nicho}”`
                      : "Nenhuma"}
                </span>
                {d.analise.motivo && (
                  <span className="text-muted-foreground"> — {d.analise.motivo}</span>
                )}
              </p>
            </div>
          )}
          <Escolhidos titulo="Relatórios" itens={d.relatorios ?? []} />
          <Escolhidos titulo="Documentos" itens={d.documentos ?? []} />
          <Escolhidos
            titulo="Análises de criativo"
            itens={(d.criativos ?? []).map((c) => ({ ...c, motivo: null }))}
          />
          {d.contexto_operacional === false && (
            <p className="text-xs text-muted-foreground">Sem o Contexto Operacional.</p>
          )}
        </section>
      )}

      {perguntas.length > 0 && (
        <section className="space-y-1.5">
          <h3 className="text-xs font-semibold">O que ele perguntou aos outros bots</h3>
          <ul className="space-y-1.5">
            {perguntas.map((p, i) => (
              <li key={`${p.em}-${i}`} className="rounded-lg border border-border bg-card">
                <details>
                  <summary className="cursor-pointer px-3 py-2 text-xs">
                    <span className="font-semibold">{p.para}</span>
                    <span className="text-muted-foreground"> · {p.assunto}</span>
                    {p.erro && <span className="ml-1.5 text-destructive">falhou</span>}
                    {!p.erro && !p.resposta && (
                      <Loader2 className="ml-1.5 inline h-3 w-3 animate-spin text-muted-foreground" />
                    )}
                  </summary>
                  <div className="space-y-2 border-t border-border px-3 py-2">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Pergunta
                      </p>
                      <p className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed">{p.pergunta}</p>
                    </div>
                    {(p.resposta || p.erro) && (
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {p.erro ? "Erro" : "Resposta"}
                        </p>
                        <p
                          className={`mt-0.5 whitespace-pre-wrap text-xs leading-relaxed ${
                            p.erro ? "text-destructive" : ""
                          }`}
                        >
                          {p.erro || p.resposta}
                        </p>
                      </div>
                    )}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
