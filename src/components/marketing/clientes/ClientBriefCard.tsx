import { Link } from "react-router-dom";
import { AlertTriangle, Clock, Cpu, Loader2, PenLine, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ClientBrief } from "@/lib/clientBriefsApi";

/** Métricas exatas da página Clientes (uma linha de `clientTable`), já recortadas ao essencial. */
export type ResumoMetricas = {
  investimento: number;
  leadsCRM: number;
  consultasAgendadas: number;
  faturamentoBruto: number;
  roas: number;
};

export type ClienteCard = {
  /** `padrao` — a mesma chave com que o worker grava o resumo. */
  padrao: string;
  nome: string;
  especialidades: string[];
  plano: string | null;
  squad: string | null;
  mesesDeCasa: number | null;
};

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});
const NUM = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

/** Sem dado é travessão, nunca zero: "não temos" e "deu zero" contam histórias diferentes. */
function money(v: number | null | undefined) {
  return Number.isFinite(v as number) ? BRL.format(v as number) : "—";
}
function count(v: number | null | undefined) {
  return Number.isFinite(v as number) ? NUM.format(v as number) : "—";
}
function cpl(m?: ResumoMetricas) {
  if (!m || !Number.isFinite(m.investimento) || !m.leadsCRM) return "—";
  return BRL.format(m.investimento / m.leadsCRM);
}

const GRAVIDADE: Record<string, string> = {
  alta: "bg-destructive/10 text-destructive",
  media: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  baixa: "bg-muted text-muted-foreground",
};

function quando(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Primeiro parágrafo da prosa — o suficiente para decidir se vale abrir. */
function primeiroTrecho(md: string | null) {
  if (!md) return null;
  const limpo = md
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n")
    .trim();
  return limpo.split(/\n{2,}/)[0]?.trim() || null;
}

type Props = {
  cliente: ClienteCard;
  brief?: ClientBrief;
  metricas?: ResumoMetricas;
  onOpen: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
};

export function ClientBriefCard({ cliente, brief, metricas, onOpen, onRefresh, isRefreshing }: Props) {
  const rodando = brief?.status === "running" || isRefreshing;
  const riscos = brief?.brief?.riscos ?? [];
  const trecho =
    primeiroTrecho(brief?.brief_md ?? null) ??
    brief?.brief?.contexto_operacional ??
    // Linha do formato antigo, gravada quando o resumo tinha uma seção de contexto separada.
    brief?.brief?.contexto ??
    null;
  const atualizado = quando(brief?.atualizado_em ?? null);

  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md">
      <button type="button" onClick={onOpen} className="flex flex-1 flex-col gap-3 p-4 text-left">
        <div>
          <h3 className="line-clamp-2 text-sm font-semibold">{cliente.nome}</h3>
          <div className="mt-1 flex flex-wrap gap-1">
            {cliente.especialidades.map((e) => (
              <span
                key={e}
                className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary"
              >
                {e}
              </span>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {[
              cliente.plano,
              cliente.squad,
              Number.isFinite(cliente.mesesDeCasa as number)
                ? `${cliente.mesesDeCasa} meses de casa`
                : null,
            ]
              .filter(Boolean)
              .join(" · ") || "sem ficha na planilha"}
          </p>
        </div>

        {/* Números exatos da página Clientes, resumidos. O rótulo não é decoração: estes são os
            últimos 30 dias ao vivo, e o Relatório analisa o período que a pessoa escolher — sem
            dizer o período, dois números diferentes na mesma tela pareceriam um erro. */}
        <p className="-mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          Últimos 30 dias
        </p>
        <dl className="grid grid-cols-3 gap-2 rounded-lg bg-muted/40 p-2 text-center">
          {[
            ["Investido", money(metricas?.investimento)],
            ["Leads", count(metricas?.leadsCRM)],
            ["CPL", cpl(metricas)],
            ["Agendadas", count(metricas?.consultasAgendadas)],
            ["Faturamento", money(metricas?.faturamentoBruto)],
            ["ROAS", Number.isFinite(metricas?.roas as number) ? (metricas as ResumoMetricas).roas.toFixed(1) : "—"],
          ].map(([rotulo, valor]) => (
            <div key={rotulo}>
              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{rotulo}</dt>
              <dd className="text-xs font-semibold tabular-nums">{valor}</dd>
            </div>
          ))}
        </dl>

        {rodando ? (
          <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> escrevendo o resumo…
          </p>
        ) : brief?.status === "error" ? (
          <p className="line-clamp-2 text-xs text-destructive">{brief.error || "Falhou ao gerar."}</p>
        ) : trecho ? (
          <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">{trecho}</p>
        ) : (
          <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" /> sem contexto ainda
          </p>
        )}

        {riscos.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {riscos.slice(0, 3).map((r) => (
              <span
                key={r.titulo}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  GRAVIDADE[r.gravidade] ?? GRAVIDADE.baixa
                }`}
              >
                <AlertTriangle className="h-3 w-3" />
                {r.titulo}
              </span>
            ))}
          </div>
        )}
      </button>

      <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-1.5">
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          {atualizado ? (
            <>
              <Clock className="h-3 w-3" />
              {atualizado}
            </>
          ) : (
            "nunca atualizado"
          )}
        </span>
        <div className="flex items-center gap-1">
          {/* Fora do <button> que abre o detalhe: botão dentro de botão não é HTML válido, e o
              navegador reordena a árvore de um jeito que nenhum dos dois clica direito. */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[11px]"
            asChild
            aria-label={`Compor anúncio para ${cliente.nome}`}
          >
            <Link to={`/marketing/composer?cliente=${encodeURIComponent(cliente.padrao)}`}>
              <PenLine className="mr-1 h-3 w-3" />
              Compor
            </Link>
          </Button>
          {/* O mesmo destino sem as etapas no meio: o orquestrador já abre com este cliente. Só
              ícone, para os três atalhos caberem no rodapé do card. */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px]"
            asChild
            aria-label={`Orquestrar anúncios para ${cliente.nome}`}
            title="Orquestrar: do diagnóstico aos anúncios, sozinho"
          >
            <Link to={`/marketing/orquestrador?cliente=${encodeURIComponent(cliente.padrao)}`}>
              <Cpu className="h-3 w-3" />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[11px]"
            onClick={onRefresh}
            disabled={rodando}
            aria-label={`Atualizar o resumo de ${cliente.nome}`}
          >
            <RefreshCw className={`mr-1 h-3 w-3 ${rodando ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </div>
    </article>
  );
}
