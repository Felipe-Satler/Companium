/**
 * Agregações da página Uso do Companium. Tudo parte das linhas diárias (dia × usuário × tela)
 * que a RPC usage_diario devolve; nada aqui fala com o banco, então é testável à parte.
 */
import { USAGE_SECTIONS, USAGE_SCREENS, sectionOf } from "./screens";

export type UsoTipo = "admin" | "equipe" | "cliente";
export type UsoUsuario = { id: string; email: string; tipo: UsoTipo };

export type UsoDiaRow = {
  dia: string; // yyyy-MM-dd (fuso de SP)
  user_id: string;
  screen_key: string;
  active_ms: number;
  visits: number;
  clicks: number;
};

/** Escopo de telas: null = todas; senão chaves exatas ("clientes.crm") ou seção ("clientes.*").
 *  Mesma regra da função SQL usage_screen_match. */
export type EscopoTelas = string[] | null;

export function matchScreen(key: string, escopo: EscopoTelas): boolean {
  if (!escopo) return true;
  return escopo.includes(key) || escopo.includes(`${sectionOf(key)}.*`);
}

export const msParaMin = (ms: number) => ms / 60_000;

export function formatarDuracao(ms: number): string {
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 1) return ms > 0 ? "<1 min" : "0 min";
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const ehDiaUtil = (dia: string) => {
  const d = new Date(`${dia}T12:00:00`).getDay();
  return d !== 0 && d !== 6;
};

export type UsoKpis = {
  usuariosAtivos: number;
  tempoTotalMs: number;
  /** Tempo médio por usuário em cada dia em que ele usou. */
  mediaPorUsuarioDiaMs: number;
  visitas: number;
  cliques: number;
  /** Média de usuários ativos por dia útil ÷ usuários ativos no período (0–1). */
  frequencia: number;
};

export function calcularKpis(rows: UsoDiaRow[]): UsoKpis {
  const ativos = rows.filter((r) => r.active_ms > 0);
  const usuarios = new Set(ativos.map((r) => r.user_id));
  const usuarioDia = new Set(ativos.map((r) => `${r.user_id}|${r.dia}`));
  const tempoTotalMs = ativos.reduce((s, r) => s + r.active_ms, 0);

  const porDiaUtil = new Map<string, Set<string>>();
  for (const r of ativos) {
    if (!ehDiaUtil(r.dia)) continue;
    if (!porDiaUtil.has(r.dia)) porDiaUtil.set(r.dia, new Set());
    porDiaUtil.get(r.dia)!.add(r.user_id);
  }
  const dauMedio = porDiaUtil.size
    ? [...porDiaUtil.values()].reduce((s, u) => s + u.size, 0) / porDiaUtil.size
    : 0;

  return {
    usuariosAtivos: usuarios.size,
    tempoTotalMs,
    mediaPorUsuarioDiaMs: usuarioDia.size ? tempoTotalMs / usuarioDia.size : 0,
    visitas: rows.reduce((s, r) => s + r.visits, 0),
    cliques: rows.reduce((s, r) => s + r.clicks, 0),
    frequencia: usuarios.size ? dauMedio / usuarios.size : 0,
  };
}

/** Série do gráfico de barras empilhadas: um ponto por dia do período, minutos por grupo. */
export type GrupoSerie = { key: string; label: string };

export function gruposDaSerie(rows: UsoDiaRow[], escopo: EscopoTelas): { porTela: boolean; grupos: GrupoSerie[] } {
  const secoes = new Set(rows.map((r) => sectionOf(r.screen_key)));
  const escopoSecoes = escopo ? new Set(escopo.map(sectionOf)) : null;
  const umaSecao = (escopoSecoes?.size ?? secoes.size) === 1 ? [...(escopoSecoes ?? secoes)][0] : null;
  if (umaSecao) {
    // Uma seção só: empilha por tela, na ordem do registro; telas fora do registro no fim.
    const presentes = new Set(rows.map((r) => r.screen_key));
    const conhecidas = USAGE_SCREENS.filter((s) => s.section === umaSecao && presentes.has(s.key)).map((s) => s.key);
    const extras = [...presentes].filter((k) => !conhecidas.includes(k)).sort();
    return { porTela: true, grupos: [...conhecidas, ...extras].map((key) => ({ key, label: key })) };
  }
  return {
    porTela: false,
    grupos: USAGE_SECTIONS.filter((s) => secoes.has(s.key)).map((s) => ({ key: s.key, label: s.label })),
  };
}

export function listarDias(from: string, to: string): string[] {
  const dias: string[] = [];
  const d = new Date(`${from}T12:00:00`);
  const fim = new Date(`${to}T12:00:00`);
  while (d <= fim) {
    dias.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    );
    d.setDate(d.getDate() + 1);
  }
  return dias;
}

export function seriePorDia(
  rows: UsoDiaRow[],
  dias: string[],
  porTela: boolean,
): Array<Record<string, number | string>> {
  const idx = new Map(dias.map((d, i) => [d, i]));
  const serie: Array<Record<string, number | string>> = dias.map((dia) => ({ dia }));
  for (const r of rows) {
    const i = idx.get(r.dia);
    if (i === undefined) continue;
    const k = porTela ? r.screen_key : sectionOf(r.screen_key);
    serie[i][k] = ((serie[i][k] as number | undefined) ?? 0) + msParaMin(r.active_ms);
  }
  return serie;
}

export type LinhaDetalhe = {
  user_id: string | null; // null = agregado (todas as pessoas)
  screen_key: string;
  active_ms: number;
  visits: number;
  clicks: number;
  usuarios: number;
  ultimoDia: string;
};

/** Tabela detalhada: por usuário × tela, ou só por tela (agregado). */
export function detalhar(rows: UsoDiaRow[], agregado: boolean): LinhaDetalhe[] {
  const mapa = new Map<string, LinhaDetalhe & { _users: Set<string> }>();
  for (const r of rows) {
    const k = agregado ? r.screen_key : `${r.user_id}|${r.screen_key}`;
    let l = mapa.get(k);
    if (!l) {
      l = {
        user_id: agregado ? null : r.user_id,
        screen_key: r.screen_key,
        active_ms: 0,
        visits: 0,
        clicks: 0,
        usuarios: 0,
        ultimoDia: r.dia,
        _users: new Set(),
      };
      mapa.set(k, l);
    }
    l.active_ms += r.active_ms;
    l.visits += r.visits;
    l.clicks += r.clicks;
    l._users.add(r.user_id);
    if (r.dia > l.ultimoDia) l.ultimoDia = r.dia;
  }
  return [...mapa.values()]
    .map(({ _users, ...l }) => ({ ...l, usuarios: _users.size }))
    .sort((a, b) => b.active_ms - a.active_ms);
}

/** Matriz usuário × tela (minutos). Linhas e colunas ordenadas pelo total. */
export function matrizUsuarioTela(rows: UsoDiaRow[]) {
  const porUser = new Map<string, number>();
  const porTela = new Map<string, number>();
  const celula = new Map<string, number>();
  for (const r of rows) {
    porUser.set(r.user_id, (porUser.get(r.user_id) ?? 0) + r.active_ms);
    porTela.set(r.screen_key, (porTela.get(r.screen_key) ?? 0) + r.active_ms);
    const k = `${r.user_id}|${r.screen_key}`;
    celula.set(k, (celula.get(k) ?? 0) + r.active_ms);
  }
  const usuarios = [...porUser.entries()].filter(([, ms]) => ms > 0).sort((a, b) => b[1] - a[1]).map(([u]) => u);
  const telas = [...porTela.entries()].filter(([, ms]) => ms > 0).sort((a, b) => b[1] - a[1]).map(([t]) => t);
  const max = Math.max(0, ...celula.values());
  return { usuarios, telas, max, valor: (u: string, t: string) => celula.get(`${u}|${t}`) ?? 0 };
}

/** Adoção: % dos usuários ativos no período que usaram cada tela. */
export function adocaoPorTela(rows: UsoDiaRow[]) {
  const ativos = rows.filter((r) => r.active_ms > 0);
  const total = new Set(ativos.map((r) => r.user_id)).size;
  const porTela = new Map<string, Set<string>>();
  for (const r of ativos) {
    if (!porTela.has(r.screen_key)) porTela.set(r.screen_key, new Set());
    porTela.get(r.screen_key)!.add(r.user_id);
  }
  return [...porTela.entries()]
    .map(([screen_key, users]) => ({ screen_key, usuarios: users.size, pct: total ? users.size / total : 0 }))
    .sort((a, b) => b.usuarios - a.usuarios);
}

/** Usuários ativos por dia. */
export function ativosPorDia(rows: UsoDiaRow[], dias: string[]) {
  const porDia = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.active_ms <= 0) continue;
    if (!porDia.has(r.dia)) porDia.set(r.dia, new Set());
    porDia.get(r.dia)!.add(r.user_id);
  }
  return dias.map((dia) => ({ dia, usuarios: porDia.get(dia)?.size ?? 0 }));
}

/* ---------- Agentes de IA (GrooChat) ---------- */

export type UsoAgenteRow = {
  dia: string;
  user_id: string;
  bot_id: string;
  active_ms: number;
  sessoes: number;
  perguntas: number;
  respostas: number;
};

export type LinhaAgente = {
  bot_id: string;
  user_id: string | null; // null = agregado
  active_ms: number;
  sessoes: number;
  perguntas: number;
  respostas: number;
  usuarios: number;
};

/** Totais por agente (agregado) ou por usuário × agente, ordenados por perguntas. */
export function agregarAgentes(rows: UsoAgenteRow[], porUsuario: boolean): LinhaAgente[] {
  const mapa = new Map<string, LinhaAgente & { _users: Set<string> }>();
  for (const r of rows) {
    const k = porUsuario ? `${r.user_id}|${r.bot_id}` : r.bot_id;
    let l = mapa.get(k);
    if (!l) {
      l = { bot_id: r.bot_id, user_id: porUsuario ? r.user_id : null, active_ms: 0, sessoes: 0, perguntas: 0, respostas: 0, usuarios: 0, _users: new Set() };
      mapa.set(k, l);
    }
    l.active_ms += r.active_ms;
    l.sessoes += r.sessoes;
    l.perguntas += r.perguntas;
    l.respostas += r.respostas;
    if (r.active_ms > 0 || r.perguntas > 0) l._users.add(r.user_id);
  }
  return [...mapa.values()]
    .map(({ _users, ...l }) => ({ ...l, usuarios: _users.size }))
    .sort((a, b) => b.perguntas - a.perguntas || b.active_ms - a.active_ms);
}

export function totaisAgentes(rows: UsoAgenteRow[]) {
  const usuarios = new Set(rows.filter((r) => r.active_ms > 0 || r.perguntas > 0).map((r) => r.user_id));
  return {
    active_ms: rows.reduce((s, r) => s + r.active_ms, 0),
    perguntas: rows.reduce((s, r) => s + r.perguntas, 0),
    respostas: rows.reduce((s, r) => s + r.respostas, 0),
    usuarios: usuarios.size,
  };
}

/** Série diária de perguntas por agente. */
export function perguntasPorDia(rows: UsoAgenteRow[], dias: string[]) {
  const idx = new Map(dias.map((d, i) => [d, i]));
  const serie: Array<Record<string, number | string>> = dias.map((dia) => ({ dia }));
  for (const r of rows) {
    const i = idx.get(r.dia);
    if (i === undefined || !r.perguntas) continue;
    serie[i][r.bot_id] = ((serie[i][r.bot_id] as number | undefined) ?? 0) + r.perguntas;
  }
  return serie;
}
