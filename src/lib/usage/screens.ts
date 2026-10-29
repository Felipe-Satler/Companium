/**
 * Registro das telas do Companium para a página "Uso do Companium" (/uso).
 *
 * Cada rota vira uma chave estável "secao.tela" — é ela que vai para o banco (usage_visits /
 * usage_clicks), então NÃO renomear chaves existentes: o histórico fica órfão. Para mudar só o
 * nome exibido, troque o `label`. Rotas novas: acrescente aqui; até lá elas aparecem como
 * "Outras › <caminho>".
 *
 * A ordem das seções é também a ordem das cores nos gráficos (cor segue a seção, nunca a posição).
 */

export type UsageSection = {
  key: string;
  label: string;
};

export type UsageScreen = {
  key: string;
  section: string;
  label: string;
  path: string;
};

export const USAGE_SECTIONS: UsageSection[] = [
  { key: "clientes", label: "Clientes" },
  { key: "captacao", label: "Captação" },
  { key: "gestao", label: "Gestão" },
  { key: "marketing", label: "Marketing" },
  { key: "biblioteca", label: "Biblioteca" },
  { key: "assistente", label: "Assistente" },
  { key: "admin", label: "Administração" },
  { key: "outras", label: "Outras" },
];

export const USAGE_SCREENS: UsageScreen[] = [
  { key: "clientes.crm", section: "clientes", label: "CRM", path: "/clientes/crm" },
  { key: "clientes.meta-ads", section: "clientes", label: "Meta Ads", path: "/clientes/meta-ads" },
  { key: "clientes.google-ads", section: "clientes", label: "Google Ads", path: "/clientes/google-ads" },
  { key: "clientes.cronograma", section: "clientes", label: "Cronograma", path: "/clientes/cronograma" },
  { key: "clientes.metas", section: "clientes", label: "Metas", path: "/clientes/metas" },
  { key: "clientes.performance", section: "clientes", label: "Performance", path: "/clientes/performance" },
  { key: "captacao.metas", section: "captacao", label: "Metas", path: "/captacao/meta" },
  { key: "captacao.meta-ads", section: "captacao", label: "Meta Ads", path: "/captacao/meta-ads" },
  { key: "captacao.google-ads", section: "captacao", label: "Google Ads", path: "/captacao/google-ads" },
  { key: "gestao.gestao", section: "gestao", label: "Gestão", path: "/gestao/gestao" },
  { key: "gestao.marcos", section: "gestao", label: "Marcos", path: "/gestao/marcos" },
  { key: "marketing.mineracao", section: "marketing", label: "Mineração", path: "/marketing" },
  { key: "marketing.biblioteca", section: "marketing", label: "Biblioteca de anúncios", path: "/marketing/biblioteca" },
  { key: "marketing.criativos", section: "marketing", label: "Criativos", path: "/marketing/criativos" },
  { key: "marketing.clientes", section: "marketing", label: "Clientes", path: "/marketing/clientes" },
  { key: "marketing.composer", section: "marketing", label: "Composer", path: "/marketing/composer" },
  { key: "marketing.composicoes", section: "marketing", label: "Composições salvas", path: "/marketing/composer/salvas" },
  // Endereço antigo (redireciona para a Oficina). A chave fica: é a do histórico de 27–29/10/2026.
  { key: "marketing.estatico", section: "marketing", label: "Estático (antigo)", path: "/marketing/composer/estatico" },
  { key: "marketing.oficina", section: "marketing", label: "Oficina de Artes", path: "/marketing/oficina" },
  { key: "marketing.artes", section: "marketing", label: "Artes Salvas", path: "/marketing/oficina/salvas" },
  { key: "marketing.orquestrador", section: "marketing", label: "Orquestrador", path: "/marketing/orquestrador" },
  { key: "biblioteca.biblioteca", section: "biblioteca", label: "Biblioteca", path: "/biblioteca" },
  { key: "assistente.chat", section: "assistente", label: "Assistente", path: "/assistente" },
  { key: "admin.admin", section: "admin", label: "Administração", path: "/admin" },
  { key: "admin.whatsapp", section: "admin", label: "Agente WhatsApp", path: "/admin/whatsapp" },
  { key: "admin.uso", section: "admin", label: "Uso do Companium", path: "/uso" },
];

const BY_PATH = new Map(USAGE_SCREENS.map((s) => [s.path, s]));
const BY_KEY = new Map(USAGE_SCREENS.map((s) => [s.key, s]));
const SECTION_LABEL = new Map(USAGE_SECTIONS.map((s) => [s.key, s.label]));

/** Tela da rota atual. Rota fora do registro → "outras.<caminho>". */
export function resolveScreen(pathname: string): UsageScreen {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const known = BY_PATH.get(path);
  if (known) return known;
  const slug = path.replace(/^\//, "").replace(/\//g, "-") || "raiz";
  return { key: `outras.${slug}`, section: "outras", label: path, path };
}

export const sectionOf = (screenKey: string) => screenKey.split(".")[0] ?? "outras";

export const sectionLabel = (sectionKey: string) => SECTION_LABEL.get(sectionKey) ?? sectionKey;

/** Nome curto da tela ("CRM") ou com a seção ("Clientes › CRM"). */
export function screenLabel(screenKey: string, withSection = false): string {
  if (screenKey === "_inicio") return "Início da sessão";
  const known = BY_KEY.get(screenKey);
  const label = known?.label ?? `/${screenKey.slice(screenKey.indexOf(".") + 1)}`;
  return withSection ? `${sectionLabel(sectionOf(screenKey))} › ${label}` : label;
}

export const screensOfSection = (sectionKey: string) => USAGE_SCREENS.filter((s) => s.section === sectionKey);
