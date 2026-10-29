import * as React from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDown, ArrowUp } from "lucide-react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import {
  detalhar,
  formatarDuracao,
  gruposDaSerie,
  matrizUsuarioTela,
  seriePorDia,
  type EscopoTelas,
  type LinhaDetalhe,
  type UsoDiaRow,
  type UsoUsuario,
} from "@/lib/usage/agregar";
import { screenLabel, sectionLabel, sectionOf } from "@/lib/usage/screens";
import { AZUL_SEQ, EIXO, MAX_SERIES, useCoresUso } from "./cores";
import { nomeUsuario } from "./UsoFiltros";
import { CardUso, Vazio } from "./CardUso";

type Props = {
  rows: UsoDiaRow[];
  dias: string[];
  escopo: EscopoTelas;
  usuarios: Map<string, UsoUsuario>;
};

const diaCurto = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

export function UsoTempo({ rows, dias, escopo, usuarios }: Props) {
  if (!rows.some((r) => r.active_ms > 0)) return <Vazio />;
  return (
    <div className="space-y-4">
      <GraficoPorDia rows={rows} dias={dias} escopo={escopo} />
      <MapaUsuarioTela rows={rows} usuarios={usuarios} />
      <TabelaDetalhe rows={rows} usuarios={usuarios} />
    </div>
  );
}

function GraficoPorDia({ rows, dias, escopo }: { rows: UsoDiaRow[]; dias: string[]; escopo: EscopoTelas }) {
  const { corSecao, corSlot } = useCoresUso();
  // Mais de 8 grupos: os 7 primeiros (ordem fixa do registro) + "Demais".
  const { porTela, grupos, visiveis, serie, temResto } = React.useMemo(() => {
    const { porTela, grupos } = gruposDaSerie(rows, escopo);
    const visiveis = grupos.length > MAX_SERIES ? grupos.slice(0, MAX_SERIES - 1) : grupos;
    const resto = new Set(grupos.slice(visiveis.length).map((g) => g.key));
    let serie = seriePorDia(rows, dias, porTela);
    if (resto.size) {
      serie = serie.map((p) => {
        const out: Record<string, number | string> = { dia: p.dia, _demais: 0 };
        for (const [k, v] of Object.entries(p)) {
          if (k === "dia") continue;
          if (resto.has(k)) out._demais = (out._demais as number) + (v as number);
          else out[k] = v;
        }
        return out;
      });
    }
    return { porTela, grupos, visiveis, serie, temResto: resto.size > 0 };
  }, [rows, dias, escopo]);

  const series = [
    ...visiveis.map((g, i) => ({
      key: g.key,
      nome: porTela ? screenLabel(g.key) : g.label,
      cor: porTela ? corSlot(i) : corSecao(g.key),
    })),
    ...(temResto ? [{ key: "_demais", nome: "Demais telas", cor: corSlot(MAX_SERIES - 1) }] : []),
  ];

  const titulo = porTela ? `Tempo ativo por dia — ${sectionLabel(sectionOf(grupos[0]?.key ?? ""))}, por tela` : "Tempo ativo por dia, por seção";

  return (
    <CardUso titulo={titulo} subtitulo="Minutos com a aba visível, em foco e com interação no último minuto.">
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={serie} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} barCategoryGap="20%">
            <CartesianGrid vertical={false} stroke={EIXO.grade} strokeDasharray="2 4" />
            <XAxis dataKey="dia" tickFormatter={diaCurto} tick={EIXO.tick} tickLine={false} axisLine={false} minTickGap={12} />
            <YAxis tick={EIXO.tick} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => `${Math.round(v)}m`} />
            <Tooltip
              cursor={{ fill: "hsl(var(--muted) / 0.35)" }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const itens = payload.filter((p) => (p.value as number) > 0).reverse();
                const total = itens.reduce((s, p) => s + (p.value as number), 0);
                return (
                  <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
                    <p className="mb-1 font-semibold text-foreground">{diaCurto(String(label))} · {formatarDuracao(total * 60_000)}</p>
                    {itens.map((p) => (
                      <p key={String(p.dataKey)} className="flex items-center gap-2 text-muted-foreground">
                        <span className="inline-block size-2 rounded-sm" style={{ background: p.color }} />
                        <span className="flex-1">{p.name}</span>
                        <span className="tabular-nums text-foreground">{formatarDuracao((p.value as number) * 60_000)}</span>
                      </p>
                    ))}
                  </div>
                );
              }}
            />
            <Legend iconType="square" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
            {series.map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.nome} stackId="t" fill={s.cor} stroke="hsl(var(--card))" strokeWidth={1} maxBarSize={36} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </CardUso>
  );
}

const MAX_LINHAS_MAPA = 30;

function MapaUsuarioTela({ rows, usuarios }: { rows: UsoDiaRow[]; usuarios: Map<string, UsoUsuario> }) {
  const m = React.useMemo(() => matrizUsuarioTela(rows), [rows]);
  const linhas = m.usuarios.slice(0, MAX_LINHAS_MAPA);
  return (
    <CardUso
      titulo="Quem usa o quê"
      subtitulo={`Tempo ativo de cada usuário em cada tela no período. Mais escuro = mais tempo.${m.usuarios.length > MAX_LINHAS_MAPA ? ` Mostrando os ${MAX_LINHAS_MAPA} usuários com mais uso.` : ""}`}
    >
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0.5 text-[11px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-card px-2 text-left font-medium text-muted-foreground">Usuário</th>
              {m.telas.map((t) => (
                <th key={t} className="min-w-[72px] px-1 pb-1 text-center align-bottom font-medium text-muted-foreground">
                  <span className="block text-[9px] uppercase tracking-wide opacity-70">{sectionLabel(sectionOf(t))}</span>
                  {screenLabel(t)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map((u) => (
              <tr key={u}>
                <th scope="row" className="sticky left-0 z-10 max-w-[180px] truncate bg-card px-2 text-left font-normal text-foreground" title={usuarios.get(u)?.email}>
                  {nomeUsuario(usuarios.get(u), u)}
                </th>
                {m.telas.map((t) => {
                  const v = m.valor(u, t);
                  const alfa = v > 0 ? 0.1 + 0.9 * Math.sqrt(v / (m.max || 1)) : 0;
                  return (
                    <td
                      key={t}
                      title={`${usuarios.get(u)?.email ?? u} · ${screenLabel(t, true)}: ${formatarDuracao(v)}`}
                      className={cn("h-7 rounded px-1 text-center tabular-nums", alfa > 0.55 ? "text-white" : "text-foreground", !v && "text-muted-foreground/40")}
                      style={{ background: v ? `rgba(${AZUL_SEQ}, ${alfa})` : "hsl(var(--muted) / 0.25)" }}
                    >
                      {v ? formatarDuracao(v) : "–"}
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

type Coluna = "usuario" | "tela" | "active_ms" | "visits" | "media" | "clicks" | "usuarios" | "ultimoDia";

function TabelaDetalhe({ rows, usuarios }: { rows: UsoDiaRow[]; usuarios: Map<string, UsoUsuario> }) {
  const [visao, setVisao] = React.useState<"agregado" | "usuario">("agregado");
  const [ordem, setOrdem] = React.useState<{ col: Coluna; desc: boolean }>({ col: "active_ms", desc: true });
  const agregado = visao === "agregado";
  const linhas = React.useMemo(() => {
    const base = detalhar(rows, agregado);
    const valor = (l: LinhaDetalhe): number | string => {
      switch (ordem.col) {
        case "usuario":
          return usuarios.get(l.user_id ?? "")?.email ?? "";
        case "tela":
          return screenLabel(l.screen_key, true);
        case "media":
          return l.visits ? l.active_ms / l.visits : 0;
        default:
          return l[ordem.col];
      }
    };
    return [...base].sort((a, b) => {
      const va = valor(a);
      const vb = valor(b);
      const c = typeof va === "number" ? va - (vb as number) : String(va).localeCompare(String(vb), "pt-BR");
      return ordem.desc ? -c : c;
    });
  }, [rows, agregado, ordem, usuarios]);

  const cab = (col: Coluna, rotulo: string, direita = false) => (
    <th className={cn("px-2 py-2 font-medium text-muted-foreground", direita ? "text-right" : "text-left")}>
      <button
        type="button"
        className="inline-flex items-center gap-1 hover:text-foreground"
        onClick={() => setOrdem((o) => ({ col, desc: o.col === col ? !o.desc : true }))}
      >
        {rotulo}
        {ordem.col === col && (ordem.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
      </button>
    </th>
  );

  return (
    <CardUso
      titulo="Detalhamento"
      acao={
        <ToggleGroup type="single" value={visao} onValueChange={(v) => v && setVisao(v as typeof visao)} className="neu-inset rounded-md p-0.5">
          <ToggleGroupItem value="agregado" className="h-7 px-2.5 text-xs">Agregado</ToggleGroupItem>
          <ToggleGroupItem value="usuario" className="h-7 px-2.5 text-xs">Por usuário</ToggleGroupItem>
        </ToggleGroup>
      }
    >
      <div className="max-h-[480px] overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card">
            <tr className="border-b border-border">
              {!agregado && cab("usuario", "Usuário")}
              {cab("tela", "Tela")}
              {cab("active_ms", "Tempo ativo", true)}
              {cab("visits", "Visitas", true)}
              {cab("media", "Média/visita", true)}
              {cab("clicks", "Cliques", true)}
              {agregado && cab("usuarios", "Usuários", true)}
              {cab("ultimoDia", "Último uso", true)}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={`${l.user_id}|${l.screen_key}`} className="border-b border-border/40 hover:bg-muted/30">
                {!agregado && (
                  <td className="max-w-[220px] truncate px-2 py-1.5" title={usuarios.get(l.user_id ?? "")?.email}>
                    {nomeUsuario(usuarios.get(l.user_id ?? ""), l.user_id ?? "")}
                  </td>
                )}
                <td className="px-2 py-1.5">
                  <span className="text-muted-foreground">{sectionLabel(sectionOf(l.screen_key))} › </span>
                  {screenLabel(l.screen_key)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatarDuracao(l.active_ms)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{l.visits.toLocaleString("pt-BR")}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{l.visits ? formatarDuracao(l.active_ms / l.visits) : "–"}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{l.clicks.toLocaleString("pt-BR")}</td>
                {agregado && <td className="px-2 py-1.5 text-right tabular-nums">{l.usuarios}</td>}
                <td className="px-2 py-1.5 text-right tabular-nums">{diaCurto(l.ultimoDia)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CardUso>
  );
}
