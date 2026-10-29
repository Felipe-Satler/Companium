import { ChatMessage, PlotRef, Role } from './types';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { emojifyNode } from './emoji';
import { safeHttpUrl } from './url';

// github-flavored + line breaks. Bot output is markdown; we render it sanitized
marked.setOptions({ gfm: true, breaks: true });
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); }
});

// ---------------------------------------------------------------------------
// esc — ALWAYS run user/bot text through this before injecting as innerHTML.
// This is the single line between us and XSS, since we build HTML as strings.
// ---------------------------------------------------------------------------

export function esc(s: string): string {
    return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Clean role model in the core -> CSS class our bubble styles key off.
// (assistant=inbound/left, user=outbound/right, system/centered note.)
export function roleClass(role: Role): 'inbound' | 'outbound' | 'system' {
    if (role === 'assistant') return 'inbound';
    if (role === 'user') return 'outbound';
    return 'system';

}

// Assistant replies -> sanitized Markdown HTML. User/system -> escaped plain text
// esc() stays the only path for untrusted user input; bot HTML is DOMPurify-sanitized Markdown
//
// Emoji: literal characters (🎉) survive markdown + sanitize untouched. Shortcodes
// (`:tada:`) are expanded AFTER sanitizing, on the resulting DOM's text nodes only —
// so the expansion can never inject markup, and code/pre keep their literal text.
function renderText(role: Role, content: string): string {
    if (role !== 'assistant') return esc(content);
    const html = marked.parse(content, { async: false }) as string;
    const frag = DOMPurify.sanitize(html, { RETURN_DOM_FRAGMENT: true });
    emojifyNode(frag);
    const holder = document.createElement('div');
    holder.appendChild(frag);
    return holder.innerHTML;
}

function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateSep(ts: number): string {
    return new Date(ts).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
}

export interface RenderOptions {
    // Optional sender label shown above assistant bubbles (the bot's name)
    assistantLabel?: string;
    // Host delegate for rich content (plots, future types). Receive an empty
    // container already in the DOM + the message. If absent, the renderer falls back to a thumbnail/link
    // Must be idempotent - it runs on every re-render
    renderContent?: (container: HTMLElement, message: ChatMessage) => void;
    // Where a plot's own page lives, for the link fallback. Defaukt: /plots/:id
    plotHref?: (plot: PlotRef) => string;
}


// ---------------------------------------------------------------------------
// renderMessages — full list rebuild via map+innerHTML, with the brief's exact
// auto-scroll rule, then hydrate any rich-content placeholders.
// ---------------------------------------------------------------------------
export function renderMessages(
    listEl: HTMLElement,
    messages: ChatMessage[],
    opts: RenderOptions = {},
): void {
    // BEFORE render: remember where we were. If near the bottom we follow the
    // new content; otherwise we must RESTORE the exact scrollTop afterwards —
    // `innerHTML = html` resets scrollTop to 0, which would yank a reader who
    // scrolled up straight to the top on every re-render (e.g. each stream chunk).
    const prevScrollTop = listEl.scrollTop;
    const wasNearBottom =  listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 150;

    let html = '';
    let lastDateKey = '';
    for (const m of messages) {
        const dateKey = new Date(m.timestamp).toDateString();
        if (dateKey !== lastDateKey) {
            html += `<div class="msg-date-sep"><span>${esc(formatDateSep(m.timestamp))}</span></div>`;
            lastDateKey = dateKey;
        }
        html += renderBubble(m, opts);
    }
    listEl.innerHTML = html;

    // AFTER innerHTML: fill plot placeholders via the host delegate (or fallback)
    hydrateRichContent(listEl, messages, opts);

    // AFTER render: follow to the bottom if we were near it, otherwise restore
    // the previous position so the innerHTML rebuild doesn't jump the user around.
    listEl.scrollTop = wasNearBottom ? listEl.scrollHeight : prevScrollTop;
}


function renderBubble(m: ChatMessage, opts: RenderOptions): string {
    const rc = roleClass(m.role);
    const label =
        m.role === 'assistant' && opts.assistantLabel
        ? `<div class="msg-sender">${esc(opts.assistantLabel)}</div>`
        : '';

    const statusCls = 
        m.status === 'failed' ? ' failed' : m.status === 'sending' ? ' sending' : '';


    // content blocks (text first, then any deliverables)
    let body = `<div class="msg-content">${renderText(m.role, m.content)}</div>`;

    // user's attachment (image/PDF they sent) -> a small chip
    if (m.attachment) {
        const isImg = m.attachment.mimeType.startsWith('image/');
        body += `<div class="msg-attachment"><span class="msg-attach-ic">${isImg ? '🖼' : '📄'}</span>` +
                `<span class="msg-attach-name">${esc(m.attachment.name)}</span></div>`;
    }

    // pdf/png/md -> native download link (no JS needed to download)
    const art = m.metadata?.artifact;
    if (art) {
        // art.source is model/backend output — only link it if it's a real http(s) URL.
        const safeSrc = safeHttpUrl(art.source);
        body += safeSrc
            ? `<a class="msg-artifact" href="${esc(safeSrc)}" download="${esc(art.filename)}" ` +
              `data-artifact-id="${esc(m.id)}">⬇ ${esc(art.filename)}</a>`
            : `<span class="msg-artifact">⬇ ${esc(art.filename)}</span>`;
    }

    // plot -> empty container, hydrated after innerHTML by the delegate seam
    if (m.metadata?.plot) {
        body += `<div class="msg-plot" data-plot-container data-msg-id="${esc(m.id)}"></div>`;
    }

    // failed messages get a retry affordance (event-delegated, see below)
    const retry =
        m.status === 'failed'
        ? `<button type="button" class="msg-retry" data-retry-id="${esc(m.id)}">Retry</button>`
        : '';

    return (
        `<div class="msg-wrapper ${rc}">` +
        label +
        `<div class="msg-bubble ${rc}${statusCls}" data-msg-id="${esc(m.id)}">` +
        body +
        `<div class="msg-meta"><span class="msg-time-inner">${esc(formatTime(m.timestamp))}</span>${retry}</div>` +
        `</div></div>`
  );
}

function hydrateRichContent(
    listEl: HTMLElement,
    messages: ChatMessage[],
    opts: RenderOptions,
): void{
    const byId = new Map(messages.map((m) => [m.id, m] as const));
    listEl.querySelectorAll<HTMLElement>('[data-plot-container]').forEach((el) => {
        const m = byId.get(el.dataset.msgId ?? '');
        const plot = m?.metadata?.plot;
        if (!m || !plot) return;

        // Host owns rich rendering (live recharts) - keep the core React-free
        if (opts.renderContent) {
            opts.renderContent(el, m);
            return;
        }

        // link-first fallback: thumbnail (if any) or a text link to the plot page
        const href = opts.plotHref ? opts.plotHref(plot) : `/plots/${plot.id}`;
        el.innerHTML = plot.thumbnailUrl
            ? `<a class="msg-plot-link" href="${esc(href)}"><img src="${esc(plot.thumbnailUrl)}" alt="${esc(plot.title ?? 'Plot')}" /></a>`
            : `<a class="msg-plot-link" href="${esc(href)}">${esc(plot.title ?? 'Open plot')} →</a>`;
    });
}

// ---------------------------------------------------------------------------
// Event delegation — attach ONCE to the list container; survives innerHTML
// rebuilds because the listener is on the (stable) container, not the bubbles.
// Returns a disposer. Downloads use native <a download>, so only retry here.
// ---------------------------------------------------------------------------

export interface ListHandlers {
    onRetry?: (messageId: string) => void;
}

export function attachListDelegation(
    listEl: HTMLElement,
    handlers: ListHandlers,
): () => void {
    const onClick = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        const retry = target.closest<HTMLElement>('[data-retry-id]');
        if (retry) handlers.onRetry?.(retry.dataset.retryId!);
    };
    listEl.addEventListener('click', onClick);
    return () => listEl.removeEventListener('click', onClick);
}

// ---------------------------------------------------------------------------
// Input mechanics — auto-grow the textarea up to a max height. Enter/Shift+
// Enter wiring happens in the shell (Step 4), where the textarea is created.
// ---------------------------------------------------------------------------
export function autoGrowTextarea(ta: HTMLTextAreaElement, maxPx = 120): void {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, maxPx) + 'px';
}