import { useEffect, useRef, useState } from "react";
import { LayoutGrid, List, Settings2, Eye, EyeOff, Check } from "lucide-react";

// Métricas que os cards de anúncio podem ocultar.
export const METRICAS_OCULTAVEIS = [
  "Investimento",
  "Resultados",
  "CPR",
  "Alcance",
  "Frequência",
  "Impressões",
  "Hook",
  "Hold",
  "CPM",
  "CTR Criativo",
  "CPC Link",
  "Cliques no link",
] as const;

export type MetricaOcultavel = (typeof METRICAS_OCULTAVEIS)[number];
export type ViewMode = "grid" | "lista";
export type Colunas = 2 | 3 | 4;
export type Preset = "todas" | "resultados" | "metricas" | "personalizado";

export const PRESET_HIDDEN: Record<Exclude<Preset, "personalizado">, MetricaOcultavel[]> = {
  todas: [],
  // "Só resultados" oculta TODAS as métricas do painel MÉTRICAS, deixando apenas o painel RESULTADO.
  resultados: ["Alcance", "Frequência", "Impressões", "Hook", "Hold", "CPM", "CTR Criativo", "CPC Link", "Cliques no link"],
  // "Só métricas" oculta o painel RESULTADO.
  metricas: ["Investimento", "Resultados", "CPR"],
};

type Props = {
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;
  colunas: Colunas;
  setColunas: (c: Colunas) => void;
  filtrosAbertos: boolean;
  setFiltrosAbertos: (v: boolean) => void;
  preset: Preset;
  setPreset: (p: Preset) => void;
  setHidden: (h: Set<MetricaOcultavel>) => void;
};

export function MetaAdsOrganizarMenu(props: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  function applyPreset(p: Preset) {
    props.setPreset(p);
    if (p !== "personalizado") {
      props.setHidden(new Set(PRESET_HIDDEN[p]));
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="neu-card rounded-xl inline-flex cursor-pointer items-center gap-2 px-3 py-2 text-xs font-medium text-foreground/85 hover:text-foreground"
      >
        <Settings2 className="h-4 w-4" />
        Organizar
      </button>

      {open && (
        <div className="neu-card absolute right-0 top-full z-50 mt-2 w-[320px] rounded-xl p-4 shadow-xl">
          <Section title="Visualização">
            <div className="flex gap-2">
              <Chip active={props.viewMode === "grid"} onClick={() => props.setViewMode("grid")} icon={<LayoutGrid className="h-3.5 w-3.5" />}>
                Grid
              </Chip>
              <Chip active={props.viewMode === "lista"} onClick={() => props.setViewMode("lista")} icon={<List className="h-3.5 w-3.5" />}>
                Lista
              </Chip>
            </div>
          </Section>

          <Section title="Densidade">
            <div>
              <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">Colunas</p>
              <div className="flex gap-2">
                {([2, 3, 4] as const).map((n) => (
                  <Chip key={n} active={props.colunas === n} onClick={() => props.setColunas(n)} disabled={props.viewMode === "lista"}>
                    {n}
                  </Chip>
                ))}
              </div>
            </div>
          </Section>

          <Section title="Filtros">
            <button
              onClick={() => props.setFiltrosAbertos(!props.filtrosAbertos)}
              className="neu-card rounded-full inline-flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs font-medium text-foreground/85 hover:text-foreground"
            >
              {props.filtrosAbertos ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {props.filtrosAbertos ? "Ocultar filtros" : "Mostrar filtros"}
            </button>
          </Section>

          <Section title="Presets de métricas" last>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["todas", "Todas"],
                  ["resultados", "Só resultados"],
                  ["metricas", "Só métricas"],
                  ["personalizado", "Personalizado"],
                ] as [Preset, string][]
              ).map(([id, label]) => (
                <Chip key={id} active={props.preset === id} onClick={() => applyPreset(id)} icon={props.preset === id ? <Check className="h-3 w-3" /> : undefined}>
                  {label}
                </Chip>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">
              {METRICAS_OCULTAVEIS.length} métricas disponíveis. Ajustes manuais mudam para "Personalizado".
            </p>
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({ title, children, last }: { title: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={last ? "" : "mb-4 border-b border-border/50 pb-4"}>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-foreground/70">{title}</p>
      {children}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
  icon,
  disabled,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
        disabled
          ? "opacity-40 cursor-not-allowed neu-card rounded-full text-muted-foreground"
          : active
            ? "bg-emerald-500 text-white"
            : "neu-card rounded-full text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}
