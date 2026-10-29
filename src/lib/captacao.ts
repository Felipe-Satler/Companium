// Captação (mídia própria da Groohub) — a agência roda anúncios para captar seus PRÓPRIOS
// clientes. As contas de anúncios dessa operação são as contas do Meta cujo nome COMEÇA com
// "Groohub" (ex.: "Groohub - CA 1.1.1", "Groohub - CA 4.1.1"), SEM o sufixo " | Groohub" que
// os clientes usam ("Dr. Fulano - CA 1.1.1 | Groohub"). São ~8 contas hoje.
//
// O bot do Composio grava `Client` = nome cru da conta do Meta (index.ts buildRow → acc.name),
// então na base (v_meta_google_ads / "Criativos Meta Ads") o `Client` é "Groohub - CA X.X.X".
// Toda a camada de /clientes trata "groohub" como TAG de portfólio e a descarta
// (canonicalizeAdsClient), por isso a captação é invisível lá. Aqui isolamos essas contas
// por prefixo, sem canonicalização.

/**
 * Padrão PostgREST (ilike) para restringir o fetch às contas próprias da Groohub no servidor.
 * Casa "Groohub - CA 1.1.1", "Groohub - CA 4.1.1" etc. Nenhuma conta de CLIENTE começa com
 * "Groohub" (o nome do médico/clínica vem antes; "Groohub" só aparece no fim, após " | ").
 */
export const CAPTACAO_ILIKE = "Groohub%";

/**
 * true se o nome cru da conta (`Client`) é uma conta PRÓPRIA da Groohub (captação), e não uma
 * conta de cliente ("... | Groohub"). Reforço client-side do filtro do servidor.
 */
export function isCaptacaoClient(client: string | null | undefined): boolean {
  if (!client) return false;
  const c = client.trim();
  // Começa com "Groohub" (início da palavra) E não é conta de cliente ("... | Groohub").
  return /^groohub\b/i.test(c) && !c.includes("|");
}

/**
 * Sentinela passado como `clientFilter` aos hooks de Ads (useMetaAdsClienteData /
 * useGoogleAdsClienteData) para ativar o "modo captação": o fetch restringe no servidor a
 * `Client ilike 'Groohub%'` (contas próprias) e o CRM não atribui nenhum lead (a captação não
 * tem pipeline de clientes no Kommo). NÃO usar o nome cru "Groohub" aqui — a canonicalização
 * o reduziria a vazio e cairia no portfólio inteiro.
 */
export const CAPTACAO_FILTER = "__captacao_groohub__";

// A meta mensal de investimento do "Pacing mensal" NÃO é constante — é preenchida por dentro
// do sistema e persistida em `captacao_config` (ver useCaptacaoMeta). Vazia até definir.
