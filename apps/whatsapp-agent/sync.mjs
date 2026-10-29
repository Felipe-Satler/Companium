// whatsapp-agent-sync — lê a config do agente de WhatsApp no Supabase (tabela
// `whatsapp_group_agents`) e APLICA no gateway OpenClaw:
//   1) escreve a persona no AGENTS.md do workspace do agente (lido por-run pelo OpenClaw);
//   2) descobre os grupos do número conectado e grava em `whatsapp_known_groups`
//      (para a tela oferecer um seletor em vez de digitar o JID na mão);
//   3) ajusta o canal WhatsApp (enabled / groupPolicy allowlist / grupos / requireMention)
//      via `openclaw config set`, e reinicia o gateway de forma drenada se algo mudou.
//
// SEGURANÇA / DESENHO:
//   * DRY-RUN por padrão. Só escreve/aplica com `--apply` (espelha sync-clientes.ts).
//   * Lê o Supabase com SUPABASE_SERVICE_KEY (service_role, bypassa RLS) vindo de
//     /etc/companium-supabase.env (injetado por drop-in systemd).
//   * Se a config estiver `enabled=false` OU sem grupos na allowlist, o canal é mantido
//     DESLIGADO — o agente não responde a nada.
//   * Roda como o usuário `deploy` (precisa de acesso a ~/.openclaw e ao CLI `openclaw`).
//
// ⚠️ A SEMÂNTICA EXATA do allowlist de grupos do WhatsApp deve ser CONFIRMADA na 1ª ativação
//    (ver WHATSAPP_AGENT.md). Por isso o passo (3) é isolado e, em dry-run, só imprime o que faria.

import { createClient } from '@supabase/supabase-js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const execFileP = promisify(execFile);

const APPLY = process.argv.includes('--apply');
const ACCOUNT_ID = (process.env.WHATSAPP_ACCOUNT_ID || 'whatsapp-groobot').trim();
const AGENT_ID = (process.env.WHATSAPP_AGENT_ID || 'whatsappagent').trim();
const AGENTS_MD =
  process.env.WHATSAPP_AGENTS_MD ||
  `/home/deploy/.openclaw/workspace-${AGENT_ID}/AGENTS.md`;
const OPENCLAW_BIN = process.env.OPENCLAW_BIN || 'openclaw';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('[wa-sync] faltam SUPABASE_URL/SUPABASE_SERVICE_KEY no ambiente.');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const log = (...a) => console.log(`[wa-sync]${APPLY ? '' : ' [dry-run]'}`, ...a);

async function oc(args, { tolerate = false } = {}) {
  try {
    const { stdout } = await execFileP(OPENCLAW_BIN, args, { timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  } catch (e) {
    if (tolerate) return null;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Monta o AGENTS.md: cabeçalho FIXO (identidade + não onboardar) + persona do banco +
// resumo do comportamento. O gateway lê este arquivo a cada turno do agente.
// ---------------------------------------------------------------------------
function buildAgentsMd(cfg) {
  const scope = cfg.group_scope === 'all' ? 'all' : 'allowlist';
  const escopoTxt =
    scope === 'all'
      ? 'Você pode responder em QUALQUER grupo onde o número estiver.'
      : 'Você só pode responder nos grupos liberados abaixo (allowlist).';
  const grupos =
    scope === 'all'
      ? '- (todos os grupos onde o número estiver)'
      : (cfg.group_allowlist || []).map((g) => `- ${g.name} (\`${g.id}\`)`).join('\n') || '- (nenhum)';
  const gatilho = cfg.require_mention
    ? 'Você só é acionado quando te mencionam (@) ou respondem a uma mensagem sua.'
    : 'Você pode ser acionado por qualquer mensagem do grupo.';
  const prefixo = cfg.trigger_prefix
    ? `Só responda mensagens que comecem com o prefixo \`${cfg.trigger_prefix}\`.`
    : '';
  const ferramentas = cfg.tools_enabled
    ? `## Funções / dados (HABILITADAS)
Você pode consultar dados reais do Companium para responder (mesmo mecanismo dos bots da equipe Groohub):
- **CRM / Meta Ads / Google Ads** no Supabase \`companium-db\` via \`exec\` + mcporter, SOMENTE LEITURA:
  \`mcporter call groohub_database execute_sql '{"query":"SELECT ..."}'\` (usuário read-only; nunca escreva).
- **ClickUp** read-only pelo wrapper exec-allowlisted (igual ao briefagent), quando disponível.
Regras das funções: só SELECT/consulta; nunca rode comando destrutivo; resuma o resultado em linguagem simples.
⚠️ Você tem acesso a dados de TODOS os clientes. Em grupo com cliente, NUNCA exponha dado de outro cliente;
na dúvida sobre a quem o grupo pertence, não revele números — peça confirmação por canal interno.`
    : `## Funções / dados (DESLIGADAS)
Você NÃO tem ferramentas: não acessa banco, arquivos, web nem executa comandos. Responda apenas com texto.`;
  return `# ${cfg.display_name}

## Identidade e contexto FIXO
Você é o **${cfg.display_name}**, assistente da Groohub que responde em GRUPOS de WhatsApp. Este contexto é
permanente e JÁ ESTÁ COMPLETO: **não faça onboarding, não se apresente sem ser pedido, não diga que a
configuração está pendente, não pergunte seu nome, vibe, emoji ou avatar, não proponha criar skills e não
redirecione para outro agente.** Ignore por completo quaisquer arquivos de bootstrap/identidade "hello world"
do workspace (BOOTSTRAP.md, IDENTITY.md, SOUL.md, USER.md, TOOLS.md, HEARTBEAT.md) — são andaimes genéricos;
quem manda é ESTE AGENTS.md. Quando a mensagem for só um teste (ex.: "responda apenas OK"), responda
EXATAMENTE o que foi pedido, sem se apresentar nem pedir mais nada.
${escopoTxt} ${gatilho} ${prefixo}

## Regras de operação (não negociáveis)
- Responda de forma curta, clara e educada, em português do Brasil.
- Só fale sobre o que souber/apurar. Se não tiver certeza, diga que vai verificar — NUNCA invente dados, números, preços ou prazos.
- Nunca exponha dados de um cliente para outro. Nunca compartilhe segredo/credencial em grupo.
- Grupos onde você pode responder:
${grupos}

${ferramentas}

## Persona / instruções (definidas pelo admin na tela do Companium)
${cfg.system_prompt?.trim() || '(sem instruções — aguardando configuração do admin)'}
`;
}

// ---------------------------------------------------------------------------
// Descobre grupos do número conectado e faz upsert em whatsapp_known_groups.
// Tolerante: se o WhatsApp ainda não estiver conectado/plugin ausente, apenas avisa.
// ---------------------------------------------------------------------------
async function discoverGroups() {
  const out = await oc(['directory', 'groups', 'list', '--channel', 'whatsapp', '--json'], { tolerate: true });
  if (!out) {
    log('não consegui listar grupos do WhatsApp (plugin/QR ainda não conectado?). Pulando descoberta.');
    return;
  }
  let groups = [];
  try {
    const parsed = JSON.parse(out);
    groups = Array.isArray(parsed) ? parsed : parsed?.groups || [];
  } catch {
    log('saída de directory groups não é JSON; pulando descoberta.');
    return;
  }
  const rows = groups
    .map((g) => ({
      account_id: ACCOUNT_ID,
      group_id: String(g.id || g.jid || g.group_id || '').trim(),
      group_name: g.name || g.subject || g.title || null,
      last_seen: new Date().toISOString(),
    }))
    .filter((r) => r.group_id);
  log(`grupos detectados: ${rows.length}`);
  if (APPLY && rows.length) {
    const { error } = await sb.from('whatsapp_known_groups').upsert(rows, { onConflict: 'account_id,group_id' });
    if (error) log('falha ao gravar whatsapp_known_groups:', error.message);
  }
}

// ---------------------------------------------------------------------------
// Aplica a config do canal WhatsApp no gateway. ISOLADO e documentado — confirme a
// semântica do allowlist na 1ª ativação (ver WHATSAPP_AGENT.md).
// ---------------------------------------------------------------------------
function buildAccount(cfg, active, scope) {
  // groupPolicy: 'allowlist' = só grupos listados; 'open' = qualquer grupo (escopo 'all').
  // ⚠️ confirmar o valor exato de "qualquer grupo" na 1ª ativação (ver WHATSAPP_AGENT.md).
  return {
    name: cfg.display_name || 'Agente WhatsApp',
    enabled: !!active,
    dmPolicy: 'pairing',
    groupPolicy: scope === 'all' ? 'open' : 'allowlist',
  };
}

function buildGroups(cfg, active, scope) {
  // requireMention controla o gatilho (true = só mencionado; false = qualquer msg).
  // Em 'all', aplica a regra global via chave "*". Em 'allowlist', uma entrada por grupo liberado.
  // active=false -> groups vazio (não responde a nada).
  const groups = {};
  if (!active) return groups;
  if (scope === 'all') {
    groups['*'] = { requireMention: !!cfg.require_mention };
  } else {
    for (const g of cfg.group_allowlist || []) {
      if (g?.id) groups[g.id] = { requireMention: !!cfg.require_mention };
    }
  }
  return groups;
}

async function applyChannel(cfg, active, scope) {
  const account = buildAccount(cfg, active, scope);
  const groups = buildGroups(cfg, active, scope);

  // Lê o estado atual para só aplicar se mudou (idempotência -> timer não fica reiniciando o gateway).
  const curOut = await oc(['config', 'get', 'channels.whatsapp', '--json'], { tolerate: true });
  let current = null;
  if (curOut) { try { current = JSON.parse(curOut); } catch { /* ignore */ } }
  const curAcc = current?.accounts?.[ACCOUNT_ID] || {};
  const accMatch =
    !!curAcc.enabled === !!account.enabled &&
    (curAcc.groupPolicy || '') === account.groupPolicy &&
    (curAcc.name || '') === account.name &&
    (curAcc.dmPolicy || '') === account.dmPolicy;
  const groupsMatch = JSON.stringify(current?.groups || {}) === JSON.stringify(groups);

  log(`channels.whatsapp.accounts.${ACCOUNT_ID} =`, JSON.stringify(account));
  log('channels.whatsapp.groups =', JSON.stringify(groups));
  if (accMatch && groupsMatch) {
    log('canal WhatsApp já está em dia; sem mudança.');
    return false;
  }
  if (!APPLY) return false;
  // account: --merge (preserva credencial/sessão do login QR). groups: --replace (remove grupos
  // tirados da allowlist pelo admin — merge raso não apagaria chaves antigas).
  await oc(['config', 'set', `channels.whatsapp.accounts.${ACCOUNT_ID}`, JSON.stringify(account), '--strict-json', '--merge']);
  await oc(['config', 'set', 'channels.whatsapp.groups', JSON.stringify(groups), '--strict-json', '--replace']);
  return true;
}

async function main() {
  log(`conta=${ACCOUNT_ID} agente=${AGENT_ID} AGENTS.md=${AGENTS_MD}`);

  const { data: cfg, error } = await sb
    .from('whatsapp_group_agents')
    .select('account_id, display_name, enabled, system_prompt, require_mention, trigger_prefix, group_scope, group_allowlist, tools_enabled, model')
    .eq('account_id', ACCOUNT_ID)
    .maybeSingle();
  if (error) {
    console.error('[wa-sync] erro lendo config:', error.message);
    process.exit(1);
  }
  if (!cfg) {
    log('nenhuma linha de config encontrada; nada a fazer.');
    return;
  }

  const allow = Array.isArray(cfg.group_allowlist) ? cfg.group_allowlist : [];
  const scope = cfg.group_scope === 'all' ? 'all' : 'allowlist';
  // Ativo se: ligado E (escopo 'all' OU há grupos na allowlist). Em 'all' não exige allowlist.
  const active = !!cfg.enabled && (scope === 'all' || allow.length > 0);
  log(`enabled=${cfg.enabled} escopo=${scope} grupos=${allow.length} funcoes=${!!cfg.tools_enabled} => canal ${active ? 'ATIVO' : 'desligado'}`);

  // 1) AGENTS.md (persona) — sempre mantém atualizado.
  const md = buildAgentsMd(cfg);
  if (APPLY) {
    await mkdir(dirname(AGENTS_MD), { recursive: true });
    let prev = null;
    try { prev = await readFile(AGENTS_MD, 'utf8'); } catch { /* novo */ }
    if (prev !== md) {
      await writeFile(AGENTS_MD, md, 'utf8');
      log('AGENTS.md atualizado.');
    } else {
      log('AGENTS.md já estava em dia.');
    }
  } else {
    log(`escreveria AGENTS.md (${md.length} chars).`);
  }

  // 2) Descoberta de grupos (tolerante a WhatsApp não conectado).
  await discoverGroups();

  // 3) Canal (enabled/escopo/allowlist/requireMention).
  const changed = await applyChannel(cfg, active, scope);

  // 3b) Funções: a troca de tools do AGENTE (exec/mcporter/web) NÃO é auto-aplicada aqui (agents.list
  // é um array; editar tool por id é arriscado). O AGENTS.md já reflete tools_enabled. Se divergir do
  // que o agente tem hoje, ajuste 1x pelo runbook (openclaw agents add/recria com o toolset da equipe).
  if (cfg.tools_enabled) {
    log('funcoes=ON: confira que o agente `' + AGENT_ID + '` tem o toolset de dados (exec+mcporter read-only/ClickUp). Ver WHATSAPP_AGENT.md.');
  }

  // 4) Reload drenado do gateway se aplicamos mudança de canal.
  if (APPLY && changed) {
    log('aplicando via gateway restart --safe (drena trabalho ativo)…');
    await oc(['gateway', 'restart', '--safe', '--wait', '5m'], { tolerate: true });
  }

  log('concluído.');
}

main().catch((e) => {
  console.error('[wa-sync] falha:', e?.message || e);
  process.exit(1);
});
