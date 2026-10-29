import * as React from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDown, ArrowUp } from "lucide-react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { UsoAgentes as Dados } from "@/hooks/useUso";
import {
  agregarAgentes,
  formatarDuracao,
  perguntasPorDia,
  totaisAgentes,
  type LinhaAgente,
  type UsoUsuario,
} from "@/lib/usage/agregar";
import { cn } from "@/lib/utils";
import { CardUso, Vazio } from "./CardUso";
import { EIXO, MAX_SERIES, useCoresUso } from "./cores";
import { nomeUsuario } from "./UsoFiltros";

const diaCurto = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
const num = (n: number) => n.toLocaleString("pt-BR");

/**
 * Aba "Agentes de IA": tempo ativo em cada agente do GrooChat, perguntas feitas e textos
 * recebidos. Tempo vem da coleta do navegador; perguntas/respostas, das conversas salvas.
 */
export function UsoAgentes({ dados, dias, usuarios }: { dados: Dados; dias: string[]; usuarios: Map<string, UsoUsuario> }) {
  const nomes = React.useMemo(() => new Map(dados.bots.map((b) => [b.id, b.label])), [dados.bots]);
  const nomeAgente = React.useCallback((id: string) => nomes.get(id) ?? id, [nomes]);
  const rows = dados.linhas;
  const t = React.useMemo(() => totaisAgentes(rows), [rows]);

  if (!rows.some((r) => r.active_ms > 0 || r.perguntas > 0)) {
    return <Vazio texto="Nenhum uso de agente de IA registrado para este filtro." />;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile rotulo="Tempo nos agentes" valor={formatarDuracao(t.active_ms)} />
        <Tile rotulo="Perguntas feitas" valor={num(t.perguntas)} />
        <Tile rotulo="Textos recebidos" valor={num(t.respostas)} />
        <Tile rotulo="Usuários" valor={num(t.usuarios)} />
      </div>
      <PerguntasPorDia dados={dados} dias={dias} nomeAgente={nomeAgente} />
      <Tabela rows={rows} usuarios={usuarios} nomeAgente={nomeAgente} />
      <p className="text-[11px] text-muted-foreground">
        O tempo é medido com o chat aberto e em uso (página Assistente ou chat flutuante) e só existe a partir da
        ativação desta coleta. Perguntas e textos recebidos vêm das conversas salvas e incluem o histórico. O filtro de
        telas não se aplica a esta aba.
      </p>
    </div>
  );
}

function Tile({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="neu-card p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{rotulo}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{valor}</p>
    </div>
  );
}

function PerguntasPorDia({ dados, dias, nomeAgente }: { dados: Dados; dias: string[]; nomeAgente: (id: string) => string }) {
  const { corSlot } = useCoresUso();
  const { serie, series } = React.useMemo(() => {
    // Cor segue o agente (ordem do catálogo, por nome), não a posição. Além de 8, "Demais".
    const comUso = new Set(dados.linhas.filter((r) => r.perguntas > 0).map((r) => r.bot_id));
    const ordem = [...dados.bots.map((b) => b.id), ...[...comUso].filter((id) => !dados.bots.some((b) => b.id === id))];
    const cor = new Map(ordem.map((id, i) => [id, corSlot(i)]));
    const presentes = ordem.filter((id) => comUso.has(id));
    const visiveis = presentes.length > MAX_SERIES ? presentes.slice(0, MAX_SERIES - 1) : presentes;
    const resto = new Set(presentes.slice(visiveis.length));
    let serie = perguntasPorDia(dados.linhas, dias);
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
    const series = [
      ...visiveis.map((id) => ({ key: id, nome: nomeAgente(id), cor: cor.get(id)! })),
      ...(resto.size ? [{ key: "_demais", nome: "Demais agentes", cor: corSlot(MAX_SERIES - 1) }] : []),
    ];
    return { serie, series };
  }, [dados, dias, corSlot, nomeAgente]);

  return (
    <CardUso titulo="Perguntas por dia, por agente">
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={serie} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barCategoryGap="20%">
            <CartesianGrid vertical={false} stroke={EIXO.grade} strokeDasharray="2 4" />
            <XAxis dataKey="dia" tickFormatter={diaCurto} tick={EIXO.tick} tickLine={false} axisLine={false} minTickGap={12} />
            <YAxis allowDecimals={false} tick={EIXO.tick} tickLine={false} axisLine={false} width={44} />
            <Tooltip
              cursor={{ fill: "hsl(var(--muted) / 0.35)" }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const itens = payload.filter((p) => (p.value as number) > 0).reverse();
                const total = itens.reduce((s, p) => s + (p.value as number), 0);
                return (
                  <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
                    <p className="mb-1 font-semibold text-foreground">{diaCurto(String(label))} · {num(total)} perguntas</p>
                    {itens.map((p) => (
                      <p key={String(p.dataKey)} className="flex items-center gap-2 text-muted-foreground">
                        <span className="inline-block size-2 rounded-sm" style={{ background: p.color }} />
                        <span className="flex-1">{p.name}</span>
                        <span className="tabular-nums text-foreground">{num(p.value as number)}</span>
                      </p>
                    ))}
                  </div>
                );
              }}
            />
            {series.length > 1 && <Legend iconType="square" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />}
            {series.map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.nome} stackId="p" fill={s.cor} stroke="hsl(var(--card))" strokeWidth={1} maxBarSize={36} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </CardUso>
  );
}

type Coluna = "agente" | "usuario" | "active_ms" | "perguntas" | "respostas" | "usuarios" | "sessoes" | "porPergunta";

function Tabela({
  rows,
  usuarios,
  nomeAgente,
}: {
  rows: Dados["linhas"];
  usuarios: Map<string, UsoUsuario>;
  nomeAgente: (id: string) => string;
}) {
  const [visao, setVisao] = React.useState<"agregado" | "usuario">("agregado");
  const [ordem, setOrdem] = React.useState<{ col: Coluna; desc: boolean }>({ col: "perguntas", desc: true });
  const porUsuario = visao === "usuario";
  const linhas = React.useMemo(() => {
    const valor = (l: LinhaAgente): number | string => {
      switch (ordem.col) {
        case "agente":
          return nomeAgente(l.bot_id);
        case "usuario":
          return usuarios.get(l.user_id ?? "")?.email ?? "";
        case "porPergunta":
          return l.perguntas ? l.active_ms / l.perguntas : 0;
        default:
          return l[ordem.col];
      }
    };
    return [...agregarAgentes(rows, porUsuario)].sort((a, b) => {
      const va = valor(a);
      const vb = valor(b);
      const c = typeof va === "number" ? va - (vb as number) : String(va).localeCompare(String(vb), "pt-BR");
      return ordem.desc ? -c : c;
    });
  }, [rows, porUsuario, ordem, usuarios, nomeAgente]);

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
      titulo="Por agente"
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
              {porUsuario && cab("usuario", "Usuário")}
              {cab("agente", "Agente")}
              {cab("active_ms", "Tempo ativo", true)}
              {cab("perguntas", "Perguntas", true)}
              {cab("respostas", "Textos recebidos", true)}
              {cab("porPergunta", "Tempo/pergunta", true)}
              {cab("sessoes", "Aberturas", true)}
              {!porUsuario && cab("usuarios", "Usuários", true)}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={`${l.user_id}|${l.bot_id}`} className="border-b border-border/40 hover:bg-muted/30">
                {porUsuario && (
                  <td className="max-w-[220px] truncate px-2 py-1.5" title={usuarios.get(l.user_id ?? "")?.email}>
                    {nomeUsuario(usuarios.get(l.user_id ?? ""), l.user_id ?? "")}
                  </td>
                )}
                <td className="px-2 py-1.5 font-medium">{nomeAgente(l.bot_id)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatarDuracao(l.active_ms)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{num(l.perguntas)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{num(l.respostas)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{l.perguntas && l.active_ms ? formatarDuracao(l.active_ms / l.perguntas) : "–"}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{num(l.sessoes)}</td>
                {!porUsuario && <td className="px-2 py-1.5 text-right tabular-nums">{l.usuarios}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CardUso>
  );
}
