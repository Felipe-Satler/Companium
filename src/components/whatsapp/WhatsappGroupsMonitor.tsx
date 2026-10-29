import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Activity,
  RefreshCw,
  Loader2,
  MessagesSquare,
  Users,
  Clock,
  Smile,
  Meh,
  Frown,
  CheckCircle2,
  Hourglass,
  CircleDashed,
  PlayCircle,
  AlertTriangle,
  Flame,
  Thermometer,
  Snowflake,
  TrendingUp,
  Reply,
  Sparkles,
} from "lucide-react";
import {
  useWhatsappInsights,
  type WhatsappSentiment,
  type WhatsappAttendanceStatus,
  type WhatsappLeadTemperature,
  type WhatsappGroupInsight,
} from "@/hooks/useWhatsappInsights";

// Acompanhamento operacional dos grupos do agente de WhatsApp: quadro de retorno (temperatura
// dos leads, quem aguarda resposta, andamento do atendimento), ranking de resultado
// (quem está mais quente/frio e quem dá mais resultado) e histórico de introdução por grupo.
// Dados vêm de `whatsapp_group_insights`, populada pelo job de análise no servidor.

const SENTIMENT_META: Record<
  WhatsappSentiment,
  { label: string; cls: string; Icon: typeof Smile }
> = {
  positivo: {
    label: "Positivo",
    cls: "border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    Icon: Smile,
  },
  neutro: { label: "Neutro", cls: "border-border bg-muted text-muted-foreground", Icon: Meh },
  negativo: {
    label: "Negativo",
    cls: "border-rose-500/40 bg-rose-500/15 text-rose-600 dark:text-rose-400",
    Icon: Frown,
  },
  misto: {
    label: "Misto",
    cls: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-400",
    Icon: Meh,
  },
  sem_dados: {
    label: "Sem dados",
    cls: "border-border bg-muted text-muted-foreground",
    Icon: CircleDashed,
  },
};

const ATTENDANCE_META: Record<
  WhatsappAttendanceStatus,
  { label: string; cls: string; Icon: typeof Hourglass }
> = {
  resolvido: {
    label: "Resolvido",
    cls: "border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    Icon: CheckCircle2,
  },
  em_andamento: {
    label: "Em andamento",
    cls: "border-sky-500/40 bg-sky-500/15 text-sky-600 dark:text-sky-400",
    Icon: PlayCircle,
  },
  aguardando: {
    label: "Aguardando",
    cls: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-400",
    Icon: Hourglass,
  },
  sem_atividade: {
    label: "Sem atividade",
    cls: "border-border bg-muted text-muted-foreground",
    Icon: CircleDashed,
  },
};

const TEMPERATURE_META: Record<
  WhatsappLeadTemperature,
  { label: string; cls: string; Icon: typeof Flame; rank: number }
> = {
  quente: {
    label: "Quente",
    cls: "border-orange-500/40 bg-orange-500/15 text-orange-600 dark:text-orange-400",
    Icon: Flame,
    rank: 3,
  },
  morno: {
    label: "Morno",
    cls: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-400",
    Icon: Thermometer,
    rank: 2,
  },
  frio: {
    label: "Frio",
    cls: "border-sky-500/40 bg-sky-500/15 text-sky-600 dark:text-sky-400",
    Icon: Snowflake,
    rank: 1,
  },
  sem_dados: {
    label: "Sem dados",
    cls: "border-border bg-muted text-muted-foreground",
    Icon: CircleDashed,
    rank: 0,
  },
};

const fmtDateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR") : "—");
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—");

function MetaBadge({ cls, label, Icon }: { cls: string; label: string; Icon: typeof Smile }) {
  return (
    <Badge variant="outline" className={cls}>
      <Icon className="mr-1 h-3 w-3" />
      {label}
    </Badge>
  );
}

function StatTile({
  label,
  value,
  cls,
  Icon,
}: {
  label: string;
  value: number;
  cls: string;
  Icon: typeof Flame;
}) {
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${cls}`}>
      <Icon className="h-4 w-4 shrink-0" />
      <div className="leading-tight">
        <div className="text-lg font-semibold">{value.toLocaleString("pt-BR")}</div>
        <div className="text-[11px] opacity-80">{label}</div>
      </div>
    </div>
  );
}

function ResultMeter({ score }: { score: number | null }) {
  if (score == null) return null;
  const pct = Math.max(0, Math.min(100, score));
  const bar =
    pct >= 66 ? "bg-emerald-500" : pct >= 33 ? "bg-amber-500" : "bg-rose-500";
  return (
    <span className="inline-flex items-center gap-1.5" title="Potencial de resultado (0–100)">
      <TrendingUp className="h-3.5 w-3.5" />
      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
        <span className={`block h-full ${bar}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="tabular-nums">{pct.toLocaleString("pt-BR")}/100</span>
    </span>
  );
}

function GroupCard({ g }: { g: WhatsappGroupInsight }) {
  const s = SENTIMENT_META[g.sentiment] ?? SENTIMENT_META.sem_dados;
  const a = ATTENDANCE_META[g.attendance_status] ?? ATTENDANCE_META.sem_atividade;
  const t = TEMPERATURE_META[g.lead_temperature] ?? TEMPERATURE_META.sem_dados;
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="truncate font-medium text-foreground">{g.group_name || g.group_id}</span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <MetaBadge cls={t.cls} label={t.label} Icon={t.Icon} />
          <MetaBadge cls={a.cls} label={a.label} Icon={a.Icon} />
          <MetaBadge cls={s.cls} label={s.label} Icon={s.Icon} />
          {g.awaiting_reply && (
            <MetaBadge
              cls="border-rose-500/40 bg-rose-500/15 text-rose-600 dark:text-rose-400"
              label="Aguardando nosso retorno"
              Icon={Reply}
            />
          )}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <ResultMeter score={g.result_score} />
        <span className="inline-flex items-center gap-1">
          <MessagesSquare className="h-3.5 w-3.5" />
          {g.message_count.toLocaleString("pt-BR")} mensagens
        </span>
        <span className="inline-flex items-center gap-1" title="Respostas do agente × mensagens do cliente">
          <Reply className="h-3.5 w-3.5" />
          {g.agent_reply_count.toLocaleString("pt-BR")} nossas / {g.client_message_count.toLocaleString("pt-BR")} do cliente
        </span>
        <span className="inline-flex items-center gap-1">
          <Users className="h-3.5 w-3.5" />
          {g.participant_count.toLocaleString("pt-BR")} participantes
        </span>
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" />
          última msg: {fmtDateTime(g.last_message_at)}
        </span>
      </div>

      {(g.first_contact_at || g.intro_summary) && (
        <div className="mt-2 flex items-start gap-2 rounded-md border border-border/60 bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-600 dark:text-sky-400" />
          <span>
            <strong className="text-foreground">Introdução</strong>
            {g.first_contact_at ? ` · ${fmtDate(g.first_contact_at)}` : ""}
            {g.intro_summary ? ` — ${g.intro_summary}` : ""}
          </span>
        </div>
      )}

      {g.summary && <p className="mt-2 text-sm text-foreground">{g.summary}</p>}

      {g.highlights.length > 0 && (
        <ul className="mt-2 space-y-1">
          {g.highlights.map((h, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                {h.tipo ? <strong className="text-foreground">{h.tipo}: </strong> : null}
                {h.texto}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 text-[11px] text-muted-foreground">
        Atualizado em {fmtDateTime(g.updated_at)}
        {g.analyzed_by ? ` · ${g.analyzed_by}` : ""}
      </div>
    </div>
  );
}

export function WhatsappGroupsMonitor() {
  const { insights, loading, error, reload } = useWhatsappInsights();

  // Ranking: mais quente primeiro; empate por maior potencial de resultado; depois atividade.
  const ranked = useMemo(() => {
    const score = (g: WhatsappGroupInsight) =>
      (TEMPERATURE_META[g.lead_temperature]?.rank ?? 0) * 1000 +
      (g.result_score ?? 0) +
      (g.awaiting_reply ? 0.5 : 0);
    return [...insights].sort((a, b) => score(b) - score(a));
  }, [insights]);

  const board = useMemo(() => {
    const b = {
      quente: 0,
      morno: 0,
      frio: 0,
      aguardando_retorno: 0,
      resolvido: 0,
    };
    for (const g of insights) {
      if (g.lead_temperature === "quente") b.quente++;
      else if (g.lead_temperature === "morno") b.morno++;
      else if (g.lead_temperature === "frio") b.frio++;
      if (g.awaiting_reply) b.aguardando_retorno++;
      if (g.attendance_status === "resolvido") b.resolvido++;
    }
    return b;
  }, [insights]);

  return (
    <Card className="space-y-4 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Activity className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        Acompanhamento dos grupos
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-7 w-7"
          onClick={() => void reload()}
          title="Atualizar"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Quadro de retorno dos grupos: temperatura do lead (quente/morno/frio), quem está aguardando
        nosso retorno, potencial de resultado e andamento do atendimento. Ordenado do mais quente
        para o mais frio. Os dados são gerados pelo servidor a partir das conversas dos grupos.
      </p>

      {error ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>
            Não foi possível carregar o acompanhamento ({error}). Verifique se as migrations
            <code className="mx-1 rounded bg-muted px-1">whatsapp_group_insights</code> foram
            aplicadas e se você tem papel de admin.
          </span>
        </div>
      ) : insights.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          Nenhum acompanhamento ainda. Os cartões aparecem aqui depois que o WhatsApp é conectado e o
          serviço de análise roda sobre as conversas dos grupos.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <StatTile label="Quentes" value={board.quente} cls={TEMPERATURE_META.quente.cls} Icon={Flame} />
            <StatTile label="Mornos" value={board.morno} cls={TEMPERATURE_META.morno.cls} Icon={Thermometer} />
            <StatTile label="Frios" value={board.frio} cls={TEMPERATURE_META.frio.cls} Icon={Snowflake} />
            <StatTile
              label="Aguardando retorno"
              value={board.aguardando_retorno}
              cls="border-rose-500/40 bg-rose-500/15 text-rose-600 dark:text-rose-400"
              Icon={Reply}
            />
            <StatTile
              label="Resolvidos"
              value={board.resolvido}
              cls={ATTENDANCE_META.resolvido.cls}
              Icon={CheckCircle2}
            />
          </div>

          <div className="space-y-2">
            {ranked.map((g) => (
              <GroupCard key={g.group_id} g={g} />
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
