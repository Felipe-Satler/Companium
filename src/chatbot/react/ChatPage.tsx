import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { useChatWidget } from '@/chatbot/react/useChatWidget';
import { PlotModal } from '@/chatbot/react/PlotModal';
import { BotSelect } from '@/chatbot/react/BotSelect';
import { ConversationArtifacts } from '@/chatbot/react/ConversationArtifacts';
import { ConversationList } from './ConversationList';

const LEFT_KEY = 'groohub:chatbot:v1:showConversations';

// Suggestion chips for the empty state (fill the composer on click).
const SUGGESTIONS = [
  'Faturamento por mês',
  'Leads por canal',
  'Como está o CPA este mês?',
  'Resumo da semana',
];

export default function ChatPage() {
  const containerRef = useRef<HTMLDivElement>(null);

  // Stable slot node: the shell inserts it into the footer (left of Send); we
  // portal the bot picker into it so flexbox aligns it with the Send button.
  const slotRef = useRef<HTMLDivElement | null>(null);
  if (!slotRef.current) {
    slotRef.current = document.createElement('div');
    slotRef.current.className = 'gh-chatbot-composer-slot';
  }

  // Show/hide the single left panel; preference persists in localStorage.
  const [showLeft, setShowLeft] = useState(() => localStorage.getItem(LEFT_KEY) !== '0');
  const toggleLeft = () => setShowLeft((v) => { const n = !v; localStorage.setItem(LEFT_KEY, n ? '1' : '0'); return n; });

  const { currentAgent, switchable, canSwitch, switchAgent,
          activePlot, setActivePlot, downloadPlotPdf, pdfBusy,
          items, detachItem, conversations, activeConversationId, switchConversation, newConversation,
    renameConversation, deleteConversation, pendingReply, currentBotLabel } =
    useChatWidget(containerRef, { inline: true, composerSlot: slotRef.current });

  const toggleBtn =
    'inline-flex h-8 w-8 items-center justify-center rounded-md border border-border/60 bg-background/80 text-foreground shadow-sm backdrop-blur transition-all duration-200 ease-out hover:bg-background';

  // Put a suggestion into the shell's textarea (imperative DOM). Dispatching an
  // 'input' event drives the shell's own handler (state sync + auto-grow).
  const fillInput = (text: string) => {
    const ta = containerRef.current?.querySelector<HTMLTextAreaElement>('.gh-chatbot-input');
    if (!ta) return;
    ta.value = text;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus();
  };

  return (
    <DashboardLayout flush>
      {/* Paint the chat surface immediately so the empty container (before the
          shell mounts) doesn't flash the app background. */}
      <div className="relative flex h-full overflow-hidden" style={{ background: 'var(--chat-surface)' }}>
        {/* Left panel. Mobile: a drawer that slides OVER the chat (translate-x)
            with a dismiss backdrop. Desktop (lg+): in-flow, PUSHES the chat by
            animating its width (overflow-hidden clips the fixed-width inner). */}
        <div
          className={`gh-side-panel absolute inset-y-0 left-0 z-50 w-[86vw] max-w-[340px] overflow-hidden shadow-xl transition-transform duration-200 ease-out lg:static lg:z-auto lg:max-w-none lg:shadow-none lg:translate-x-0 lg:transition-[width] ${
            showLeft ? 'translate-x-0 lg:w-[300px]' : '-translate-x-full lg:w-0'
          }`}
        >
          {/* Divisória à direita (lg): separa o painel da área de conversa. Fica no
              wrapper interno de largura fixa p/ ser recortada quando o painel colapsa. */}
          <div className="flex h-full w-full flex-col lg:w-[300px] lg:border-r lg:border-border">
            <ConversationList
              conversations={conversations}
              activeId={activeConversationId}
              onSwitch={switchConversation}
              onNew={() => void newConversation()}
              onClose={toggleLeft}
              onRename={renameConversation}
              onDelete={deleteConversation}
              className="min-h-0 flex-[3]"
            />
            <ConversationArtifacts
              items={items}
              onOpenPlot={(p) => setActivePlot(p)}
              onDetach={detachItem}
              className="min-h-0 flex-[2] border-t-2 border-border"
            />
          </div>
        </div>

        {/* Mobile-only dismiss backdrop, shown while the drawer is open. */}
        {showLeft && (
          <div
            className="absolute inset-0 z-30 bg-black/40 lg:hidden"
            onClick={toggleLeft}
            aria-hidden="true"
          />
        )}

        {/* Chat column takes the remaining space and shifts as the panel pushes. */}
        <div className="gh-chat-center relative h-full min-w-0 flex-1">
          <div ref={containerRef} className="h-full" />
          {createPortal(
            <BotSelect bots={switchable} current={currentAgent} currentLabel={currentBotLabel} canSwitch={canSwitch} onSelect={switchAgent}  />,
            slotRef.current,
          )}

          {/* Empty-state hero: greeting + suggestion chips. CSS shows it only
              while the conversation is empty (:has(.gh-chatbot-list:empty)). */}
          <div className="gh-empty-hero pointer-events-none absolute inset-x-0 top-[32%] -translate-y-1/2 gap-7 px-4">
            <h2 className="text-center text-2xl font-semibold tracking-tight text-foreground sm:text-[28px]">
              Como posso ajudar você hoje?
            </h2>
            <div className="pointer-events-auto flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => fillInput(s)}
                  className="rounded-full border border-border bg-card px-4 py-2 text-sm text-muted-foreground shadow-sm transition-colors hover:border-primary/40 hover:bg-muted hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Background turn still running (came back before it finished) */}
          {pendingReply && (
            <div className="pointer-events-none absolute bottom-24 left-1/2 z-20 -translate-x-1/2">
              <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs text-muted-foreground shadow-sm">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Gerando resposta em segundo plano…
              </div>
            </div>
          )}

          {/* Toggle. Desktop: always visible, opens/closes. Mobile: only shown
              while CLOSED (max-lg:hidden when open) — when open, the X in the
              panel header closes it. */}
          <button type="button" onClick={toggleLeft}
            className={`absolute top-16 left-2 z-50 ${toggleBtn} ${showLeft ? 'max-lg:hidden' : ''}`}
            aria-label={showLeft ? 'Esconder painel' : 'Mostrar painel'} title="Conversas e gerados">
            {showLeft ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
          </button>

          {/* New conversation — mobile only (lg:hidden), over the header, right
              corner. Hidden while the drawer is open (max-lg:hidden) so it doesn't
              sit on top of the panel's close (X). Desktop uses the panel's '+'. */}
          <button type="button" onClick={() => void newConversation()}
            className={`absolute top-2 right-2 z-50 lg:hidden ${showLeft ? 'max-lg:hidden' : ''} ${toggleBtn}`}
            aria-label="Nova conversa" title="Nova conversa">
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <PlotModal plot={activePlot} onClose={() => setActivePlot(null)} onDownload={downloadPlotPdf} busy={pdfBusy} />
      </div>
    </DashboardLayout>
  );
}
