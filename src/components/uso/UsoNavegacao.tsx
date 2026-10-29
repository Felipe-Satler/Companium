import * as React from "react";
import { ResponsiveContainer, Sankey, Tooltip } from "recharts";
import { ArrowRight } from "lucide-react";

import type { UsoNavegacao as Dados } from "@/hooks/useUso";
import { matchScreen, type EscopoTelas } from "@/lib/usage/agregar";
import { screenLabel, sectionOf } from "@/lib/usage/screens";
import { CardUso, Vazio } from "./CardUso";
import { useCoresUso } from "./cores";

const MAX_LINKS_SANKEY = 20;
const FORA = "_fora";

const nomeTela = (k: string) => (k === FORA ? "Outras telas" : screenLabel(k, true));

export function UsoNavegacao({ dados, escopo }: { dados: Dados; escopo: EscopoTelas }) {
  const vazio = !dados.transicoes.length && !dados.cliques.length;
  if (vazio) return <Vazio />;
  return (
    <div className="space-y-4">
      <Fluxo dados={dados} escopo={escopo} />
      <div className="grid gap-4 xl:grid-cols-2">
        <TopCliques dados={dados} />
        <Sequencias dados={dados} />
      </div>
      <Saidas dados={dados} />
    </div>
  );
}

/** Transições de/para fora do filtro viram "Outras telas"; duplicadas se somam. */
function transicoesNoEscopo(dados: Dados, escopo: EscopoTelas) {
  const soma = new Map<string, { de: string; para: string; n: number; usuarios: number }>();
  for (const t of dados.transicoes) {
    const de = t.de === "_inicio" || matchScreen(t.de, escopo) ? t.de : FORA;
    const para = matchScreen(t.para, escopo) ? t.para : FORA;
    if (de === FORA && para === FORA) continue;
    const k = `${de}|${para}`;
    const cur = soma.get(k);
    if (cur) {
      cur.n += t.n;
      cur.usuarios = Math.max(cur.usuarios, t.usuarios);
    } else soma.set(k, { de, para, n: t.n, usuarios: t.usuarios });
  }
  return [...soma.values()].sort((a, b) => b.n - a.n);
}

type NoProps = { x: number; y: number; width: number; height: number; index: number; payload: { name: string; lado: "de" | "para"; cor: string } };

function Fluxo({ dados, escopo }: { dados: Dados; escopo: EscopoTelas }) {
  const { corSecao } = useCoresUso();
  const lista = React.useMemo(() => transicoesNoEscopo(dados, escopo), [dados, escopo]);
  const top = lista.slice(0, MAX_LINKS_SANKEY);

  // Bipartido (coluna "de" × coluna "para"): A→B e B→A não formam ciclo, que o Sankey não aceita.
  const sankey = React.useMemo(() => {
    const nos: Array<{ name: string; lado: "de" | "para"; cor: string }> = [];
    const idx = new Map<string, number>();
    const no = (k: string, lado: "de" | "para") => {
      const id = `${lado}:${k}`;
      if (!idx.has(id)) {
        idx.set(id, nos.length);
        const cor = k === FORA || k === "_inicio" ? "hsl(var(--muted-foreground))" : corSecao(sectionOf(k));
        nos.push({ name: nomeTela(k), lado, cor });
      }
      return idx.get(id)!;
    };
    const links = top.map((t) => ({ source: no(t.de, "de"), target: no(t.para, "para"), value: t.n }));
    return { nodes: nos, links };
  }, [top, corSecao]);

  if (!top.length) return null;
  const altura = Math.max(260, Math.min(640, sankey.nodes.length * 18));

  return (
    <CardUso
      titulo="Fluxo entre telas"
      subtitulo={`De onde as pessoas vêm (esquerda) e para onde vão (direita). As ${top.length} transições mais frequentes; espessura = número de vezes.`}
    >
      <div style={{ height: altura }}>
        <ResponsiveContainer width="100%" height="100%">
          <Sankey
            data={sankey}
            nodePadding={14}
            nodeWidth={8}
            iterations={32}
            margin={{ top: 8, right: 170, bottom: 8, left: 170 }}
            link={{ stroke: "hsl(var(--primary))", strokeOpacity: 0.18 }}
            node={(props: NoProps) => {
              const { x, y, width, height, payload } = props;
              const esquerda = payload.lado === "de";
              return (
                <g>
                  <rect x={x} y={y} width={width} height={Math.max(height, 2)} rx={2} fill={payload.cor} />
                  <text
                    x={esquerda ? x - 6 : x + width + 6}
                    y={y + height / 2}
                    textAnchor={esquerda ? "end" : "start"}
                    dominantBaseline="middle"
                    fontSize={11}
                    fill="hsl(var(--foreground))"
                  >
                    {payload.name}
                  </text>
                </g>
              );
            }}
          >
            <Tooltip
              content={({ active, payload }) => {
                const p = active ? (payload?.[0]?.payload as { source?: { name: string }; target?: { name: string }; value?: number; name?: string } | undefined) : undefined;
                if (!p) return null;
                return (
                  <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
                    {p.source && p.target ? (
                      <p>
                        {p.source.name} → {p.target.name}: <strong className="tabular-nums">{p.value?.toLocaleString("pt-BR")}</strong>
                      </p>
                    ) : (
                      <p>
                        {p.name}: <strong className="tabular-nums">{p.value?.toLocaleString("pt-BR")}</strong>
                      </p>
                    )}
                  </div>
                );
              }}
            />
          </Sankey>
        </ResponsiveContainer>
      </div>
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Ver como tabela ({lista.length} transições)</summary>
        <div className="mt-2 max-h-72 overflow-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-card text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-2 py-1.5 text-left font-medium">De</th>
                <th className="px-2 py-1.5 text-left font-medium">Para</th>
                <th className="px-2 py-1.5 text-right font-medium">Vezes</th>
                <th className="px-2 py-1.5 text-right font-medium">Usuários</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((t) => (
                <tr key={`${t.de}|${t.para}`} className="border-b border-border/40">
                  <td className="px-2 py-1">{nomeTela(t.de)}</td>
                  <td className="px-2 py-1">{nomeTela(t.para)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{t.n.toLocaleString("pt-BR")}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{t.usuarios}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </CardUso>
  );
}

/** Barra horizontal fina dentro da célula (proporção ao maior valor da lista). */
const Barra = ({ v, max }: { v: number; max: number }) => (
  <div className="h-1.5 w-full rounded-full bg-muted/40">
    <div className="h-1.5 rounded-full bg-primary" style={{ width: `${max ? (v / max) * 100 : 0}%` }} />
  </div>
);

function TopCliques({ dados }: { dados: Dados }) {
  const lista = dados.cliques.slice(0, 50);
  const max = lista[0]?.n ?? 0;
  return (
    <CardUso titulo="Botões mais clicados" subtitulo="Por tela, no período e filtro escolhidos.">
      {!lista.length ? (
        <p className="text-xs text-muted-foreground">Sem cliques registrados.</p>
      ) : (
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-2 py-1.5 text-left font-medium">Tela</th>
                <th className="px-2 py-1.5 text-left font-medium">Botão</th>
                <th className="w-28 px-2 py-1.5 text-right font-medium">Cliques</th>
                <th className="px-2 py-1.5 text-right font-medium">Usuários</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((c) => (
                <tr key={`${c.screen_key}|${c.target_key}`} className="border-b border-border/40">
                  <td className="whitespace-nowrap px-2 py-1 text-muted-foreground">{screenLabel(c.screen_key, true)}</td>
                  <td className="max-w-[220px] truncate px-2 py-1" title={c.target_key}>{c.label || c.target_key}</td>
                  <td className="px-2 py-1">
                    <div className="flex items-center gap-2">
                      <Barra v={c.n} max={max} />
                      <span className="w-10 text-right tabular-nums">{c.n.toLocaleString("pt-BR")}</span>
                    </div>
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{c.usuarios}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </CardUso>
  );
}

function Sequencias({ dados }: { dados: Dados }) {
  const lista = dados.sequencias;
  return (
    <CardUso titulo="Sequências de cliques mais comuns" subtitulo="Três cliques seguidos na mesma sessão (repetições do mesmo botão contam uma vez).">
      {!lista.length ? (
        <p className="text-xs text-muted-foreground">Ainda não há sequências suficientes.</p>
      ) : (
        <ol className="max-h-[420px] space-y-1.5 overflow-auto text-xs">
          {lista.map((s, i) => (
            <li key={`${s.a}|${s.b}|${s.c}`} className="flex items-center gap-2 rounded-md border border-border/40 px-2 py-1.5">
              <span className="w-5 shrink-0 text-right tabular-nums text-muted-foreground">{i + 1}</span>
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                {[s.la ?? s.a, s.lb ?? s.b, s.lc ?? s.c].map((l, j) => (
                  <React.Fragment key={j}>
                    {j > 0 && <ArrowRight className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />}
                    <span className="max-w-[160px] truncate rounded bg-muted/50 px-1.5 py-0.5">{l}</span>
                  </React.Fragment>
                ))}
              </span>
              <span className="shrink-0 tabular-nums text-foreground">{s.n.toLocaleString("pt-BR")}×</span>
              <span className="shrink-0 text-muted-foreground">{s.usuarios} usu.</span>
            </li>
          ))}
        </ol>
      )}
    </CardUso>
  );
}

function Saidas({ dados }: { dados: Dados }) {
  const total = dados.saidas.reduce((s, x) => s + x.n, 0);
  const lista = dados.saidas.slice(0, 12);
  const max = lista[0]?.n ?? 0;
  if (!lista.length) return null;
  return (
    <CardUso titulo="Onde as sessões terminam" subtitulo="Última tela de cada sessão. Uma tela que encerra muitas sessões pode ser ponto de desistência — ou o destino final do trabalho.">
      <ul className="grid gap-x-6 gap-y-1.5 text-xs md:grid-cols-2">
        {lista.map((s) => (
          <li key={s.screen_key} className="grid grid-cols-[minmax(0,1fr)_120px_64px] items-center gap-2">
            <span className="truncate">{screenLabel(s.screen_key, true)}</span>
            <Barra v={s.n} max={max} />
            <span className="text-right tabular-nums text-muted-foreground">{total ? Math.round((s.n / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </CardUso>
  );
}
