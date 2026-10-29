import * as React from "react";
import { createPortal } from "react-dom";
import { Plus, Pencil, Trash2, Eye, EyeOff, X, Download, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Board,
  Bar,
  BarKind,
  Checkpoint,
  RealStatus,
  CARD_TYPES,
  DURATIONS,
  PLAN_STATUS_BG,
  REAL_STATUS_BG,
  REAL_STATUS_BORDER,
  REAL_STATUS_LABEL,
  REAL_STATUS_KEYS,
  daysToSpan,
  spanToDays,
  snap,
  MIN_SPAN,
  MIN_COL_WIDTH,
  MAX_COL_WIDTH,
  defaultMonthWidth,
  randomPairId,
  normalizeCheckpoint,
  offsetPx,
  posFromPx,
  sumWidths,
} from "@/lib/cronograma";

// ---------------------------------------------------------------------------
// Estados dos diálogos
// ---------------------------------------------------------------------------
interface AddCardState {
  rowIndex: number;
  monthIndex: number; // índice ABSOLUTO da coluna
  label: string;
  status: string;
  days: number;
}
interface EditCardState {
  rowIndex: number;
  barIndex: number;
  isReal: boolean;
  label: string;
  status: string;
  description: string;
  realStatus: RealStatus | "";
}
interface RenameState {
  type: "month" | "marco";
  index: number;
  value: string;
}

type DragBar = { rowIndex: number; barIndex: number } | null;
type DragCp = { rowIndex: number; cpIndex: number } | null;

interface EditorProps {
  board: Board;
  onChange: (board: Board) => void;
  /** nome do cliente (para nomear o PNG exportado). */
  clientLabel?: string;
  /**
   * Permite editar o cronograma. Quando false (não-admin), a tela fica somente
   * leitura: nenhuma ação de edição (arrastar, redimensionar, "+", salvar). Os
   * cards "Real" e o toggle "Mostrar cards Real" continuam VISÍVEIS para todos
   * que têm acesso à página — só a edição é restrita.
   */
  canEdit?: boolean;
}

export function CronogramaEditor({ board, onChange, clientLabel, canEdit = true }: EditorProps) {
  const { months, rows } = board;

  const [addCard, setAddCard] = React.useState<AddCardState | null>(null);
  const [editCard, setEditCard] = React.useState<EditCardState | null>(null);
  const [newMonth, setNewMonth] = React.useState("");
  const [newMarco, setNewMarco] = React.useState("");
  const [addMonthOpen, setAddMonthOpen] = React.useState(false);
  const [addMarcoOpen, setAddMarcoOpen] = React.useState(false);
  const [rename, setRename] = React.useState<RenameState | null>(null);
  const [dragBar, setDragBar] = React.useState<DragBar>(null);
  const [dragCp, setDragCp] = React.useState<DragCp>(null);
  const [showRealState, setShowReal] = React.useState(true);
  // Cards "Real" + toggle são visíveis para toda a equipe Groohub que acessa a
  // página (a rota já bloqueia usuário-cliente). A edição segue restrita a admin
  // via canEdit nas ações individuais; a visualização é livre.
  const showReal = showRealState;
  const [hiddenMonths, setHiddenMonths] = React.useState<number[]>([]);
  const [hiddenRows, setHiddenRows] = React.useState<number[]>([]);
  const [widthOverrides, setWidthOverrides] = React.useState<Record<number, number>>({});
  const [exporting, setExporting] = React.useState(false);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [exportCols, setExportCols] = React.useState(months.length || 1);
  const [exportLimit, setExportLimit] = React.useState<number | null>(null);

  const showRealRef = React.useRef(showReal);
  showRealRef.current = showReal;
  const justDragged = React.useRef(false);
  const boardRef = React.useRef(board);
  boardRef.current = board;
  const gridWrapRef = React.useRef<HTMLDivElement | null>(null);

  // Reseta inputs ao fechar diálogos.
  React.useEffect(() => {
    if (!addMonthOpen) setNewMonth("");
    if (!addMarcoOpen) setNewMarco("");
  }, [addMonthOpen, addMarcoOpen]);

  // --- Colunas visíveis (respeitando ocultas + limite de exportação) -------
  const visibleMonthsArr = exportLimit == null ? months : months.slice(0, exportLimit);
  const hiddenMonthsSet = React.useMemo(() => new Set(hiddenMonths), [hiddenMonths]);
  const hiddenRowsSet = React.useMemo(() => new Set(hiddenRows), [hiddenRows]);
  const visIdx = React.useMemo(
    () => visibleMonthsArr.map((_, i) => i).filter((i) => !hiddenMonthsSet.has(i)),
    [visibleMonthsArr, hiddenMonthsSet],
  );
  const visMonthLabels = visIdx.map((i) => months[i] ?? "");
  const visCount = Math.max(visIdx.length, 1);

  const toVis = React.useMemo(
    () => (pos: number) => {
      const whole = Math.floor(pos);
      const frac = pos - whole;
      let r = 0;
      for (const i of visIdx) if (i < whole) r++;
      return visIdx.includes(whole) ? r + frac : r;
    },
    [visIdx],
  );
  const fromVis = React.useMemo(
    () => (vpos: number) => {
      const whole = Math.floor(vpos + 1e-6);
      const frac = vpos - whole;
      if (whole < visIdx.length) return (visIdx[whole] ?? 0) + frac;
      return (visIdx.length ? visIdx[visIdx.length - 1] : -1) + 1 + frac;
    },
    [visIdx],
  );
  const fromVisRef = React.useRef(fromVis);
  fromVisRef.current = fromVis;
  const visCountRef = React.useRef(visCount);
  visCountRef.current = visCount;

  const colWidth = (absIdx: number) =>
    widthOverrides[absIdx] ?? defaultMonthWidth(months[absIdx] ?? "");
  const visWidths = visIdx.map(colWidth);
  const visWidthsRef = React.useRef(visWidths);
  visWidthsRef.current = visWidths;

  // --- Redimensionar largura de coluna -------------------------------------
  const onColResizePointerDown = (e: React.PointerEvent, absIdx: number) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidth(absIdx);
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const w = Math.min(Math.max(MIN_COL_WIDTH, startW + (ev.clientX - startX)), MAX_COL_WIDTH);
      setWidthOverrides((o) => ({ ...o, [absIdx]: Math.round(w) }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // --- Meses ---------------------------------------------------------------
  const commitAddMonth = () => {
    const name = newMonth.trim();
    if (!name) return;
    onChange({ ...board, months: [...months, name] });
    setAddMonthOpen(false);
  };

  const removeMonth = (absIdx: number) => {
    const nextMonths = months.filter((_, i) => i !== absIdx);
    const nextRows = rows.map((row) => ({
      ...row,
      bars: (row.bars || [])
        .filter((b) => b.start !== absIdx || b.end !== absIdx)
        .map((b) => {
          const start = b.start > absIdx ? b.start - 1 : b.start;
          return {
            ...b,
            start,
            end: b.end >= absIdx ? Math.max(start, b.end - 1) : b.end,
          };
        }),
      checkpoints: (row.checkpoints || [])
        .filter((c) => Math.floor(normalizeCheckpoint(c).pos) !== absIdx)
        .map((c) => {
          const cp = normalizeCheckpoint(c);
          return cp.pos > absIdx ? { ...cp, pos: cp.pos - 1 } : cp;
        }),
    }));
    setHiddenMonths((h) => h.filter((i) => i !== absIdx).map((i) => (i > absIdx ? i - 1 : i)));
    setWidthOverrides((prev) => {
      const next: Record<number, number> = {};
      for (const [k, v] of Object.entries(prev)) {
        const i = Number(k);
        if (i !== absIdx) next[i > absIdx ? i - 1 : i] = v;
      }
      return next;
    });
    onChange({ months: nextMonths, rows: nextRows });
  };

  // --- Marcos --------------------------------------------------------------
  const commitAddMarco = () => {
    const name = newMarco.trim();
    if (!name) return;
    onChange({ ...board, rows: [...rows, { marco: name, bars: [], checkpoints: [] }] });
    setAddMarcoOpen(false);
  };

  const removeMarco = (rowIdx: number) => {
    setHiddenRows((h) => h.filter((i) => i !== rowIdx).map((i) => (i > rowIdx ? i - 1 : i)));
    onChange({ ...board, rows: rows.filter((_, i) => i !== rowIdx) });
  };

  // --- Renomear mês / marco ------------------------------------------------
  const commitRename = () => {
    if (!rename) return;
    const value = rename.value.trim();
    if (!value) return;
    if (rename.type === "month") {
      onChange({ ...board, months: months.map((m, i) => (i === rename.index ? value : m)) });
    } else {
      onChange({
        ...board,
        rows: rows.map((r, i) => (i === rename.index ? { ...r, marco: value } : r)),
      });
    }
    setRename(null);
  };

  // --- Adicionar card / checkpoint -----------------------------------------
  const commitAddCard = () => {
    if (!addCard) return;
    const nextRows = rows.map((row, i) => {
      if (i !== addCard.rowIndex) return row;
      if (addCard.status === "checkpoint") {
        const cp: Checkpoint = { pos: addCard.monthIndex, lane: "plan" };
        return { ...row, checkpoints: [...(row.checkpoints || []), cp] };
      }
      const span = Math.min(daysToSpan(addCard.days), Math.max(1, months.length - addCard.monthIndex));
      const pairId = randomPairId();
      const base = {
        label: addCard.label.trim() || "Sem título",
        start: addCard.monthIndex,
        end: addCard.monthIndex + span - 1,
        status: addCard.status,
        pairId,
      };
      return {
        ...row,
        bars: [
          ...(row.bars || []),
          { ...base, kind: "plan" as BarKind },
          { ...base, kind: "real" as BarKind },
        ],
      };
    });
    onChange({ ...board, rows: nextRows });
    setAddCard(null);
  };

  const removeBar = (rowIdx: number, barIdx: number) => {
    const nextRows = rows.map((row, i) => {
      if (i !== rowIdx) return row;
      const bars = row.bars || [];
      const target = bars[barIdx];
      return {
        ...row,
        bars: bars.filter((b, t) => (target?.pairId ? b.pairId !== target.pairId : t !== barIdx)),
      };
    });
    onChange({ ...board, rows: nextRows });
  };

  const openEditBar = (rowIdx: number, barIdx: number) => {
    const bar = rows[rowIdx]?.bars?.[barIdx];
    if (!bar) return;
    setEditCard({
      rowIndex: rowIdx,
      barIndex: barIdx,
      isReal: bar.kind === "real",
      label: bar.label,
      status: bar.status,
      description: bar.description || "",
      realStatus: bar.realStatus ?? "",
    });
  };

  const commitEditCard = () => {
    if (!editCard) return;
    const label = editCard.label.trim() || "Sem título";
    const nextRows = rows.map((row, i) => {
      if (i !== editCard.rowIndex) return row;
      const bars = row.bars || [];
      const target = bars[editCard.barIndex];
      return {
        ...row,
        bars: bars.map((b, t) => {
          if (!(target?.pairId ? b.pairId === target.pairId : t === editCard.barIndex)) return b;
          const next: Bar = { ...b, label, status: editCard.status };
          if (t === editCard.barIndex) {
            const desc = editCard.description.trim();
            if (desc) next.description = desc;
            else delete next.description;
          }
          if (b.kind === "real" && editCard.isReal) {
            if (editCard.realStatus) next.realStatus = editCard.realStatus;
            else delete next.realStatus;
          }
          return next;
        }),
      };
    });
    onChange({ ...board, rows: nextRows });
    setEditCard(null);
  };

  // --- Arrastar/redimensionar barra ----------------------------------------
  const resizeBar = (rowIdx: number, barIdx: number, visStart: number, visSpan: number) => {
    const b = boardRef.current;
    const from = fromVisRef.current;
    const start = from(visStart);
    const end = from(visStart + visSpan) - 1;
    const nextRows = b.rows.map((row, r) =>
      r === rowIdx
        ? { ...row, bars: (row.bars || []).map((bar, t) => (t === barIdx ? { ...bar, start, end } : bar)) }
        : row,
    );
    onChange({ ...b, rows: nextRows });
  };

  const removeCheckpoint = (rowIdx: number, cpIdx: number) => {
    const nextRows = rows.map((row, i) =>
      i === rowIdx
        ? { ...row, checkpoints: (row.checkpoints || []).filter((_, t) => t !== cpIdx) }
        : row,
    );
    onChange({ ...board, rows: nextRows });
  };

  // Move um checkpoint (podendo trocá-lo de linha/faixa). Retorna o novo índice.
  const moveCheckpoint = (
    fromRow: number,
    cpIdx: number,
    toRow: number,
    visPos: number,
    lane: BarKind,
  ) => {
    const b = boardRef.current;
    const moved: Checkpoint = { pos: fromVisRef.current(visPos), lane };
    let newIdx = cpIdx;
    const nextRows = b.rows.map((row, i) => {
      if (fromRow === toRow) {
        return i === fromRow
          ? { ...row, checkpoints: (row.checkpoints || []).map((c, t) => (t === cpIdx ? moved : c)) }
          : row;
      }
      if (i === fromRow) {
        return { ...row, checkpoints: (row.checkpoints || []).filter((_, t) => t !== cpIdx) };
      }
      if (i === toRow) {
        const next = [...(row.checkpoints || []), moved];
        newIdx = next.length - 1;
        return { ...row, checkpoints: next };
      }
      return row;
    });
    onChange({ ...b, rows: nextRows });
    return newIdx;
  };

  // Colunas ocupadas por linha (esconde o "+" das células ocupadas).
  const occupied = React.useMemo(
    () =>
      rows.map((row) => {
        const set = new Set<number>();
        for (const bar of row.bars || []) {
          const a = Math.floor(bar.start);
          const b = Math.ceil(bar.end + 1) - 1;
          for (let i = a; i <= b; i++) set.add(i);
        }
        for (const c of row.checkpoints || []) set.add(Math.floor(normalizeCheckpoint(c).pos));
        return set;
      }),
    [rows],
  );

  const onCheckpointDragStart = (
    e: React.PointerEvent,
    rowIdx: number,
    cpIdx: number,
    visPos: number,
    lane: BarKind,
    trackEl: HTMLDivElement | null,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (!trackEl) return;
    const widths = visWidthsRef.current;
    const total = sumWidths(widths) || 1;
    const pxPerCol = trackEl.getBoundingClientRect().width / total;
    const startX = e.clientX;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragCp({ rowIndex: rowIdx, cpIndex: cpIdx });
    let moved = false;
    let raf = 0;
    let curLane = lane;
    let curRow = rowIdx;
    let curCp = cpIdx;
    let curPos = visPos;
    const handle = (clientX: number, clientY: number) => {
      const px = offsetPx(visPos, widths) + (clientX - startX) / (pxPerCol || 1);
      const max = Math.max(0, visCountRef.current);
      const pos = Math.min(Math.max(0, posFromPx(px, widths)), max);
      if (Math.abs(pos - curPos) > 0.001) moved = true;
      curPos = pos;
      let toRow = curRow;
      let toLane = curLane;
      const tracks = Array.from(document.querySelectorAll<HTMLElement>("[data-row-track]"));
      for (const el of tracks) {
        const rect = el.getBoundingClientRect();
        if (clientY >= rect.top && clientY <= rect.bottom) {
          toRow = Number(el.dataset.rowTrack);
          toLane = showRealRef.current && clientY > rect.top + rect.height / 2 ? "real" : "plan";
          break;
        }
      }
      if (toRow !== curRow || toLane !== curLane) moved = true;
      const newIdx = moveCheckpoint(curRow, curCp, toRow, Number(pos.toFixed(4)), toLane);
      curRow = toRow;
      curCp = newIdx;
      curLane = toLane;
      setDragCp({ rowIndex: toRow, cpIndex: newIdx });
    };
    const move = (ev: PointerEvent) => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => handle(ev.clientX, ev.clientY));
    };
    const up = () => {
      if (raf) cancelAnimationFrame(raf);
      setDragCp(null);
      justDragged.current = moved;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onBarDragStart = (
    e: React.PointerEvent,
    rowIdx: number,
    barIdx: number,
    mode: "move" | "resize-left" | "resize-right",
    start: number,
    span: number,
    trackEl: HTMLDivElement | null,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (!trackEl) return;
    const widths = visWidthsRef.current;
    const total = sumWidths(widths) || 1;
    const pxPerCol = trackEl.getBoundingClientRect().width / total;
    const startX = e.clientX;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragBar({ rowIndex: rowIdx, barIndex: barIdx });
    let raf = 0;
    let curStart = start;
    let curSpan = span;
    const handle = (clientX: number) => {
      const delta = (clientX - startX) / (pxPerCol || 1);
      const max = visCountRef.current;
      const snapped = (x: number) => snap(posFromPx(offsetPx(x, widths) + delta, widths));
      let nextStart = start;
      let nextSpan = span;
      if (mode === "move") {
        nextStart = Math.min(Math.max(0, snapped(start)), Math.max(0, max - span));
      } else if (mode === "resize-right") {
        const e2 = snapped(start + span);
        nextSpan = Math.min(Math.max(MIN_SPAN, e2 - start), max - start);
      } else {
        const d = Math.min(Math.max(-start, snapped(start) - start), span - MIN_SPAN);
        nextStart = start + d;
        nextSpan = span - d;
      }
      nextStart = Number(nextStart.toFixed(4));
      nextSpan = Number(nextSpan.toFixed(4));
      if (nextStart !== curStart || nextSpan !== curSpan) {
        curStart = nextStart;
        curSpan = nextSpan;
        resizeBar(rowIdx, barIdx, nextStart, nextSpan);
      }
    };
    const move = (ev: PointerEvent) => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = 0;
        handle(ev.clientX);
      });
    };
    const up = () => {
      if (raf) cancelAnimationFrame(raf);
      setDragBar(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // --- Exportar PNG --------------------------------------------------------
  const exportPng = async (cols: number | null) => {
    setExporting(true);
    const limit = cols == null ? null : Math.min(Math.max(cols, 1), Math.max(months.length, 1));
    if (limit != null) {
      setExportLimit(limit);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
    }
    const el = gridWrapRef.current;
    if (!el) {
      setExportLimit(null);
      setExporting(false);
      return;
    }
    const prevOverflow = el.style.overflow;
    const prevWidth = el.style.width;
    try {
      const { domToPng } = await import("modern-screenshot");
      el.style.overflow = "visible";
      el.style.width = `${el.scrollWidth}px`;
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const data = await domToPng(el, {
        scale: 2,
        backgroundColor: "#111827",
        width: el.scrollWidth,
        height: el.scrollHeight,
        style: { overflow: "visible" },
      });
      const a = document.createElement("a");
      a.href = data;
      const name = (clientLabel || "cronograma").replace(/\s+/g, "-").toLowerCase();
      a.download = `cronograma-${name}.png`;
      a.click();
    } finally {
      el.style.overflow = prevOverflow;
      el.style.width = prevWidth;
      setExportLimit(null);
      setExporting(false);
    }
  };

  const openExport = () => {
    setExportCols(Math.max(months.length, 1));
    setExportOpen(true);
  };

  // -------------------------------------------------------------------------
  return (
    <div className="neu-panel space-y-5">
      {/* Legenda + toggle "Real" */}
      <div className="flex flex-wrap items-center gap-5 pl-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rotate-45 rounded-[2px] border border-white/30 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.35)]" />
          <span className="text-white">Checkpoint</span>
        </div>
        {showReal &&
          REAL_STATUS_KEYS.map((key) => (
            <div key={key} className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${REAL_STATUS_BG[key]}`} />
              <span className="text-foreground">{REAL_STATUS_LABEL[key]}</span>
            </div>
          ))}
        <div className="neu-inset flex items-center gap-2 rounded-lg px-3 py-1.5">
          <Switch id="show-real" checked={showRealState} onCheckedChange={setShowReal} />
          <Label htmlFor="show-real" className="text-xs text-muted-foreground">
            Mostrar cards "Real"
          </Label>
        </div>
      </div>

      {/* Grade */}
      <div
        ref={gridWrapRef}
        className="table-grid-wrap overflow-x-auto rounded-xl border bg-background/30"
      >
        <table className="table-grid w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted/30">
              <th className="sticky-col sticky left-0 z-30 w-56 min-w-56 border-b border-r border-border/60 px-3 py-2.5 text-center text-xs font-medium text-muted-foreground bg-background/95">
                Marco
              </th>
              {visMonthLabels.map((label, t) => {
                const absIdx = visIdx[t];
                return (
                  <th
                    key={`${label}-${absIdx}`}
                    style={{ width: colWidth(absIdx), minWidth: colWidth(absIdx), maxWidth: colWidth(absIdx) }}
                    className="group relative border-b border-r border-border/60 px-3 py-2.5 text-xs font-semibold text-foreground last:border-r-0"
                  >
                    {canEdit && (
                      <span className="absolute inset-y-0 left-2 flex items-center opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => setRename({ type: "month", index: absIdx, value: label })}
                          aria-label={`Editar mês ${label}`}
                          className="cursor-pointer text-muted-foreground hover:text-foreground"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    )}
                    <span className="block w-full truncate text-center">{label}</span>
                    {canEdit && (
                      <>
                        <span className="absolute inset-y-0 right-4 flex items-center gap-4 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() => setHiddenMonths((h) => [...h, absIdx])}
                            aria-label={`Esconder mês ${label}`}
                            title="Esconder coluna"
                            className="cursor-pointer text-muted-foreground hover:text-foreground"
                          >
                            <EyeOff className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeMonth(absIdx)}
                            aria-label={`Remover mês ${label}`}
                            className="cursor-pointer text-muted-foreground hover:text-destructive"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </span>
                        <span
                          role="separator"
                          aria-label={`Ajustar largura da coluna ${label}`}
                          title="Arraste para ajustar a largura • duplo clique para redefinir"
                          onPointerDown={(e) => onColResizePointerDown(e, absIdx)}
                          onDoubleClick={() =>
                            setWidthOverrides((prev) => {
                              const next = { ...prev };
                              delete next[absIdx];
                              return next;
                            })
                          }
                          className="absolute inset-y-0 right-0 z-20 w-2 translate-x-1/2 cursor-col-resize touch-none select-none bg-transparent transition-colors hover:bg-primary/40"
                        />
                      </>
                    )}
                  </th>
                );
              })}
              <th className="min-w-[48px] border-b border-border/60 px-2 py-2.5 text-center">
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setAddMonthOpen(true)}
                    aria-label="Adicionar mês"
                    className="neu-button inline-flex h-6 w-6 items-center justify-center rounded-md"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, t) =>
              hiddenRowsSet.has(t) ? null : (
                <CronogramaRow
                  key={`${row.marco}-${t}`}
                  row={row}
                  rowIndex={t}
                  colCount={visCount}
                  widths={visWidths}
                  visIdx={visIdx}
                  toVis={toVis}
                  occupied={occupied[t] ?? new Set()}
                  showReal={showReal}
                  canEdit={canEdit}
                  draggingBar={dragBar?.rowIndex === t ? dragBar.barIndex : null}
                  draggingCp={dragCp?.rowIndex === t ? dragCp.cpIndex : null}
                  onRemoveMarco={() => removeMarco(t)}
                  onHideMarco={() => setHiddenRows((h) => [...h, t])}
                  onRenameMarco={() => setRename({ type: "marco", index: t, value: row.marco })}
                  onAddCard={(visColIdx) =>
                    setAddCard({
                      rowIndex: t,
                      monthIndex: visIdx[visColIdx] ?? 0,
                      label: "",
                      status: "andamento",
                      days: 30,
                    })
                  }
                  onEditBar={(barIdx) => openEditBar(t, barIdx)}
                  onRemoveCheckpoint={(cpIdx) => {
                    if (justDragged.current) {
                      justDragged.current = false;
                      return;
                    }
                    removeCheckpoint(t, cpIdx);
                  }}
                  onCheckpointDragStart={onCheckpointDragStart}
                  onDragStart={onBarDragStart}
                />
              ),
            )}
            {canEdit && (
              <tr>
                <td className="px-3 py-3">
                  <button
                    type="button"
                    onClick={() => setAddMarcoOpen(true)}
                    className="neu-button inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Marco
                  </button>
                </td>
                <td colSpan={visCount + 1} />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Rodapé: ocultos + exportar */}
      <div className="flex flex-wrap items-center justify-between gap-5">
        {hiddenMonths.length > 0 || hiddenRows.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <EyeOff className="h-3.5 w-3.5" />
              Ocultos:
            </span>
            {hiddenMonths.map((i) => (
              <button
                key={`hm-${i}`}
                type="button"
                onClick={() => setHiddenMonths((h) => h.filter((x) => x !== i))}
                title="Mostrar coluna"
                className="neu-button inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[11px]"
              >
                <Eye className="h-3 w-3" />
                {months[i] ?? `Mês ${i + 1}`}
              </button>
            ))}
            {hiddenRows.map((i) => (
              <button
                key={`hr-${i}`}
                type="button"
                onClick={() => setHiddenRows((h) => h.filter((x) => x !== i))}
                title="Mostrar linha"
                className="neu-button inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[11px]"
              >
                <Eye className="h-3 w-3" />
                {rows[i]?.marco ?? `Marco ${i + 1}`}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setHiddenMonths([]);
                setHiddenRows([]);
              }}
              className="cursor-pointer underline underline-offset-2 hover:text-foreground"
            >
              Mostrar tudo
            </button>
          </div>
        ) : (
          <div />
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={openExport}
          disabled={exporting}
          className="neu-button cursor-pointer gap-2 border-0 text-xs"
        >
          <Download className="h-3.5 w-3.5" />
          {exporting ? "Gerando PNG..." : "Exportar PNG"}
        </Button>
      </div>

      {/* Diálogo: modo de exportação */}
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="neu-dialog">
          <DialogHeader>
            <DialogTitle>Modo de exportação</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="export-cols">Colunas a exportar (1 a {Math.max(months.length, 1)})</Label>
            <Input
              id="export-cols"
              type="number"
              min={1}
              max={Math.max(months.length, 1)}
              value={exportCols}
              onChange={(e) => setExportCols(Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">
              Serão exportadas as primeiras{" "}
              {Math.min(Math.max(exportCols || 1, 1), Math.max(months.length, 1))} colunas da tabela.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" className="cursor-pointer" onClick={() => setExportOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              className="cursor-pointer"
              disabled={exporting}
              onClick={() => {
                setExportOpen(false);
                exportPng(exportCols);
              }}
            >
              Exportar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo: adicionar coluna */}
      <Dialog open={addMonthOpen} onOpenChange={setAddMonthOpen}>
        <DialogContent className="neu-dialog">
          <DialogHeader>
            <DialogTitle>Adicionar coluna</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="mes">Nome da coluna</Label>
            <Input
              id="mes"
              value={newMonth}
              onChange={(e) => setNewMonth(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && commitAddMonth()}
              placeholder="Ex.: Jan"
              className="neu-inset border-0"
            />
          </div>
          <DialogFooter>
            <Button className="neu-button" variant="ghost" onClick={() => setAddMonthOpen(false)}>
              Cancelar
            </Button>
            <Button className="neu-button-primary" onClick={commitAddMonth}>
              Adicionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo: adicionar marco */}
      <Dialog open={addMarcoOpen} onOpenChange={setAddMarcoOpen}>
        <DialogContent className="neu-dialog">
          <DialogHeader>
            <DialogTitle>Adicionar marco</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="marco">Nome do marco</Label>
            <Input
              id="marco"
              value={newMarco}
              onChange={(e) => setNewMarco(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && commitAddMarco()}
              placeholder="Ex.: CRM e funil de vendas"
              className="neu-inset border-0"
            />
          </div>
          <DialogFooter>
            <Button className="neu-button" variant="ghost" onClick={() => setAddMarcoOpen(false)}>
              Cancelar
            </Button>
            <Button className="neu-button-primary" onClick={commitAddMarco}>
              Adicionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo: renomear mês / marco */}
      <Dialog open={!!rename} onOpenChange={(o) => !o && setRename(null)}>
        <DialogContent className="neu-dialog">
          <DialogHeader>
            <DialogTitle>{rename?.type === "month" ? "Editar coluna" : "Editar marco"}</DialogTitle>
          </DialogHeader>
          {rename && (
            <div className="space-y-2">
              <Label htmlFor="rename-input">{rename.type === "month" ? "Nome da coluna" : "Nome do marco"}</Label>
              <Input
                id="rename-input"
                value={rename.value}
                onChange={(e) => setRename({ ...rename, value: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && commitRename()}
                className="neu-inset border-0"
                autoFocus
              />
            </div>
          )}
          <DialogFooter>
            <Button className="neu-button" variant="ghost" onClick={() => setRename(null)}>
              Cancelar
            </Button>
            <Button className="neu-button-primary" onClick={commitRename}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo: adicionar card */}
      <Dialog open={!!addCard} onOpenChange={(o) => !o && setAddCard(null)}>
        <DialogContent className="neu-dialog">
          <DialogHeader>
            <DialogTitle>Adicionar card</DialogTitle>
          </DialogHeader>
          {addCard && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Tipo</Label>
                <div className="flex flex-wrap gap-2">
                  {CARD_TYPES.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setAddCard({ ...addCard, status: opt.value })}
                      className={`neu-tab rounded-md px-3 py-1.5 text-xs font-medium ${
                        addCard.status === opt.value ? "is-active text-primary" : "text-muted-foreground"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              {addCard.status !== "checkpoint" && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="card-label">Título</Label>
                    <Input
                      id="card-label"
                      value={addCard.label}
                      onChange={(e) => setAddCard({ ...addCard, label: e.target.value })}
                      placeholder="Ex.: Setup CRM + funil"
                      className="neu-inset border-0"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Duração inicial</Label>
                    <div className="flex flex-wrap gap-2">
                      {DURATIONS.map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setAddCard({ ...addCard, days: d })}
                          className={`neu-tab rounded-md px-3 py-1.5 text-xs font-medium ${
                            addCard.days === d ? "is-active text-primary" : "text-muted-foreground"
                          }`}
                        >
                          {d} dias
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Padrão inicial: 30 dias = 1 coluna, 45 = 1,5 e 60 = 2. Depois é só arrastar as bordas do card.
                    </p>
                  </div>
                </>
              )}
            </div>
          )}
          <DialogFooter>
            <Button className="neu-button" variant="ghost" onClick={() => setAddCard(null)}>
              Cancelar
            </Button>
            <Button className="neu-button-primary" onClick={commitAddCard}>
              Adicionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo: editar card */}
      <Dialog open={!!editCard} onOpenChange={(o) => !o && setEditCard(null)}>
        <DialogContent className="neu-dialog">
          <DialogHeader>
            <DialogTitle>{editCard?.isReal ? 'Editar card "Real"' : "Editar card"}</DialogTitle>
          </DialogHeader>
          {editCard && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-label">Título</Label>
                <Input
                  id="edit-label"
                  value={editCard.label}
                  onChange={(e) => setEditCard({ ...editCard, label: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && commitEditCard()}
                  className="neu-inset border-0"
                />
              </div>
              {editCard.isReal && (
                <div className="space-y-3">
                  <Label className="text-sm font-semibold">Status</Label>
                  <div className="grid grid-cols-2 gap-3">
                    {REAL_STATUS_KEYS.map((key) => {
                      const active = editCard.realStatus === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setEditCard({ ...editCard, realStatus: active ? "" : key })}
                          className={`group relative flex items-center gap-2.5 rounded-lg border px-4 py-2.5 text-[13px] font-semibold transition-all duration-200 ease-out hover:-translate-y-0.5 hover:scale-[1.02] hover:shadow-md ${
                            active
                              ? `bg-background ${REAL_STATUS_BORDER[key]} shadow-sm ring-1 ring-primary/30 ring-offset-2 ring-offset-background`
                              : "border-border/50 bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                          }`}
                        >
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${REAL_STATUS_BG[key]} transition-transform duration-200 group-hover:scale-110`}
                          />
                          <span className="flex-1 text-left">{REAL_STATUS_LABEL[key]}</span>
                          {active && <Check className="h-4 w-4 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Exclusivo do card "Real". Clique novamente para remover.
                  </p>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="edit-desc">{editCard.isReal ? "Comentários" : "Descrição"}</Label>
                <Textarea
                  id="edit-desc"
                  rows={4}
                  value={editCard.description}
                  onChange={(e) => setEditCard({ ...editCard, description: e.target.value })}
                  placeholder={editCard.isReal ? "Observações da execução real..." : "Detalhe a atividade planejada..."}
                  className="neu-inset border-0 resize-none"
                />
                <p className="text-[11px] text-muted-foreground">Aparece ao passar o mouse sobre o card.</p>
              </div>
            </div>
          )}
          <DialogFooter className="sm:justify-between">
            <Button
              className="neu-button text-destructive hover:text-destructive"
              variant="ghost"
              onClick={() => {
                if (editCard) {
                  removeBar(editCard.rowIndex, editCard.barIndex);
                  setEditCard(null);
                }
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Excluir card
            </Button>
            <div className="flex gap-2">
              <Button className="neu-button" variant="ghost" onClick={() => setEditCard(null)}>
                Cancelar
              </Button>
              <Button className="neu-button-primary" onClick={commitEditCard}>
                Salvar
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Linha (marco) com sua faixa de cards + checkpoints
// ---------------------------------------------------------------------------
interface RowProps {
  row: import("@/lib/cronograma").Row;
  rowIndex: number;
  colCount: number;
  widths: number[];
  visIdx: number[];
  toVis: (pos: number) => number;
  occupied: Set<number>;
  showReal: boolean;
  canEdit: boolean;
  draggingBar: number | null;
  draggingCp: number | null;
  onRemoveMarco: () => void;
  onHideMarco: () => void;
  onRenameMarco: () => void;
  onAddCard: (visColIdx: number) => void;
  onEditBar: (barIdx: number) => void;
  onRemoveCheckpoint: (cpIdx: number) => void;
  onCheckpointDragStart: (
    e: React.PointerEvent,
    rowIdx: number,
    cpIdx: number,
    visPos: number,
    lane: BarKind,
    trackEl: HTMLDivElement | null,
  ) => void;
  onDragStart: (
    e: React.PointerEvent,
    rowIdx: number,
    barIdx: number,
    mode: "move" | "resize-left" | "resize-right",
    start: number,
    span: number,
    trackEl: HTMLDivElement | null,
  ) => void;
}

interface Tooltip {
  barIndex: number;
  x: number;
  y: number;
  label: string;
  statusLabel: string;
  days: number;
  description: string;
  realStatus?: RealStatus | "";
  isReal: boolean;
}

function CronogramaRow({
  row,
  rowIndex,
  colCount,
  widths,
  visIdx,
  toVis,
  occupied,
  showReal,
  canEdit,
  draggingBar,
  draggingCp,
  onRemoveMarco,
  onHideMarco,
  onRenameMarco,
  onAddCard,
  onEditBar,
  onRemoveCheckpoint,
  onCheckpointDragStart,
  onDragStart,
}: RowProps) {
  const trackRef = React.useRef<HTMLDivElement | null>(null);
  const [tooltip, setTooltip] = React.useState<Tooltip | null>(null);

  const total = sumWidths(widths) || 1;
  const leftPct = (pos: number) => `${(offsetPx(pos, widths) / total) * 100}%`;
  const widthPct = (pos: number, span: number) =>
    `${((offsetPx(pos + span, widths) - offsetPx(pos, widths)) / total) * 100}%`;

  const bars = (row.bars || [])
    .map((bar, barIndex) => ({ bar, barIndex }))
    .filter(({ bar }) => bar.kind !== "real" || showReal)
    .map(({ bar, barIndex }) => {
      const start = toVis(bar.start);
      return { bar, barIndex, start, span: toVis(bar.end + 1) - start };
    })
    .filter(({ span }) => span > 0.001);

  const barTop = (bar: Bar): React.CSSProperties =>
    showReal
      ? { top: bar.kind === "real" ? "44px" : "8px" }
      : { top: "50%", transform: "translateY(-50%)" };
  const addTop: React.CSSProperties = { top: "50%", transform: "translateY(-50%)" };
  const cpTop = (lane: BarKind): React.CSSProperties =>
    showReal
      ? { top: lane === "real" ? "53px" : "17px" }
      : { top: "50%", transform: "translateY(-50%)" };

  return (
    <tr className="group/row">
      <td className="sticky-col sticky left-0 z-30 border-b border-r border-border/50 px-3 py-2 align-middle text-xs font-semibold text-foreground bg-background/95">
        <span className="inline-flex items-center gap-5">
          {row.marco}
          {canEdit && (
            <>
              <button
                type="button"
                onClick={onRenameMarco}
                aria-label={`Editar marco ${row.marco}`}
                className="cursor-pointer opacity-0 transition-opacity group-hover/row:opacity-100 text-muted-foreground hover:text-foreground"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={onHideMarco}
                aria-label={`Esconder marco ${row.marco}`}
                title="Esconder linha"
                className="cursor-pointer opacity-0 transition-opacity group-hover/row:opacity-100 text-muted-foreground hover:text-foreground"
              >
                <EyeOff className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={onRemoveMarco}
                aria-label={`Remover marco ${row.marco}`}
                className="cursor-pointer opacity-0 transition-opacity group-hover/row:opacity-100 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </>
          )}
        </span>
      </td>
      <td colSpan={colCount} className="border-b border-border/50 p-0">
        <div
          ref={trackRef}
          data-row-track={rowIndex}
          className={`relative z-10 w-full group-hover/bar:z-40 ${showReal ? "h-[88px]" : "h-12"}`}
        >
          {/* Botões "+" nas células vazias (só admin) */}
          {canEdit && visIdx.map((_, t) =>
            occupied.has(visIdx[t] ?? t) ? null : (
              <div
                key={`empty-${t}`}
                className="absolute flex justify-center"
                style={{ ...addTop, left: leftPct(t), width: widthPct(t, 1) }}
              >
                <button
                  type="button"
                  onClick={() => onAddCard(t)}
                  aria-label="Adicionar card"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/50 hover:text-primary hover:bg-muted/40 transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            ),
          )}

          {/* Cards */}
          {bars.map(({ bar, barIndex, start, span }) => {
            const dragging = draggingBar === barIndex;
            const isReal = bar.kind === "real";
            const statusLabel = CARD_TYPES.find((t) => t.value === bar.status)?.label ?? bar.status;
            return (
              <div
                key={`bar-${barIndex}`}
                onMouseEnter={(ev) => {
                  const rect = ev.currentTarget.getBoundingClientRect();
                  setTooltip({
                    barIndex,
                    x: rect.left + rect.width / 2,
                    y: rect.bottom,
                    label: bar.label,
                    statusLabel,
                    days: spanToDays(span),
                    description: bar.description ?? "",
                    realStatus: bar.realStatus,
                    isReal,
                  });
                }}
                onMouseLeave={() => setTooltip(null)}
                className={`group/bar absolute px-0.5 will-change-[left,width] ${
                  dragging
                    ? "z-20 transition-[left,width] duration-100 ease-out"
                    : "z-10 transition-[left,width] duration-200 ease-out"
                }`}
                style={{ ...barTop(bar), left: leftPct(start), width: widthPct(start, span), minWidth: "44px" }}
              >
                <div
                  onPointerDown={
                    canEdit
                      ? (e) => onDragStart(e, rowIndex, barIndex, "move", start, span, trackRef.current)
                      : undefined
                  }
                  onDoubleClick={canEdit ? () => onEditBar(barIndex) : undefined}
                  className={`neu-bar relative flex h-7 min-w-0 touch-none select-none items-center overflow-hidden rounded-sm px-3 text-xs font-medium transition-[box-shadow,transform] duration-200 ${
                    canEdit ? "cursor-grab active:cursor-grabbing" : "cursor-default"
                  } ${dragging ? "scale-[1.02] shadow-lg ring-2 ring-primary/40" : ""} ${
                    isReal
                      ? bar.realStatus
                        ? REAL_STATUS_BG[bar.realStatus]
                        : `${PLAN_STATUS_BG[bar.status]} opacity-70 border border-dashed border-foreground/40`
                      : "bg-[rgb(251_191_36_/_var(--tw-bg-opacity,1))] text-black"
                  }`}
                >
                  <span className={`truncate ${canEdit ? "pr-12" : ""}`}>
                    {isReal ? `Real · ${bar.label}` : bar.label}
                  </span>
                  {canEdit && (
                    <>
                      <span
                        onPointerDown={(e) =>
                          onDragStart(e, rowIndex, barIndex, "resize-left", start, span, trackRef.current)
                        }
                        className={`absolute left-0 top-0 z-10 flex h-full w-5 cursor-ew-resize touch-none items-center justify-start rounded-l-sm border-l-[3px] border-foreground/60 bg-foreground/15 transition-opacity duration-150 hover:bg-foreground/25 group-hover/bar:opacity-100 ${
                          dragging ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      <span
                        onPointerDown={(e) =>
                          onDragStart(e, rowIndex, barIndex, "resize-right", start, span, trackRef.current)
                        }
                        className={`absolute right-0 top-0 z-10 flex h-full w-5 cursor-ew-resize touch-none items-center justify-end rounded-r-sm border-r-[3px] border-foreground/60 bg-foreground/15 transition-opacity duration-150 hover:bg-foreground/25 group-hover/bar:opacity-100 ${
                          dragging ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      <button
                        type="button"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => onEditBar(barIndex)}
                        aria-label="Editar card"
                        className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer opacity-0 group-hover/bar:opacity-100 transition-opacity"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    </>
                  )}
                </div>
                <span className="pointer-events-none absolute -bottom-0.5 left-1 text-[10px] text-muted-foreground opacity-0 group-hover/bar:opacity-100">
                  {spanToDays(span)} dias
                </span>
              </div>
            );
          })}

          {/* Checkpoints */}
          {(row.checkpoints || [])
            .map((c, cpIndex) => ({ cp: normalizeCheckpoint(c), cpIndex }))
            .filter(({ cp }) => {
              const t = Math.floor(cp.pos);
              return visIdx.includes(t) || t >= (visIdx[visIdx.length - 1] ?? -1) + 1;
            })
            .map(({ cp, cpIndex }) => {
              const active = draggingCp === cpIndex;
              const pos = Math.min(toVis(cp.pos), colCount);
              const lane = cp.lane ?? "plan";
              return (
                <div
                  key={`cp-${cpIndex}`}
                  className={`absolute flex justify-center ${
                    active ? "z-30" : "z-20 transition-[left,top] duration-200 ease-out"
                  }`}
                  style={{ ...cpTop(lane), left: leftPct(pos), width: 0, transform: "translateX(-50%)" }}
                >
                  <button
                    type="button"
                    onPointerDown={
                      canEdit
                        ? (e) => onCheckpointDragStart(e, rowIndex, cpIndex, pos, lane, trackRef.current)
                        : undefined
                    }
                    onClick={canEdit ? () => onRemoveCheckpoint(cpIndex) : undefined}
                    aria-label={canEdit ? "Mover ou remover checkpoint" : "Checkpoint"}
                    title={canEdit ? "Arraste para mover • clique para remover" : "Checkpoint"}
                    className={`h-2.5 w-2.5 shrink-0 grow-0 basis-2.5 rotate-45 bg-white neu-checkpoint touch-none transition-transform ${
                      canEdit ? "cursor-grab active:cursor-grabbing hover:scale-125" : "cursor-default"
                    } ${active ? "scale-150 ring-2 ring-white/40" : ""}`}
                  />
                </div>
              );
            })}

          {/* Tooltip */}
          {tooltip &&
            createPortal(
              <div
                className="pointer-events-none fixed z-[9999] w-64 -translate-x-1/2 animate-in fade-in zoom-in-95 duration-200"
                style={{ left: tooltip.x, top: tooltip.y + 8 }}
              >
                <div className="neu-card rounded-lg border border-primary/30 bg-card p-3 shadow-2xl">
                  <div className="mb-1 flex items-center gap-1.5">
                    <span
                      className={`h-2 w-2 rounded-full ${tooltip.isReal ? "bg-white/70" : "bg-[rgb(251_191_36)]"}`}
                    />
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">
                      {tooltip.isReal ? "Real" : "Planejado"}
                    </span>
                  </div>
                  <p className="text-sm font-semibold leading-snug text-foreground">{tooltip.label}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                    <span className="neu-inset rounded-full px-2 py-0.5 text-muted-foreground">
                      {tooltip.statusLabel}
                    </span>
                    {tooltip.realStatus && (
                      <span className={`rounded-full px-2 py-0.5 font-medium ${REAL_STATUS_BG[tooltip.realStatus]}`}>
                        {REAL_STATUS_LABEL[tooltip.realStatus]}
                      </span>
                    )}
                    <span className="neu-inset rounded-full px-2 py-0.5 text-muted-foreground">
                      {tooltip.days} dias
                    </span>
                  </div>
                  {tooltip.description ? (
                    <p className="mt-2 border-t border-border/40 pt-2 text-[11px] leading-relaxed text-muted-foreground">
                      {tooltip.description}
                    </p>
                  ) : (
                    <p className="mt-2 border-t border-border/40 pt-2 text-[11px] italic text-muted-foreground/60">
                      Sem descrição.
                    </p>
                  )}
                </div>
                <span className="absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 -translate-y-1 rotate-45 border-l border-t border-primary/30 bg-card" />
              </div>,
              document.body,
            )}
        </div>
      </td>
      <td className="border-b border-border/50" />
    </tr>
  );
}
