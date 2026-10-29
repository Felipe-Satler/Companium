/**
 * Mapeamento de nomes alternativos (médicos, variações) → nome canônico do Cliente.
 * Use sempre `normalizeClientName` ao processar dados das views de Ads/CRM,
 * para garantir que registros gravados sob nomes diferentes sejam consolidados
 * sob o nome oficial da clínica.
 */
import { clienteAtivoPelaPlanilha, getClientesOcultos } from "@/data/clientesVisiveisStore";
import {
  ADS_CLIENT_ALIASES as SHARED_ADS_CLIENT_ALIASES,
  ADS_CLIENT_MERGES as SHARED_ADS_CLIENT_MERGES,
  CLIENT_ALIASES as SHARED_CLIENT_ALIASES,
} from "../../shared/client-aliases.js";

/**
 * Os mapas de alias moram em `shared/client-aliases.js` — JavaScript puro, fora de `src/`, para o
 * ad-spy-worker (Node, sem build) casar cliente EXATAMENTE como as telas casam. Os comentários que
 * explicam cada alias estão lá. Aqui ficam o tipo e as funções.
 */
export const CLIENT_ALIASES: Record<string, string> = SHARED_CLIENT_ALIASES;

/** Overrides conta de Ads → slug do Kommo. Dado e comentários em `shared/client-aliases.js`. */
export const ADS_CLIENT_ALIASES: Record<string, string> = SHARED_ADS_CLIENT_ALIASES;

export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Clientes encerrados que N\u00c3O devem mais aparecer em nenhum filtro/relat\u00f3rio
 * (Meta Ads, Google Ads e CRM). Match por TOKEN sobre a chave normalizada
 * (case/acento/underscore-insensitive) \u2014 robusto ao nome cru do Ads
 * ("Cl\u00ednica Integralis ... | Groohub"), ao slug do Kommo ("Cl\u00ednica_Integralis")
 * e a varia\u00e7\u00f5es com/sem o prefixo "Cl\u00ednica".
 *
 * Cada entrada casa um ou mais tokens completos (delimitados por in\u00edcio/fim ou "_"),
 * NUNCA um peda\u00e7o no meio de uma palavra \u2014 assim siglas curtas como "icv" pegam
 * "ICV"/"Cl\u00ednica ICV" mas N\u00c3O "Medicva".
 */
// Preferir o NOME COMPLETO (sequência de tokens) p/ não pegar clientes FUTUROS de nome
// parecido — ex.: "teo_de_oliveira" (e não "teo", que pegaria um futuro "Teo Mendes").
export const EXCLUDED_CLIENT_MATCHES: string[] = [
  // VAZIA de propósito. Os 26 nomes que viviam aqui estavam todos na mesma situação — cliente
  // encerrado / fora da carteira — e isso passou a ser decidido pela planilha `projetos_lista`
  // (só status ATIVO aparece). Manter a cópia manual significaria dois lugares para lembrar de
  // atualizar a cada mudança de carteira, que é exatamente o trabalho que essa mudança elimina.
  //
  // Para tirar da tela um cliente que a planilha diz estar ATIVO (conta de teste, cadastro
  // duplicado), use Administração → Clientes: vai para a tabela `clientes_ocultos`, sem deploy.
];

/**
 * Clientes que devem aparecer em TODOS os canais MENOS no Google Ads — visíveis no
 * Meta Ads, CRM, Relatório Geral e Performance, mas escondidos na tela de Google Ads.
 * Mesma semântica de TOKEN do EXCLUDED_CLIENT_MATCHES (casa o nome completo do cliente,
 * não pedaço no meio de palavra). Usado pela versão de `isExcludedClient` que recebe
 * `channel`: SÓ exclui quando channel === "google".
 */
export const GOOGLE_HIDDEN_CLIENT_MATCHES: string[] = [
  // VAZIA: os três clientes que ficavam aqui (ativos, escondidos só no Google Ads) foram para
  // `clientes_ocultos` com canal='google', editáveis em Administração → Clientes. Deixá-los
  // também aqui faria a remoção pela tela não surtir efeito — a constante continuaria
  // escondendo, e a Administração pareceria quebrada.
];

/**
 * Exclusões por chave EXATA (o nome canônico inteiro precisa ser igual). Use quando o nome
 * a remover é PREFIXO de outro cliente que deve PERMANECER — ex.: um "Luis Felipe" cru
 * vs "Luis Felipe Pacheco". Um token em EXCLUDED_CLIENT_MATCHES pegaria os dois; o match
 * exato pega só o cliente cujo canônico é exatamente igual.
 *
 * NOTA (25/08/2026): o antigo "luis_felipe" foi REMOVIDO daqui. O exportador externo do
 * Google passou a gravar a conta do Dr. Luis Felipe Pacheco sob o slug curto "Luis_Felipe"
 * (antes "Luis_Pacheco"); o que parecia um cliente-fantasma era, na verdade, o dado ATUAL
 * do Pacheco. Agora as views (_v_meta_google_ads_raw / _daily_raw) dobram "Luis_Felipe" em
 * "Luis_Pacheco" no banco — ver migração 20260825_pacheco_google_luis_felipe_fold — então
 * a exclusão no front deixou de ser necessária (e escondia dados reais).
 */
export const EXCLUDED_CLIENT_EXACT: string[] = [];

/**
 * IDs de leads/negócios do Kommo (v_kommo_completa.id) que NÃO devem entrar em nenhuma
 * métrica do CRM (cards de teste, lançamentos errados, etc.). Escondido no dashboard —
 * o card continua existindo no Kommo até ser apagado lá.
 */
export const EXCLUDED_KOMMO_IDS: ReadonlySet<number> = new Set<number>([
  // IDs INTERNOS (v_kommo_completa.id) — o filtro client-side compara com r.id (interno), NÃO o
  // id_externo do Kommo. A exclusão das MÉTRICAS PRINCIPAIS (cards/funil/faturamento/leads) é
  // feita NO BANCO via crm_leads_excluidos (match por id_externo) + refresh da mv_kommo_crm_agg;
  // esta lista cobre só os caminhos de linha-crua (lead-times, orçamento parado, procedimento).
  2069302,  // Clínica Lumen — procedimento de TESTE (id_externo 30001248; já excluído no banco).
  2320012,  // Instituto (lead removido das métricas a pedido, jul/2026)
]);

/** true se o id do lead/negócio do Kommo está na lista de exclusão (cards de teste). */
export function isExcludedKommoId(id: number | string | null | undefined): boolean {
  if (id == null) return false;
  const n = typeof id === "number" ? id : parseInt(String(id), 10);
  return Number.isFinite(n) && EXCLUDED_KOMMO_IDS.has(n);
}

/**
 * Canal (tela) onde a checagem está sendo feita. Clientes em GOOGLE_HIDDEN_CLIENT_MATCHES
 * são escondidos APENAS no canal "google"; em qualquer outro canal (ou sem canal) aparecem
 * normalmente.
 */
export type ClientChannel = "meta" | "google" | "crm" | "overview";

/** Casa `keys` contra `list` como TOKEN completo (delimitado por início/fim ou "_"). */
function matchesClientToken(keys: string[], list: string[]): boolean {
  return list.some((m) => {
    const re = new RegExp(`(^|_)${m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(_|$)`);
    return keys.some((k) => re.test(k));
  });
}

/**
 * true se `name` (nome cru do Ads ou slug do Kommo) NÃO deve aparecer no dashboard.
 *
 * Portão ÚNICO da carteira: dropdowns e linhas de dado passam todos por aqui. Três camadas,
 * nesta ordem:
 *   1. as constantes deste arquivo (histórico — a semente da tabela `clientes_ocultos` veio
 *      delas; ficam como rede de segurança caso a tabela não carregue);
 *   2. `clientes_ocultos`, editável em Administração — tira um cliente mesmo estando ATIVO;
 *   3. `projetos_lista`: só cliente ATIVO na planilha continua visível.
 *
 * A camada 3 só entra em ação quando a planilha carregou (`filtroAtivosLigado`). Sem ela —
 * rede fora, RLS não aplicada — nada é escondido por status e a tela fica como era antes.
 */
export function isExcludedClient(name: string | null | undefined, channel?: ClientChannel): boolean {
  if (!name) return false;
  const keys = [clientMatchKey(name), clientMatchKey(canonicalizeAdsClient(name))];
  // Exclusão por chave EXATA (nome a remover é prefixo de outro que deve ficar).
  if (EXCLUDED_CLIENT_EXACT.some((m) => keys.some((k) => k === m))) return true;
  // Casa o match como TOKEN completo (delimitado por início/fim da string ou "_"),
  // não como pedaço no meio de uma palavra — evita siglas curtas (ex.: "icv")
  // pegarem clientes não relacionados (ex.: "Medicva").
  if (matchesClientToken(keys, EXCLUDED_CLIENT_MATCHES)) return true;
  // Clientes escondidos só no Google Ads: aparecem em todo canal MENOS "google".
  if (channel === "google" && matchesClientToken(keys, GOOGLE_HIDDEN_CLIENT_MATCHES)) return true;

  // Lista editável na Administração (mesma semântica de token/exato das constantes acima).
  for (const o of getClientesOcultos()) {
    if (o.canal && o.canal !== channel) continue; // regra de um canal só
    const bate = o.exato ? keys.some((k) => k === o.padrao) : matchesClientToken(keys, [o.padrao]);
    if (bate) return true;
  }

  // Planilha de projetos: fora dela, ou sem status ATIVO, o cliente não entra.
  const canonical = canonicalizeAdsClient(name) || name;
  if (!clienteAtivoPelaPlanilha(canonical)) return true;

  return false;
}

/** Chave para matching fuzzy: case+acento+underscore-vs-espaço insensitive. */
export function clientMatchKey(s: string): string {
  if (!s) return "";
  return stripAccents(s).toLowerCase().replace(/[\s_]+/g, "_").trim();
}

/**
 * Dado um nome canônico (formato slug Kommo, ex. "Gustavo_Nobre"), retorna todas
 * as variações do mesmo cliente conhecidas pelo CLIENT_ALIASES (útil pra query
 * Kommo onde diferentes variantes podem existir lado-a-lado).
 */
export function getRawClientNames(canonical: string): string[] {
  const result = new Set<string>([canonical]);
  for (const [raw, canon] of Object.entries(CLIENT_ALIASES)) {
    if (canon === canonical) result.add(raw);
  }
  return [...result];
}

export function normalizeClientName(name: string | null | undefined): string {
  if (!name) return "";
  const trimmed = name.trim();
  if (CLIENT_ALIASES[trimmed]) return CLIENT_ALIASES[trimmed];
  // Tenta também a forma com underscores trocados por espaço e vice-versa
  const alt = trimmed.replace(/_/g, " ");
  if (CLIENT_ALIASES[alt]) return CLIENT_ALIASES[alt];
  const altUnderscore = trimmed.replace(/ /g, "_");
  if (CLIENT_ALIASES[altUnderscore]) return CLIENT_ALIASES[altUnderscore];
  return trimmed;
}

/**
 * Extrai um slug canônico (estilo Kommo: "First_Last") do nome de uma conta de
 * Meta/Google Ads (estilo "Dr. First Last - CA 1.1.1 | Groohub").
 *
 * Estratégia:
 *  1. Override explícito via ADS_CLIENT_ALIASES.
 *  2. Limpa sufixos comuns: " | Groohub", " - CA x.y.z".
 *  3. Limpa prefixos comuns: "(Groohub) -", "GROOHUB -", "Conta de Anúncios -", "CA01 -", etc.
 *  4. Tira título "Dr.", "Dra.", "Dr ", "Dra ".
 *  5. Aplica CLIENT_ALIASES (ex.: Clínica_Bellucci → Lia_Garrido).
 *  6. Troca espaços por "_".
 */
/**
 * Núcleo de busca do nome da conta de Ads: aplica a MESMA limpeza estrutural do
 * `canonicalizeAdsClient` (tira sufixos " | Groohub" / " - CA x.y.z", prefixos
 * "GROOHUB -" etc. e título "Dr./Dra."), mas NÃO aplica aliases. Serve para um
 * filtro server-side `.ilike("Client", "%core%")` que casa TODAS as variantes do
 * mesmo cliente no banco (ex.: "Dr. Lia Garrido ..." e "Dra. Lia Garrido ..."),
 * inclusive períodos sob nomes antigos após a conta ser renomeada.
 */
export function adsClientSearchCore(raw: string | null | undefined): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";
  let s = trimmed;
  // Trailing "Groohub" em qualquer variação de separador (" | Groohub", " - Groohub",
  // " I Groohub" typo, ou só " Groohub"). "groohub" é tag de portfólio, nunca parte do nome.
  s = s.replace(/\s*[-–—|I]?\s*Groohub\s*$/i, "");
  // `\.?\s*` extra antes do 1º número tolera o ponto sobrando de "C.A .1.1.2" (digitação)
  s = s.replace(/\s+-\s*C\.?\s*A\.?\s*\.?\s*\d+(\s*\.\s*\d+)*\s*\.?\s*$/i, "");
  s = s.replace(/^\(Groohub\)\s*-\s*/i, "");
  s = s.replace(/^GROOHUB\s*\d*\s*-\s*/i, "");
  s = s.replace(/^Groohub\s+/i, "");
  s = s.replace(/^Conta\s+de\s+An[úu]ncios\s*-\s*/i, "");
  s = s.replace(/^C\.?\s*A\.?(\s+GROOHUB)?\s*-\s*/i, "");
  s = s.replace(/^CA\d+\s*-\s*/i, "");
  s = s.replace(/^C\.?A\.?\s*\d+(\.\d+)*\s*-\s*/i, "");
  s = s.trim();
  s = s.replace(/^Dra?\.?\s+/i, "");
  s = s.trim();
  return s;
}

export function canonicalizeAdsClient(raw: string | null | undefined): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";
  if (ADS_CLIENT_ALIASES[trimmed]) return ADS_CLIENT_ALIASES[trimmed];

  let s = trimmed;
  // Trailing "Groohub" em qualquer variação de separador: " | Groohub", " - Groohub",
  // " I Groohub" (typo com I maiúsculo) ou só " Groohub". É tag de portfólio, nunca parte
  // do nome do cliente — sem isso, conta com/sem groohub no nome cru vira 2 linhas no filtro.
  s = s.replace(/\s*[-–—|I]?\s*Groohub\s*$/i, "");
  // Trailing " - CA x[.y[.z]]" (com ou sem ponto final, com ou sem espaços em volta dos pontos).
  // `\.?\s*` extra antes do 1º número tolera o ponto sobrando de "C.A .1.1.2" (digitação).
  s = s.replace(/\s+-\s*C\.?\s*A\.?\s*\.?\s*\d+(\s*\.\s*\d+)*\s*\.?\s*$/i, "");

  // Leading "(Groohub) - "
  s = s.replace(/^\(Groohub\)\s*-\s*/i, "");
  // Leading "GROOHUB - " / "GROOHUB 001 -"
  s = s.replace(/^GROOHUB\s*\d*\s*-\s*/i, "");
  // Leading "Groohub " sem traço (ex.: "Groohub Instituto ...")
  s = s.replace(/^Groohub\s+/i, "");
  // Leading "Conta de Anúncios - "
  s = s.replace(/^Conta\s+de\s+An[úu]ncios\s*-\s*/i, "");
  // Leading "C.A GROOHUB - " / "CA- " / "C.A - "
  s = s.replace(/^C\.?\s*A\.?(\s+GROOHUB)?\s*-\s*/i, "");
  // Leading "CA01 - "
  s = s.replace(/^CA\d+\s*-\s*/i, "");
  // Leading "CA x.y.z - "
  s = s.replace(/^C\.?A\.?\s*\d+(\.\d+)*\s*-\s*/i, "");
  s = s.trim();

  // Strip "Dr.", "Dra.", "Dr ", "Dra "
  s = s.replace(/^Dra?\.?\s+/i, "");
  s = s.trim();

  // Aplica CLIENT_ALIASES (forma com espaço)
  if (CLIENT_ALIASES[s]) return CLIENT_ALIASES[s];

  // Converte para underscore
  const slug = s.replace(/\s+/g, "_");
  if (CLIENT_ALIASES[slug]) return CLIENT_ALIASES[slug];
  return slug;
}

/**
 * Fusão de conta de Ads em outro cliente do CRM: para médicos que COMPARTILHAM o mesmo
 * cliente no Kommo mas têm conta de Ads própria (ex.: Dr. Moacir e Dra. Lia na Clínica
 * Bellucci → cliente "Lia Garrido"). A fusão vale em TODOS os canais MENOS "meta": na tela
 * Meta Ads a conta continua SEPARADA; no CRM/Relatório/Performance/Google ela é somada ao
 * cliente destino (e some do dropdown de cliente). O `medico` permite dividir o "leads
 * tráfego" por médico dentro do cliente destino — o filtro de médico do CRM separa as
 * conversas do Moacir dos leads da Lia. Chave = clientMatchKey do slug canônico da conta.
 */
export interface AdsClientMerge {
  /** slug canônico destino no CRM (estilo Kommo, ex.: "Lia_Garrido"). */
  crmCanonical: string;
  /** médico (string EXATA do campo "Médico" no Kommo) ao qual esta conta pertence. */
  medico: string;
}
export const ADS_CLIENT_MERGES: Record<string, AdsClientMerge> = SHARED_ADS_CLIENT_MERGES;

/**
 * Médico de cada conta de Ads que participa de um split de "leads tráfego" dentro de um
 * cliente compartilhado. Inclui também o médico "dono" do cliente destino (ex.: a Lia),
 * pra que o filtro de médico consiga isolar os leads tráfego dela vs. os do Moacir.
 * Chave = clientMatchKey do slug canônico da conta de Ads (PRÉ-fusão).
 */
export const ADS_MEDICO_BY_CLIENT: Record<string, string> = {
  moacir_vitorio: "Dr. Moacir",
  lia_garrido: "Dra. Lia",
};

/** Rótulo/sentinela para o grupo de leads do Kommo SEM médico preenchido (campo vazio). */
export const MEDICO_VAZIO = "Sem médico";

/**
 * Aplica a fusão ADS_CLIENT_MERGES a um slug canônico de conta de Ads. Vale em todos os
 * canais MENOS "meta" (na tela Meta Ads a conta segue separada). Retorna o slug destino,
 * ou o próprio `canonical` se não houver fusão para esta conta.
 */
export function foldMergedAdsClient(canonical: string, channel?: ClientChannel): string {
  if (channel === "meta") return canonical;
  const merge = ADS_CLIENT_MERGES[clientMatchKey(canonical)];
  return merge ? merge.crmCanonical : canonical;
}

/**
 * Médico (string do Kommo) ao qual uma conta de Ads pertence, quando ela participa de um
 * split de leads tráfego dentro de um cliente compartilhado. Retorna null quando a conta
 * não faz parte de nenhum split (o leads tráfego dela não se divide por médico). Aceita o
 * nome CRU do Ads ("Dr. Moacir Vitório - CA 1.1.1 | Groohub") ou o slug canônico.
 */
export function adsMedicoForClient(adsNameOrCanonical: string | null | undefined): string | null {
  if (!adsNameOrCanonical) return null;
  const key = clientMatchKey(canonicalizeAdsClient(adsNameOrCanonical));
  const direct = ADS_MEDICO_BY_CLIENT[key];
  if (direct) return direct;
  // Cliente que AGRUPA várias contas (uma por médico), ex.: Instituto Aurum (Davi + Kato).
  // Aqui o médico não está num mapa fixo: é definido por QUAL conta a linha pertence. Casa o nome
  // CRU do Ads (que ainda distingue as contas, antes da fusão sob o slug agrupador) contra as
  // regras do split por conta. Assim o leads tráfego/investimento também se divide por médico no
  // CRM, espelhando a tela de Meta Ads. null quando o nome não casa nenhuma conta do grupo.
  const accountRules = ADS_ACCOUNT_MEDICO_SPLIT[key];
  if (accountRules && accountRules.length) {
    return campaignMedicoFromName(accountRules, adsNameOrCanonical);
  }
  return null;
}

/**
 * Regra de split de campanhas do Meta por NOME da campanha. Usada em clientes cuja conta de
 * Ads é ÚNICA, mas cujas campanhas carregam o médico/unidade no próprio nome (diferente do
 * caso Lia/Moacir, que são contas de Ads SEPARADAS). A primeira regra cujo `match` casar
 * (substring sem acento, minúscula) no nome da campanha vence.
 */
export interface CampaignMedicoRule {
  /** Rótulo do médico/unidade exibido no filtro de médico. */
  medico: string;
  /** Substrings (sem acento, minúsculas) que, presentes no nome da campanha, atribuem o médico. */
  match: string[];
}

/**
 * Split de campanhas por médico, por cliente. Chave = clientMatchKey do slug canônico da conta
 * de Ads. Campanha que não casa NENHUMA regra fica "sem médico" — só aparece quando nenhum
 * médico está selecionado (seleção vazia = mostra tudo).
 */
export const ADS_CAMPAIGN_MEDICO_SPLIT: Record<string, CampaignMedicoRule[]> = {
  // Dra. Carla Gouveia — conta única "Dra. Carla Gouveia - CA 1.1.1 | Groohub" (clientMatchKey
  // "carla_gouveia"). Três frentes dividem a mesma conta pelos nomes de campanha:
  // "GROOHUB NN | DRA. CARLA ...", "... CLÍN./CLÍNICA ÚNICA ...", "... DRA. ISADORA ...".
  // IMPORTANTE: o rótulo `medico` TEM de ser IGUAL ao nome do médico no Kommo (campo "Médico"),
  // senão o mesmo médico aparece com 2 nomes (um no leads tráfego/Meta, outro no CRM) e o filtro
  // não casa entre as telas. Nomes conferidos em prod no _v_kommo_completa_raw do cliente:
  // "Dra. Carla Gouveia", "Dra. Isadora Freitas" (há ainda "Dra. Ingrid Esteves" no CRM, sem
  // campanha dedicada). "Clín. Única" é frente/unidade de Ads sem médico correspondente no Kommo.
  carla_gouveia: [
    { medico: "Dra. Isadora Freitas", match: ["isadora"] },
    { medico: "Clín. Única", match: ["unica"] }, // casa "CLÍN. ÚNICA" e "CLÍNICA ÚNICA"
    { medico: "Dra. Carla Gouveia", match: ["carla"] },
  ],
};

/** Regras de split por nome de campanha de um cliente (ou [] se a conta não participa). */
export function campaignMedicoRules(
  clientNameOrCanonical: string | null | undefined,
): CampaignMedicoRule[] {
  if (!clientNameOrCanonical || clientNameOrCanonical === "all") return [];
  const key = clientMatchKey(canonicalizeAdsClient(clientNameOrCanonical));
  return ADS_CAMPAIGN_MEDICO_SPLIT[key] ?? [];
}

/** Lista ordenada de médicos possíveis p/ o filtro (vazia se o cliente não participa). */
export function campaignMedicoOptions(clientNameOrCanonical: string | null | undefined): string[] {
  return campaignMedicoRules(clientNameOrCanonical).map((r) => r.medico);
}

/**
 * Médico derivado do NOME da campanha, dadas as regras do cliente. Retorna null quando o nome
 * não casa nenhuma regra (campanha genérica/ERRO/Post) — essas só aparecem sem filtro de médico.
 */
export function campaignMedicoFromName(
  rules: CampaignMedicoRule[],
  campaignName: string | null | undefined,
): string | null {
  if (!rules.length || !campaignName) return null;
  const n = stripAccents(String(campaignName)).toLowerCase();
  for (const r of rules) {
    if (r.match.some((kw) => n.includes(kw))) return r.medico;
  }
  return null;
}

/**
 * Split de médico por CONTA de Ads, para clientes que AGRUPAM várias contas (uma por médico)
 * sob um único cliente — ex.: "Instituto Aurum" reúne as contas do Dr. Davi Colares e do
 * Dr. Filipe Kato (via ADS_CLIENT_ALIASES → "Instituto_Aurum"). Diferente de
 * ADS_CAMPAIGN_MEDICO_SPLIT (que separa por NOME da campanha dentro de UMA conta): aqui o
 * médico é definido por QUAL CONTA a campanha pertence, casando `match` contra o nome CRU do
 * `Client` (a conta). Serve a contas cujas campanhas NÃO carregam o nome do médico (ex.:
 * Kato = "Post do Instagram ..."). Chave = clientMatchKey do slug canônico agrupador.
 * Reusa `CampaignMedicoRule` e `campaignMedicoFromName` (match por substring sem acento),
 * passando o nome da conta no lugar do nome da campanha.
 */
export const ADS_ACCOUNT_MEDICO_SPLIT: Record<string, CampaignMedicoRule[]> = {
  instituto_aurum: [
    // `match` são substrings do nome CRU da conta ("Dr. Davi Colares - CA 1.1.1 | Groohub").
    // Sobrenomes únicos — não casam nenhuma outra conta da carteira.
    { medico: "Dr. Davi Colares", match: ["davi", "colares"] },
    { medico: "Dr. Filipe Kato", match: ["kato"] },
  ],
};

/** Regras de split por CONTA de um cliente agrupador (ou [] se não participa). */
export function accountMedicoRules(
  clientNameOrCanonical: string | null | undefined,
): CampaignMedicoRule[] {
  if (!clientNameOrCanonical || clientNameOrCanonical === "all") return [];
  const key = clientMatchKey(canonicalizeAdsClient(clientNameOrCanonical));
  return ADS_ACCOUNT_MEDICO_SPLIT[key] ?? [];
}

/** Lista ordenada de médicos do split por conta (vazia se o cliente não agrupa contas). */
export function accountMedicoOptions(clientNameOrCanonical: string | null | undefined): string[] {
  return accountMedicoRules(clientNameOrCanonical).map((r) => r.medico);
}

export interface ClientCanonicalMap {
  /** Lista única de slugs canônicos (estilo Kommo), ordenada por pt-BR. */
  canonicalList: string[];
  /** canonical → variantes do Kommo (todos os valores `client` no v_kommo_completa). */
  kommoVariantsByCanonical: Map<string, string[]>;
  /** canonical → variantes do Ads (todos os valores `Client` no v_meta_google_ads). */
  adsVariantsByCanonical: Map<string, string[]>;
  /** Ads-raw-name → canonical (lookup rápido por linha). */
  canonicalByAdsName: Map<string, string>;
  /** Kommo-raw-name → canonical (lookup rápido por linha). */
  canonicalByKommoName: Map<string, string>;
}

/**
 * Constrói o mapa cliente-canônico unificando Kommo + Ads:
 *  - cada Kommo `client` distinto vira (ou é absorvido por) um slug canônico
 *  - cada Ads `Client` é canonicalizado via heurística + alias; se bater com
 *    algum slug Kommo (case+acento insensitive), reusa o slug do Kommo
 *  - lista final = união dos canônicos dos dois lados
 *
 * Quando dois Kommo variants compartilham a mesma `clientMatchKey` (ex.:
 * `Fabio_Morais` e `Fábio_Morais`), escolhemos o que tem mais diacríticos
 * como canônico — mantém a forma "rica" no dropdown.
 */
export function buildClientCanonicalMap({
  kommoNames,
  adsNames,
  channel,
}: {
  kommoNames: string[];
  adsNames: string[];
  /** Canal onde o mapa será usado. Fora de "meta", contas em ADS_CLIENT_MERGES são
   *  fundidas no cliente destino (ex.: Moacir → Lia), sumindo do dropdown de cliente. */
  channel?: ClientChannel;
}): ClientCanonicalMap {
  // 1. Agrupa Kommo names por matchKey
  const kommoByKey = new Map<string, string[]>();
  for (const k of kommoNames) {
    const key = clientMatchKey(k);
    if (!key) continue;
    const arr = kommoByKey.get(key) || [];
    arr.push(k);
    kommoByKey.set(key, arr);
  }

  // Para cada grupo, escolhe canonical: prefer variante com mais diacríticos
  const canonicalByKey = new Map<string, string>();
  for (const [key, variants] of kommoByKey) {
    const best = variants.slice().sort((a, b) => {
      const accA = a.length - stripAccents(a).length;
      const accB = b.length - stripAccents(b).length;
      if (accA !== accB) return accB - accA;
      return a.localeCompare(b);
    })[0];
    canonicalByKey.set(key, best);
  }

  const kommoVariantsByCanonical = new Map<string, string[]>();
  const canonicalByKommoName = new Map<string, string>();
  for (const [key, variants] of kommoByKey) {
    const canonical = canonicalByKey.get(key)!;
    kommoVariantsByCanonical.set(canonical, variants);
    for (const v of variants) canonicalByKommoName.set(v, canonical);
  }

  // 2. Canonicaliza Ads names — se bater com algum Kommo, reusa o canonical Kommo
  const adsVariantsByCanonical = new Map<string, string[]>();
  const canonicalByAdsName = new Map<string, string>();
  for (const adsName of adsNames) {
    if (!adsName) continue;
    // Fusão "médico compartilha cliente" (ex.: Moacir → Lia) em todo canal MENOS meta.
    const tentative = foldMergedAdsClient(canonicalizeAdsClient(adsName), channel);
    if (!tentative) continue;
    const key = clientMatchKey(tentative);
    const canonical = canonicalByKey.get(key) || tentative;
    // Se o canonical não existir ainda no mapa Kommo (caso só-Ads), registramos
    // o mesmo key para que outras variantes Ads agrupem juntas.
    if (!canonicalByKey.has(key)) canonicalByKey.set(key, canonical);
    canonicalByAdsName.set(adsName, canonical);
    const arr = adsVariantsByCanonical.get(canonical) || [];
    arr.push(adsName);
    adsVariantsByCanonical.set(canonical, arr);
  }

  // 3. União ordenada
  const all = new Set<string>();
  for (const k of kommoVariantsByCanonical.keys()) all.add(k);
  for (const k of adsVariantsByCanonical.keys()) all.add(k);
  const canonicalList = [...all]
    .filter((c) => !isExcludedClient(c))
    // Remove entradas sem rótulo amigável (ex.: slug "groohub" → label vazio): apareceriam
    // como opção em branco no dropdown e, se selecionadas, zerariam os totais.
    .filter((c) => prettyClientLabel(c).trim() !== "")
    .sort((a, b) => a.localeCompare(b, "pt-BR"));

  return {
    canonicalList,
    kommoVariantsByCanonical,
    adsVariantsByCanonical,
    canonicalByAdsName,
    canonicalByKommoName,
  };
}

/**
 * Chave de COMPARAÇÃO de cliente entre páginas. Tolerante a caixa/acento/underscore
 * E ao formato do identificador: aceita tanto o slug do Kommo ("Gustavo_Nobre") quanto
 * o nome longo do Ads ("Dr. Gustavo Nobre - CA 1.1.1 | Groohub") e devolve a MESMA chave.
 * É o que permite que o filtro de cliente escolhido numa página (slug canônico) case com
 * as opções/linhas de outra (nome cru do Ads), sem depender de igualdade de string exata.
 */
export function clientCmpKey(name: string | null | undefined): string {
  if (!name) return "";
  return clientMatchKey(canonicalizeAdsClient(name));
}

/** true se `a` e `b` (slug do Kommo ou nome longo do Ads) representam o mesmo cliente. */
export function isSameClient(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = clientCmpKey(a);
  return ka !== "" && ka === clientCmpKey(b);
}

/**
 * Rótulos de EXIBIÇÃO oficiais dos clientes ativos. Chave = `clientMatchKey` do slug
 * canônico (tolerante a caixa/acento/underscore); valor = nome EXATO que deve aparecer
 * em TODO filtro/tabela/cabeçalho da seção Clientes.
 *
 * É um override puramente COSMÉTICO: só troca o texto mostrado. O `value` das opções e
 * toda a lógica de matching/canonicalização continuam usando o slug canônico — nada aqui
 * afeta filtragem, fetch, agregação ou o "planejado". Se um cliente não estiver no mapa,
 * cai no comportamento antigo (underscore→espaço + strip "groohub").
 *
 * Como a chave é o `clientMatchKey`, o mesmo rótulo vale em todas as telas mesmo quando o
 * slug canônico difere entre elas (ex.: CRM usa "Aurelio_Oliveira", Meta Ads idem → ambos
 * viram key "aurelio_oliveira"). Entradas de clientes ainda SEM dado ingerido são inertes
 * até a conta aparecer (aí já saem com o nome certo).
 */
export const CLIENT_DISPLAY_LABELS: Record<string, string> = {
  lia_garrido: "Dra. Lia Garrido",
  vasculare: "Dr. Abel & Dr. Celso - Vasculare",
  luis_pacheco: "Dr. Luís Felipe Pacheco",
  moacir_vitorio: "Dr. Moacir Vitório",
  lumilaser: "Sílvio Matos - LumiLaser",
  clinica_pellegrini: "Jonas Cerqueira - Clínica Pellegrini",
  fernando_del_rio: "Dr. Fernando Del Rio",
  douglas_brito: "Dr. Douglas Brito",
  bruno_moura: "Dr. Bruno Moura",
  fabio_morais: "Dr. Fábio Morais Filho",
  thiago_godinho: "Dr. Thiago Godinho",
  gustavo_nobre: "Dr. Gustavo Nobre",
  vista_nova: "Centro Oftalmológico Vista Nova",
  dario_bastos: "Dr. Dario Bastos",
  elaine_padua: "Dra. Elaine Pádua",
  bruno_veloso: "Dr. Bruno Veloso",
  juliano_patricio: "Dr. Juliano Patrício",
  agata: "Dra. Ágata",
  rafael_abreu: "Dr. Rafael Abreu",
  clinica_lumen: "Clínica Lumen",
  "ims_-_servicos_medicos": "IMS Serviços Médicos",
  alcides_furtado: "Dr. Alcides",
  gustavo_coelho: "Dr. Gustavo Coelho",
  fatima_cunha: "Dra. Fátima Cunha",
  laura_peixoto: "Dra. Laura Peixoto",
  aurelio_oliveira: "Dr. Aurelio",
  clinica_ventura: "Clínica Ventura",
  carlos_dantas: "Dr. Carlos Dantas",
  lidia_macedo: "Dra. Lídia Macedo",
  fernando_pontes: "Dr. Fernando Pontes",
  luiz_cardoso: "Dr. Luiz Cardoso",
  lucas_bittencourt: "Dr. Lucas Bittencourt",
  ronald_valverde: "Dr. Ronald",
  luciano_lopes_carvalhal: "Dr. Luciano Lopes Carvalhal",
  diego_rezende: "Dr. Diego Rezende",
  instituto_serena: "Instituto Serena",
  carla_gouveia: "Dra. Carla Gouveia",
  instituto_urologico_de_aurora: "Instituto Urológico de Aurora",
  jose_augusto: "Dr. José Augusto",
  alan_sampaio: "Dr. Alan Sampaio",
  evelyne: "Dra. Evelyne Pacini",
  evelyne_pacini: "Dra. Evelyne Pacini",
  danilo_leite: "Dr. Danilo Leite",
  monica_nader: "Dra. Monica Nader",
  mario_fraga: "Dr. Mário Fraga",
  amanda_duarte: "Dra. Amanda Duarte",
  henrique_couto: "Dr. Henrique Couto",
  daniel_rios: "Dr. Daniel Rios",
  heitor_simao: "Dr. Heitor",
  heitor: "Dr. Heitor",
  luna_mota: "Dra. Luna Mota",
  lupino_ads: "Lupino Cirurgia Vascular",
  lupino: "Lupino Cirurgia Vascular",
  lupino_cirurgia_vascular: "Lupino Cirurgia Vascular",
  jose_gaspar: "Dr. José Gaspar",
  jose_cordeiro: "Dr. José Cordeiro",
  patricia_pavan: "Dra. Patricia Pavan",
  danilo_novaes: "Dr. Danilo Novaes",
  andre_ritter: "Dr. André Ritter",
  pablo_fonseca: "Dr. Pablo Fonseca",
  instituto_de_medicina_integrada_de_atibaia: "Instituto de Medicina Integrada de Atibaia",
  jose_paiva: "Dr. José Paiva",
  italo_garcia: "Dr. Ítalo Garcia",
  yuri_prates: "Dr. Yuri Prates",
  gustav_sardinha: "Dr. Gustav Sardinha",
  // Jerônimo: a conta de Ads ("Dr. Jerônimo de Souza") é fundida no slug do Healo "Jeronimo_Henrique"
  // via ADS_CLIENT_ALIASES, então o canônico do card é jeronimo_henrique. Rótulo oficial aqui.
  jeronimo_henrique: "Dr. Jerônimo Henrique",
  janaina_pinheiro: "Dra. Janaina Pinheiro",
  otavio_brandt: "Dr. Otavio Brandt",
  // Agrupa as contas do Dr. Davi Colares + Dr. Filipe Kato (ver ADS_CLIENT_ALIASES /
  // ADS_ACCOUNT_MEDICO_SPLIT). Split por médico dentro dele é feito por conta, não por campanha.
  instituto_aurum: "Instituto Aurum",
  laura_ramalho: "Dra. Laura Ramalho",
  lais_guerreiro: "Dra. Laís Guerreiro",
  eduardo_rangel: "Dr. Eduardo Rangel",
  jackeline_pinto: "Dra. Jackeline Pinto",
  // Variante com typo no cadastro ("Pereirra") — mesmo rótulo oficial (cosmético).
  jackeline_pintto: "Dra. Jackeline Pinto",
};

/**
 * Rótulo amigável de um slug canônico. Consulta primeiro o override oficial
 * `CLIENT_DISPLAY_LABELS` (nome exato do cliente); se não houver, cai no default
 * (underscores→espaço e remove o prefixo/sufixo "groohub"). Puramente cosmético.
 */
export function prettyClientLabel(canonical: string): string {
  const official = CLIENT_DISPLAY_LABELS[clientMatchKey(canonical)];
  if (official) return official;
  return canonical
    .replace(/_/g, " ")
    .replace(/^\s*groohub\s*[-|]?\s*/i, "")
    .replace(/\s*[-|]?\s*groohub\s*$/i, "")
    .trim();
}

export interface AdsClientOptions {
  /** Opções p/ o dropdown: value = slug canônico, label = nome amigável. */
  options: { value: string; label: string }[];
  /** cmpKey → nomes CRUS do Ads (p/ o fetch server-side via `.ilike` do core). */
  rawByCmpKey: Map<string, string[]>;
}

/**
 * Constrói opções de cliente CANÔNICAS a partir da lista de nomes CRUS do Ads
 * (v_meta_google_ads.Client), agrupando variantes do mesmo cliente (Dr./Dra.,
 * renomeações, com/sem "groohub") por `clientCmpKey`. Mantém como representante a forma
 * canônica mais "rica" (com mais diacríticos). O `rawByCmpKey` permite traduzir o slug
 * canônico escolhido de volta para um nome cru — necessário porque o fetch dos hooks de
 * Ads restringe no servidor via `.ilike("Client", "%core%")`, e p/ clientes com alias
 * (ex.: "Dr. Diego Candido - Ginecologista" → "Diego_Cândido") o core do slug não casaria.
 */
export function buildAdsClientOptions(rawNames: string[], channel?: ClientChannel): AdsClientOptions {
  const rawByCmpKey = new Map<string, string[]>();
  const canonicalByCmpKey = new Map<string, string>();
  for (const raw of rawNames) {
    if (!raw || isExcludedClient(raw, channel)) continue;
    const canonical = canonicalizeAdsClient(raw);
    if (!canonical) continue;
    const key = clientMatchKey(canonical);
    if (!key) continue;
    const arr = rawByCmpKey.get(key) || [];
    arr.push(raw);
    rawByCmpKey.set(key, arr);
    const prev = canonicalByCmpKey.get(key);
    const richness = (s: string) => s.length - stripAccents(s).length;
    if (!prev || richness(canonical) > richness(prev)) canonicalByCmpKey.set(key, canonical);
  }
  const options = [...canonicalByCmpKey.values()]
    .map((canonical) => ({ value: canonical, label: prettyClientLabel(canonical) }))
    // Descarta opções sem rótulo (ex.: slug que vira só "groohub" → label vazio): nada
    // pra exibir e, se selecionada, zeraria os dados. Não deve aparecer no dropdown.
    .filter((o) => o.value.trim() !== "" && o.label.trim() !== "")
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  return { options, rawByCmpKey };
}
