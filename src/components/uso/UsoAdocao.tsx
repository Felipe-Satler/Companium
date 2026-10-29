import * as React from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { UsoHorario } from "@/hooks/useUso";
import { adocaoPorTela, ativosPorDia, formatarDuracao, type UsoDiaRow } from "@/lib/usage/agregar";
import { screenLabel, sectionOf } from "@/lib/usage/screens";
import { cn } from "@/lib/utils";
import { CardUso, Vazio } from "./CardUso";
import { AZUL_SEQ, EIXO, useCoresUso } from "./cores";

const DIAS_SEMANA = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const diaCurto = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

export function UsoAdocao({ rows, dias, horarios }: { rows: UsoDiaRow[]; dias: string[]; horarios: UsoHorario[] | undefined }) {
  if (!rows.some((r) => r.active_ms > 0)) return <Vazio />;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Adocao rows={rows} />
        <AtivosPorDia rows={rows} dias={dias} />
      </div>
      <Horarios horarios={horarios} />
    </div>
  );
}

function Adocao({ rows }: { rows: UsoDiaRow[] }) {
  const { corSecao } = useCoresUso();
  const lista = React.useMemo(() => adocaoPorTela(rows), [rows]);
  return (
    <CardUso titulo="Adoção por tela" subtitulo="Dos usuários ativos no período, quantos usaram cada tela. Telas no fim da lista são candidatas a revisão.">
      <ul className="max-h-[360px] space-y-1.5 overflow-auto text-xs">
        {lista.map((t) => (
          <li key={t.screen_key} className="grid grid-cols-[minmax(0,1fr)_minmax(80px,40%)_72px] items-center gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="inline-block size-2 shrink-0 rounded-sm" style={{ background: corSecao(sectionOf(t.screen_key)) }} />
              <span className="truncate">{screenLabel(t.screen_key, true)}</span>
            </span>
            <span className="h-2 rounded-full bg-muted/40">
              <span className="block h-2 rounded-full bg-primary" style={{ width: `${t.pct * 100}%` }} />
            </span>
            <span className="text-right tabular-nums">
              {Math.round(t.pct * 100)}% <span className="text-muted-foreground">({t.usuarios})</span>
            </span>
          </li>
        ))}
      </ul>
    </CardUso>
  );
}

function AtivosPorDia({ rows, dias }: { rows: UsoDiaRow[]; dias: string[] }) {
  const serie = React.useMemo(() => ativosPorDia(rows, dias), [rows, dias]);
  return (
    <CardUso titulo="Usuários ativos por dia" subtitulo="Pessoas com algum tempo ativo no dia.">
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={serie} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={EIXO.grade} strokeDasharray="2 4" />
            <XAxis dataKey="dia" tickFormatter={diaCurto} tick={EIXO.tick} tickLine={false} axisLine={false} minTickGap={12} />
            <YAxis allowDecimals={false} tick={EIXO.tick} tickLine={false} axisLine={false} width={40} />
            <Tooltip
              cursor={{ fill: "hsl(var(--muted) / 0.35)" }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
                    {diaCurto(String(label))}: <strong className="tabular-nums">{String(payload[0].value)}</strong> usuários
                  </div>
                ) : null
              }
            />
            <Bar dataKey="usuarios" name="Usuários ativos" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </CardUso>
  );
}

function Horarios({ horarios }: { horarios: UsoHorario[] | undefined }) {
  const { mapa, max, horas } = React.useMemo(() => {
    const mapa = new Map<string, UsoHorario>();
    let max = 0;
    let min = 23;
    let maxH = 0;
    for (const h of horarios ?? []) {
      mapa.set(`${h.dow}|${h.hora}`, h);
      max = Math.max(max, h.active_ms);
      if (h.active_ms > 0) {
        min = Math.min(min, h.hora);
        maxH = Math.max(maxH, h.hora);
      }
    }
    // Recorta as horas sem uso nas pontas (madrugada), mantendo pelo menos 7h–20h.
    const ini = Math.min(min, 7);
    const fim = Math.max(maxH, 20);
    return { mapa, max, horas: Array.from({ length: fim - ini + 1 }, (_, i) => ini + i) };
  }, [horarios]);

  return (
    <CardUso titulo="Quando o Companium é usado" subtitulo="Tempo ativo por dia da semana e hora (horário de Brasília). Dados dos últimos 90 dias no máximo.">
      {!horarios ? (
        <p className="text-xs text-muted-foreground">Carregando…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="border-separate border-spacing-0.5 text-[10px]">
            <thead>
              <tr>
                <th />
                {horas.map((h) => (
                  <th key={h} className="w-8 font-normal text-muted-foreground">{h}h</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DIAS_SEMANA.map((nome, i) => (
                <tr key={nome}>
                  <th scope="row" className="pr-2 text-right font-normal text-muted-foreground">{nome}</th>
                  {horas.map((h) => {
                    const c = mapa.get(`${i + 1}|${h}`);
                    const v = c?.active_ms ?? 0;
                    const alfa = v ? 0.1 + 0.9 * Math.sqrt(v / (max || 1)) : 0;
                    return (
                      <td
                        key={h}
                        title={`${nome} ${h}h: ${formatarDuracao(v)}${c ? ` · ${c.usuarios} usuário(s)` : ""}`}
                        className={cn("h-6 w-8 rounded-sm")}
                        style={{ background: v ? `rgba(${AZUL_SEQ}, ${alfa})` : "hsl(var(--muted) / 0.25)" }}
                      />
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </CardUso>
  );
}
