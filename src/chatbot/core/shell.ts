import { ChatState, ChatEvent, initialState, reducer } from './state';
import { ChatMessage, BotReply, Role, ConversationItem, InputAttachment } from './types';
import { Transport, SendRequest } from './transport';
import { ChatStorage, LocalStorageChatStorage } from './storage';
import { ChatAuditEvent, ChatAuditEventType } from './audit';
import {
  RenderOptions,
  renderMessages,
  attachListDelegation,
  autoGrowTextarea,
} from './render';

// Optional lifecycle hooks. The core fires them; the host decides what to do
// (logging, analytics). Fleshed out with structured payloads in Step 6.
export interface ChatHooks {
  onOpen?: () => void;
  onClose?: () => void;
  onMessageSend?: (message: ChatMessage) => void;
  onReply?: (reply: BotReply, message: ChatMessage) => void;
  onError?: (error: Error, context: { phase: string }) => void;
  onReset?: () => void;
  // structured logging hook: one typed audit record per interaction (no text)
  onEvent?: (event: ChatAuditEvent) => void;
}

// One entry in the header settins menu. Built-in actions (new conversation, report BUG)
// are exposed via the api so host-defined items can reuse them
// app-specific items like "Report a bug" are supplied by the host
export interface ChatMenuApi {
  reset(): void; // start a new conversation
  close(): void; // close the panel
  closeMenu(): void; // close the menu
}
export interface ChatMenuItem {
  label: string;
  onSelect: (api: ChatMenuApi) => void;
}

export interface ChatTitleOption { id: string; label: string; }
export interface ChatTitleMenu {
  label: string;  // current bot name shown in the header
  options: ChatTitleOption[]; // bots to choose from
  currentId?: string; // active option (marked)
  enabled: boolean; // false -> grayed (non-interactive)
  onSelect: (id: string) => void;
}


// Everything the host supplies at mount time. Extends RenderOptions so the
// renderer config (assistantLabel, renderContent, plotHref) threads through.
export interface ChatConfig extends RenderOptions {
  transport: Transport;
  storage?: ChatStorage;   // default: LocalStorageChatStorage
  title?: string;          // panel header text (often the bot's name)
  hooks?: ChatHooks;
  menuItems?: ChatMenuItem[]; // optional host-defined menu items
  titleMenu?: ChatTitleMenu; // optional bot-switcher menu in the header
  inline?: boolean; // true -> embed in page (no launcher, no resize, no menu)
  composerSlot?: HTMLElement; // host element placed in the footer, left of Send
  onItems?: (items: ConversationItem[]) => void; // plots/documents in the conversation
}

// Monotonic id helper. Date.now alone can collide within a ms; the counter guarantees uniqueness.
let idCounter = 0;
function makeId(prefix: string): string {
  idCounter++;
  return `${prefix}-${Date.now()}-${idCounter}`;
}

// Lê um File como base64 sem o prefixo data: (o que o bridge espera). O core não sabe nada de File/Blob, só do base64 puro.
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'));
    reader.onload = () => {
      const s  = String(reader.result);
      const comma = s.indexOf(',');
      resolve(comma >= 0 ? s.slice(comma + 1) : s); // strip data: prefix if present
    };
    reader.readAsDataURL(file);
  })
}

// Translate a transport BotReply into an assistant ChatMessage for the model.
// streamed reply finalize the SAME message it grew as a placeholder.
function messageFromReply(reply: BotReply, id: string = makeId('bot')): ChatMessage {
  const base = {
    id,
    role: 'assistant' as Role,
    timestamp: Date.now(),
    status: 'sent' as const,
  };
  if (reply.type === 'message') {
    return { ...base, content: reply.content };
  }
  return {
    ...base,
    content: reply.content,
    metadata: {
      intentType: 'service_request',
      service: reply.service,
      artifact: reply.artifact,
      plot: reply.plot,
      actionResults: reply.actionResults,
    },
  };
}

export class ChatbotShell {
  private state: ChatState = initialState;
  private config: ChatConfig;
  private storage: ChatStorage;
  private inline = false;

  // DOM refs
  private target: HTMLElement | null = null;
  private root: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;
  private typingEl: HTMLElement | null = null;
  private textarea: HTMLTextAreaElement | null = null;
  private sendBtn: HTMLButtonElement | null = null;
  private launcher: HTMLButtonElement | null = null;
  private panel: HTMLElement | null = null;
  private announcer: HTMLElement | null = null;
  private menuWrap: HTMLElement | null = null;
  private menu: HTMLElement | null = null;
  private optionsBtn: HTMLButtonElement | null = null;
  private titleEl: HTMLElement | null = null;

  // title (bot switcher) menu
  private titleWrap: HTMLElement | null = null;
  private titleBtn: HTMLButtonElement | null = null;
  private titleMenuEl: HTMLElement | null = null;
  private titleMenuOpen: boolean = false;

  // closes the title dropdown when a click lands outside it
  private onTitleOutsideClick = (e: MouseEvent) => {
    if (this.titleWrap && !this.titleWrap.contains(e.target as Node)) this.closeTitleMenu();
  }

  // bookkeeping
  private disposers: Array<() => void> = [];
  private inFlight: AbortController | null = null;
  // Externally-driven composer lock: the host sets this true while a reply is
  // still being generated in the background (came back to a running turn), so a
  // new send can't preempt it on the gateway.
  private inputBlocked = false;
  private rafId: number | null = null; // pending coalesced stream render
  private lastMessages: ChatMessage[] | null = null;

  private pendingAttachment: InputAttachment | null = null; // the user attached a file, waiting to send
  private fileInput: HTMLInputElement | null = null; // hidden file input for the attachment button
  private attachPreview: HTMLElement | null = null; // shows the name of the attached file, if any
  // Mid-stream "still working" dots: brought back when the reply pauses (a tool
  // call / data fetch) so a long, gappy answer never looks halted.
  private typingIdle = false;
  private writingTimer: ReturnType<typeof setTimeout> | null = null;

  // a11y bookkeeping
  private previouslyFocused: HTMLElement | null = null;
  private domId = makeId('ghbot'); // unique base for ARIA id wiring
  private sessionId: string; // set per mount; correlates all events in one session

  private menuOpen = false; // is the settings menu open?

  // closes the settings menu when a click lands outside it
  private onOutsideClick = (e: MouseEvent) => {
    if(this.menuWrap && !this.menuWrap.contains(e.target as Node)) {
      this.closeMenu(false);
    }
  }

  constructor(config: ChatConfig) {
    this.config = config;
    this.storage = config.storage ?? new LocalStorageChatStorage();
    this.inline = !!config.inline;
  }

  // --- lifecycle ------------------------------------------------

  mount(target: HTMLElement): void {
    if (this.root) return; // already mounted
    this.target = target;
    this.sessionId = makeId('sess'); // one session per mount

    // Seed from storage (survives reloads, TTL-capped). Panel starts closed.
    const saved = this.storage.load();
    this.state = { ...initialState, messages: saved ?? [] };

    this.buildDom();
    target.appendChild(this.root!);
    this.render();
    this.emitItems(); // seed the host's side panel from the loaded transcript
    if (this.inline) this.open(); // panel visible, status 'open', fires onOpen/audit
  }

  unmount(): void {
    this.inFlight?.abort();
    this.inFlight = null;
    this.disposers.forEach((dispose) => dispose());
    this.disposers = [];
    this.root?.remove();
    this.root = null;
    this.listEl = null;
    this.typingEl = null;
    this.textarea = null;
    this.sendBtn = null;
    this.fileInput = null;
    this.attachPreview = null;
    this.pendingAttachment = null;
    this.typingIdle = false;
    if (this.writingTimer) { clearTimeout(this.writingTimer); this.writingTimer = null; }
    this.menuWrap = null;
    this.menu = null;
    this.optionsBtn = null;
    this.menuOpen = false;
    document.removeEventListener('mousedown', this.onOutsideClick);
    this.launcher = null;
    this.panel = null;
    this.announcer = null;
    this.previouslyFocused = null;
    this.lastMessages = null;
    this.titleWrap = null;
    this.titleBtn = null;
    this.titleMenuEl = null;
    this.titleMenuOpen = false;
    this.titleEl = null;
    document.removeEventListener('mousedown', this.onTitleOutsideClick);
    if (this.rafId != null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
  }

  destroy(): void {
    this.unmount();
    this.target = null;
  }

  // --- public actions ------------------------------------------

  open(): void {
    if (this.state.status !== 'closed') return;
    this.previouslyFocused = document.activeElement as HTMLElement | null;
    this.dispatch({ type: 'open' });        // adds .is-open -> panel visible
    this.config.hooks?.onOpen?.();
    this.emit({ type: 'open' });                 // structured audit log
    this.textarea?.focus();                 // move focus into the dialog
    // Jump to the latest message once layout has settled. The conditional
    // near-bottom auto-scroll in renderMessages can't fire before the panel has
    // a resolved height (inline page mount) or when opening with a tall history
    // (scrollTop 0 reads as "not near bottom"), so force it on the next frame.
    requestAnimationFrame(() => {
      if (this.listEl) this.listEl.scrollTop = this.listEl.scrollHeight;
    });
  }


  close(): void {
    if (this.inline) return;
    if (this.state.status === 'closed') return;
    this.closeMenu(false); // close menu first, if open
    this.closeTitleMenu();
    this.dispatch({ type: 'close' });
    this.config.hooks?.onClose?.();
    this.emit({ type: 'close' });                 // structured audit log
    // Return focus to whatever opened the panel (usually the launcher).
    (this.previouslyFocused ?? this.launcher)?.focus();
    this.previouslyFocused = null;
  }

  reset(): void {
    this.dispatch({ type: 'reset' });
    this.storage.clear();
    this.emit({ type: 'reset' });                 // structured audit log
    this.config.hooks?.onReset?.();
    this.emitItems();
  }

  setTitle(title: string): void {
    this.config.title = title;
    if (this.titleEl) this.titleEl.textContent = title;

  }

  // Derive the conversation's deliverables (plots + documents) from message
  // metadata and hand them to the host (side panel). Fired on mount, on each
  // finalized reply, and on reset — not per streaming frame.
  private deriveItems(): ConversationItem[] {
    const items: ConversationItem[] = [];
    for (const m of this.state.messages) {
      const plot = m.metadata?.plot;
      if (plot) {
        items.push({ kind: 'plot', key: `plot:${plot.id}`, msgId: m.id, id: plot.id,
          title: plot.title, spec: plot.spec, thumbnailUrl: plot.thumbnailUrl });
      }
      const art = m.metadata?.artifact;
      if (art) {
        items.push({ kind: 'artifact', key: `artifact:${m.id}:${art.filename}`, msgId: m.id,
          filename: art.filename, mimeType: art.mimeType, source: art.source, artifactKind: art.kind });
      }
    }
    return items;
  }
  private emitItems(): void { this.config.onItems?.(this.deriveItems()); }

  // Replace the transcript from the host (e.g. a background reply that landed
  // while the user was away). No-op while a local turn is in flight so it can't
  // clobber a streaming/loading reply.
  hydrate(messages: ChatMessage[]): void {
    if (this.state.status === 'loading' || this.state.status === 'streaming') return;
    this.dispatch({ type: 'hydrate', messages });
    this.emitItems();
  }

  // Lock/unlock the composer from the host (e.g. while a background reply is
  // still generating). Blocks submit() and disables the textarea + send button.
  setInputBlocked(blocked: boolean): void {
    if (this.inputBlocked === blocked) return;
    this.inputBlocked = blocked;
    this.render();
  }

  // --- internals -----------------------------------------------

  private dispatch(event: ChatEvent): void {
    this.state = reducer(this.state, event);
    // tokens arrive faster than the screen repaints - coalesce streamChunk
    // renders to one per frame. Every other event renders syncrhonously so the
    // UI stays instant.
    if (event.type === 'streamChunk'){
      if (this.rafId === null){
        this.rafId = requestAnimationFrame(() => {this.rafId = null; this.render(); })
      }
    } else {
      if (this.rafId != null) { cancelAnimationFrame(this.rafId); this.rafId = null;}
      this.render();
    }
  }

  // fill in the constant fields and forward to the host's logging hook
  private emit(e: Partial<ChatAuditEvent> & {type: ChatAuditEventType}): void {
    const hook = this.config.hooks?.onEvent;
    if (!hook) return;
    hook({ botSessionId: this.sessionId, timestamp: Date.now(), ...e });
  }

  // Visible, focusable elements inside the panel — used by the focus trap.
  private getFocusable(): HTMLElement[] {
    if (!this.panel) return [];
    const selector =
      'a[href], button:not([disabled]), textarea:not([disabled]), ' +
      'input:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.from(this.panel.querySelectorAll<HTMLElement>(selector)).filter(
      (el) => el.offsetParent !== null, // visible elements only
    );
  }

  // Settings menu (header dropwdown) --------------------------------
  private getMenuItems(): ChatMenuItem[] {
    return (
      this.config.menuItems ?? [
        {label: "Start new conversation", onSelect: (api) => api.reset()},
      ]
    );
  }

  private menuItemsEls(): HTMLElement[] {
    if (!this.menu) return [];
    return Array.from(this.menu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  }

  private toggleMenu(): void {
    if (this.menuOpen) this.closeMenu(true);
    else this.openMenu();
  }

  private openMenu(): void {
    if (this.menuOpen || !this.menu || !this.optionsBtn) return;
    this.menuOpen = true;
    this.menu.classList.add('is-open');
    this.optionsBtn.setAttribute('aria-expanded', 'true');
    this.menuItemsEls()[0]?.focus(); // move focus into the menu
    document.addEventListener('mousedown', this.onOutsideClick);
  }

  private closeMenu(returnFocus = true): void {
    if (!this.menuOpen) return;
    this.menuOpen = false;
    this.menu?.classList.remove('is-open');
    this.optionsBtn?.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', this.onOutsideClick);
    if (returnFocus) this.optionsBtn?.focus(); // back to the gear
  }

  private toggleTitleMenu(): void {
    if (this.titleMenuOpen) this.closeTitleMenu();
    else this.openTitleMenu();
  }

  private openTitleMenu(): void {
    if (this.titleMenuOpen || !this.titleMenuEl || !this.titleBtn) return;
    this.titleMenuOpen = true;
    this.titleMenuEl.classList.add('is-open');
    this.titleBtn.setAttribute('aria-expanded', 'true');
    document.addEventListener('mousedown', this.onTitleOutsideClick);
  }

  private closeTitleMenu(): void {
    if (!this.titleMenuOpen) return;
    this.titleMenuOpen = false;
    this.titleMenuEl?.classList.remove('is-open');
    this.titleBtn?.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', this.onTitleOutsideClick);
  }

  // arrow-key navigation inside the menu ( the deferred option-list ally)
  private onMenuKeydown(e: KeyboardEvent): void {
    const items = this.menuItemsEls();
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); items[(i + 1) % items.length].focus(); break;
      case 'ArrowUp': e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); break;
      case 'Escape': e.preventDefault(); e.stopPropagation(); this.closeMenu(true); break;
      case 'Tab': e.preventDefault(); this.closeMenu(true); break; // close + focus back to gear
    }
  }

  private buildDom(): void {
    const root = document.createElement('div');
    // inline -> full-page ChatPage variant; floating -> the "modern" popup that
    // borrows the same look (bubble-less assistant, pill composer) at popup size.
    root.className = 'gh-chatbot' + (this.inline ? ' gh-chatbot--inline' : ' gh-chatbot--modern');

    const titleId = `${this.domId}-title`;

    // Launcher button (visible when chat closed; CSS hides it when .is-open).
    const launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.className = 'gh-chatbot-launcher';
    // Ícone de robô (lucide "bot") — mesmo do botão GrooChat na sidebar.
    launcher.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>';
    launcher.setAttribute('aria-label', 'Open chat');
    launcher.setAttribute('aria-haspopup', 'dialog');
    launcher.setAttribute('aria-expanded', 'false');
    const onLauncher = () => this.open();
    launcher.addEventListener('click', onLauncher);
    this.disposers.push(() => launcher.removeEventListener('click', onLauncher));

    // Panel — a dialog labelled by its title, focus-trapped while open.
    const panel = document.createElement('div');
    panel.className = 'gh-chatbot-panel';
    panel.setAttribute('role', this.inline ? 'region' : 'dialog');
    if (!this.inline) panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', titleId);


    // Header: title + options + close. -----------------------------------------
    const header = document.createElement('div');
    header.className = 'gh-chatbot-header';
    // Title: plain label OR a host-provided dropdown to switch bots
    // grayed + non-interactive if titleMenu.enabled=false
    let titleNode: HTMLElement;
    const tm = this.config.titleMenu;
    if (tm) {
      const wrap = document.createElement('div');
      wrap.className = 'gh-chatbot-title-wrap';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = titleId;
      btn.className = 'gh-chatbot-title-btn' + (tm.enabled ? '' : ' is-disabled');
      btn.innerHTML =
        '<span class="gh-chatbot-title-label"></span>' +
        '<span class="gh-chatbot-title-caret" aria-hidden="true">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>' +
        '</span>';
      const labelEl = btn.querySelector('.gh-chatbot-title-label') as HTMLElement;
      labelEl.textContent = tm.label;
      // Keep the button width constant across bot switches: reserve space for the
      // longest option name (approx. via `ch`). CSS caps + ellipsis prevent overflow.
      const longest = Math.max(
        tm.label.length,
        ...tm.options.map((o) => o.label.length),
      );
      labelEl.style.minWidth = `${longest}ch`;
      btn.setAttribute('aria-haspopup', 'menu');
      btn.setAttribute('aria-expanded', 'false');
      if (!tm.enabled) btn.setAttribute('aria-disabled', 'true');

      const titleMenuEl = document.createElement('div');
      titleMenuEl.className = 'gh-chatbot-menu gh-chatbot-title-menu';
      titleMenuEl.setAttribute('role', 'menu');
      for (const opt of tm.options) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'gh-chatbot-menu-item';
        item.setAttribute('role', 'menuitem');
        item.tabIndex = -1;
        item.textContent = `${opt.id === tm.currentId ? '● ' : '○ '}${opt.label}`;
        const onItem = () => { this.closeTitleMenu(); tm.onSelect(opt.id); };
        item.addEventListener('click', onItem);
        this.disposers.push(() => item.removeEventListener('click', onItem));
        titleMenuEl.appendChild(item);
      }

      if (tm.enabled) {
        const onTitleClick = () => this.toggleTitleMenu();
        btn.addEventListener('click', onTitleClick);
        this.disposers.push(() => btn.removeEventListener('click', onTitleClick));
        const onTKey = (e: KeyboardEvent) => {
          if (e.key === 'Escape') { e.stopPropagation(); this.closeTitleMenu(); }
        };
        titleMenuEl.addEventListener('keydown', onTKey);
        this.disposers.push(() => titleMenuEl.removeEventListener('keydown', onTKey));
      }

      wrap.append(btn, titleMenuEl);
      titleNode = wrap;
      this.titleWrap = wrap;
      this.titleBtn = btn;
      this.titleMenuEl = titleMenuEl;
    } else {
      const span = document.createElement('span');
      span.className = 'gh-chatbot-title';
      span.id = titleId;
      span.textContent = this.config.title ?? 'Chat';
      this.titleEl = span;
      titleNode = span;
    }
    
    // Settings menu (dropdown) ------------------------------------------------
    const menuWrap = document.createElement('div');
    menuWrap.className = 'gh-chatbot-menu-wrap';

    const optionsBtn = document.createElement('button');
    optionsBtn.type = 'button';
    optionsBtn.className = 'gh-chatbot-options';
    // Inline SVG (fill=currentColor) so the gear follows the header text color
    // — an emoji ⚙️ would render gray regardless of CSS.
    optionsBtn.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
      '<path d="M19.14 12.94a7.97 7.97 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.58.24-1.13.55-1.62.94l-2.39-.96a.5.5 0 0 0-.6.22L2.18 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.97 7.97 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.31.6.22l2.39-.96c.49.39 1.04.7 1.62.94l.36 2.54c.04.24.25.42.5.42h3.84c.25 0 .46-.18.5-.42l.36-2.54c.58-.24 1.13-.55 1.62-.94l2.39.96c.22.09.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"/>' +
      '</svg>';
    optionsBtn.setAttribute('aria-label', 'Settings');
    optionsBtn.setAttribute('aria-haspopup', 'menu');
    optionsBtn.setAttribute('aria-expanded', 'false');
    const menuId = `${this.domId}-menu`;
    optionsBtn.setAttribute('aria-controls', menuId);
    const onOptions = () => this.toggleMenu();
    optionsBtn.addEventListener('click', onOptions);
    this.disposers.push(() => optionsBtn.removeEventListener('click', onOptions));

    const menu = document.createElement('div');
    menu.className = 'gh-chatbot-menu';
    menu.id = menuId;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Settings');

    const menuApi: ChatMenuApi = {
      reset: () => this.reset(),
      close: () => this.close(),
      closeMenu: () => this.closeMenu(),
    };
    for (const item of this.getMenuItems()) {
      const itemEl = document.createElement('button');
      itemEl.type = 'button';
      itemEl.className = 'gh-chatbot-menu-item';
      itemEl.setAttribute('role', 'menuitem');
      itemEl.tabIndex = -1;                         // roving focus; not a Tab stop
      itemEl.textContent = item.label;
      const onItem = () => {
        this.closeMenu();
        item.onSelect(menuApi);
      };
      itemEl.addEventListener('click', onItem);
      this.disposers.push(() => itemEl.removeEventListener('click', onItem));
      menu.appendChild(itemEl);
    }

    const onMenuKey = (e: KeyboardEvent) => this.onMenuKeydown(e);
    menu.addEventListener('keydown', onMenuKey);
    this.disposers.push(() => menu.removeEventListener('keydown', onMenuKey));

    menuWrap.append(optionsBtn, menu);
    // -------------------------------------------------------------------------

    // Close
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'gh-chatbot-close';
    // Inline SVG (like the gear) so it aligns pixel-for-pixel and never clips at
    // fractional display scaling — a text '×' glyph carries font metrics that
    // misalign against the SVG gear.
    closeBtn.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    closeBtn.setAttribute('aria-label', 'Close chat');
    const onClose = () => this.close();
    closeBtn.addEventListener('click', onClose);
    this.disposers.push(() => closeBtn.removeEventListener('click', onClose));
    header.append(titleNode, menuWrap, closeBtn);


    // Resize handle
    const BASE_W = 360, BASE_H = 520; // default panel size (CSS sets min/max)
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'gh-chatbot-resize';
    resizeHandle.setAttribute('aria-hidden', 'true'); // decorative only

    let resizing = false, startX = 0, startY = 0, startW = 0, startH = 0;
    const onResizeDown = (e: PointerEvent) => {
      resizing = true;
      startX = e.clientX; startY = e.clientY;
      const r = panel.getBoundingClientRect();
      startW = r.width; startH = r.height;
      resizeHandle.setPointerCapture(e.pointerId); // keep receiving move/up outside the grip
      e.preventDefault();
    };
    const onResizeMove = (e: PointerEvent) => {
      if (!resizing) return;
      // anchored bottom-right: moving up/left (negative delta) should GROW it
      const w = Math.min(BASE_W * 1.5, Math.max(BASE_W, startW - (e.clientX - startX)));
      const h = Math.min(BASE_H * 1.5, Math.max(BASE_H, startH - (e.clientY - startY)));
      panel.style.width = `${w}px`;
      panel.style.height = `${h}px`;
    };
    const onResizeUp = (e: PointerEvent) => {
      resizing = false;
      try { resizeHandle.releasePointerCapture(e.pointerId); } catch {/* ignore */}
    };
    resizeHandle.addEventListener('pointerdown', onResizeDown);
    resizeHandle.addEventListener('pointermove', onResizeMove);
    resizeHandle.addEventListener('pointerup', onResizeUp);
    this.disposers.push(() => {
      resizeHandle.removeEventListener('pointerdown', onResizeDown);
      resizeHandle.removeEventListener('pointermove', onResizeMove);
      resizeHandle.removeEventListener('pointerup', onResizeUp);
    });

    // Header -------------------------------------------------------------------

    // Message list — role=log for structure. aria-live is OFF here because we
    // rebuild via innerHTML; announcements go through the dedicated announcer.
    const listEl = document.createElement('div');
    listEl.className = 'gh-chatbot-list';
    listEl.setAttribute('role', 'log');
    listEl.setAttribute('aria-label', 'Conversation');
    listEl.setAttribute('aria-live', 'off');
    this.disposers.push(
      attachListDelegation(listEl, { onRetry: (id) => this.retry(id) }),
    );

    // Typing indicator ("bot is writing" cue). A SIBLING of the list — not inside
    // it — so renderMessages' innerHTML rebuild never wipes it. Shown/hidden purely
    // via the root's .is-loading class (see chatbot.css). No JS ref needed.
    const typingEl = document.createElement('div');
    typingEl.className = 'gh-chatbot-typing';
    typingEl.setAttribute('aria-hidden', 'true'); // decorative; aria-busy conveys state
    typingEl.innerHTML =
      '<span class="gh-typing-dot"></span>' +
      '<span class="gh-typing-dot"></span>' +
      '<span class="gh-typing-dot"></span>';


    // Footer: textarea + send button.
    const footer = document.createElement('div');
    footer.className = 'gh-chatbot-footer';
    const textarea = document.createElement('textarea');
    textarea.className = 'gh-chatbot-input';
    textarea.rows = 1;
    textarea.placeholder = 'Escreva sua mensagem…';
    textarea.setAttribute('aria-label', 'Message');
    const sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.className = 'gh-chatbot-send';
    sendBtn.textContent = 'Send';
    sendBtn.setAttribute('aria-label', 'Send message');
    // Attachment: a paperclip button + a hidden file input (image/PDF).
    const attachBtn = document.createElement('button');
    attachBtn.type = 'button';
    attachBtn.className = 'gh-chatbot-attach';
    attachBtn.setAttribute('aria-label', 'Anexar arquivo');
    attachBtn.title = 'Anexar imagem ou PDF';

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/png,image/jpeg,application/pdf';
    fileInput.className = 'gh-chatbot-file-input';
    fileInput.hidden = true;
    this.fileInput = fileInput;

    // Composer pill, two rows: the textarea on top and a controls row below with
    // [attach, optional host slot (bot picker), Send].
    const composer = document.createElement('div');
    composer.className = 'gh-chatbot-composer';
    const composerRow = document.createElement('div');
    composerRow.className = 'gh-chatbot-composer-row';
    if (this.config.composerSlot) composerRow.append(attachBtn, this.config.composerSlot, sendBtn);
    else composerRow.append(attachBtn, sendBtn);
    composer.append(textarea, composerRow);

    // Preview chip for the pending attachment, shown above the composer pill.
    const attachPreview = document.createElement('div');
    attachPreview.className = 'gh-chatbot-attach-preview';
    attachPreview.hidden = true;
    this.attachPreview = attachPreview;

    footer.append(attachPreview, composer, fileInput);

    // Off-screen polite live region: announces the newest incoming message.
    const announcer = document.createElement('div');
    announcer.className = 'gh-sr-only';
    announcer.setAttribute('role', 'status');
    announcer.setAttribute('aria-live', 'polite');

    // Input wiring: auto-grow + keep state.input in sync.
    const onInput = () => {
      autoGrowTextarea(textarea);
      this.dispatch({ type: 'setInput', value: textarea.value });
    };
    textarea.addEventListener('input', onInput);
    this.disposers.push(() => textarea.removeEventListener('input', onInput));

    // Enter sends, Shift+Enter inserts newline.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.submit();
      }
    };
    textarea.addEventListener('keydown', onKey);
    this.disposers.push(() => textarea.removeEventListener('keydown', onKey));

    // Attachment wiring: clip opens the file dialog; a pick loads + validates it.
    const onAttachClick = () => this.fileInput?.click();
    attachBtn.addEventListener('click', onAttachClick);
    this.disposers.push(() => attachBtn.removeEventListener('click', onAttachClick));
    const onFile = () => {
      const file = fileInput.files?.[0];
      fileInput.value = ''; // allow re-selecting the same file
      if (file) void this.setAttachment(file);
    };
    fileInput.addEventListener('change', onFile);
    this.disposers.push(() => fileInput.removeEventListener('change', onFile));

    const onSend = () => this.submit();
    sendBtn.addEventListener('click', onSend);
    this.disposers.push(() => sendBtn.removeEventListener('click', onSend));

    // Keyboard handling for the open dialog. Attached to DOCUMENT (not the
    // panel) so ESC + the focus trap work even when focus sits on a
    // non-focusable area — e.g. the user clicked the message list, dropping
    // focus to <body>, which is outside the panel. Guarded so it's a no-op
    // while closed.
    const onDocKey = (e: KeyboardEvent) => {
      if (this.inline) return; // inline panels don't trap focus or close on ESC
      if (this.state.status === 'closed') return;

      if (e.key === 'Escape') {
        if (this.titleMenuOpen) { this.closeTitleMenu(); return; } // title menu first
        e.stopPropagation(); // don't bubble to app-level ESC handlers
        if (this.menuOpen) { this.closeMenu(); return; } // menu first, then panel
        this.close();
        return;
      }
      if (e.key !== 'Tab') return;

      const focusable = this.getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      // Focus escaped the panel (e.g. clicked empty space) -> pull it back in.
      if (!this.panel?.contains(active)) {
        e.preventDefault();
        first.focus();
        return;
      }
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onDocKey);
    this.disposers.push(() => document.removeEventListener('keydown', onDocKey));

    panel.append(header, listEl, footer, announcer, resizeHandle);
    root.append(launcher, panel);

    this.root = root;
    this.launcher = launcher;
    this.panel = panel;
    this.listEl = listEl;
    this.typingEl = typingEl;
    this.textarea = textarea;
    this.sendBtn = sendBtn;
    this.announcer = announcer;
    this.menuWrap = menuWrap;
    this.menu = menu;
    this.optionsBtn = optionsBtn;
  }

  // Read + validate a picked file into the pending attachment (client-side
  // mirror of the bridge's caps), then show the preview chip.
  private async setAttachment(file: File): Promise<void> {
    const isPdf = file.type === 'application/pdf';
    const ALLOWED = ['image/png', 'image/jpeg', 'application/pdf'];
    const cap = isPdf ? 10 * 1024 * 1024 : 6 * 1024 * 1024;
    if (!ALLOWED.includes(file.type)) return this.renderAttachPreview('Use PNG, JPEG ou PDF.');
    if (file.size > cap) return this.renderAttachPreview(`Arquivo muito grande (máx ${isPdf ? 10 : 6}MB).`);
    try {
      const dataBase64 = await fileToBase64(file);
      this.pendingAttachment = { name: file.name, mimeType: file.type, dataBase64 };
      this.renderAttachPreview();
    } catch {
      this.renderAttachPreview('Não foi possível ler o arquivo.');
    }
  }

  // Render the pending-attachment chip (or a transient error). Uses textContent
  // for the filename so it can't inject markup.
  private renderAttachPreview(error?: string): void {
    const el = this.attachPreview;
    if (!el) return;
    if (error) {
      el.hidden = false;
      el.innerHTML = '<span class="gh-attach-error"></span>';
      el.querySelector('.gh-attach-error')!.textContent = error;
      window.setTimeout(() => { if (!this.pendingAttachment) { el.hidden = true; el.innerHTML = ''; } }, 3000);
      return;
    }
    if (!this.pendingAttachment) { el.hidden = true; el.innerHTML = ''; this.render(); return; }
    const { name, mimeType } = this.pendingAttachment;
    const isImg = mimeType.startsWith('image/');
    el.hidden = false;
    el.innerHTML =
      '<span class="gh-attach-chip">' +
        `<span class="gh-attach-ic">${isImg ? '🖼' : '📄'}</span>` +
        '<span class="gh-attach-name"></span>' +
        '<button type="button" class="gh-attach-remove" aria-label="Remover anexo">×</button>' +
      '</span>';
    el.querySelector('.gh-attach-name')!.textContent = name;
    el.querySelector('.gh-attach-remove')!.addEventListener('click', () => {
      this.pendingAttachment = null;
      this.renderAttachPreview();
    });
    this.render(); // refresh the send button's disabled state
  }

  private submit(): void {
    const text = this.state.input.trim();
    const att = this.pendingAttachment;
    if ((!text && !att) || this.inputBlocked || this.state.status === 'loading' || this.state.status === 'streaming') return;

    // Optimistic user message: push + render immediately, then call transport.
    const userMsg: ChatMessage = {
      id: makeId('temp'),
      role: 'user',
      content: text,
      timestamp: Date.now(),
      status: 'sending',
      ...(att ? { attachment: { name: att.name, mimeType: att.mimeType } } : {}),
    };
    this.dispatch({ type: 'send', message: userMsg }); // appends, clears input, loading
    this.storage.save(this.state.messages); // persist the user msg NOW (survives leaving mid-turn)
    this.config.hooks?.onMessageSend?.(userMsg);
    this.pendingAttachment = null;       // consumed by this turn
    this.renderAttachPreview();          // clear the chip
    this.callTransport(userMsg, 'free_text', att);
  }

  private retry(id: string): void {
    const msg = this.state.messages.find((m) => m.id === id);
    if (!msg || msg.role !== 'user' || this.state.status === 'loading' || this.state.status === 'streaming') return;
    this.dispatch({ type: 'retry', messageId: id });
    this.callTransport(msg);
  }

  private callTransport(userMsg: ChatMessage, inputKind: 'free_text' | 'option' = 'free_text', attachment?: InputAttachment | null): void {
    const history = this.state.messages.filter((m) => m.id !== userMsg.id);
    const controller = new AbortController();
    this.inFlight = controller;

    const traceId = makeId('trace');
    const startedAt = Date.now();
    this.emit({
      type: 'message_send',
      traceId,
      inputKind,
      textLength: userMsg.content.length, 
    });

    const req: SendRequest = {
      message: userMsg,
      history,
      signal: controller.signal,
      ...(attachment ? { attachment } : {}),
    };

    // Assistant id is fixed now so the placeholder (streamStart) and the
    // finalized message (streamEnd) are the same list entry
    const assistantId = makeId('bot');
    let streamStarted = false;

    const onChunk = (chunk: string) => {
      if (controller.signal.aborted || !chunk) return;
      if (!streamStarted) {
        streamStarted = true;
        this.dispatch({
          type: 'streamStart',
          message: {
            id: assistantId, role: 'assistant', content: '',
            timestamp: Date.now(), status: 'sent'
          },
        });
      }
      this.dispatch({ type: 'streamChunk', messageId: assistantId, chunk });
      this.onWriting(); // actively writing -> hide idle dots, arm the pause timer
    };

    this.config.transport
      .send(req, { onChunk })
      .then((reply) => {
        if (controller.signal.aborted) return;
        // reuse the placeholder id when we streamed; otherwise append fresh,
        const botMsg = messageFromReply(reply, streamStarted ? assistantId : undefined);
        this.dispatch(streamStarted ? { type: 'streamEnd', message: botMsg } : { type: 'receive', message: botMsg });
        this.storage.save(this.state.messages);
        this.emitItems(); // a plot/artifact may have just been produced
        this.config.hooks?.onReply?.(reply, botMsg);
        this.emit({
          type: 'reply',
          traceId,
          status: 'ok',
          durationMs: Date.now() - startedAt,
          intentType: botMsg.metadata?.intentType,
          service: botMsg.metadata?.service,
          hasArtifact: !!botMsg.metadata?.artifact,
          hasPlot: !!botMsg.metadata?.plot,
        })
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const error = err instanceof Error ? err : new Error(String(err));
        this.dispatch({ type: 'fail', messageId: userMsg.id, reason: error.message });
        this.config.hooks?.onError?.(error, { phase: 'transport' });
        this.emit({
          type: 'error',
          traceId,
          status: 'error',
          durationMs: Date.now() - startedAt,
          errorMessage: error.message,
        })
      })
      .finally(() => {
        if (this.inFlight === controller) this.inFlight = null;
        this.endTyping(); // turn over -> stop the dots for good
      });
  }

  // A chunk arrived: we're actively writing, so hide the idle dots and, if the
  // reply then goes quiet for a beat while the turn is still open, bring them back.
  private onWriting(): void {
    this.typingIdle = false;
    if (this.writingTimer) clearTimeout(this.writingTimer);
    this.writingTimer = setTimeout(() => {
      this.writingTimer = null;
      if (this.inFlight) { this.typingIdle = true; this.syncTyping(); }
    }, 1000);
    this.syncTyping();
  }

  private endTyping(): void {
    this.typingIdle = false;
    if (this.writingTimer) { clearTimeout(this.writingTimer); this.writingTimer = null; }
    this.syncTyping();
  }

  // Show the typing dots as the LAST list item when we're waiting for the first
  // token (status 'loading') OR the reply paused mid-stream (typingIdle).
  private syncTyping(): void {
    if (!this.listEl || !this.typingEl) return;
    const show = this.state.status === 'loading' || this.typingIdle;
    const present = this.listEl.contains(this.typingEl);
    if (!show) {
      if (present) this.listEl.removeChild(this.typingEl);
      return;
    }
    // Keep it last (renderMessages wipes the list; a new message may land after it).
    const nearBottom = this.listEl.scrollHeight - this.listEl.scrollTop - this.listEl.clientHeight < 150;
    if (this.listEl.lastElementChild !== this.typingEl) this.listEl.appendChild(this.typingEl);
    if (nearBottom) this.listEl.scrollTop = this.listEl.scrollHeight;
  }

  private render(): void {
    if (!this.root) return;

    // Panel open/loading -> root classes; CSS drives the actual show/hide.
    this.root.classList.toggle('is-open', this.state.status !== 'closed');
    this.root.classList.toggle('is-loading', this.state.status === 'loading');
    this.root.classList.toggle('is-streaming', this.state.status === 'streaming');

    // Reflect open/busy state to assistive tech.
    this.launcher?.setAttribute(
      'aria-expanded',
      this.state.status !== 'closed' ? 'true' : 'false',
    );
    this.listEl?.setAttribute(
      'aria-busy',
      this.state.status === 'loading' ? 'true' : 'false',
    );

    // Rebuild the list ONLY when the messages array identity changed. setInput/
    // open/close keep the same array reference (reducer spreads but reuses it),
    // so typing doesn't trigger a full list rebuild.
    if (this.listEl && this.state.messages !== this.lastMessages) {
      renderMessages(this.listEl, this.state.messages, this.renderOpts());
      this.lastMessages = this.state.messages;

      // Announce the newest incoming (non-user) message to screen readers.
      const last = this.state.messages[this.state.messages.length - 1];
      if (this.announcer && last && last.role !== 'user' && this.state.status !== 'streaming') {
        this.announcer.textContent = last.content;
      }
    }

    // Typing dots: while loading (pre-first-token) or when the reply paused
    // mid-stream. Re-added after each renderMessages (which wipes the list).
    this.syncTyping();

    // Sync textarea to state.input. In the common case (user just typed) the
    // values already match, so no reset and no cursor jump; after send/reset
    // state.input is '' and this clears the box.
    if (this.textarea && this.textarea.value !== this.state.input) {
      this.textarea.value = this.state.input;
      autoGrowTextarea(this.textarea);
    }

    if (this.sendBtn) {
      this.sendBtn.disabled = this.inputBlocked || this.state.status === 'loading' || this.state.status === 'streaming' || (!this.state.input.trim() && !this.pendingAttachment);
    }
    if (this.textarea) {
      this.textarea.disabled = this.inputBlocked;
      this.textarea.placeholder = this.inputBlocked
        ? 'Gerando resposta… aguarde para enviar'
        : 'Escreva sua mensagem…';
    }
  }

  private renderOpts(): RenderOptions {
    return {
      assistantLabel: this.config.assistantLabel,
      renderContent: this.config.renderContent,
      plotHref: this.config.plotHref,
    };
  }
}
