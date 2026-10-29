import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// companium-db (mesmo projeto/sessão autenticada usado por TODO o resto do app). O client
// default `@/integrations/supabase/client` aponta p/ outro projeto (sem sessão), então
// as views RLS-authenticated e as tabelas do cronograma voltavam vazias — bug do seletor.
import { externalSupabase as supabase } from "@/integrations/external-supabase/client";
import { buildClientCanonicalMap, prettyClientLabel } from "@/data/clienteAliases";
import { Board, DEFAULT_BOARD, RealStatus, normalizeCheckpoint } from "@/lib/cronograma";

// ---------------------------------------------------------------------------
// Persistência do Cronograma no Supabase (projeto companium-db / companium).
//
// Três tabelas (ver migration 2026..._projetos_cronograma_EXTERNAL.sql):
//   projetos_cronograma_meses   — colunas (meses) por cliente
//   projetos_cronograma_marcos  — linhas (marcos) por cliente
//   projetos_cronograma_cards   — cards/checkpoints por cliente (a "tabela do cronograma")
//
// Salvamento = "replace" (apaga tudo do cliente e reinsere), disparado com
// debounce a cada edição — mesmo padrão de replace usado em outras telas.
// ---------------------------------------------------------------------------

const MESES = "projetos_cronograma_meses";
const MARCOS = "projetos_cronograma_marcos";
const CARDS = "projetos_cronograma_cards";

interface CardRow {
  cliente: string;
  marco_ordem: number;
  ordem: number;
  tipo: "card" | "checkpoint";
  kind: "plan" | "real";
  titulo: string;
  status: string | null;
  real_status: RealStatus | null;
  mes_inicio: number;
  mes_fim: number;
  duracao_dias: number | null;
  descricao: string | null;
  pair_id: string | null;
  checkpoint_pos: number | null;
  checkpoint_lane: "plan" | "real" | null;
}

/**
 * Lista COMPLETA de clientes do Companium, sem duplicidades. Mesma fonte usada em
 * todas as telas de /clientes: união canônica de Ads (`list_ads_clients`) + Kommo
 * (`list_kommo_clients`) via `buildClientCanonicalMap`. Retorna os rótulos amigáveis
 * (prettyClientLabel) já deduplicados e ordenados em pt-BR.
 */
export function useCronogramaClients() {
  const [clients, setClients] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [adsRes, kommoRes] = await Promise.all([
          supabase.rpc("list_ads_clients"),
          supabase.rpc("list_kommo_clients"),
        ]);
        if (adsRes.error) throw adsRes.error;
        if (kommoRes.error) throw kommoRes.error;

        const adsNames = new Set<string>();
        for (const r of (adsRes.data as { client: string | null }[]) || []) {
          if (r.client) adsNames.add(r.client);
        }
        const kommoNames = new Set<string>();
        for (const r of (kommoRes.data as { client: string | null }[]) || []) {
          if (r.client) kommoNames.add(r.client);
        }

        const { canonicalList } = buildClientCanonicalMap({
          adsNames: [...adsNames],
          kommoNames: [...kommoNames],
        });

        // canonical (slug) → rótulo amigável; dedup por rótulo (case-insensitive).
        const seen = new Set<string>();
        const out: string[] = [];
        for (const canonical of canonicalList) {
          const label = prettyClientLabel(canonical);
          const k = label.toLowerCase();
          if (!label || seen.has(k)) continue;
          seen.add(k);
          out.push(label);
        }
        out.sort((a, b) => a.localeCompare(b, "pt-BR"));

        if (!alive) return;
        setClients(out);
        setError(null);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || String(e));
        setClients([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return { clients, loading, error };
}

// --- Montagem Board <-> linhas do banco ------------------------------------
function rowsToBoard(
  meses: { ordem: number; nome: string }[],
  marcos: { ordem: number; nome: string }[],
  cards: CardRow[],
): Board {
  const months = [...meses].sort((a, b) => a.ordem - b.ordem).map((m) => m.nome);
  const rows = [...marcos]
    .sort((a, b) => a.ordem - b.ordem)
    .map((m) => ({ marco: m.nome, bars: [] as Board["rows"][number]["bars"], checkpoints: [] as Board["rows"][number]["checkpoints"] }));

  for (const c of [...cards].sort((a, b) => a.marco_ordem - b.marco_ordem || a.ordem - b.ordem)) {
    const row = rows[c.marco_ordem];
    if (!row) continue;
    if (c.tipo === "checkpoint") {
      row.checkpoints.push({ pos: c.checkpoint_pos ?? 0, lane: c.checkpoint_lane ?? "plan" });
    } else {
      row.bars.push({
        label: c.titulo,
        start: c.mes_inicio,
        end: c.mes_fim,
        status: c.status ?? "andamento",
        pairId: c.pair_id ?? "",
        kind: c.kind,
        ...(c.descricao ? { description: c.descricao } : {}),
        ...(c.kind === "real" && c.real_status ? { realStatus: c.real_status } : {}),
      });
    }
  }
  return { months, rows };
}

function boardToCardRows(cliente: string, board: Board): CardRow[] {
  const out: CardRow[] = [];
  board.rows.forEach((row, marcoOrdem) => {
    let ordem = 0;
    for (const bar of row.bars || []) {
      out.push({
        cliente,
        marco_ordem: marcoOrdem,
        ordem: ordem++,
        tipo: "card",
        kind: bar.kind,
        titulo: bar.label,
        status: bar.status ?? null,
        real_status: bar.kind === "real" && bar.realStatus ? bar.realStatus : null,
        mes_inicio: bar.start,
        mes_fim: bar.end,
        duracao_dias: Math.round((bar.end - bar.start + 1) * 30),
        descricao: bar.description ?? null,
        pair_id: bar.pairId ?? null,
        checkpoint_pos: null,
        checkpoint_lane: null,
      });
    }
    for (const c of row.checkpoints || []) {
      const cp = normalizeCheckpoint(c);
      out.push({
        cliente,
        marco_ordem: marcoOrdem,
        ordem: ordem++,
        tipo: "checkpoint",
        kind: "plan",
        titulo: "",
        status: null,
        real_status: null,
        mes_inicio: 0,
        mes_fim: 0,
        duracao_dias: null,
        descricao: null,
        pair_id: null,
        checkpoint_pos: cp.pos,
        checkpoint_lane: cp.lane,
      });
    }
  });
  return out;
}

/** Carrega o board de um cliente. Retorna board vazio se não houver dados. */
export async function loadBoard(cliente: string): Promise<Board> {
  const [meses, marcos, cards] = await Promise.all([
    supabase.from(MESES).select("ordem, nome").eq("cliente", cliente),
    supabase.from(MARCOS).select("ordem, nome").eq("cliente", cliente),
    supabase.from(CARDS).select("*").eq("cliente", cliente),
  ]);
  const err = meses.error || marcos.error || cards.error;
  if (err) throw err;
  return rowsToBoard(
    (meses.data as any) || [],
    (marcos.data as any) || [],
    (cards.data as any) || [],
  );
}

/** Substitui todos os dados do cliente pelo board atual. */
export async function saveBoard(cliente: string, board: Board): Promise<void> {
  await deleteBoard(cliente);
  const meses = board.months.map((nome, ordem) => ({ cliente, ordem, nome }));
  const marcos = board.rows.map((r, ordem) => ({ cliente, ordem, nome: r.marco }));
  const cards = boardToCardRows(cliente, board);
  if (meses.length) {
    const { error } = await supabase.from(MESES).insert(meses);
    if (error) throw error;
  }
  if (marcos.length) {
    const { error } = await supabase.from(MARCOS).insert(marcos);
    if (error) throw error;
  }
  if (cards.length) {
    const { error } = await supabase.from(CARDS).insert(cards);
    if (error) throw error;
  }
}

export async function deleteBoard(cliente: string): Promise<void> {
  await Promise.all([
    supabase.from(CARDS).delete().eq("cliente", cliente),
    supabase.from(MARCOS).delete().eq("cliente", cliente),
    supabase.from(MESES).delete().eq("cliente", cliente),
  ]);
}

/** Quais clientes já têm cronograma salvo (para marcar no seletor). */
export async function fetchSavedClients(): Promise<string[]> {
  const { data, error } = await supabase.from(MARCOS).select("cliente");
  if (error) throw error;
  const set = new Set<string>();
  for (const r of (data as { cliente: string }[]) || []) set.add(r.cliente);
  // meses também pode existir sem marcos (cliente só com colunas)
  const { data: m } = await supabase.from(MESES).select("cliente");
  for (const r of (m as { cliente: string }[]) || []) set.add(r.cliente);
  return [...set];
}

/**
 * Board de um cliente com autosave (debounce). `client` = null quando é o
 * rascunho "Cliente novo" (fica só em memória até salvar com um nome).
 */
export function useCronogramaBoard(client: string | null) {
  const [board, setBoard] = useState<Board>(DEFAULT_BOARD);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clientRef = useRef<string | null>(client);
  clientRef.current = client;

  // Carrega ao trocar de cliente.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!client) {
      setBoard(DEFAULT_BOARD);
      setLoading(false);
      setError(null);
      return;
    }
    let alive = true;
    setLoading(true);
    loadBoard(client)
      .then((b) => {
        if (alive) {
          setBoard(b);
          setError(null);
        }
      })
      .catch((e) => {
        if (alive) setError(e?.message || String(e));
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [client]);

  // Persiste com debounce.
  const persist = useCallback((next: Board) => {
    const c = clientRef.current;
    if (!c) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setSaving(true);
      try {
        await saveBoard(c, next);
        setError(null);
      } catch (e: any) {
        setError(e?.message || String(e));
      } finally {
        setSaving(false);
      }
    }, 700);
  }, []);

  const onChange = useCallback(
    (next: Board) => {
      setBoard(next);
      persist(next);
    },
    [persist],
  );

  useEffect(() => () => timer.current && clearTimeout(timer.current), []);

  return { board, setBoard, onChange, loading, saving, error };
}
