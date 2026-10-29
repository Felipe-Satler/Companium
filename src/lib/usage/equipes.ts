/**
 * Comparação de uso entre equipes e entre membros de uma equipe (aba Equipes de /uso).
 *
 * "Equipe da época": cada linha diária (dia × usuário) conta para a equipe em que a pessoa estava
 * NAQUELE dia (histórico em equipe_membros). Regra do dia: inicio_dia <= d < fim_dia; no dia de uma
 * troca vale a equipe nova. Usuário-cliente não entra em equipe e cai no grupo "Clientes"; equipe
 * interna sem equipe no dia cai em "Sem equipe".
 *
 * Equipes têm tamanhos diferentes, então além dos totais há as médias POR MEMBRO (membro = quem
 * pertenceu ao grupo em algum dia do período, tendo usado ou não).
 */
import type { UsoAgenteRow, UsoDiaRow, UsoUsuario } from "./agregar";
import { sectionOf } from "./screens";

export type Equipe = { id: string; nome: string; arquivada: boolean };
export type Pertencimento = { user_id: string; equipe_id: string; inicio_dia: string | null; fim_dia: string | null };

export const GRUPO_SEM_EQUIPE = "_sem_equipe";
export const GRUPO_CLIENTES = "_clientes";

export const nomeGrupo = (id: string, equipes: Map<string, Equipe>) =>
  id === GRUPO_SEM_EQUIPE ? "Sem equipe" : id === GRUPO_CLIENTES ? "Clientes" : equipes.get(id)?.nome ?? "Equipe removida";

/** Mapa (usuário, dia) → grupo. Pertencimentos indexados por usuário para não varrer tudo. */
export function criarMapaGrupo(membros: Pertencimento[], usuarios: Map<string, UsoUsuario>) {
  const porUser = new Map<string, Pertencimento[]>();
  for (const m of membros) {
    if (!porUser.has(m.user_id)) porUser.set(m.user_id, []);
    porUser.get(m.user_id)!.push(m);
  }
  return (userId: string, dia: string): string => {
    if (usuarios.get(userId)?.tipo === "cliente") return GRUPO_CLIENTES;
    const m = porUser
      .get(userId)
      ?.find((p) => (p.inicio_dia === null || p.inicio_dia <= dia) && (p.fim_dia === null || dia < p.fim_dia));
    return m?.equipe_id ?? GRUPO_SEM_EQUIPE;
  };
}

/** Quem pertenceu a cada grupo em algum dia do período (com ou sem uso). Mesma regra do dia
 *  usada para atribuir o uso, aplicada a cada dia — os dois nunca divergem. */
export function membrosNoPeriodo(
  usuarios: UsoUsuario[],
  dias: string[],
  grupoDe: (userId: string, dia: string) => string,
  escopoUsuarios: string[] | null,
): Map<string, Set<string>> {
  const grupos = new Map<string, Set<string>>();
  for (const u of usuarios) {
    if (escopoUsuarios && !escopoUsuarios.includes(u.id)) continue;
    for (const dia of dias) {
      const g = grupoDe(u.id, dia);
      if (!grupos.has(g)) grupos.set(g, new Set());
      grupos.get(g)!.add(u.id);
    }
  }
  return grupos;
}

export type Totais = {
  grupo: string;
  membros: number;
  membrosAtivos: number;
  active_ms: number;
  visits: number;
  clicks: number;
  agente_ms: number;
  perguntas: number;
  respostas: number;
  /** Minutos ativos em telas por seção. */
  porSecao: Record<string, number>;
};

const vazio = (grupo: string): Totais => ({
  grupo,
  membros: 0,
  membrosAtivos: 0,
  active_ms: 0,
  visits: 0,
  clicks: 0,
  agente_ms: 0,
  perguntas: 0,
  respostas: 0,
  porSecao: {},
});

function somar(
  chave: (userId: string, dia: string) => string | null,
  diario: UsoDiaRow[],
  agentes: UsoAgenteRow[],
) {
  const tot = new Map<string, Totais>();
  const ativos = new Map<string, Set<string>>();
  const pegar = (k: string) => {
    if (!tot.has(k)) tot.set(k, vazio(k));
    return tot.get(k)!;
  };
  const ativo = (k: string, u: string) => {
    if (!ativos.has(k)) ativos.set(k, new Set());
    ativos.get(k)!.add(u);
  };
  for (const r of diario) {
    const k = chave(r.user_id, r.dia);
    if (k === null) continue;
    const t = pegar(k);
    t.active_ms += r.active_ms;
    t.visits += r.visits;
    t.clicks += r.clicks;
    const s = sectionOf(r.screen_key);
    t.porSecao[s] = (t.porSecao[s] ?? 0) + r.active_ms;
    if (r.active_ms > 0) ativo(k, r.user_id);
  }
  for (const r of agentes) {
    const k = chave(r.user_id, r.dia);
    if (k === null) continue;
    const t = pegar(k);
    t.agente_ms += r.active_ms;
    t.perguntas += r.perguntas;
    t.respostas += r.respostas;
    if (r.active_ms > 0 || r.perguntas > 0) ativo(k, r.user_id);
  }
  for (const [k, t] of tot) t.membrosAtivos = ativos.get(k)?.size ?? 0;
  return tot;
}

/** Totais por grupo (equipe, "Sem equipe", "Clientes"), com o nº de membros do período. */
export function compararEquipes(
  diario: UsoDiaRow[],
  agentes: UsoAgenteRow[],
  grupoDe: (userId: string, dia: string) => string,
  membrosPorGrupo: Map<string, Set<string>>,
): Totais[] {
  const tot = somar(grupoDe, diario, agentes);
  for (const [g, membros] of membrosPorGrupo) {
    const t = tot.get(g) ?? vazio(g);
    t.membros = Math.max(membros.size, t.membrosAtivos);
    tot.set(g, t);
  }
  for (const t of tot.values()) t.membros = Math.max(t.membros, t.membrosAtivos);
  // Equipes de verdade primeiro (pela média de tempo por membro); "Sem equipe" e "Clientes" no fim.
  const especial = (g: string) => (g === GRUPO_SEM_EQUIPE ? 1 : g === GRUPO_CLIENTES ? 2 : 0);
  return [...tot.values()].sort(
    (a, b) => especial(a.grupo) - especial(b.grupo) || porMembro(b, "active_ms") - porMembro(a, "active_ms"),
  );
}

/** Membros de UM grupo, só com o uso dos dias em que estavam nele. */
export function compararMembros(
  grupo: string,
  diario: UsoDiaRow[],
  agentes: UsoAgenteRow[],
  grupoDe: (userId: string, dia: string) => string,
  membros: Set<string>,
): Totais[] {
  const tot = somar((u, d) => (grupoDe(u, d) === grupo ? u : null), diario, agentes);
  for (const u of membros) if (!tot.has(u)) tot.set(u, vazio(u));
  for (const t of tot.values()) {
    t.membros = 1;
    t.membrosAtivos = t.active_ms > 0 || t.perguntas > 0 || t.agente_ms > 0 ? 1 : 0;
  }
  return [...tot.values()].sort((a, b) => b.active_ms - a.active_ms);
}

export type MetricaSomavel = "active_ms" | "visits" | "clicks" | "agente_ms" | "perguntas" | "respostas";

export const porMembro = (t: Totais, m: MetricaSomavel) => (t.membros ? t[m] / t.membros : 0);

/** Média de uma lista de membros (referência "média da equipe"). */
export const mediaDe = (linhas: Totais[], m: MetricaSomavel) =>
  linhas.length ? linhas.reduce((s, l) => s + l[m], 0) / linhas.length : 0;
