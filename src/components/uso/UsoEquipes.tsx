import * as React from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { UsoEquipesDados } from "@/hooks/useEquipes";
import { formatarDuracao, type UsoAgenteRow, type UsoDiaRow, type UsoUsuario } from "@/lib/usage/agregar";
import {
  GRUPO_CLIENTES,
  GRUPO_SEM_EQUIPE,
  compararEquipes,
  compararMembros,
  criarMapaGrupo,
  mediaDe,
  membrosNoPeriodo,
  nomeGrupo,
  porMembro,
  type Equipe,
  type MetricaSomavel,
  type Totais,
} from "@/lib/usage/equipes";
import { USAGE_SECTIONS } from "@/lib/usage/screens";
import { cn } from "@/lib/utils";
import { CardUso, Vazio } from "./CardUso";
import { AZUL_SEQ, EIXO, useCoresUso } from "./cores";
import { nomeUsuario } from "./UsoFiltros";

type Metrica = { key: MetricaSomavel; rotulo: string; tempo: boolean };
const METRICAS: Metrica[] = [
  { key: "active_ms", rotulo: "Tempo ativo nas telas", tempo: true },
  { key: "agente_ms", rotulo: "Tempo nos agentes de IA", tempo: true },
  { key: "perguntas", rotulo: "Perguntas aos agentes de IA", tempo: false },
  { key: "clicks", rotulo: "Cliques", tempo: false },
  { key: "visits", rotulo: "Visitas a telas", tempo: false },
];

const fmt = (v: number, tempo: boolean) =>
  tempo ? formatarDuracao(v) : v.toLocaleString("pt-BR", { maximumFractionDigits: v < 10 ? 1 : 0 });

type Props = {
  diario: UsoDiaRow[];
  agentes: UsoAgenteRow[];
  dados: UsoEquipesDados;
  usuarios: UsoUsuario[];
  dias: string[];
  escopoUsuarios: string[] | null;
};

/**
 * Comparação de uso entre equipes (médias POR MEMBRO, porque as equipes têm tamanhos diferentes)
 * e entre os membros de uma equipe (com a média da equipe como referência). Cada dia de uso
 * conta para a equipe em que a pessoa estava naquele dia.
 */
export function UsoEquipes({ diario, agentes, dados, usuarios, dias, escopoUsuarios }: Props) {
  const porId = React.useMemo(() => new Map(usuarios.map((u) => [u.id, u])), [usuarios]);
  const equipes = React.useMemo(() => new Map(dados.equipes.map((e) => [e.id, e])), [dados.equipes]);
  const grupoDe = React.useMemo(() => criarMapaGrupo(dados.membros, porId), [dados.membros, porId]);
  const membros = React.useMemo(
    () => membrosNoPeriodo(usuarios, dias, grupoDe, escopoUsuarios),
    [usuarios, dias, grupoDe, escopoUsuarios],
  );
  const grupos = React.useMemo(() => compararEquipes(diario, agentes, grupoDe, membros), [diario, agentes, grupoDe, membros]);

  const [modo, setModo] = React.useState<"entre" | "dentro">("entre");
  const [metrica, setMetrica] = React.useState<MetricaSomavel>("active_ms");
  const equipesComMembro = grupos.filter((g) => g.grupo !== GRUPO_CLIENTES && g.membros > 0);
  const [equipeSel, setEquipeSel] = React.useState<string | null>(null);
  const equipe = equipeSel && equipesComMembro.some((g) => g.grupo === equipeSel) ? equipeSel : equipesComMembro[0]?.grupo ?? null;

  if (!dados.equipes.length) {
    return <Vazio texto="Nenhuma equipe cadastrada. Crie equipes e atribua as pessoas em Administração › Equipes." />;
  }

  const m = METRICAS.find((x) => x.key === metrica)!;

  return (
    <div className="space-y-4">
      <div className="neu-card flex flex-wrap items-center gap-3 p-3">
        <ToggleGroup type="single" value={modo} onValueChange={(v) => v && setModo(v as typeof modo)} className="neu-inset rounded-md p-0.5">
          <ToggleGroupItem value="entre" className="h-7 px-2.5 text-xs">Entre equipes</ToggleGroupItem>
          <ToggleGroupItem value="dentro" className="h-7 px-2.5 text-xs">Dentro de uma equipe</ToggleGroupItem>
        </ToggleGroup>
        {modo === "dentro" && (
          <Select value={equipe ?? ""} onValueChange={setEquipeSel}>
            <SelectTrigger className="h-8 w-52 text-xs" aria-label="Equipe">
              <SelectValue placeholder="Equipe" />
            </SelectTrigger>
            <SelectContent>
              {equipesComMembro.map((g) => (
                <SelectItem key={g.grupo} value={g.grupo} className="text-xs">
                  {nomeGrupo(g.grupo, equipes)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={metrica} onValueChange={(v) => setMetrica(v as MetricaSomavel)}>
          <SelectTrigger className="h-8 w-60 text-xs" aria-label="Métrica do gráfico">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {METRICAS.map((x) => (
              <SelectItem key={x.key} value={x.key} className="text-xs">
                {x.rotulo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="w-full text-[11px] text-muted-foreground">
          Cada dia de uso conta para a equipe em que a pessoa estava naquele dia. O filtro de telas vale para tempo,
          visitas e cliques; não vale para os agentes de IA.
        </p>
      </div>

      {modo === "entre" ? (
        <Entre grupos={grupos} equipes={equipes} metrica={m} />
      ) : equipe ? (
        <Dentro
          equipe={equipe}
          nome={nomeGrupo(equipe, equipes)}
          linhas={compararMembros(equipe, diario, agentes, grupoDe, membros.get(equipe) ?? new Set())}
          usuarios={porId}
          metrica={m}
        />
      ) : (
        <Vazio texto="Nenhuma equipe com membros neste período." />
      )}
    </div>
  );
}

function GraficoBarras({
  dados,
  metrica,
  referencia,
  rotuloReferencia,
}: {
  dados: Array<{ nome: string; valor: number; destaque: boolean }>;
  metrica: Metrica;
  referencia?: number;
  rotuloReferencia?: string;
}) {
  const { corSlot } = useCoresUso();
  const altura = Math.max(160, dados.length * 34 + 40);
  return (
    <div style={{ height: altura }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={dados} layout="vertical" margin={{ top: 8, right: 72, left: 8, bottom: 0 }}>
          <CartesianGrid horizontal={false} stroke={EIXO.grade} strokeDasharray="2 4" />
          <XAxis type="number" hide domain={[0, "dataMax"]} />
          <YAxis type="category" dataKey="nome" width={150} tick={EIXO.tick} tickLine={false} axisLine={false} />
          <Tooltip
            cursor={{ fill: "hsl(var(--muted) / 0.35)" }}
            content={({ active, payload }) => {
              const p = active ? (payload?.[0]?.payload as { nome: string; valor: number } | undefined) : undefined;
              if (!p) return null;
              return (
                <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
                  {p.nome}: <strong className="tabular-nums">{fmt(p.valor, metrica.tempo)}</strong>
                </div>
              );
            }}
          />
          {referencia !== undefined && (
            <ReferenceLine
              x={referencia}
              stroke="hsl(var(--foreground))"
              strokeDasharray="4 3"
              label={{ value: rotuloReferencia, position: "top", fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            />
          )}
          <Bar dataKey="valor" radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false}>
            {dados.map((d) => (
              <Cell key={d.nome} fill={d.destaque ? corSlot(0) : "hsl(var(--muted-foreground) / 0.45)"} />
            ))}
            <LabelList
              dataKey="valor"
              position="right"
              formatter={(v: number) => fmt(v, metrica.tempo)}
              style={{ fontSize: 11, fill: "hsl(var(--foreground))" }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function Entre({ grupos, equipes, metrica }: { grupos: Totais[]; equipes: Map<string, Equipe>; metrica: Metrica }) {
  const visiveis = grupos.filter((g) => g.membros > 0);
  const dadosGrafico = visiveis.map((g) => ({
    nome: nomeGrupo(g.grupo, equipes),
    valor: porMembro(g, metrica.key),
    // Equipes de verdade em cor; "Sem equipe" e "Clientes" em cinza (referência, não competidores).
    destaque: g.grupo !== GRUPO_SEM_EQUIPE && g.grupo !== GRUPO_CLIENTES,
  }));
  return (
    <>
      <CardUso titulo={`${metrica.rotulo} por membro`} subtitulo="Total da equipe dividido pelo número de membros no período (usando ou não).">
        <GraficoBarras dados={dadosGrafico} metrica={metrica} />
      </CardUso>

      <CardUso titulo="Comparativo das equipes">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="px-2 py-2 text-left font-medium">Equipe</th>
                <th className="px-2 py-2 text-right font-medium">Membros</th>
                <th className="px-2 py-2 text-right font-medium" title="Membros com algum uso no período">Ativos</th>
                <th className="px-2 py-2 text-right font-medium">Tempo ativo</th>
                <th className="px-2 py-2 text-right font-medium">Por membro</th>
                <th className="px-2 py-2 text-right font-medium">Cliques/membro</th>
                <th className="px-2 py-2 text-right font-medium">Perguntas IA</th>
                <th className="px-2 py-2 text-right font-medium">Perguntas/membro</th>
                <th className="px-2 py-2 text-right font-medium">Tempo IA/membro</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((g) => (
                <tr key={g.grupo} className={cn("border-b border-border/40", g.grupo.startsWith("_") && "text-muted-foreground")}>
                  <td className="px-2 py-1.5 font-medium">{nomeGrupo(g.grupo, equipes)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{g.membros}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {g.membrosAtivos} <span className="text-muted-foreground">({Math.round((g.membrosAtivos / g.membros) * 100)}%)</span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatarDuracao(g.active_ms)}</td>
                  <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{formatarDuracao(porMembro(g, "active_ms"))}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(porMembro(g, "clicks"), false)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{g.perguntas.toLocaleString("pt-BR")}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(porMembro(g, "perguntas"), false)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatarDuracao(porMembro(g, "agente_ms"))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardUso>

      <MapaSecoes
        titulo="Onde cada equipe passa o tempo"
        linhas={visiveis.map((g) => ({ id: g.grupo, nome: nomeGrupo(g.grupo, equipes), t: g }))}
      />
    </>
  );
}

function Dentro({
  equipe,
  nome,
  linhas,
  usuarios,
  metrica,
}: {
  equipe: string;
  nome: string;
  linhas: Totais[];
  usuarios: Map<string, UsoUsuario>;
  metrica: Metrica;
}) {
  const media = mediaDe(linhas, metrica.key);
  const mediaTempo = mediaDe(linhas, "active_ms");
  const nomeDe = (id: string) => nomeUsuario(usuarios.get(id), id);
  const ordenadas = [...linhas].sort((a, b) => b[metrica.key] - a[metrica.key]);
  return (
    <>
      <CardUso titulo={`${metrica.rotulo} — ${nome}`} subtitulo="Cada membro, só nos dias em que estava nesta equipe. A linha tracejada é a média da equipe.">
        <GraficoBarras
          dados={ordenadas.map((l) => ({ nome: nomeDe(l.grupo), valor: l[metrica.key], destaque: true }))}
          metrica={metrica}
          referencia={media}
          rotuloReferencia={`média ${fmt(media, metrica.tempo)}`}
        />
      </CardUso>

      <CardUso titulo={`Membros — ${nome}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="px-2 py-2 text-left font-medium">Membro</th>
                <th className="px-2 py-2 text-right font-medium">Tempo ativo</th>
                <th className="px-2 py-2 text-right font-medium" title="Diferença para a média de tempo ativo da equipe">vs. média</th>
                <th className="px-2 py-2 text-right font-medium">Visitas</th>
                <th className="px-2 py-2 text-right font-medium">Cliques</th>
                <th className="px-2 py-2 text-right font-medium">Perguntas IA</th>
                <th className="px-2 py-2 text-right font-medium">Tempo IA</th>
              </tr>
            </thead>
            <tbody>
              {ordenadas.map((l) => {
                const dif = mediaTempo ? (l.active_ms - mediaTempo) / mediaTempo : 0;
                return (
                  <tr key={l.grupo} className="border-b border-border/40">
                    <td className="max-w-[220px] truncate px-2 py-1.5 font-medium" title={usuarios.get(l.grupo)?.email}>
                      {nomeDe(l.grupo)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatarDuracao(l.active_ms)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                      {mediaTempo ? `${dif >= 0 ? "+" : "−"}${Math.abs(Math.round(dif * 100))}%` : "–"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{l.visits.toLocaleString("pt-BR")}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{l.clicks.toLocaleString("pt-BR")}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{l.perguntas.toLocaleString("pt-BR")}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatarDuracao(l.agente_ms)}</td>
                  </tr>
                );
              })}
              <tr className="font-semibold">
                <td className="px-2 py-1.5">Média da equipe</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatarDuracao(mediaTempo)}</td>
                <td className="px-2 py-1.5" />
                <td className="px-2 py-1.5 text-right tabular-nums">{fmt(mediaDe(linhas, "visits"), false)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmt(mediaDe(linhas, "clicks"), false)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmt(mediaDe(linhas, "perguntas"), false)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatarDuracao(mediaDe(linhas, "agente_ms"))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </CardUso>

      <MapaSecoes
        titulo={`Onde cada membro passa o tempo — ${nome}`}
        linhas={ordenadas.map((l) => ({ id: `${equipe}|${l.grupo}`, nome: nomeDe(l.grupo), t: l }))}
      />
    </>
  );
}

/** Linha × seção: % do tempo de tela de cada linha em cada seção (compara o perfil, não o volume). */
function MapaSecoes({ titulo, linhas }: { titulo: string; linhas: Array<{ id: string; nome: string; t: Totais }> }) {
  const secoes = USAGE_SECTIONS.filter((s) => linhas.some((l) => (l.t.porSecao[s.key] ?? 0) > 0));
  if (!secoes.length) return null;
  return (
    <CardUso titulo={titulo} subtitulo="Parte do tempo de tela de cada linha gasta em cada seção. Mais escuro = maior parte.">
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0.5 text-[11px]">
          <thead>
            <tr>
              <th />
              {secoes.map((s) => (
                <th key={s.key} className="min-w-[72px] px-1 pb-1 text-center font-medium text-muted-foreground">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.id}>
                <th scope="row" className="max-w-[180px] truncate px-2 text-left font-normal text-foreground">
                  {l.nome}
                </th>
                {secoes.map((s) => {
                  const pct = l.t.active_ms ? (l.t.porSecao[s.key] ?? 0) / l.t.active_ms : 0;
                  const alfa = pct ? 0.1 + 0.9 * pct : 0;
                  return (
                    <td
                      key={s.key}
                      className={cn("h-7 rounded px-1 text-center tabular-nums", alfa > 0.55 ? "text-white" : "text-foreground", !pct && "text-muted-foreground/40")}
                      style={{ background: pct ? `rgba(${AZUL_SEQ}, ${alfa})` : "hsl(var(--muted) / 0.25)" }}
                    >
                      {pct ? `${Math.round(pct * 100)}%` : "–"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CardUso>
  );
}
