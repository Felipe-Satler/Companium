import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  ChevronsUpDown,
  Columns3,
  Filter,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Agg, CampanhaNode } from "@/hooks/useMetaAdsCriativosData";
import { canonicalResultType, formatCampaignResultType } from "@/lib/metaAdsResultTypeLabels";

// ------- Formatação (pt-BR, valores inteiros completos — nunca abreviados) -------
function formatBRL(v: number): string {
  return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function formatNum(v: number): string {
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}
function formatPct(v: number): string {
  return `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}
// Data + hora (pt-BR) das colunas de criação/última edição. Aceita ISO do Meta.
function formatDateTime(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type ColKey = keyof Agg | "custoResult";
// negativeMetric: métrica que vem negativa (bounce = perda). O valor mais alto (mais perto de 0)
// é o melhor → os rótulos de ordenação viram "melhor → pior" em vez de "mais baixo → mais alto".
type ColDef = {
  key: ColKey;
  label: string;
  width: number;
  type: "num" | "text";
  lowerIsBetter?: boolean;
  negativeMetric?: boolean;
};

const METRIC_COLS: ColDef[] = [
  { key: "criadoEm", label: "Criação", width: 132, type: "text" },
  { key: "editadoEm", label: "Última edição", width: 132, type: "text" },
  { key: "tipoResultado", label: "Tipo de Resultado", width: 170, type: "text" },
  { key: "orcamento", label: "Orçamento Diário", width: 104, type: "num" },
  { key: "gasto", label: "Investimento", width: 96, type: "num" },
  { key: "resultado", label: "Resultados", width: 78, type: "num" },
  { key: "custoResult", label: "Custo/Result.", width: 92, type: "num", lowerIsBetter: true },
  { key: "alcance", label: "Alcance", width: 78, type: "num" },
  { key: "frequencia", label: "Frequência", width: 78, type: "num" },
  { key: "impressoes", label: "Impressões", width: 84, type: "num" },
  { key: "video3s", label: "Vídeo 3s", width: 74, type: "num" },
  { key: "hookRate", label: "Hook Rate", width: 76, type: "num" },
  { key: "video95", label: "Vídeo 95%", width: 76, type: "num" },
  { key: "holdRate", label: "Hold Rate", width: 76, type: "num" },
  { key: "cpm", label: "CPM", width: 74, type: "num", lowerIsBetter: true },
  { key: "ctr", label: "CTR", width: 66, type: "num" },
  { key: "cpc", label: "CPC", width: 74, type: "num", lowerIsBetter: true },
  { key: "cliquesLink", label: "Cliques (link)", width: 90, type: "num" },
  { key: "bounceMsg", label: "Bounce (msg)", width: 90, type: "num", negativeMetric: true },
  { key: "mensagensIniciadas", label: "Msgs Iniciadas", width: 98, type: "num" },
  { key: "custoMensagem", label: "Custo/Msg", width: 84, type: "num", lowerIsBetter: true },
  { key: "bounceLead", label: "Bounce (lead)", width: 90, type: "num", negativeMetric: true },
  { key: "leads", label: "Lead", width: 66, type: "num" },
  { key: "custoLead", label: "Custo/Lead", width: 84, type: "num", lowerIsBetter: true },
  { key: "leadsCrm", label: "Leads CRM", width: 84, type: "num" },
  { key: "cplCrm", label: "CPL CRM", width: 84, type: "num", lowerIsBetter: true },
  { key: "consultas", label: "Consultas Agend.", width: 104, type: "num" },
];

const COL_MAP: Record<string, ColDef> = Object.fromEntries(METRIC_COLS.map((c) => [c.key, c]));
const DEFAULT_NAME_COL_WIDTH = 360;
const MIN_NAME_COL_WIDTH = 220;
const MAX_NAME_COL_WIDTH = 720;
const STORAGE_NAME_WIDTH = "meta-ads-hierarquia-name-width-v1";

// Colunas cujo valor pode ser null (CRM só existe no nível de campanha).
function aggRawValue(agg: Agg, key: ColKey): number | string | null {
  if (key === "custoResult") return agg.custoPorResultado;
  return (agg as any)[key];
}
function getAggValue(agg: Agg, key: ColKey): number | string {
  const v = aggRawValue(agg, key);
  return v == null ? 0 : v;
}

function renderCell(key: ColKey, agg: Agg): React.ReactNode {
  switch (key) {
    case "tipoResultado": {
      // Exibe o rótulo canonicalizado (as duas caixas gravadas pela ingestão viram uma só);
      // mantém o valor cru do banco no tooltip (rastreabilidade). "Total"/"—" caem no
      // formatador, que os preserva.
      const canon = canonicalResultType(agg.tipoResultado);
      return (
        <span className="truncate" title={agg.tipoResultado}>
          {canon || formatCampaignResultType(agg.tipoResultado)}
        </span>
      );
    }
    case "criadoEm": {
      const s = formatDateTime(agg.criadoEm);
      return <span className="truncate text-muted-foreground" title={s}>{s}</span>;
    }
    case "editadoEm": {
      const s = formatDateTime(agg.editadoEm);
      return <span className="truncate text-muted-foreground" title={s}>{s}</span>;
    }
    // Orçamento DIÁRIO — taxa/dia deduplicada (0 no nível de anúncio → "—"). Cálculo em
    // dailyBudgetRate (useMetaAdsCriativosData): por conjunto pega a taxa do dia mais recente;
    // CBO = valor único da campanha, ABO = soma dos conjuntos. Validado contra sistema externo.
    case "orcamento":
      return agg.orcamento > 0 ? (
        <div className="leading-tight">
          <div>{formatBRL(agg.orcamento)}</div>
          <div className="text-[9px] font-normal normal-case text-muted-foreground whitespace-nowrap">Orçamento diário</div>
        </div>
      ) : (
        <span className="text-muted-foreground">—</span>
      );
    case "gasto":
      return formatBRL(agg.gasto);
    case "resultado":
      return <span>{formatNum(agg.resultado)}</span>;
    case "custoResult":
      return agg.custoPorResultado > 0 ? formatBRL(agg.custoPorResultado) : "—";
    case "alcance":
      // Alcance não é somável entre dias. alcanceAprox=true = soma diária (superconta);
      // no nível de campanha é sobreposto pelo reach deduplicado do Meta. O "~" + tooltip
      // sinaliza o valor aproximado (níveis conjunto/anúncio permanecem somados).
      return agg.alcanceAprox ? (
        <span className="text-muted-foreground" title="Aproximado: soma do alcance diário (superconta quem foi alcançado em vários dias). No nível de campanha, o valor exato deduplicado do Meta é carregado automaticamente.">
          ~{formatNum(agg.alcance)}
        </span>
      ) : (
        formatNum(agg.alcance)
      );
    case "frequencia":
      return agg.alcanceAprox ? (
        <span className="text-muted-foreground" title="Aproximado: derivado do alcance somado. No nível de campanha, o valor exato do Meta (impressões ÷ alcance deduplicado) é carregado automaticamente.">
          ~{agg.frequencia.toFixed(2)}
        </span>
      ) : (
        agg.frequencia.toFixed(2)
      );
    case "impressoes":
      return formatNum(agg.impressoes);
    case "video3s":
      return formatNum(agg.video3s);
    case "hookRate":
      return formatPct(agg.hookRate);
    case "video95":
      return formatNum(agg.video95);
    case "holdRate":
      return formatPct(agg.holdRate);
    case "cpm":
      return formatBRL(agg.cpm);
    case "ctr":
      return formatPct(agg.ctr);
    case "cpc":
      return formatBRL(agg.cpc);
    case "cliquesLink":
      return formatNum(agg.cliquesLink);
    case "bounceMsg":
      return formatPct(agg.bounceMsg);
    case "mensagensIniciadas":
      return formatNum(agg.mensagensIniciadas);
    case "custoMensagem":
      return agg.custoMensagem > 0 ? formatBRL(agg.custoMensagem) : "—";
    case "bounceLead":
      return formatPct(agg.bounceLead);
    case "leads":
      return formatNum(agg.leads);
    case "custoLead":
      return agg.custoLead > 0 ? formatBRL(agg.custoLead) : "—";
    // CRM — só nível de campanha; null nos demais níveis → "—".
    case "leadsCrm":
      return agg.leadsCrm == null ? "—" : formatNum(agg.leadsCrm);
    case "cplCrm":
      return agg.cplCrm == null || agg.cplCrm <= 0 ? "—" : formatBRL(agg.cplCrm);
    case "consultas":
      return agg.consultas == null ? "—" : formatNum(agg.consultas);
  }
}

// Total da tabela (última linha). Soma as BASES aditivas dos agregados de campanha (que já
// somaram suas próprias linhas) e RE-DERIVA as razões com as MESMAS fórmulas do aggregate()
// do hook — assim o total é calculado "da mesma forma que a campanha" (não é média de médias).
// Alcance é somado (aproximado entre campanhas, como no nível de campanha antes do dedup).
function computeTotal(aggs: Agg[]): Agg {
  let gasto = 0, orcamento = 0, impressoes = 0, alcance = 0, cliquesLink = 0, resultado = 0;
  let video3s = 0, video95 = 0, mensagens = 0, leads = 0;
  let leadsCrm = 0, consultas = 0, hasCrm = false;
  let freqWeighted = 0, freqWeight = 0;
  for (const a of aggs) {
    gasto += a.gasto;
    orcamento += a.orcamento;
    impressoes += a.impressoes;
    alcance += a.alcance;
    cliquesLink += a.cliquesLink;
    resultado += a.resultado;
    video3s += a.video3s;
    video95 += a.video95;
    mensagens += a.mensagensIniciadas;
    leads += a.leads;
    if (a.leadsCrm != null) { leadsCrm += a.leadsCrm; hasCrm = true; }
    if (a.consultas != null) { consultas += a.consultas; hasCrm = true; }
    if (a.impressoes > 0 && a.frequencia > 0) {
      freqWeighted += a.frequencia * a.impressoes;
      freqWeight += a.impressoes;
    }
  }
  const frequencia = freqWeight > 0 ? freqWeighted / freqWeight : alcance > 0 ? impressoes / alcance : 0;
  return {
    status: "ativo",
    orcamento,
    gasto,
    resultado,
    tipoResultado: "Total",
    custoPorResultado: resultado > 0 ? gasto / resultado : 0,
    alcance,
    frequencia,
    alcanceAprox: true,
    impressoes,
    video3s,
    hookRate: impressoes > 0 ? (video3s / impressoes) * 100 : 0,
    video95,
    holdRate: impressoes > 0 ? (video95 / impressoes) * 100 : 0,
    cpm: impressoes > 0 ? (gasto / impressoes) * 1000 : 0,
    ctr: impressoes > 0 ? (cliquesLink / impressoes) * 100 : 0,
    cpc: cliquesLink > 0 ? gasto / cliquesLink : 0,
    cliquesLink,
    bounceMsg: cliquesLink > 0 ? (mensagens / cliquesLink - 1) * 100 : 0,
    mensagensIniciadas: mensagens,
    custoMensagem: mensagens > 0 ? gasto / mensagens : 0,
    bounceLead: cliquesLink > 0 ? (leads / cliquesLink - 1) * 100 : 0,
    leads,
    custoLead: leads > 0 ? gasto / leads : 0,
    leadsCrm: hasCrm ? leadsCrm : null,
    cplCrm: hasCrm && leadsCrm > 0 ? gasto / leadsCrm : null,
    consultas: hasCrm ? consultas : null,
    criadoEm: null,
    editadoEm: null,
  };
}

type SortRule = { key: ColKey; dir: "asc" | "desc" };
type NumFilter = { min?: number; max?: number };
type TextFilter = { contains?: string };
type FilterMap = Record<string, NumFilter | TextFilter>;
type ColumnConfig = { key: ColKey; visible: boolean };

// "Orçamento Total" (existiu na v3) foi REMOVIDA — só ficou "Orçamento Diário". Chaves
// desconhecidas na ordem salva são filtradas no load, então a coluna some sozinha (sem bump).
// v2: Criação/Última edição movidas p/ ANTES de "Tipo de Resultado".
const STORAGE_COLUMNS = "meta-ads-hierarquia-columns-v3";

function ColumnHeaderMenu({
  col,
  sortRules,
  filter,
  onSort,
  onFilter,
  onClear,
  onOpenColumns,
}: {
  col: ColDef;
  sortRules: SortRule[];
  filter: NumFilter | TextFilter | undefined;
  onSort: (dir: "asc" | "desc") => void;
  onFilter: (f: NumFilter | TextFilter | undefined) => void;
  onClear: () => void;
  onOpenColumns: () => void;
}) {
  const [openFilter, setOpenFilter] = useState(false);
  const [minVal, setMinVal] = useState<string>(
    filter && "min" in filter && filter.min !== undefined ? String(filter.min) : "",
  );
  const [maxVal, setMaxVal] = useState<string>(
    filter && "max" in filter && filter.max !== undefined ? String(filter.max) : "",
  );
  const [textVal, setTextVal] = useState<string>(
    filter && "contains" in filter && filter.contains ? filter.contains : "",
  );

  const sortIdx = sortRules.findIndex((r) => r.key === col.key);
  const active = sortIdx >= 0;
  const activeRule = active ? sortRules[sortIdx] : null;
  const hasFilter = !!filter && Object.values(filter).some((v) => v !== undefined && v !== "");

  const SortIcon = activeRule ? (activeRule.dir === "asc" ? ArrowUp : ArrowDown) : ChevronsUpDown;

  const applyFilter = () => {
    if (col.type === "num") {
      const min = minVal === "" ? undefined : Number(minVal);
      const max = maxVal === "" ? undefined : Number(maxVal);
      if (min === undefined && max === undefined) onFilter(undefined);
      else onFilter({ min, max });
    } else {
      const c = textVal.trim();
      if (!c) onFilter(undefined);
      else onFilter({ contains: c });
    }
    setOpenFilter(false);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="group inline-flex w-full cursor-pointer items-center justify-center gap-1 rounded px-1 py-1 hover:bg-muted/70"
          aria-label={`Opções da coluna ${col.label}`}
        >
          <span className="truncate">{col.label}</span>
          <span className="inline-flex items-center">
            <SortIcon
              className={`h-3 w-3 shrink-0 ${active || hasFilter ? "text-primary" : "text-muted-foreground/60"}`}
            />
            {active && sortRules.length > 1 && (
              <span className="ml-0.5 text-[9px] font-semibold text-primary">{sortIdx + 1}</span>
            )}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs">{col.label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {col.key !== "tipoResultado" && (
          <>
            {col.negativeMetric ? (
              <>
                {/* Bounce é negativo (perda): valor mais alto = melhor. */}
                <DropdownMenuItem className="cursor-pointer" onClick={() => onSort("desc")}>
                  <ArrowUp className="mr-2 h-4 w-4" />
                  Classificar do melhor para o pior
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer" onClick={() => onSort("asc")}>
                  <ArrowDown className="mr-2 h-4 w-4" />
                  Classificar do pior para o melhor
                </DropdownMenuItem>
              </>
            ) : (
              <>
                <DropdownMenuItem className="cursor-pointer" onClick={() => onSort("asc")}>
                  <ArrowUp className="mr-2 h-4 w-4" />
                  Classificar do mais baixo para o mais alto
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer" onClick={() => onSort("desc")}>
                  <ArrowDown className="mr-2 h-4 w-4" />
                  Classificar do mais alto para o mais baixo
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem className="cursor-pointer" onClick={onOpenColumns}>
          <Columns3 className="mr-2 h-4 w-4" />
          Colunas
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="cursor-pointer"
          onSelect={(e) => {
            e.preventDefault();
            setOpenFilter((v) => !v);
          }}
        >
          <Filter className="mr-2 h-4 w-4" />
          Filtrar coluna
        </DropdownMenuItem>
        {openFilter && (
          // stopPropagation em keydown/keyup: sem isso o typeahead do DropdownMenu (Radix)
          // captura cada tecla digitada dentro do menu e rouba o foco dos inputs — deixando
          // os filtros de coluna impossíveis de preencher. Também paramos Enter aqui pra
          // aplicar o filtro em vez de acionar o menu. onClick já era interceptado.
          <div
            className="space-y-2 px-2 py-2"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            onKeyUp={(e) => e.stopPropagation()}
          >
            {col.type === "num" ? (
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  placeholder="Mín"
                  value={minVal}
                  onChange={(e) => setMinVal(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyFilter()}
                  className="h-8 text-xs"
                />
                <Input
                  type="number"
                  placeholder="Máx"
                  value={maxVal}
                  onChange={(e) => setMaxVal(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyFilter()}
                  className="h-8 text-xs"
                />
              </div>
            ) : (
              <Input
                placeholder="Contém..."
                value={textVal}
                onChange={(e) => setTextVal(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyFilter()}
                className="h-8 text-xs"
              />
            )}
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => {
                  setMinVal("");
                  setMaxVal("");
                  setTextVal("");
                  onFilter(undefined);
                  setOpenFilter(false);
                }}
              >
                Limpar
              </Button>
              <Button size="sm" className="h-7 text-xs" onClick={applyFilter}>
                Aplicar
              </Button>
            </div>
          </div>
        )}
        {(active || hasFilter) && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer" onClick={onClear}>
              Limpar classificação e filtro
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// -------- Columns dialog --------
function ColumnsDialog({
  open,
  onOpenChange,
  columns,
  onChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  columns: ColumnConfig[];
  onChange: (c: ColumnConfig[]) => void;
}) {
  const [draft, setDraft] = useState<ColumnConfig[]>(columns);
  useEffect(() => {
    if (open) setDraft(columns);
  }, [open, columns]);

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...draft];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setDraft(next);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Colunas</DialogTitle>
          <DialogDescription>Escolha quais colunas exibir e a ordem em que aparecem.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="h-80 pr-3">
          <div className="space-y-1">
            {draft.map((c, i) => {
              const def = COL_MAP[c.key];
              return (
                <div key={c.key} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted/40">
                  <Checkbox
                    checked={c.visible}
                    onCheckedChange={(v) => {
                      const next = [...draft];
                      next[i] = { ...next[i], visible: !!v };
                      setDraft(next);
                    }}
                  />
                  <span className="flex-1 text-xs">{def.label}</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => move(i, -1)}>
                    <ArrowUp className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => move(i, 1)}>
                    <ArrowDown className="h-3 w-3" />
                  </Button>
                </div>
              );
            })}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setDraft(METRIC_COLS.map((c) => ({ key: c.key, visible: true })))}>
            Restaurar padrão
          </Button>
          <Button
            onClick={() => {
              onChange(draft);
              onOpenChange(false);
            }}
          >
            Aplicar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MetaAdsCampaignHierarchy({
  campanhas: campanhasProp,
  tipoResultado = "all",
  crmSemCampanha,
  loading = false,
}: {
  campanhas: CampanhaNode[];
  tipoResultado?: string;
  // Leads/consultas do CRM que não caíram em nenhuma campanha (sem Campanha no Kommo ou nome
  // sem correspondência). Mostrados à parte p/ não sumirem da conta.
  crmSemCampanha?: { leads: number; consultas: number };
  loading?: boolean;
}) {
  // O Tipo de Resultado vem da tabela "Criativos Meta Ads" e mais nada.
  //
  // Antes, o tipo era SOBRESCRITO pelo código cru da tabela principal (v_meta_google_ads),
  // casado por nome de campanha. Isso quebrava de duas formas ao mesmo tempo:
  //   • o RÓTULO passava a vir de uma tabela e o NÚMERO ao lado continuava vindo da outra —
  //     a campanha 013 do Fábio Morais exibia "Conversas Iniciadas" sobre 1.177 visitas ao
  //     perfil, com 2 mensagens;
  //   • o filtro (abaixo) compara contra esse mesmo campo, então uma campanha classificada
  //     como mensagem na tabela principal SUMIA do filtro "Visitas ao perfil" mesmo tendo
  //     todas as linhas gravadas como visita ao perfil.
  // A classificação dos criativos é por LINHA (dia × anúncio, derivada do optimization_goal
  // do conjunto), enquanto a da tabela principal é um único palpite por campanha. Ficamos com
  // a mais granular — que é, além disso, a fonte do número exibido.
  const campanhas = campanhasProp;
  const [expandedCamp, setExpandedCamp] = useState<Set<string>>(new Set());
  const [expandedConj, setExpandedConj] = useState<Set<string>>(new Set());
  const [sortRules, setSortRules] = useState<SortRule[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | "ativo" | "pausado">("all");
  const [filters, setFilters] = useState<FilterMap>({});
  const [columnState, setColumnState] = useState<ColumnConfig[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(STORAGE_COLUMNS);
        if (raw) {
          const parsed = JSON.parse(raw) as ColumnConfig[];
          const known = new Set(METRIC_COLS.map((c) => c.key));
          const filtered = parsed.filter((c) => known.has(c.key));
          const present = new Set(filtered.map((c) => c.key));
          for (const c of METRIC_COLS) if (!present.has(c.key)) filtered.push({ key: c.key, visible: true });
          return filtered;
        }
      } catch {
        // ignore
      }
    }
    return METRIC_COLS.map((c) => ({ key: c.key, visible: true }));
  });

  const [columnsOpen, setColumnsOpen] = useState(false);

  // Largura ajustável (drag) da coluna de nome — persistida.
  const [nameColWidth, setNameColWidth] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const raw = window.localStorage.getItem(STORAGE_NAME_WIDTH);
      const n = raw ? Number(raw) : NaN;
      if (!Number.isNaN(n) && n >= MIN_NAME_COL_WIDTH && n <= MAX_NAME_COL_WIDTH) return n;
    }
    return DEFAULT_NAME_COL_WIDTH;
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_NAME_WIDTH, String(nameColWidth));
    } catch {
      // ignore
    }
  }, [nameColWidth]);

  // No mobile a coluna de nome é sticky; se ela for tão larga quanto a viewport,
  // cobre a área toda e as colunas de métrica nunca aparecem por mais que role.
  // Limita a largura APLICADA no mobile (mantém a preferência salva p/ o desktop).
  const isMobile = useIsMobile();
  const appliedNameColWidth = isMobile ? Math.min(nameColWidth, 150) : nameColWidth;

  const startResizeName = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = nameColWidth;
    const onMove = (ev: MouseEvent) => {
      const next = Math.min(MAX_NAME_COL_WIDTH, Math.max(MIN_NAME_COL_WIDTH, startW + (ev.clientX - startX)));
      setNameColWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_COLUMNS, JSON.stringify(columnState));
    } catch {
      // ignore
    }
  }, [columnState]);

  const visibleCols = useMemo(
    () => columnState.filter((c) => c.visible).map((c) => COL_MAP[c.key]).filter(Boolean),
    [columnState],
  );

  const metricsTotalWidth = visibleCols.reduce((s, c) => s + c.width, 0);

  const filteredSorted = useMemo(() => {
    // Filtro por tipo de resultado (dropdown da tela). Compara CANONICALIZADO: a ingestão
    // gravou o mesmo tipo com caixas diferentes ("Conversas Iniciadas" × "Conversas
    // iniciadas"), e a comparação crua dividia as campanhas entre as duas grafias.
    const alvo = canonicalResultType(tipoResultado);
    let list =
      tipoResultado === "all"
        ? campanhas
        : campanhas.filter((c) => canonicalResultType(c.agg.tipoResultado) === alvo);
    // Filtro por status (ativo/pausado) da campanha.
    if (statusFilter !== "all") list = list.filter((c) => c.agg.status === statusFilter);
    // Filtros por coluna (aplicados ao nível de campanha).
    list = list.filter((c) => {
      for (const [key, f] of Object.entries(filters)) {
        if (!f) continue;
        const col = COL_MAP[key];
        if (!col) continue;
        const val = getAggValue(c.agg, col.key);
        if (col.type === "num") {
          const nf = f as NumFilter;
          const n = Number(val);
          if (nf.min !== undefined && n < nf.min) return false;
          if (nf.max !== undefined && n > nf.max) return false;
        } else {
          const tf = f as TextFilter;
          if (tf.contains && !String(val).toLowerCase().includes(tf.contains.toLowerCase())) return false;
        }
      }
      return true;
    });
    if (sortRules.length > 0) {
      list = [...list].sort((a, b) => {
        for (const rule of sortRules) {
          const col = COL_MAP[rule.key];
          const va = getAggValue(a.agg, rule.key);
          const vb = getAggValue(b.agg, rule.key);
          let cmp = 0;
          if (col?.type === "num") cmp = Number(va) - Number(vb);
          else cmp = String(va).localeCompare(String(vb));
          if (cmp !== 0) return rule.dir === "asc" ? cmp : -cmp;
        }
        return 0;
      });
    }
    return list;
  }, [campanhas, tipoResultado, statusFilter, filters, sortRules]);

  // Total da tabela (última linha) — soma das campanhas VISÍVEIS (respeita todos os filtros).
  const totalAgg = useMemo(() => computeTotal(filteredSorted.map((c) => c.agg)), [filteredSorted]);

  const toggleCamp = (n: string) =>
    setExpandedCamp((p) => {
      const s = new Set(p);
      if (s.has(n)) s.delete(n);
      else s.add(n);
      return s;
    });
  const toggleConj = (n: string) =>
    setExpandedConj((p) => {
      const s = new Set(p);
      if (s.has(n)) s.delete(n);
      else s.add(n);
      return s;
    });

  const applySort = (key: ColKey, dir: "asc" | "desc") => {
    setSortRules([{ key, dir }]);
  };
  const clearCol = (key: ColKey) => {
    setSortRules((rules) => rules.filter((r) => r.key !== key));
    setFilters((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  return (
    <div className="neu-card rounded-xl p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">Campanhas</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "all" | "ativo" | "pausado")}
            className="neu-card cursor-pointer rounded-lg bg-transparent px-2.5 py-1 text-xs font-medium text-foreground outline-none"
          >
            <option value="all">Todos</option>
            <option value="ativo">Ativos</option>
            <option value="pausado">Pausados</option>
          </select>
        </div>
      </div>
      {crmSemCampanha && crmSemCampanha.leads > 0 && (
        <div
          className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
          title="Leads do CRM (Kommo) que não têm campanha registrada — ou cujo nome não corresponde a nenhuma campanha do Meta. Não é possível atribuí-los a uma campanha específica, então ficam contabilizados aqui à parte."
        >
          <span className="font-semibold text-foreground">CRM sem campanha:</span>
          <span>
            {crmSemCampanha.leads.toLocaleString("pt-BR")} {crmSemCampanha.leads === 1 ? "lead" : "leads"}
          </span>
          <span aria-hidden>·</span>
          <span>
            {crmSemCampanha.consultas.toLocaleString("pt-BR")}{" "}
            {crmSemCampanha.consultas === 1 ? "consulta agendada" : "consultas agendadas"}
          </span>
          <span className="text-muted-foreground/70">(não atribuídos a nenhuma campanha)</span>
        </div>
      )}
      <div className="overflow-hidden rounded-lg border border-border/50">
        <div className="max-h-[600px] overflow-auto">
          <div style={{ width: appliedNameColWidth + metricsTotalWidth }}>
            {/* Header */}
            <div className="sticky top-0 z-20 flex items-stretch border-b border-border/60 bg-card text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <div
                className="sticky left-0 z-30 flex items-center gap-3 bg-card px-5 py-3 relative"
                style={{ width: appliedNameColWidth, minWidth: appliedNameColWidth }}
              >
                <span className="shrink-0">Status</span>
                <span>Campanha</span>
                <div
                  onMouseDown={startResizeName}
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-0 top-0 z-40 flex h-full w-2 cursor-col-resize items-center justify-center hover:bg-primary/30"
                  title="Arraste para ajustar a largura da coluna"
                >
                  <span className="h-1/2 w-px bg-border/70" />
                </div>
              </div>
              {visibleCols.map((c) => (
                <div key={c.key} className="border-l border-border/40" style={{ width: c.width, minWidth: c.width }}>
                  <div className="px-1 py-2 text-center">
                    <ColumnHeaderMenu
                      col={c}
                      sortRules={sortRules}
                      filter={filters[c.key]}
                      onSort={(dir) => applySort(c.key, dir)}
                      onFilter={(f) =>
                        setFilters((prev) => {
                          const next = { ...prev };
                          if (f === undefined) delete next[c.key];
                          else next[c.key] = f;
                          return next;
                        })
                      }
                      onClear={() => clearCol(c.key)}
                      onOpenColumns={() => setColumnsOpen(true)}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div>
              {loading ? (
                <div className="px-5 py-10 text-center text-xs text-muted-foreground">Carregando anúncios…</div>
              ) : (
                <>
                  {filteredSorted.map((c) => {
                    const isOpen = expandedCamp.has(c.nome);
                    return (
                      <div key={c.nome}>
                        <RowLine
                          level={0}
                          open={isOpen}
                          onToggle={() => toggleCamp(c.nome)}
                          nome={c.nome}
                          agg={c.agg}
                          visibleCols={visibleCols}
                          nameColWidth={appliedNameColWidth}
                        />
                        {isOpen &&
                          c.conjuntos.map((cj) => {
                            const key = `${c.nome}::${cj.nome}`;
                            const cjOpen = expandedConj.has(key);
                            return (
                              <div key={key}>
                                <RowLine
                                  level={1}
                                  open={cjOpen}
                                  onToggle={() => toggleConj(key)}
                                  nome={cj.nome}
                                  agg={cj.agg}
                                  visibleCols={visibleCols}
                                  nameColWidth={appliedNameColWidth}
                                />
                                {cjOpen &&
                                  cj.anuncios.map((a) => (
                                    <RowLine
                                      key={a.id}
                                      level={2}
                                      nome={a.nome}
                                      agg={a.agg}
                                      visibleCols={visibleCols}
                                      nameColWidth={appliedNameColWidth}
                                    />
                                  ))}
                              </div>
                            );
                          })}
                      </div>
                    );
                  })}
                  {filteredSorted.length === 0 && (
                    <div className="px-5 py-8 text-center text-xs text-muted-foreground">
                      Nenhuma campanha corresponde aos filtros aplicados.
                    </div>
                  )}
                  {filteredSorted.length > 0 && (
                    <TotalRow agg={totalAgg} visibleCols={visibleCols} nameColWidth={appliedNameColWidth} />
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <ColumnsDialog open={columnsOpen} onOpenChange={setColumnsOpen} columns={columnState} onChange={setColumnState} />
    </div>
  );
}

function RowLine({
  level,
  open,
  onToggle,
  nome,
  agg,
  visibleCols,
  nameColWidth,
}: {
  level: 0 | 1 | 2;
  open?: boolean;
  onToggle?: () => void;
  nome: string;
  agg: Agg;
  visibleCols: ColDef[];
  nameColWidth: number;
}) {
  const isAtivo = agg.status === "ativo";
  // Fundo OPACO: a coluna de nome é sticky; com fundo translúcido o conteúdo das
  // métricas (que rola por baixo) vazava através do nome nos subníveis.
  const bg = level === 0 ? "bg-card" : level === 1 ? "bg-muted" : "bg-secondary";
  const nameIndent = level === 0 ? "pl-5" : level === 1 ? "pl-12" : "pl-20";
  const chevronVisible = level < 2;

  return (
    <div
      className={`flex items-stretch text-xs ${chevronVisible ? "cursor-pointer hover:bg-muted/60" : ""}`}
      onClick={chevronVisible ? onToggle : undefined}
    >
      <div
        className={`sticky left-0 z-10 flex items-center gap-3 ${bg} ${nameIndent} pr-3 py-2.5`}
        style={{ width: nameColWidth, minWidth: nameColWidth }}
      >
        <div className="flex w-8 items-center gap-1">
          <span
            className={`inline-flex h-4 w-7 items-center rounded-full p-0.5 transition ${
              isAtivo ? "bg-emerald-500" : "bg-muted"
            }`}
          >
            <span className={`h-3 w-3 rounded-full bg-white transition ${isAtivo ? "translate-x-3" : ""}`} />
          </span>
        </div>
        <div className="flex min-w-0 items-start gap-2 md:items-center">
          {chevronVisible ? (
            <ChevronRight
              className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""} mt-0.5 md:mt-0`}
            />
          ) : (
            <span className="h-3.5 w-3.5 shrink-0" />
          )}
          {/* Mobile: quebra em linhas p/ ler o nome inteiro na coluna estreita.
              Desktop: uma linha só com reticências (truncate). */}
          <span
            className={`whitespace-normal break-words md:truncate ${
              level === 0 ? "font-semibold text-foreground" : level === 1 ? "text-foreground/90" : "text-muted-foreground"
            }`}
            title={nome}
          >
            {nome}
          </span>
        </div>
      </div>

      {visibleCols.map((c) => (
        <div
          key={c.key}
          className="flex flex-col items-center justify-center px-1.5 py-2.5 text-center text-[11px] tabular-nums"
          style={{ width: c.width, minWidth: c.width }}
        >
          {renderCell(c.key, agg)}
        </div>
      ))}
    </div>
  );
}

// Última linha da tabela: TOTAL das campanhas visíveis. Fica grudada no rodapé (sticky bottom)
// e destacada. Sem switch de status/chevron — só o rótulo "Total" na coluna de nome. As
// colunas de data mostram "—" (total não tem entidade única).
function TotalRow({
  agg,
  visibleCols,
  nameColWidth,
}: {
  agg: Agg;
  visibleCols: ColDef[];
  nameColWidth: number;
}) {
  return (
    <div className="sticky bottom-0 z-10 flex items-stretch border-t-2 border-border/70 bg-card text-xs font-semibold">
      <div
        className="sticky left-0 z-10 flex items-center gap-3 bg-card pl-5 pr-3 py-2.5"
        style={{ width: nameColWidth, minWidth: nameColWidth }}
      >
        <span className="w-8" />
        <span className="text-foreground">Total</span>
      </div>
      {visibleCols.map((c) => (
        <div
          key={c.key}
          className="flex flex-col items-center justify-center px-1.5 py-2.5 text-center text-[11px] tabular-nums text-foreground"
          style={{ width: c.width, minWidth: c.width }}
        >
          {c.key === "criadoEm" || c.key === "editadoEm" || c.key === "tipoResultado"
            ? <span className="text-muted-foreground">—</span>
            : renderCell(c.key, agg)}
        </div>
      ))}
    </div>
  );
}
