# The header settings menu (dropdown)

A step-by-step explanation of the gear/settings dropdown in the chatbot header —
how it's configured, built, opened/closed, keyboard-navigated, and torn down.
Lives in `shell.ts` + `chatbot.css`.

> It's a **settings menu** (app-level actions like "Start new conversation",
> "Report a bug"), NOT chat-reply options. Its open/closed state is deliberately
> kept **out** of the reducer (see step 2).

---

## 1. Config types — what the host supplies

```ts
export interface ChatMenuApi {
  reset(): void;       // start a new conversation
  close(): void;       // close the whole panel
  closeMenu(): void;   // close just the settings menu
}
export interface ChatMenuItem {
  label: string;
  onSelect: (api: ChatMenuApi) => void;
}
// ChatConfig gains:
//   menuItems?: ChatMenuItem[]
```

The host passes the **menu contents** via `config.menuItems`. Each item is a
label + an `onSelect` callback. When an item is chosen, `onSelect` receives a
`ChatMenuApi` — a small set of **built-in actions** the core exposes so items can
reuse them without the core hardcoding behavior:

- `api.reset()` → start a new conversation (clears state + storage).
- `api.close()` → close the whole panel.
- `api.closeMenu()` → close only the dropdown.

This keeps the core generic and portable: "Report a bug" is host-specific (the
core can't know what reporting means), while "Start new conversation" just calls
`api.reset()`. Example (from `dev-mount.ts`):

```ts
menuItems: [
  { label: 'Start new conversation', onSelect: (api) => api.reset() },
  { label: 'Report a bug', onSelect: () => console.log('TODO: open bug report') },
],
```

If the host supplies nothing, `getMenuItems()` returns a sensible default:

```ts
private getMenuItems(): ChatMenuItem[] {
  return this.config.menuItems ?? [
    { label: 'Start new conversation', onSelect: (api) => api.reset() },
  ];
}
```

---

## 2. State — kept OUT of the reducer

```ts
private menuOpen = false;
private menuWrap: HTMLElement | null = null;
private menu: HTMLElement | null = null;
private optionsBtn: HTMLButtonElement | null = null;

private onOutsideClick = (e: MouseEvent) => {
  if (this.menuWrap && !this.menuWrap.contains(e.target as Node)) {
    this.closeMenu(false);
  }
};
```

The menu is **transient UI chrome** (like a tooltip), not conversation state, so
its open/closed flag is a plain field — **not** part of `ChatState`. Why it
matters: the reducer's `messages` array drives the (expensive) message-list
rebuild. If `menuOpen` lived in the reducer, toggling the gear would re-run the
whole render path. As a local flag, opening/closing the menu touches only the
menu's own DOM.

`onOutsideClick` is an **arrow-function field** (not a method) on purpose: it's a
single stable function reference, so the *same* function can be added to and
removed from `document` (a method bound inline would create a new function each
time and never unregister).

---

## 3. Building the DOM (`buildDom`)

```ts
const menuWrap = document.createElement('div');
menuWrap.className = 'gh-chatbot-menu-wrap';

const optionsBtn = document.createElement('button');
optionsBtn.type = 'button';
optionsBtn.className = 'gh-chatbot-options';
optionsBtn.innerHTML = '<svg ... fill="currentColor" aria-hidden="true">…</svg>'; // gear
optionsBtn.setAttribute('aria-label', 'Settings');
optionsBtn.setAttribute('aria-haspopup', 'menu');
optionsBtn.setAttribute('aria-expanded', 'false');
const menuId = `${this.domId}-menu`;
optionsBtn.setAttribute('aria-controls', menuId);
optionsBtn.addEventListener('click', () => this.toggleMenu());

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
  itemEl.tabIndex = -1;                 // roving focus; reached via arrows, not Tab
  itemEl.textContent = item.label;
  itemEl.addEventListener('click', () => { this.closeMenu(); item.onSelect(menuApi); });
  menu.appendChild(itemEl);
}
menu.addEventListener('keydown', (e) => this.onMenuKeydown(e));

menuWrap.append(optionsBtn, menu);
```

Key points:

- **`menuWrap`** is a positioning anchor (`position: relative` in CSS) so the
  absolutely-positioned `menu` drops directly under the gear.
- **ARIA**: the gear is a menu button — `aria-haspopup="menu"`,
  `aria-expanded` (kept in sync), `aria-controls` pointing at the menu's `id`.
  The menu is `role="menu"`; each item is `role="menuitem"`.
- **`tabIndex = -1`** on items: that's the standard **menu pattern** — the gear
  is the single Tab stop; once open, you move between items with arrow keys, not
  Tab. (The browser's Tab order isn't cluttered with every item.)
- **Item click** closes the menu, then runs `item.onSelect(menuApi)`.
- Every listener is paired with a disposer (`this.disposers.push(...)`) so it's
  removed on teardown.
- The locals are stored on the instance at the end of `buildDom`:
  `this.menuWrap = menuWrap; this.menu = menu; this.optionsBtn = optionsBtn;`
  — **without this, `openMenu()` early-returns** on a null `this.menu` and the
  gear appears dead.

---

## 4. Open / close / toggle

```ts
private toggleMenu(): void {
  if (this.menuOpen) this.closeMenu();
  else this.openMenu();
}

private openMenu(): void {
  if (this.menuOpen || !this.menu || !this.optionsBtn) return;
  this.menuOpen = true;
  this.menu.classList.add('is-open');                  // CSS shows it
  this.optionsBtn.setAttribute('aria-expanded', 'true');
  this.menuItemsEls()[0]?.focus();                     // focus first item
  document.addEventListener('mousedown', this.onOutsideClick);
}

private closeMenu(returnFocus = true): void {
  if (!this.menuOpen) return;
  this.menuOpen = false;                               // <-- must flip back!
  this.menu?.classList.remove('is-open');
  this.optionsBtn?.setAttribute('aria-expanded', 'false');
  document.removeEventListener('mousedown', this.onOutsideClick);
  if (returnFocus) this.optionsBtn?.focus();           // focus back to the gear
}
```

- **Open**: flip the flag, add `.is-open` (CSS toggles `display`), update
  `aria-expanded`, move focus into the first item, and start listening for
  outside clicks.
- **Close**: the mirror. The line `this.menuOpen = false` is essential — if it's
  missing, the flag stays `true`, `toggleMenu` keeps calling `closeMenu`, and the
  menu can never reopen.
- **`returnFocus` parameter**: on keyboard close (ESC/Tab/select) we want focus
  back on the gear (`true`); on an **outside click** we don't want to yank focus
  back (`false`), since the user clicked elsewhere intentionally.

---

## 5. Keyboard navigation (`onMenuKeydown`)

```ts
private onMenuKeydown(e: KeyboardEvent): void {
  const items = this.menuItemsEls();
  if (items.length === 0) return;
  const i = items.indexOf(document.activeElement as HTMLElement);
  switch (e.key) {
    case 'ArrowDown': e.preventDefault(); items[(i + 1) % items.length].focus(); break;
    case 'ArrowUp':   e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); break;
    case 'Escape':    e.preventDefault(); e.stopPropagation(); this.closeMenu(true); break;
    case 'Tab':       e.preventDefault(); this.closeMenu(true); break;
  }
}
```

This is the ARIA menu keyboard model (and the "option-list keyboard nav" deferred
from the accessibility step):

- **ArrowDown / ArrowUp** cycle through items. The modulo math wraps around: from
  the last item ArrowDown goes to the first, and `(i - 1 + length) % length`
  wraps ArrowUp from the first to the last without going negative.
- **Escape** closes the menu and returns focus to the gear. The
  `stopPropagation()` is critical: without it the keydown bubbles to the
  document-level handler (`onDocKey`), which would then *also* close the whole
  panel — so one ESC would close both.
- **Tab** closes the menu and returns focus to the gear (predictable), rather
  than letting focus drift to a now-hidden item.
- **Enter / Space** need no case here — the items are real `<button>`s, so the
  browser fires their `click` natively.

`menuItemsEls()` is just a live query helper:

```ts
private menuItemsEls(): HTMLElement[] {
  if (!this.menu) return [];
  return Array.from(this.menu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
}
```

---

## 6. Integration with the panel's ESC / focus trap

The panel already has a **document-level** key handler (`onDocKey`) for ESC and
the focus trap. The menu plugs into it so ESC closes the right thing:

```ts
if (e.key === 'Escape') {
  e.stopPropagation();
  if (this.menuOpen) { this.closeMenu(); return; } // menu first…
  this.close();                                    // …then the panel
  return;
}
```

Two ESC paths, both correct:
- Focus **inside** the menu → `onMenuKeydown`'s Escape handles it (and
  `stopPropagation` prevents `onDocKey` from also firing).
- Focus **elsewhere** while the menu is open → `onDocKey` sees `menuOpen` and
  closes the menu instead of the panel.

So: ESC closes the menu if it's open; a second ESC closes the panel.

---

## 7. Lifecycle hygiene

```ts
// in close(): don't leave a stray dropdown open when the panel closes
this.closeMenu(false);

// in unmount(): drop refs + remove the global listener
this.menuWrap = null;
this.menu = null;
this.optionsBtn = null;
this.menuOpen = false;
document.removeEventListener('mousedown', this.onOutsideClick);
```

- `close()` closes the menu first (with `returnFocus = false`, since the panel is
  going away).
- `unmount()` nulls the refs and **removes the `mousedown` listener** from
  `document`. That listener lives on a global target, so forgetting to remove it
  would leak and could fire after teardown. (The per-element listeners are all
  handled by the `disposers` array.)

---

## 8. CSS (`chatbot.css`)

```css
/* Header: title pinned left, gear + close grouped right */
.gh-chatbot-header { display: flex; align-items: center; gap: 4px; }
.gh-chatbot-title  { font-weight: 600; margin-right: auto; }

/* Dropdown anchored under the gear */
.gh-chatbot-menu-wrap { position: relative; display: inline-flex; }
.gh-chatbot-menu {
  display: none;            /* hidden until .is-open */
  position: absolute; top: 100%; right: 0; margin-top: 4px;
  min-width: 200px; padding: 4px;
  background: var(--bot-panel); color: var(--bot-text);
  border: 1px solid var(--bot-border); border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,.18);
  z-index: 10;
}
.gh-chatbot-menu.is-open { display: block; }
.gh-chatbot-menu-item { display: block; width: 100%; text-align: left; /* … */ }
.gh-chatbot-menu-item:hover,
.gh-chatbot-menu-item:focus { background: var(--bot-bubble-bot); outline: none; }
```

- **The header fix**: `margin-right: auto` on the title eats the free space,
  pinning the title left and grouping the gear + close on the right (replacing
  the old `justify-content: space-between`, which floated the gear in the center).
- **`display: none` ↔ `.is-open { display: block }`** is what `openMenu` /
  `closeMenu` toggle via the class. Using `display:none` (not just opacity) also
  means hidden items are excluded from the panel's focus trap, because the trap
  filters on `el.offsetParent !== null` (visible only).
- All colors are **tokens** (`--bot-panel`, `--bot-text`, …) so the dropdown
  themes with the rest of the widget (light/dark).

> ⚠️ The panel has `overflow: hidden`. The menu opens *downward into the message
> list area*, which is inside the panel box, so it isn't clipped. If you ever make
> it open upward or outside the panel, `overflow: hidden` will cut it off.

---

## 9. Why the gear is an SVG, not an emoji

```ts
optionsBtn.innerHTML = '<svg ... fill="currentColor" aria-hidden="true">…</svg>';
```

`⚙️` (emoji form) is drawn by the system color-emoji font and **ignores CSS
`color`**, so it rendered gray while the `×` (plain text) was white. An inline SVG
with `fill="currentColor"` follows the button's text color, so the gear matches
the header. The SVG is `aria-hidden="true"` because the button already has
`aria-label="Settings"` — otherwise a screen reader might announce the graphic
redundantly.

---

## Summary

The settings menu is a small, self-contained, accessible dropdown: **host-defined
items** with built-in actions exposed via `ChatMenuApi`, a **local open/closed
flag** kept out of the reducer, full **ARIA menu semantics** + **arrow-key
navigation**, careful **ESC layering** with the panel, and **leak-free teardown**.
It also doubles as the first real use of the option-list keyboard navigation we
deferred during the accessibility step — the same pattern will power predefined
question flows later.
