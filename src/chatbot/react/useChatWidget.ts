import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/external-supabase/client';
import { ChatbotShell } from '@/chatbot/core/shell';
import { safeHttpUrl } from '@/chatbot/core/url';
import { MockTransport, type Transport } from '@/chatbot/core/transport';
import { OpenClawTransport } from '@/chatbot/react/openClawTransport';
import type { PlotSpec } from '@/components/PlotChart';
import type { ChatMessage, ConversationItem } from '@/chatbot/core/types';
import { toast } from 'sonner';
import '@/chatbot/core/chatbot.css';
import { HybridChatStorage, seedCache } from './hybridStorage';
import { botConfigKey, fetchBotConfig, resolveBotAccess } from './botConfig';
import { enterAgent, leaveAgent } from '@/lib/usage/tracker';
import { listConversations, createConversation, loadTranscript, saveTranscript, renameConversation as apiRename,
        deleteConversation as apiDelete, type Conversation } from '@/chatbot/react/conversationsApi';



export type ActivePlot = { id: string; spec: PlotSpec; title: string };

export function useChatWidget(
    containerRef: React.RefObject<HTMLElement | null>,
    opts: { inline?: boolean; composerSlot?: HTMLElement } = {},
) {
    const inline = !!opts.inline;
    const { user, session, clientUser } = useAuth();
    const userId = user?.id ?? null;
    const isClient = !!clientUser;

    const { data: botConfig } = useQuery({
        queryKey: botConfigKey(userId),
        enabled: !!userId,
        queryFn: () => fetchBotConfig(userId!),
    });

    const [ currentAgent, setCurrentAgent ] = useState<string | null>(null);
    const [ activePlot, setActivePlot ] = useState<ActivePlot | null>(null);
    const [ pdfBusy, setPdfBusy ] = useState(false);
    // Deliverables (plots/documents) of the current conversation + the set of
    // items the user "detached" (hidden from the side panel), persisted per bot.
    const [ items, setItems ] = useState<ConversationItem[]>([]);
    const [ detached, setDetached ] = useState<Set<string>>(new Set());
    // True when the active conversation ends in a user message with no reply yet
    // (a turn is running in the background) — drives the "gerando…" indicator.
    const [ pendingReply, setPendingReply ] = useState(false);

    // Resolve current agent: saved pick if allowed, else the primary bot. Primary is
    // assigned/default for internal users, assigned/allowed (no default) for clients.
    useEffect(() => {
        if (!userId || !botConfig) return;
        const { primary } = resolveBotAccess(botConfig, isClient);
        if (!primary) return;
        const canSwitch = botConfig.settings?.can_switch;
        const allowed = botConfig.settings?.allowed_bots ?? [];
        const pick = localStorage.getItem(`groohub:chatbot:v1:${userId}:agent`);
        const valid = !!pick && botConfig.bots.some((b) => b.id === pick) &&
            (pick === primary || (canSwitch && allowed.includes(pick)));
        setCurrentAgent(valid ? pick : primary)
    }, [ userId, botConfig, isClient ]);

    // Switchable set + canSwitch, exposed for an external picker (BotSelect),
    const canSwitch = !!botConfig?.settings?.can_switch;
    const switchable = useMemo(() => {
        if (!canSwitch) return [] as { id: string; label: string }[];
        const { primary } = resolveBotAccess(botConfig, isClient);
        const allowedIds = new Set([primary, ...(botConfig?.settings?.allowed_bots ?? [])].filter(Boolean));
        return (botConfig?.bots ?? []).filter((b) => allowedIds.has(b.id)).map((b) => ({ id: b.id, label: b.label }));
    }, [botConfig, canSwitch, isClient]);
    const sessionRef = useRef(session);
  sessionRef.current = session;
  const reopenRef = useRef(false);
  const widgetRef = useRef<ChatbotShell | null>(null); // live shell, for background-reply hydrate
  const pendingReplyRef = useRef(false); // mirror, so a fresh mount can apply the lock immediately

  // Get the current bot name
  const currentBotLabel = botConfig?.bots.find((b) => b.id === currentAgent)?.label ?? 'Assistente';

  const switchAgent = (botId: string) => {
    if (!userId || botId === currentAgent) return;
    localStorage.setItem(`groohub:chatbot:v1:${userId}:agent`, botId);
    reopenRef.current = true;
    setCurrentAgent(botId);
  };

  const qc = useQueryClient();

  // Conversas do bot atual (trocar de bot recarrega a lista)
  const convQuery = useQuery({
    queryKey: ['chatbot-conversations', userId, currentAgent],
    enabled: !!userId && !!currentAgent,
    queryFn: () => listConversations(userId!, currentAgent!),
  });
  const conversations = convQuery.data ?? [];

  const conversationsRef = useRef<Conversation[]>([]);
  conversationsRef.current = conversations;

  const [ activeConversationId, setActiveConversationId ] = useState<string | null>(null);
  const activeKey = (botId: string) => `groohub:chatbot:v1:${botId}:${userId}:activeConversation`;

  // ao trocar de bot, zera a ativa para não montar com a conversa do bot anterior
  // (o mount só monta quando activeConversationId existir)
  useEffect(() => {
    setActiveConversationId(null);
  }, [currentAgent]);

  // ao renomear uma conversa, atualiza o título no header
  useEffect(() => {
    const t = conversations.find((c) => c.id === activeConversationId)?.title;
    if (t) widgetRef.current?.setTitle(t);
  }, [conversations, activeConversationId]);

  // Resolve a conversa ativa: úultima usada (se existir), senão a mais recente
  // senão, cria uma nova conversa
  const ensuringRef = useRef(false);
  useEffect(() => {
    if (!userId || !currentAgent || !convQuery.isSuccess) return;
    const list = convQuery.data;
    if (activeConversationId && list.some((c) => c.id === activeConversationId)) return;
    const persisted = localStorage.getItem(activeKey(currentAgent));
    const pick = (persisted && list.find((c) => c.id === persisted)) || list[0];
    if (pick) { setActiveConversationId(pick.id); return; }
    // bot sem conversas -> migra o transcript local antigo (se houver) pra um
    // tópico, PRESERVANDO o id (mantém a sessão/memória do OpenClaw); senão cria
    // uma "Nova conversa" vazia.
    if (ensuringRef.current) return;
    ensuringRef.current = true;
    const legacyBase = `groohub:chatbot:v1:${currentAgent}:${userId}`;
    const legacyConvId = localStorage.getItem(`${legacyBase}:conversation`);
    let legacyMsgs: ChatMessage[] = [];
    try{
      const env = JSON.parse(localStorage.getItem(`${legacyBase}:transcript`) ?? 'null');
      if (env && Array.isArray(env.messages)) legacyMsgs = env.messages;
    } catch { /* ignore */ }
    const migrating = !!legacyConvId && legacyMsgs.length > 0;
    const id = migrating ? legacyConvId! : crypto.randomUUID();
    createConversation(userId, currentAgent, id, migrating ? 'Conversa 1' : 'Nova conversa')
      .then(async (conv) => {
        if(migrating) {
          await saveTranscript(id, userId, legacyMsgs).catch(() => {});
          localStorage.removeItem(`${legacyBase}:transcript`);
          localStorage.removeItem(`${legacyBase}:conversation`);
        }
        qc.setQueryData<Conversation[]>(
          ['chatbot-conversations', userId, currentAgent],
          (old) => (old ?? []).some((c) => c.id === id) ? (old as Conversation[]) : [conv, ...(old ?? [])],
        );
        setActiveConversationId(id);
      })
      .catch(() => {})
      .finally(() => { ensuringRef.current = false; });

  }, [ userId, currentAgent, convQuery.isSuccess, convQuery.data, activeConversationId, qc ]);

  const switchConversation = (convId: string) => {
    if (!currentAgent || convId === activeConversationId) return;
    localStorage.setItem(activeKey(currentAgent), convId);
    setActiveConversationId(convId);
  };

  const newConversation = async () => {
    if (!userId || !currentAgent) return;
    const id = crypto.randomUUID();
    const conv = await createConversation(userId, currentAgent, id).catch(() => null);
    // Coloca a conversa nova no cache da query JÁ, para o efeito que resolve a
    // ativa enxergá-la e NÃO reverter para uma existente antes do refetch chegar.
    const optimistic: Conversation = conv ?? {
      id, bot_id: currentAgent, title: 'Nova conversa',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    qc.setQueryData<Conversation[]>(
      ['chatbot-conversations', userId, currentAgent],
      (old) => [optimistic, ...(old ?? []).filter((c) => c.id !== id)],
    );
    localStorage.setItem(activeKey(currentAgent), id);
    setActiveConversationId(id);
  }

  const renameConversation = async (convId: string, title: string) => {
    await apiRename(convId, title).catch(() => {});
    qc.invalidateQueries({ queryKey: ['chatbot-conversations', userId, currentAgent] });
  }

  // Título automático: na 1ª mensagem do usuário, se a conversa estiver sem título, renomeia
  // uma vez renomeado, não renomeia mais
  const maybeAutoTitle = (convId: string, content: string) => {
    const conv = conversationsRef.current.find((c) => c.id === convId);
    if (!conv || conv.title !== "Nova conversa") return;
    const clean = content.trim().replace(/\s+/g, " ");
    if (!clean) return;
    const MAX = 60;
    let title = clean;
    if (clean.length > MAX) {
      // Corta numa fronteira de palavra (último espaço antes do limite) e termina
      // em … — evita palavras cortadas no meio no header/lista.
      const cut = clean.slice(0, MAX);
      const lastSpace = cut.lastIndexOf(' ');
      title = (lastSpace > 30 ? cut.slice(0, lastSpace) : cut).replace(/[\s…]+$/, '') + '…';
    }
    void renameConversation(convId, title);
  }

  const deleteConversation = async (convId: string) => {
    await apiDelete(convId).catch(() => {});
    if (convId === activeConversationId) {
      // cai para mais recente restante; se não sobrar, null -> a resolução cria uma nova
      const remaining = conversations.filter((c) => c.id !== convId);
      if (currentAgent) {
        if(remaining[0]) localStorage.setItem(activeKey(currentAgent), remaining[0].id);
        else localStorage.removeItem(activeKey(currentAgent));
      }
      setActiveConversationId(remaining[0]?.id ?? null);
    }
    qc.invalidateQueries({ queryKey: ['chatbot-conversations', userId, currentAgent] });
  }


  // Mount / re-mount the shell whenever user or agent changes.
  useEffect(() => {
    if (!userId || !currentAgent || !activeConversationId) return;
    const el = containerRef.current;
    if (!el) return;
    const botId = currentAgent;
    const convId = activeConversationId;
    const cacheKey = `groohub:chatbot:v1:${botId}:${userId}:${convId}:transcript`;

    let cancelled = false;
    let widget: ChatbotShell | null = null;

    (async () => {
      // semeia o cache local com o transcript do Supabase antes do load() síncrono
      try {
        const msgs = await loadTranscript(convId);
        if (!cancelled) seedCache(cacheKey, msgs);
      } catch { /* offline */ }
      if (cancelled) return;

      const transport: Transport = import.meta.env.VITE_CHATBOT_BACKEND === 'openclaw'
        ? new OpenClawTransport({
          endpoint: import.meta.env.VITE_OPENCLAW_ENDPOINT ?? '/api/openclaw/chat',
          botId,
          getAuthHeaders: () => {
            const token = sessionRef.current?.access_token;
            return token ? { Authorization: `Bearer ${token}` } : {};
          },
          getConversationId: () => convId,
        })
        : new MockTransport({ delayMs: 700, reply: (text) => ({ type: 'message', content: `You said: ${text}` }) });

      const label = botConfig?.bots.find((b) => b.id === botId)?.label ?? 'Assistente';

      const convTitle = conversationsRef.current.find((c) => c.id === convId)?.title ?? 'Nova conversa';
    
      widget = new ChatbotShell({
        transport,
        inline,                                 // ← full-page vs floating
        composerSlot: opts.composerSlot,        // host slot in the footer (bot picker)
        onItems: setItems,                      // conversation deliverables -> side panel
        title: convTitle,                              // header title
        renderContent: (elc, message) => {
          const plot = message.metadata?.plot;
          if (!plot) return;
          elc.innerHTML = '';
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'msg-plot-link';
          // thumbnailUrl is model/backend output — only ever use a real http(s) URL.
          const safeThumb = safeHttpUrl(plot.thumbnailUrl);
          if (safeThumb) {
            const img = document.createElement('img');
            img.src = safeThumb; img.alt = plot.title ?? 'Gráfico';
            btn.appendChild(img);
          } else {
            btn.textContent = `${plot.title || 'Abrir gráfico'} →`;
          }
          btn.addEventListener('click', () => {
            if (plot.spec) setActivePlot({ id: plot.id, spec: plot.spec as PlotSpec, title: plot.title ?? 'Gráfico' });
            else if (safeThumb) window.open(safeThumb, '_blank', 'noopener');
          });
          elc.appendChild(btn);
        },
        // Full page: the picker is external (BotSelect), so no header dropdown.
        titleMenu: inline ? undefined : {
          label,
          options: switchable,
          currentId: botId,
          enabled: canSwitch && switchable.length > 1,
          onSelect: (id) => switchAgent(id),
        },
        storage: new HybridChatStorage(cacheKey, (m) => { void saveTranscript(convId, userId, m).catch(() => {}); }),
        menuItems: [
          { label: 'Reportar um bug', onSelect: () => console.log('TODO: open bug report form') },
        ],
        hooks: {
          onEvent: (e) => {
            // Tempo por agente na página Uso do Companium (/uso).
            if (e.type === 'open') enterAgent(botId, inline ? 'pagina' : 'flutuante', el);
            else if (e.type === 'close') leaveAgent(botId);
            void supabase.from('chatbot_audit').insert({
              user_id: userId, bot_id: botId, event_type: e.type,
              bot_session_id: e.botSessionId ?? null, trace_id: e.traceId ?? null,
              input_kind: e.inputKind ?? null, text_length: e.textLength ?? null,
              intent_type: e.intentType ?? null, service: e.service ?? null,
              has_artifact: e.hasArtifact ?? null, has_plot: e.hasPlot ?? null,
              status: e.status ?? null, duration_ms: e.durationMs ?? null,
              error_message: e.errorMessage ?? null, client_ts: new Date(e.timestamp).toISOString(),
            }).then(({ error }) => { if (error) console.debug('[audit] insert failed:', error.message); });
          },
          onReset: () => {void newConversation();},
          onMessageSend: (m) => maybeAutoTitle(convId, m.content),
        },
      });
    
      widget.mount(el);
      widgetRef.current = widget; // expose for background-reply hydrate
      widget.setInputBlocked(pendingReplyRef.current); // a running bg turn locks the composer
      if (!inline && reopenRef.current) { widget.open(); reopenRef.current = false; } // inline mounts already open
    })();

    return () => { cancelled = true; leaveAgent(botId); widget?.destroy(); widgetRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, currentAgent, activeConversationId, inline]);

  // Background turns: if the active conversation ends in a user message with no
  // reply (a turn is running server-side after we left/returned), poll the
  // transcript until the reply lands, then hydrate the live shell with it.
  useEffect(() => {
    if (!userId || !currentAgent || !activeConversationId) { setPendingReply(false); return; }
    const botId = currentAgent;
    const convId = activeConversationId;
    const cacheKey = `groohub:chatbot:v1:${botId}:${userId}:${convId}:transcript`;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let sawPending = false;
    const deadline = Date.now() + 4 * 60 * 1000; // stop polling after ~4 min

    const poll = async () => {
      if (cancelled) return;
      let msgs: ChatMessage[] = [];
      try { msgs = await loadTranscript(convId); } catch { /* offline */ }
      if (cancelled) return;
      const last = msgs[msgs.length - 1];
      const pending = !!last && last.role === 'user';
      if (pending && Date.now() < deadline) {
        sawPending = true;
        setPendingReply(true);
        timer = setTimeout(poll, 2500);
      } else {
        // resolved (reply arrived) OR timed out -> hide the indicator either way
        setPendingReply(false);
        if (sawPending && !pending) {
          // a reply actually landed -> push it into the cache + the live shell
          seedCache(cacheKey, msgs);
          widgetRef.current?.hydrate(msgs);
        }
      }
    };
    timer = setTimeout(poll, 1500); // let the mount settle first
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, currentAgent, activeConversationId]);

  // Keep the composer lock in sync with "a reply is still generating".
  useEffect(() => {
    pendingReplyRef.current = pendingReply;
    widgetRef.current?.setInputBlocked(pendingReply);
  }, [pendingReply]);

  const downloadPlotPdf = async () => {
    if (!activePlot) return;
    const token = sessionRef.current?.access_token;
    if (!token) { toast.error('Sessão expirada. Recarregue a página.'); return; }
    const apiBase = (import.meta.env.VITE_OPENCLAW_ENDPOINT ?? '/api/openclaw/chat').replace(/\/chat$/, '');
    setPdfBusy(true);
    try {
      const res = await fetch(`${apiBase}/plots/${activePlot.id}/export.pdf`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`export ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${activePlot.title || 'grafico'}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch { toast.error('Não foi possível baixar o PDF.'); }
    finally { setPdfBusy(false); }
  };

  // Detached set (items hidden from the side panel), persisted per conversation.
  const detachedKey = userId && currentAgent && activeConversationId
    ? `groohub:chatbot:v1:${currentAgent}:${userId}:${activeConversationId}:detached` : null;
  useEffect(() => {
    if (!detachedKey) { setDetached(new Set()); return; }
    try {
      const raw = localStorage.getItem(detachedKey);
      setDetached(new Set(raw ? (JSON.parse(raw) as string[]) : []));
    } catch { setDetached(new Set()); }
  }, [detachedKey]);

  const detachItem = (key: string) => {
    if (!detachedKey) return;
    setDetached((prev) => {
      const next = new Set(prev);
      next.add(key);
      try { localStorage.setItem(detachedKey, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  };

  const visibleItems = useMemo(
    () => items.filter((it) => !detached.has(it.key)),
    [items, detached],
  );

  return {
    currentAgent, switchable, canSwitch, switchAgent,
    activePlot, setActivePlot, pdfBusy, downloadPlotPdf,
    items: visibleItems, detachItem,
    conversations, activeConversationId, switchConversation, newConversation,
    renameConversation, deleteConversation,
    pendingReply, currentBotLabel,
  };
}