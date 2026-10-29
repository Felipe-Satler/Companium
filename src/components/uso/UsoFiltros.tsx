import * as React from "react";
import { ChevronDown, ChevronRight, Download, LayoutGrid, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { USAGE_SECTIONS, screensOfSection } from "@/lib/usage/screens";
import type { EscopoTelas, UsoUsuario } from "@/lib/usage/agregar";

export type TipoFiltro = "todos" | "equipe" | "cliente";
export type ExportKind = "diario" | "detalhe" | "cliques" | "transicoes" | "agentes" | "equipes";

type Props = {
  from?: Date;
  to?: Date;
  onPeriodo: (r: { from?: Date; to?: Date }) => void;
  usuarios: UsoUsuario[];
  selecionados: string[];
  onSelecionados: (ids: string[]) => void;
  tipo: TipoFiltro;
  onTipo: (t: TipoFiltro) => void;
  escopo: EscopoTelas;
  onEscopo: (e: EscopoTelas) => void;
  onExportar: (k: ExportKind) => void;
  exportando: boolean;
};

export const nomeUsuario = (u: UsoUsuario | undefined, id?: string) => u?.email.split("@")[0] ?? id?.slice(0, 8) ?? "—";

export function UsoFiltros(p: Props) {
  return (
    <div className="neu-card flex flex-col gap-3 p-4 lg:flex-row lg:flex-wrap lg:items-center">
      <DateRangePicker from={p.from} to={p.to} onChange={p.onPeriodo} ariaLabel="Período" className="h-8" />
      <SeletorUsuarios {...p} />
      <ToggleGroup
        type="single"
        value={p.tipo}
        onValueChange={(v) => v && p.onTipo(v as TipoFiltro)}
        className="neu-inset rounded-md p-0.5"
        aria-label="Tipo de usuário"
      >
        <ToggleGroupItem value="todos" className="h-7 px-2.5 text-xs">Todos</ToggleGroupItem>
        <ToggleGroupItem value="equipe" className="h-7 px-2.5 text-xs">Equipe</ToggleGroupItem>
        <ToggleGroupItem value="cliente" className="h-7 px-2.5 text-xs">Clientes</ToggleGroupItem>
      </ToggleGroup>
      <SeletorTelas escopo={p.escopo} onEscopo={p.onEscopo} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="neu-button h-8 gap-2 px-3.5 lg:ml-auto" disabled={p.exportando}>
            <Download className="size-4" aria-hidden="true" />
            {p.exportando ? "Exportando…" : "Exportar CSV"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Respeita o período, os usuários e as telas filtrados.
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => p.onExportar("diario")}>Resumo diário (dia × usuário × tela)</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => p.onExportar("detalhe")}>Totais por usuário e tela</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => p.onExportar("cliques")}>Cliques em sequência (bruto)</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => p.onExportar("transicoes")}>Transições entre telas</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => p.onExportar("agentes")}>Agentes de IA (dia × usuário × agente)</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => p.onExportar("equipes")}>Por equipe (dia × usuário × equipe da época)</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function SeletorUsuarios({ usuarios, selecionados, onSelecionados, tipo }: Props) {
  const visiveis = usuarios.filter((u) => tipo === "todos" || (tipo === "cliente" ? u.tipo === "cliente" : u.tipo !== "cliente"));
  const sel = new Set(selecionados);
  const rotulo =
    selecionados.length === 0
      ? "Todos (agregado)"
      : selecionados.length === 1
        ? nomeUsuario(usuarios.find((u) => u.id === selecionados[0]), selecionados[0])
        : `${selecionados.length} usuários`;
  const alternar = (id: string) => {
    const next = new Set(sel);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelecionados([...next]);
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 justify-between gap-2 text-xs lg:w-56" aria-label="Usuários">
          <span className="flex min-w-0 items-center gap-2">
            <Users className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
            <span className="truncate">{rotulo}</span>
          </span>
          <ChevronDown className="size-3.5 opacity-60" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar usuário…" className="h-9 text-xs" />
          <CommandList className="max-h-72">
            <CommandEmpty>Nenhum usuário.</CommandEmpty>
            <CommandGroup>
              <CommandItem onSelect={() => onSelecionados([])} className="gap-2 text-xs">
                <Checkbox checked={selecionados.length === 0} className="pointer-events-none" />
                Todos (agregado)
              </CommandItem>
              {visiveis.map((u) => (
                <CommandItem key={u.id} value={u.email} onSelect={() => alternar(u.id)} className="gap-2 text-xs">
                  <Checkbox checked={sel.has(u.id)} className="pointer-events-none" />
                  <span className="min-w-0 flex-1 truncate">{u.email}</span>
                  <span className="text-[10px] uppercase text-muted-foreground">{u.tipo}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Estado de cada seção no seletor: "all" = seção inteira (seção.*), Set = só essas telas. */
type EstadoSecoes = Map<string, "all" | Set<string>>;

function lerEscopo(escopo: EscopoTelas): EstadoSecoes {
  const m: EstadoSecoes = new Map();
  for (const s of USAGE_SECTIONS) {
    if (!escopo || escopo.includes(`${s.key}.*`)) m.set(s.key, "all");
    else m.set(s.key, new Set(escopo.filter((k) => k.startsWith(`${s.key}.`))));
  }
  return m;
}

function gravarEscopo(m: EstadoSecoes): EscopoTelas {
  if ([...m.values()].every((v) => v === "all")) return null;
  const out: string[] = [];
  for (const [secao, v] of m) {
    if (v === "all") out.push(`${secao}.*`);
    else out.push(...v);
  }
  return out;
}

function SeletorTelas({ escopo, onEscopo }: { escopo: EscopoTelas; onEscopo: (e: EscopoTelas) => void }) {
  const estado = lerEscopo(escopo);
  const [abertas, setAbertas] = React.useState<Set<string>>(new Set());

  const rotulo = (() => {
    if (!escopo) return "Todas as telas";
    if (!escopo.length) return "Nenhuma tela";
    const secoes = USAGE_SECTIONS.filter((s) => {
      const v = estado.get(s.key);
      return v === "all" || (v instanceof Set && v.size > 0);
    });
    if (secoes.length === 1) {
      const v = estado.get(secoes[0].key);
      return v === "all" ? `${secoes[0].label} (todas)` : `${secoes[0].label} (${(v as Set<string>).size} telas)`;
    }
    return `${secoes.length} seções`;
  })();

  const marcarSecao = (secao: string, on: boolean) => {
    const m = new Map(estado);
    m.set(secao, on ? "all" : new Set());
    onEscopo(gravarEscopo(m));
  };
  const marcarTela = (secao: string, tela: string, on: boolean) => {
    const m = new Map(estado);
    const atual = m.get(secao);
    const set = new Set(atual === "all" ? screensOfSection(secao).map((s) => s.key) : atual);
    if (on) set.add(tela);
    else set.delete(tela);
    const todas = screensOfSection(secao).every((s) => set.has(s.key));
    m.set(secao, todas ? "all" : set);
    onEscopo(gravarEscopo(m));
  };
  const somente = (secao: string) => {
    const m: EstadoSecoes = new Map(USAGE_SECTIONS.map((s) => [s.key, s.key === secao ? "all" : new Set<string>()]));
    onEscopo(gravarEscopo(m));
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 justify-between gap-2 text-xs lg:w-56" aria-label="Telas">
          <span className="flex min-w-0 items-center gap-2">
            <LayoutGrid className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
            <span className="truncate">{rotulo}</span>
          </span>
          <ChevronDown className="size-3.5 opacity-60" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2" align="start">
        <div className="mb-1 flex items-center justify-between px-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Telas</span>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => onEscopo(null)}>Todas</Button>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => onEscopo([])}>Nenhuma</Button>
          </div>
        </div>
        <ul className="max-h-80 space-y-0.5 overflow-auto">
          {USAGE_SECTIONS.map((s) => {
            const v = estado.get(s.key)!;
            const telas = screensOfSection(s.key);
            const marcado: boolean | "indeterminate" = v === "all" ? true : v.size === 0 ? false : "indeterminate";
            const aberta = abertas.has(s.key);
            return (
              <li key={s.key}>
                <div className="group flex items-center gap-2 rounded px-1 py-1 hover:bg-muted/40">
                  <button
                    type="button"
                    className="flex size-5 items-center justify-center rounded text-muted-foreground disabled:opacity-30"
                    disabled={!telas.length}
                    aria-label={aberta ? `Recolher ${s.label}` : `Expandir ${s.label}`}
                    onClick={() =>
                      setAbertas((cur) => {
                        const n = new Set(cur);
                        if (n.has(s.key)) n.delete(s.key);
                        else n.add(s.key);
                        return n;
                      })
                    }
                  >
                    {aberta ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                  </button>
                  <Checkbox
                    id={`uso-secao-${s.key}`}
                    checked={marcado}
                    onCheckedChange={(c) => marcarSecao(s.key, c === true)}
                    className="data-[state=indeterminate]:bg-primary/40"
                  />
                  <label htmlFor={`uso-secao-${s.key}`} className="flex-1 cursor-pointer text-xs font-medium">
                    {s.label}
                    {!telas.length && <span className="ml-1 text-[10px] font-normal text-muted-foreground">(rotas fora do menu)</span>}
                  </label>
                  <button
                    type="button"
                    className="hidden text-[10px] text-primary hover:underline group-hover:inline"
                    onClick={() => somente(s.key)}
                  >
                    só esta
                  </button>
                </div>
                {aberta && (
                  <ul className="ml-8 space-y-0.5 border-l border-border/50 pl-2">
                    {telas.map((t) => {
                      const on = v === "all" || v.has(t.key);
                      return (
                        <li key={t.key} className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-muted/40">
                          <Checkbox id={`uso-tela-${t.key}`} checked={on} onCheckedChange={(c) => marcarTela(s.key, t.key, c === true)} />
                          <label htmlFor={`uso-tela-${t.key}`} className="flex-1 cursor-pointer text-xs">{t.label}</label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
