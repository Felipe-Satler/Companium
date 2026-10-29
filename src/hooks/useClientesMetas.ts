import { useState, useEffect, useCallback, useMemo } from "react";
import {
  startOfMonth,
  endOfMonth,
  getDaysInMonth,
  differenceInCalendarDays,
  format,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { externalSupabase } from "@/integrations/external-supabase/client";
import { clientMatchKey, canonicalizeAdsClient, prettyClientLabel } from "@/data/clienteAliases";
import { withRetry } from "@/hooks/dataCache";
import { toast } from "@/hooks/use-toast";

/**
 * METAS por cliente × MÊS (tabela `clientes_meta`, projeto companium-db).
 *
 * O valor salvo é SEMPRE o alvo do MÊS INTEIRO. Para exibir ao lado do "real" num
 * período qualquer (dia, semana, mês, vários meses) este hook:
 *   - ABSOLUTOS (investimento, leads, consultas, faturamento): rateia cada mês pela
 *     fração de dias coberta pelo período e SOMA os meses → "divide" o mês p/ dia/semana.
 *   - TAXAS (cpl, roas): NÃO rateia (um CPL-alvo de R$15 é R$15 em qualquer recorte);
 *     com vários meses, média ponderada pelos dias cobertos.
 *
 * Identidade: o dashboard usa SLUG canônico; clientes_meta.client_id é uuid → clientes.id.
 * A ponte é a view `v_clientes_lookup` (id, nome_identificador, nome_bruto), casada por
 * `clientMatchKey` (igual ao useEspecialidades). Escrita como `authenticated` (RLS),
 * então a meta vale para todas as contas.
 */

// Pontes p/ os poucos clientes cujo slug canônico NÃO bate por clientMatchKey com o
// nome_identificador da base (contas no "balde groohub" ou ausentes). Espelha o
// CANONICAL_ESP_ALIASES do useEspecialidades. chave = matchKey(slug) → matchKey(nome_id).
const CANONICAL_ID_ALIASES: Record<string, string> = {
  [clientMatchKey("Vista_Nova")]: clientMatchKey("centro oftalmologico vista nova"),
  [clientMatchKey("Carlos_Sena")]: clientMatchKey("carlos sena filho"),
  [clientMatchKey("Fabio_Morais")]: clientMatchKey("fabio morais filho"),
  [clientMatchKey("Luis_Fernando")]: clientMatchKey("luis fernando barreto"),
  [clientMatchKey("Luis_Pacheco")]: clientMatchKey("luis felipe pacheco"),
  // Bellucci → Lia Garrido: o canônico agora é "Lia_Garrido", que já casa por clientMatchKey
  // com o nome_identificador "lia garrido" da tabela clientes — sem ponte necessária.
};

// Colunas de meta na tabela. `kind` decide o rateio e a formatação.
export type MetaKind = "currency" | "count" | "ratio";
export interface MetaField {
  col: string;
  kind: MetaKind;
}
export const META_FIELDS = {
  // Planejado UNIFICADO do cliente — editado na tela de CRM (Investimento, Leads CRM, CPL CRM).
  // Um único alvo por cliente/mês; as colunas (`investimento`/`leads`/`cpl`) são as MESMAS de
  // sempre, então todo planejado já preenchido continua valendo (só mudou o LUGAR de edição:
  // antes nos painéis Meta/Google, agora tudo concentrado no CRM).
  investimento: { col: "investimento", kind: "currency" },
  leadsCRM: { col: "leads", kind: "count" },
  cplCRM: { col: "cpl", kind: "currency" },
  consultaAgendada: { col: "consulta_agendada", kind: "count" },
  consultaRealizada: { col: "consulta_realizada", kind: "count" },
  procedimentoAgendado: { col: "procedimento_agendado", kind: "count" },
  procedimentoRealizado: { col: "procedimento_realizado", kind: "count" },
  faturamento: { col: "faturamento", kind: "currency" },
  roas: { col: "roas", kind: "ratio" },
} as const satisfies Record<string, MetaField>;

export type MetaKey = keyof typeof META_FIELDS;

// Planejados MUTUAMENTE EXCLUSIVOS: preencher um ZERA (limpa) o outro. O cliente define a
// meta de procedimento em UM dos dois (agendado OU realizado), nunca nos dois ao mesmo tempo.
// Reflete nos dois lados: no salvamento (o irmão vira null no mesmo upsert) e nos alertas de
// preenchimento (o campo vazio não é cobrado quando o irmão já tem valor).
export const META_EXCLUSIVE: Partial<Record<MetaKey, MetaKey>> = {
  procedimentoAgendado: "procedimentoRealizado",
  procedimentoRealizado: "procedimentoAgendado",
};

// Resultado para um campo num período: o valor (null = nenhuma meta cadastrada) já
// rateado/somado, e a presença (algum mês teve valor) p/ decidir se exibe a linha.
export interface MetaResolved {
  value: number | null;
  kind: MetaKind;
}
export type MetaValues = Record<MetaKey, MetaResolved>;

interface MetaRow {
  client_id: string;
  mes: string; // 'YYYY-MM-DD' (dia 01)
  medico?: string; // '' = planejado geral do cliente; !='' = planejado por médico (só Lia Garrido)
  [col: string]: number | string | null | undefined;
}

// Sobreposição (em dias) entre um mês e o período [from, to] (datas civis).
function coveredDays(monthDate: Date, from?: Date, to?: Date): { covered: number; inMonth: number } {
  const mStart = startOfMonth(monthDate);
  const mEnd = endOfMonth(monthDate);
  const inMonth = getDaysInMonth(monthDate);
  if (!from && !to) return { covered: inMonth, inMonth }; // todo o histórico → mês cheio
  const lo = from && from > mStart ? from : mStart;
  const hi = to && to < mEnd ? to : mEnd;
  const covered = Math.max(0, differenceInCalendarDays(hi, lo) + 1);
  return { covered: Math.min(covered, inMonth), inMonth };
}

// Busca TODAS as linhas de uma tabela/view paginando por .range() — o PostgREST corta em
// 1000 linhas/resposta, então sem isso o carregamento de metas/lookup truncaria em silêncio
// (planejados de alguns clientes sumiriam da tela mesmo estando no banco). Ordena por uma
// coluna estável p/ o range não pular/duplicar entre páginas.
// LANÇA em erro (com code/status do PostgREST) — o chamador envolve em `withRetry` p/ que um
// timeout/queda transitória NÃO zere o planejado (a versão antiga engolia o erro e devolvia
// vazio, sumindo o planejado de TODOS os clientes até um reload manual).
async function fetchAllRows(table: string, select: string, orderCol: string): Promise<any[]> {
  const PAGE = 1000;
  const all: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await externalSupabase
      .from(table)
      .select(select)
      .order(orderCol, { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw Object.assign(new Error(error.message), error);
    const batch = data ?? [];
    all.push(...batch);
    if (batch.length < PAGE) break;
  }
  return all;
}

// medico '' = planejado geral do cliente (comportamento de sempre). Para a Lia Garrido,
// a tela de CRM grava/lê o planejado por médico usando o médico filtrado como chave; os
// demais clientes sempre usam '' e ficam idênticos ao que era antes.
export const META_MEDICO_GERAL = "";

// Chave "frouxa": clientMatchKey SEM as palavras conectivas (de/da/do/...). Rede de segurança
// p/ o planejado casar quando o nome do dropdown diverge do nome_identificador só por conectivo
// (ex.: Ads "Instituto Urológico Aurora" × Kommo "Instituto Urológico DE Contagem"). Só é
// usada como fallback e SÓ quando não é ambígua (uma única clientes-row com aquela chave frouxa),
// então nunca resolve p/ o cliente errado.
const NAME_CONNECTORS = new Set(["de", "da", "do", "das", "dos", "e"]);
function looseClientKey(s: string): string {
  return clientMatchKey(s)
    .split("_")
    .filter((t) => t && !NAME_CONNECTORS.has(t))
    .join("_");
}

export function useClientesMetas() {
  // matchKey(slug) → client_id (uuid)
  const [idByKey, setIdByKey] = useState<Map<string, string>>(new Map());
  // chave frouxa (sem conectivos) → client_id, só entradas NÃO ambíguas (fallback do resolveId)
  const [looseIdByKey, setLooseIdByKey] = useState<Map<string, string>>(new Map());
  // client_id → (ym 'YYYY-MM' → (medico → row))
  const [metaByClient, setMetaByClient] = useState<Map<string, Map<string, Map<string, MetaRow>>>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Recarrega o planejado. Retorna true se os dados foram (re)carregados; false se os fetches
  // falharam mesmo após retry — nesse caso o ESTADO ATUAL É PRESERVADO (nunca zeramos o
  // planejado por causa de uma falha transitória) e o efeito reagenda com backoff.
  const reload = useCallback(async (): Promise<boolean> => {
    // Os dois fetches são INDEPENDENTES: uma falha num NÃO pode zerar o outro. Em especial, se
    // `v_clientes_lookup` falhar (ex.: grant/permissão), a VISUALIZAÇÃO do planejado (que só
    // depende de `clientes_meta`) tem que continuar aparecendo. Cada fonte mantém o último
    // estado bom em caso de erro; devolvemos false (p/ reagendar) se QUALQUER uma falhar.
    const [lookupRes, metaRes] = await Promise.allSettled([
      withRetry(() => fetchAllRows("v_clientes_lookup", "id, nome_identificador, nome_bruto", "id")),
      withRetry(() =>
        fetchAllRows(
          "clientes_meta",
          "client_id, mes, medico, investimento, leads, cpl, consulta_agendada, consulta_realizada, procedimento_agendado, procedimento_realizado, faturamento, roas",
          "id",
        ),
      ),
    ]);

    if (lookupRes.status === "fulfilled") {
      const ids = new Map<string, string>();
      // chave frouxa → id, marcando ambíguas (mesma chave frouxa p/ ids diferentes) p/ descartar.
      const loose = new Map<string, string>();
      const looseAmbiguous = new Set<string>();
      const addLoose = (name: string, id: string) => {
        const lk = looseClientKey(name);
        if (!lk) return;
        const cur = loose.get(lk);
        if (cur && cur !== id) looseAmbiguous.add(lk);
        else loose.set(lk, id);
      };
      for (const r of lookupRes.value as { id: string; nome_identificador: string | null; nome_bruto: string | null }[]) {
        // NÃO indexar o balde catch-all "groohub" (nome_identificador com rótulo vazio).
        // A view devolve UMA linha por conta ativa, e esse cliente acumula contas mal-arquivadas
        // de vários clientes reais (Fábio Morais, etc.). Se registrássemos o `nome_bruto` dele,
        // `canonicalizeAdsClient` viraria o slug de um cliente real (ex.: "Fabio_Morais") e
        // `resolveId` daria match EXATO no id do balde ANTES do CANONICAL_ID_ALIASES → o card
        // puxaria a meta ERRADA (a do balde). Fora do índice, o slug cai no alias → id real (sem
        // meta) ou em nada — nunca na meta de outro cliente. Só a linha do balde é pulada; contas
        // corretamente arquivadas no próprio cliente continuam resolvendo normalmente.
        if (prettyClientLabel(r.nome_identificador ?? "").trim() === "") continue;
        if (r.nome_identificador) { ids.set(clientMatchKey(r.nome_identificador), r.id); addLoose(r.nome_identificador, r.id); }
        if (r.nome_bruto) { const c = canonicalizeAdsClient(r.nome_bruto); ids.set(clientMatchKey(c), r.id); addLoose(c, r.id); }
      }
      for (const lk of looseAmbiguous) loose.delete(lk);
      setIdByKey(ids);
      setLooseIdByKey(loose);
    } else {
      console.warn("[useClientesMetas] lookup falhou (mantém último estado bom):", (lookupRes.reason as Error)?.message);
    }

    if (metaRes.status === "fulfilled") {
      const byClient = new Map<string, Map<string, Map<string, MetaRow>>>();
      for (const r of metaRes.value as MetaRow[]) {
        if (!r.client_id || !r.mes) continue;
        const ym = String(r.mes).slice(0, 7);
        const medico = r.medico ?? META_MEDICO_GERAL;
        let m = byClient.get(r.client_id);
        if (!m) { m = new Map(); byClient.set(r.client_id, m); }
        let byMed = m.get(ym);
        if (!byMed) { byMed = new Map(); m.set(ym, byMed); }
        byMed.set(medico, r);
      }
      setMetaByClient(byClient);
    } else {
      console.warn("[useClientesMetas] metas falharam (mantém último estado bom):", (metaRes.reason as Error)?.message);
    }

    return lookupRes.status === "fulfilled" && metaRes.status === "fulfilled";
  }, []);

  useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      const ok = await reload();
      if (cancelled) return;
      setLoading(false);
      // Se falhou (sem zerar o estado), reprograma com backoff exponencial (cap 15s) até o
      // planejado voltar — o usuário não precisa recarregar a página.
      if (!ok && attempt < 8) {
        const delay = Math.min(1500 * 2 ** attempt, 15000) + Math.random() * 400;
        attempt++;
        timer = setTimeout(() => { void run(); }, delay);
      } else {
        attempt = 0;
      }
    };
    void run();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [reload]);

  // slug canônico → client_id. Ordem: match exato → ponte manual (CANONICAL_ID_ALIASES) →
  // match frouxo (sem conectivos, só quando não-ambíguo). O frouxo faz o planejado aparecer p/
  // clientes cujo nome do dropdown difere do nome_identificador só por "de/da/do" (ex.: IUC),
  // sem depender de alias manual nem criar linha duplicada. undefined = sem cadastro na base.
  const resolveId = useCallback(
    (slug: string): string | undefined => {
      const key = clientMatchKey(slug);
      return (
        idByKey.get(key) ??
        (CANONICAL_ID_ALIASES[key] ? idByKey.get(CANONICAL_ID_ALIASES[key]) : undefined) ??
        looseIdByKey.get(looseClientKey(slug))
      );
    },
    [idByKey, looseIdByKey],
  );

  // Metas resolvidas (rateadas/somadas) para o período. slug "all" → agrega todos os clientes.
  // `medico` !='' escopa o planejado ao médico filtrado (só usado na Lia Garrido); no
  // agregado ("all") o médico é ignorado e sempre usamos o planejado geral ('').
  const resolveMeta = useCallback(
    (slug: string, from?: Date, to?: Date, medico: string = META_MEDICO_GERAL): MetaValues => {
      const isAll = slug === "all";
      const clientIds = isAll ? [...metaByClient.keys()] : (() => { const id = resolveId(slug); return id ? [id] : []; })();
      const scope = isAll ? META_MEDICO_GERAL : medico;

      const out = {} as MetaValues;
      for (const k of Object.keys(META_FIELDS) as MetaKey[]) {
        const { col, kind } = META_FIELDS[k];
        let absSum = 0; // soma rateada (absolutos)
        let wNum = 0, wDen = 0; // média ponderada (taxas)
        let present = false;

        for (const id of clientIds) {
          const months = metaByClient.get(id);
          if (!months) continue;
          for (const [ym, byMed] of months) {
            const row = byMed.get(scope);
            if (!row) continue;
            const raw = row[col];
            if (raw == null || raw === "") continue;
            const v = typeof raw === "number" ? raw : Number(raw);
            if (!Number.isFinite(v)) continue;
            const monthDate = new Date(`${ym}-01T00:00:00`);
            const { covered, inMonth } = coveredDays(monthDate, from, to);
            if (covered <= 0) continue;
            present = true;
            if (kind === "ratio" || (kind === "currency" && k === "cplCRM")) {
              // taxa: média ponderada pelos dias cobertos, sem rateio.
              wNum += v * covered;
              wDen += covered;
            } else {
              absSum += v * (covered / inMonth);
            }
          }
        }

        const isRate = kind === "ratio" || k === "cplCRM";
        out[k] = { value: !present ? null : isRate ? (wDen > 0 ? wNum / wDen : null) : absSum, kind };
      }
      return out;
    },
    [metaByClient, resolveId],
  );

  // Meta de UM mês específico (ym 'YYYY-MM'), rateada pelos dias cobertos do período
  // (mesma lógica de resolveMeta, mas por mês individual). Usada nas linhas de meta dos
  // gráficos de evolução mensal: cada barra é um mês, então a linha corta na altura do
  // alvo daquele mês. Só faz sentido p/ absolutos (count/currency); soma no "all".
  const resolveMonthlyMeta = useCallback(
    (slug: string, field: MetaKey, ym: string, from?: Date, to?: Date, medico: string = META_MEDICO_GERAL): number | null => {
      const isAll = slug === "all";
      const clientIds = isAll ? [...metaByClient.keys()] : (() => { const id = resolveId(slug); return id ? [id] : []; })();
      const scope = isAll ? META_MEDICO_GERAL : medico;
      const { col } = META_FIELDS[field];
      const monthDate = new Date(`${ym}-01T00:00:00`);
      const { covered, inMonth } = coveredDays(monthDate, from, to);
      if (covered <= 0) return null;
      let sum = 0;
      let present = false;
      for (const id of clientIds) {
        const raw = metaByClient.get(id)?.get(ym)?.get(scope)?.[col];
        if (raw == null || raw === "") continue;
        const v = typeof raw === "number" ? raw : Number(raw);
        if (!Number.isFinite(v)) continue;
        present = true;
        sum += v * (covered / inMonth);
      }
      return present ? sum : null;
    },
    [metaByClient, resolveId],
  );

  // Valor do MÊS-ÂNCORA (mês de `from`, ou mês atual) para preencher o editor inline.
  const getMonthValue = useCallback(
    (slug: string, field: MetaKey, from?: Date, medico: string = META_MEDICO_GERAL): number | null => {
      const id = resolveId(slug);
      if (!id) return null;
      const ym = format(startOfMonth(from ?? new Date()), "yyyy-MM");
      const raw = metaByClient.get(id)?.get(ym)?.get(medico)?.[META_FIELDS[field].col];
      if (raw == null || raw === "") return null;
      const v = typeof raw === "number" ? raw : Number(raw);
      return Number.isFinite(v) ? v : null;
    },
    [metaByClient, resolveId],
  );

  // Upsert do campo no mês-âncora. `value` null limpa o campo (volta a vazio).
  // Retorna false se o cliente não tem cadastro (sem id).
  const saveMetaField = useCallback(
    async (slug: string, field: MetaKey, value: number | null, from?: Date, medico: string = META_MEDICO_GERAL): Promise<boolean> => {
      const id = resolveId(slug);
      if (!id) return false;
      const monthDate = startOfMonth(from ?? new Date());
      const ym = format(monthDate, "yyyy-MM");
      const mes = format(monthDate, "yyyy-MM-01");
      const col = META_FIELDS[field].col;

      // Ao PREENCHER (value != null) um planejado mutuamente exclusivo, o irmão SAI (vira null)
      // no MESMO upsert. Ao limpar (value == null) não mexe no irmão.
      const siblingKey = value != null ? META_EXCLUSIVE[field] : undefined;
      const siblingCol = siblingKey ? META_FIELDS[siblingKey].col : undefined;

      // Otimismo local.
      const prev = metaByClient;
      setMetaByClient((cur) => {
        const next = new Map(cur);
        const months = new Map(next.get(id) ?? new Map<string, Map<string, MetaRow>>());
        const byMed = new Map(months.get(ym) ?? new Map<string, MetaRow>());
        const row = { ...(byMed.get(medico) ?? { client_id: id, mes, medico }) } as MetaRow;
        row[col] = value;
        if (siblingCol) row[siblingCol] = null;
        byMed.set(medico, row);
        months.set(ym, byMed);
        next.set(id, months);
        return next;
      });

      setSaving(true);
      try {
        const { error } = await externalSupabase
          .from("clientes_meta")
          .upsert(
            {
              client_id: id,
              mes,
              medico,
              [col]: value,
              ...(siblingCol ? { [siblingCol]: null } : {}),
              last_update: new Date().toISOString(),
            },
            { onConflict: "client_id,mes,medico" },
          );
        if (error) throw error;
        return true;
      } catch (e) {
        setMetaByClient(prev); // reverte
        console.error("[useClientesMetas] falha ao salvar meta:", e);
        throw e;
      } finally {
        setSaving(false);
      }
    },
    [metaByClient, resolveId],
  );

  // Cliente único selecionado tem cadastro (id) → edição habilitada.
  const canEdit = useCallback((slug: string) => slug !== "all" && !!resolveId(slug), [resolveId]);

  return useMemo(
    () => ({ resolveMeta, resolveMonthlyMeta, getMonthValue, saveMetaField, canEdit, loading, saving }),
    [resolveMeta, resolveMonthlyMeta, getMonthValue, saveMetaField, canEdit, loading, saving],
  );
}

// Rótulos legíveis por campo (usados nos alertas de preenchimento).
export const META_LABELS: Record<MetaKey, string> = {
  investimento: "Investimento",
  leadsCRM: "Leads CRM",
  cplCRM: "CPL CRM",
  consultaAgendada: "Consultas Agendadas",
  consultaRealizada: "Consultas Realizadas",
  procedimentoAgendado: "Procedimentos Agendados",
  procedimentoRealizado: "Procedimentos Realizados",
  faturamento: "Faturamento",
  roas: "ROAS",
};

// Contexto pronto p/ os painéis: metas resolvidas do período + edição do mês-âncora.
export interface MetaCardsCtx {
  values: MetaValues;
  editable: boolean;
  saving: boolean;
  monthLabel: string;
  /** Campo do mês-âncora vazio/zerado (precisa preencher) — só relevante quando editável. */
  isEmpty: (field: MetaKey) => boolean;
  /** Campos relevantes da tela vazios no mês-âncora (cliente único). */
  missingFields: MetaKey[];
  /** Slugs de clientes totalmente zerados no mês-âncora (visão "Todos os clientes"). */
  missingClients: string[];
  getMonthValue: (field: MetaKey) => number | null;
  /** Meta rateada de um mês específico (ym 'YYYY-MM') p/ as linhas dos gráficos de evolução. */
  getMonthlyMeta: (field: MetaKey, ym: string) => number | null;
  onSave: (field: MetaKey, n: number) => void;
  /** Remove (limpa) a meta do campo no mês-âncora → volta a vazio. */
  onClear: (field: MetaKey) => void;
}

interface MetaCardsOpts {
  /** Campos exibidos nesta tela — base dos alertas. Default: todos. */
  fields?: MetaKey[];
  /** Lista de slugs de clientes da tela — p/ o alerta agregado de "clientes zerados". */
  allSlugs?: string[];
  /**
   * Escopa o planejado do cliente único a UM médico (só Lia Garrido). '' (default) =
   * planejado geral, comportamento idêntico ao de sempre. Quando !='', a leitura/edição
   * do cliente selecionado passa a valer só para esse médico; o agregado ("all") e os
   * demais clientes ignoram este escopo.
   */
  medico?: string;
  /**
   * Gate de PERMISSÃO p/ editar (default true). Quando false, a edição inline e os alertas
   * de preenchimento ficam desligados mesmo para cliente cadastrado — a tela vira só-leitura
   * (usado p/ restringir as ações do CRM a admin/crm_editor). A RLS do banco é a trava real.
   */
  allowEdit?: boolean;
}

/**
 * Empacota o useClientesMetas para uma tela: resolve as metas do período (rateadas),
 * expõe handlers de edição do mês-âncora (mês de `dateFrom`) e os ALERTAS de preenchimento
 * (campos/clients zerados no mês-âncora). `onSave` engole erros (loga). Edição liberada p/
 * cliente único cadastrado.
 */
export function useMetaCardsCtx(slug: string, dateFrom?: Date, dateTo?: Date, opts?: MetaCardsOpts): MetaCardsCtx {
  const { resolveMeta, resolveMonthlyMeta, getMonthValue, saveMetaField, canEdit, saving } = useClientesMetas();
  const medico = opts?.medico ?? META_MEDICO_GERAL;
  const values = useMemo(() => resolveMeta(slug, dateFrom, dateTo, medico), [resolveMeta, slug, dateFrom, dateTo, medico]);
  const monthLabel = useMemo(() => format(startOfMonth(dateFrom ?? new Date()), "MMM/yyyy", { locale: ptBR }), [dateFrom]);
  // Edição = cliente único cadastrado E com permissão (allowEdit, default true).
  const allowEdit = opts?.allowEdit ?? true;
  const editable = allowEdit && canEdit(slug);

  const fields = useMemo(() => opts?.fields ?? (Object.keys(META_FIELDS) as MetaKey[]), [opts?.fields]);
  const allSlugs = opts?.allSlugs;

  // Vazio/zerado = sem valor ou 0 no mês-âncora. O escopo por médico só vale para o
  // cliente selecionado (`slug`); os demais slugs (alerta agregado) usam o planejado geral.
  const isEmptyFor = useCallback(
    (s: string, field: MetaKey) => {
      const med = s === slug ? medico : META_MEDICO_GERAL;
      const v = getMonthValue(s, field, dateFrom, med);
      if (v != null && v !== 0) return false;
      // Par mutuamente exclusivo: se o IRMÃO já tem valor, este campo não é cobrado como
      // faltando (a meta do par foi definida no outro campo — ex.: procedimento agendado
      // preenchido não deixa "realizado" pedir preenchimento, e vice-versa).
      const sib = META_EXCLUSIVE[field];
      if (sib) {
        const sv = getMonthValue(s, sib, dateFrom, med);
        if (sv != null && sv !== 0) return false;
      }
      return true;
    },
    [getMonthValue, dateFrom, slug, medico],
  );

  const isEmpty = useCallback((field: MetaKey) => isEmptyFor(slug, field), [isEmptyFor, slug]);

  const missingFields = useMemo(
    () => (editable ? fields.filter((f) => isEmptyFor(slug, f)) : []),
    [editable, fields, isEmptyFor, slug],
  );

  // Clientes que existem na base (resolvem id) mas estão com TODOS os campos da tela zerados.
  const missingClients = useMemo(
    () => (allowEdit && !editable && allSlugs ? allSlugs.filter((s) => canEdit(s) && fields.every((f) => isEmptyFor(s, f))) : []),
    [allowEdit, editable, allSlugs, canEdit, fields, isEmptyFor],
  );

  return useMemo(
    () => ({
      values,
      editable,
      saving,
      monthLabel,
      isEmpty,
      missingFields,
      missingClients,
      getMonthValue: (field: MetaKey) => getMonthValue(slug, field, dateFrom, medico),
      getMonthlyMeta: (field: MetaKey, ym: string) => resolveMonthlyMeta(slug, field, ym, dateFrom, dateTo, medico),
      onSave: (field: MetaKey, n: number) => {
        void (async () => {
          try {
            const ok = await saveMetaField(slug, field, n, dateFrom, medico);
            if (ok) {
              toast({ title: "Planejado salvo", description: `${META_LABELS[field]} · ${monthLabel}` });
            } else {
              toast({ title: "Não foi possível salvar", description: "Cliente sem cadastro na base de clientes.", variant: "destructive" });
            }
          } catch (e) {
            toast({ title: "Erro ao salvar planejado", description: (e as Error)?.message ?? "Tente novamente.", variant: "destructive" });
          }
        })();
      },
      onClear: (field: MetaKey) => {
        void (async () => {
          try {
            const ok = await saveMetaField(slug, field, null, dateFrom, medico);
            if (ok) toast({ title: "Planejado removido", description: `${META_LABELS[field]} · ${monthLabel}` });
            else toast({ title: "Não foi possível remover", description: "Cliente sem cadastro na base de clientes.", variant: "destructive" });
          } catch (e) {
            toast({ title: "Erro ao remover planejado", description: (e as Error)?.message ?? "Tente novamente.", variant: "destructive" });
          }
        })();
      },
    }),
    [values, editable, saving, monthLabel, isEmpty, missingFields, missingClients, getMonthValue, resolveMonthlyMeta, saveMetaField, slug, dateFrom, dateTo, medico],
  );
}
