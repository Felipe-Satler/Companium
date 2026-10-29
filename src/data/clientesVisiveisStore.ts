/**
 * QUEM APARECE NOS FILTROS DE CLIENTE — fonte única, compartilhada por CRM, Meta Ads,
 * Google Ads, Relatório, Performance e Metas.
 *
 * Duas fontes, que se SOMAM:
 *   1. `projetos_lista` (planilha): decide quem ENTRA — só cliente ATIVO.
 *   2. `clientes_ocultos` (tabela editável em Administração): pode TIRAR alguém mesmo
 *      estando ATIVO (conta de teste, cliente mal arquivado).
 *
 * O store não IMPORTA nada: quem carrega a planilha injeta aqui um resolvedor pronto
 * (`setResolvedorAtivos`). Se ele importasse `@/data/squads`, fecharia um ciclo
 * clienteAliases → store → squads → clienteAliases, e num ciclo o módulo que inicializa
 * primeiro enxerga o outro pela metade (constantes ainda undefined).
 *
 * Por que um store de módulo e não um contexto React: o portão do dashboard é a função
 * SÍNCRONA `isExcludedClient`, chamada de dentro de ~7 hooks e de `buildClientCanonicalMap`.
 * Transformar tudo isso em assíncrono seria refatorar meia dúzia de caminhos de dados; com o
 * store, a função continua síncrona e passa a consultar este estado. Os hooks se inscrevem
 * (useClientesVisiveis) só para RE-RENDERIZAR quando os dados chegam.
 *
 * FAIL-SAFE, e isso é o mais importante daqui: enquanto a planilha não carregou — ou se a
 * leitura falhar, ou se a tabela vier vazia — `filtroAtivosLigado()` é false e NINGUÉM é
 * escondido por status. O dashboard se comporta exatamente como antes desta mudança. Uma
 * falha de rede (ou a policy de RLS não aplicada) não pode esvaziar os filtros de todas as
 * telas.
 */

export interface OcultoRow {
  padrao: string;
  canal: string | null;
  exato: boolean;
}

/** Responde se o slug canônico é de um cliente ATIVO. null = planilha ainda não chegou. */
export type ResolvedorAtivos = (canonical: string) => boolean;

interface Estado {
  resolverAtivo: ResolvedorAtivos | null;
  /** true = mostrar TODO o histórico (não filtra por status). Controlado pelo botão da tela. */
  incluirInativos: boolean;
  ocultos: OcultoRow[];
  /** true quando `clientes_ocultos` carregou (mesmo vazia). */
  temOcultos: boolean;
  /** Muda a cada carga; entra nas deps dos memos p/ recalcular as listas. */
  versao: number;
}

let estado: Estado = {
  resolverAtivo: null,
  incluirInativos: false,
  ocultos: [],
  temOcultos: false,
  versao: 0,
};

const inscritos = new Set<() => void>();

function avisar() {
  estado = { ...estado, versao: estado.versao + 1 };
  for (const fn of inscritos) fn();
}

export function subscribeClientesVisiveis(fn: () => void): () => void {
  inscritos.add(fn);
  return () => inscritos.delete(fn);
}

export function getVersaoClientesVisiveis(): number {
  return estado.versao;
}

/**
 * Liga o filtro por status. `resolver` null desliga (volta ao comportamento antigo) — é o que
 * o carregador faz quando a planilha vem vazia ou a leitura falha.
 */
export function setResolvedorAtivos(resolver: ResolvedorAtivos | null): void {
  estado = { ...estado, resolverAtivo: resolver };
  avisar();
}

export function setClientesOcultos(rows: OcultoRow[]): void {
  estado = { ...estado, ocultos: rows, temOcultos: true };
  avisar();
}

/**
 * O filtro por status está valendo? Só depois que a planilha chega com linhas. Enquanto for
 * false, o dashboard mostra a carteira como sempre mostrou.
 */
export function filtroAtivosLigado(): boolean {
  return estado.resolverAtivo != null && !estado.incluirInativos;
}

/**
 * Liga/desliga o recorte "só clientes ATIVOS". Desligado = carteira histórica inteira, para
 * olhar um cliente que já saiu. Estado global de propósito: as telas de /clientes compartilham
 * período, origem e cliente, e um recorte diferente por aba faria dois números da mesma
 * carteira aparecerem lado a lado sem explicação.
 */
export function setIncluirInativos(valor: boolean): void {
  if (estado.incluirInativos === valor) return;
  estado = { ...estado, incluirInativos: valor };
  avisar();
}

export function incluirInativosLigado(): boolean {
  return estado.incluirInativos;
}

export function getClientesOcultos(): OcultoRow[] {
  return estado.ocultos;
}

export function temOcultosCarregados(): boolean {
  return estado.temOcultos;
}

/**
 * O cliente está ATIVO na planilha?
 *
 * Só responde false quando a planilha está carregada E diz que ele não está ativo. Cliente
 * que a planilha não cita é tratado como NÃO-ativo — foi o combinado ("só ATIVO aparece") —,
 * mas apenas com a planilha em mãos; sem ela, ninguém é escondido.
 */
export function clienteAtivoPelaPlanilha(canonical: string): boolean {
  if (estado.incluirInativos) return true; // "histórico": ninguém é filtrado por status
  const resolver = estado.resolverAtivo;
  if (!resolver) return true; // planilha ausente: ninguém é escondido por status
  return resolver(canonical);
}
