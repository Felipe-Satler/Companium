/**
 * Credenciais do Supabase vindas do ARQUIVO CENTRAL do servidor (`/etc/companium-supabase.env`).
 *
 * Desde 25/10/2026 esse arquivo é a fonte única das credenciais: o build do site e os serviços do
 * WhatsApp já o leem. O ad-spy-worker e a openclaw-bridge tinham cópias próprias (`spy.env`,
 * `bridge.env`), e uma troca de chave feita só no arquivo central os deixaria sem banco no
 * reinício seguinte. Este módulo, importado PRIMEIRO pelos dois, traz do arquivo central as
 * credenciais — e SÓ elas.
 *
 * ## Por que no código, e não `EnvironmentFile=` no systemd
 *
 * O systemd carrega o arquivo inteiro, e entre dois `EnvironmentFile` o último ganha em TODA
 * variável: um `PORT=` ou `PATH=` que um dia entre no arquivo central derrubaria o worker na porta
 * errada (ver o comentário em `ad-spy-worker.service`). Aqui só passam as três chaves abaixo.
 *
 * ## Quem ganha
 *
 * O arquivo central, quando tem a chave: é ele que é trocado numa rotação. O que ele não tiver
 * fica como estava no `spy.env`/`bridge.env`. Sem arquivo (máquina de desenvolvimento, testes), não
 * faz nada. Nunca lança e nunca imprime valor: só o NOME das chaves que vieram de lá.
 */

import { readFileSync } from "node:fs";

export const ARQUIVO_CENTRAL = "/etc/companium-supabase.env";

/** As únicas variáveis que o arquivo central pode definir aqui. */
export const CHAVES_CENTRAIS = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_KEY"];

/**
 * Lê o texto de um arquivo `KEY=VALUE` (o formato que `set -a; . arquivo` aceita) e devolve só as
 * chaves permitidas. Ignora comentário, linha vazia e `export ` na frente; tira aspas em volta.
 */
export function lerArquivoCentral(texto) {
  const out = {};
  for (const bruta of String(texto || "").split(/\r?\n/)) {
    const linha = bruta.trim().replace(/^export\s+/, "");
    if (!linha || linha.startsWith("#")) continue;
    const i = linha.indexOf("=");
    if (i <= 0) continue;
    const chave = linha.slice(0, i).trim();
    if (!CHAVES_CENTRAIS.includes(chave)) continue;
    let valor = linha.slice(i + 1).trim();
    if (/^(["']).*\1$/.test(valor)) valor = valor.slice(1, -1);
    if (valor) out[chave] = valor;
  }
  return out;
}

/**
 * Aplica no `env` as credenciais do arquivo central. Devolve os NOMES das chaves aplicadas.
 *
 * @param {{ arquivo?: string, env?: Record<string, string|undefined>,
 *           ler?: (p: string) => string, log?: (m: string) => void }} [opcoes]
 */
export function aplicarCredenciaisCentrais({
  arquivo = process.env.COMPANIUM_SUPABASE_ENV || ARQUIVO_CENTRAL,
  env = process.env,
  ler = (p) => readFileSync(p, "utf8"),
  log = (m) => console.error(m),
} = {}) {
  let texto;
  try {
    texto = ler(arquivo);
  } catch {
    return []; // sem arquivo central (dev, testes) ou sem permissão: fica o que já está no env
  }
  const lidas = lerArquivoCentral(texto);
  const aplicadas = Object.keys(lidas);
  for (const chave of aplicadas) env[chave] = lidas[chave];
  if (aplicadas.length) log(`credenciais Supabase de ${arquivo}: ${aplicadas.join(", ")}`);
  return aplicadas;
}

aplicarCredenciaisCentrais();
