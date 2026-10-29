import * as React from "react";
import { MousePointerClick, MonitorSmartphone } from "lucide-react";

import { SearchableSelect } from "@/components/ui/searchable-select";
import { useUsoSessao } from "@/hooks/useUso";
import { formatarDuracao, type UsoDiaRow, type UsoUsuario } from "@/lib/usage/agregar";
import { screenLabel, sectionOf } from "@/lib/usage/screens";
import { CardUso, Vazio } from "./CardUso";
import { useCoresUso } from "./cores";

const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const diaLongo = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;

type Evento =
  | { tipo: "tela"; ts: string; screen_key: string; active_ms: number; fim: string }
  | { tipo: "clique"; ts: string; screen_key: string; label: string };

/**
 * Linha do tempo de UM usuário em UM dia: as telas abertas (com tempo ativo) e os botões
 * clicados, na ordem em que aconteceram, separados por sessão.
 */
export function UsoSessoes({ rows, usuarios, preSelecionado }: { rows: UsoDiaRow[]; usuarios: UsoUsuario[]; preSelecionado: string | null }) {
  const { corSecao } = useCoresUso();
  const comUso = React.useMemo(() => {
    const ids = new Set(rows.filter((r) => r.active_ms > 0).map((r) => r.user_id));
    return usuarios.filter((u) => ids.has(u.id));
  }, [rows, usuarios]);
  const [userId, setUserId] = React.useState<string | null>(preSelecionado);
  const efetivo = userId && comUso.some((u) => u.id === userId) ? userId : comUso[0]?.id ?? null;

  const diasDoUsuario = React.useMemo(
    () => [...new Set(rows.filter((r) => r.user_id === efetivo && r.active_ms > 0).map((r) => r.dia))].sort().reverse(),
    [rows, efetivo],
  );
  const [dia, setDia] = React.useState<string | null>(null);
  const diaEfetivo = dia && diasDoUsuario.includes(dia) ? dia : diasDoUsuario[0] ?? null;

  const { data, isLoading, error } = useUsoSessao(efetivo, diaEfetivo);

  const sessoes = React.useMemo(() => {
    if (!data) return [];
    const porSessao = new Map<string, Evento[]>();
    const add = (sid: string, e: Evento) => {
      if (!porSessao.has(sid)) porSessao.set(sid, []);
      porSessao.get(sid)!.push(e);
    };
    for (const v of data.visitas) add(v.session_id, { tipo: "tela", ts: v.started_at, screen_key: v.screen_key, active_ms: v.active_ms, fim: v.ended_at });
    for (const c of data.cliques) add(c.session_id, { tipo: "clique", ts: c.ts, screen_key: c.screen_key, label: c.label || c.target_key });
    return [...porSessao.entries()]
      .map(([id, eventos]) => {
        eventos.sort((a, b) => a.ts.localeCompare(b.ts) || (a.tipo === "tela" ? -1 : 1));
        const telas = eventos.filter((e): e is Extract<Evento, { tipo: "tela" }> => e.tipo === "tela");
        return {
          id,
          inicio: eventos[0]?.ts ?? "",
          fim: telas.reduce((m, t) => (t.fim > m ? t.fim : m), eventos[eventos.length - 1]?.ts ?? ""),
          ativo: telas.reduce((s, t) => s + t.active_ms, 0),
          cliques: eventos.length - telas.length,
          eventos,
        };
      })
      .sort((a, b) => a.inicio.localeCompare(b.inicio));
  }, [data]);

  if (!comUso.length) return <Vazio />;

  return (
    <CardUso
      titulo="Sessões de um usuário"
      subtitulo="A ordem exata das telas abertas e dos botões clicados num dia. Sessão nova após 30 min sem interação."
      acao={
        <div className="flex flex-wrap gap-2">
          <SearchableSelect
            value={efetivo ?? ""}
            onValueChange={setUserId}
            options={comUso.map((u) => ({ value: u.id, label: u.email }))}
            allOption={null}
            placeholder="Usuário"
            triggerClassName="h-8 w-60 text-xs"
          />
          <SearchableSelect
            value={diaEfetivo ?? ""}
            onValueChange={setDia}
            options={diasDoUsuario.map((d) => ({ value: d, label: diaLongo(d) }))}
            allOption={null}
            placeholder="Dia"
            triggerClassName="h-8 w-36 text-xs"
          />
        </div>
      }
    >
      {error ? (
        <p className="text-xs text-destructive">{(error as Error).message}</p>
      ) : isLoading ? (
        <p className="text-xs text-muted-foreground">Carregando…</p>
      ) : !sessoes.length ? (
        <p className="text-xs text-muted-foreground">Nenhum evento neste dia (ou os eventos brutos já passaram dos 90 dias de retenção).</p>
      ) : (
        <div className="space-y-4">
          {sessoes.map((s, i) => (
            <div key={s.id} className="rounded-lg border border-border/50 p-3">
              <p className="mb-2 text-xs font-semibold text-foreground">
                Sessão {i + 1} · {hora(s.inicio)}–{hora(s.fim)}
                <span className="ml-2 font-normal text-muted-foreground">
                  {formatarDuracao(s.ativo)} ativos · {s.cliques} cliques
                </span>
              </p>
              <ol className="relative ml-2 space-y-1 border-l border-border/60 pl-4 text-xs">
                {s.eventos.map((e, j) =>
                  e.tipo === "tela" ? (
                    <li key={j} className="relative pt-1">
                      <span
                        className="absolute -left-[21px] top-1.5 inline-block size-2.5 rounded-full ring-2 ring-card"
                        style={{ background: corSecao(sectionOf(e.screen_key)) }}
                      />
                      <span className="tabular-nums text-muted-foreground">{hora(e.ts)}</span>{" "}
                      <MonitorSmartphone className="mx-1 inline size-3.5 text-muted-foreground" aria-hidden="true" />
                      <strong className="font-semibold">{screenLabel(e.screen_key, true)}</strong>
                      <span className="ml-2 text-muted-foreground">{formatarDuracao(e.active_ms)} ativos</span>
                    </li>
                  ) : (
                    <li key={j} className="pl-3 text-muted-foreground">
                      <span className="tabular-nums">{hora(e.ts)}</span>{" "}
                      <MousePointerClick className="mx-1 inline size-3" aria-hidden="true" />
                      <span className="text-foreground">{e.label}</span>
                    </li>
                  ),
                )}
              </ol>
            </div>
          ))}
        </div>
      )}
    </CardUso>
  );
}
