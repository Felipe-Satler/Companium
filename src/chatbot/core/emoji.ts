// ---------------------------------------------------------------------------
// emoji — bot replies may carry emoji either as literal characters (🎉, which
// need nothing but a font that can paint them) or as GitHub/Slack-style
// shortcodes (`:tada:`), which most LLM/bot backends emit unchanged. This
// module turns the latter into the former.
//
// Applied on the SANITIZED DOM (see render.ts), never on the raw string, so:
//   - code spans / fenced blocks keep their literal `:text:` (a bot explaining
//     `:hover` or a Python dict must not sprout an emoji);
//   - the replacement can never introduce markup — we only touch text nodes.
// ---------------------------------------------------------------------------

// Values carry U+FE0F (variation selector-16) where the base codepoint would
// otherwise fall back to a monochrome text glyph (⚠ vs ⚠️).
export const EMOJI_SHORTCODES: Record<string, string> = {
  // faces / people
  smile: '😄', smiley: '😃', grin: '😁', grinning: '😀', laughing: '😆', satisfied: '😆',
  sweat_smile: '😅', joy: '😂', rofl: '🤣', slightly_smiling_face: '🙂', wink: '😉',
  blush: '😊', innocent: '😇', heart_eyes: '😍', kissing_heart: '😘', yum: '😋',
  sunglasses: '😎', nerd_face: '🤓', thinking: '🤔', thinking_face: '🤔',
  neutral_face: '😐', expressionless: '😑', no_mouth: '😶', smirk: '😏',
  unamused: '😒', disappointed: '😞', pensive: '😔', confused: '😕', worried: '😟',
  cry: '😢', sob: '😭', weary: '😩', tired_face: '😫', fearful: '😨',
  cold_sweat: '😰', scream: '😱', flushed: '😳', dizzy_face: '😵',
  rage: '😡', angry: '😠', triumph: '😤', sleeping: '😴', mask: '😷',
  face_with_monocle: '🧐', partying_face: '🥳', star_struck: '🤩', exploding_head: '🤯',
  wave: '👋', raised_hands: '🙌', clap: '👏', pray: '🙏', muscle: '💪',
  point_right: '👉', point_left: '👈', point_up: '☝️', point_down: '👇',
  thumbsup: '👍', '+1': '👍', thumbsdown: '👎', '-1': '👎', ok_hand: '👌',
  handshake: '🤝', writing_hand: '✍️', eyes: '👀', brain: '🧠',
  person_shrugging: '🤷', shrug: '🤷', facepalm: '🤦',

  // hearts / symbols
  heart: '❤️', orange_heart: '🧡', yellow_heart: '💛', green_heart: '💚',
  blue_heart: '💙', purple_heart: '💜', black_heart: '🖤', white_heart: '🤍',
  broken_heart: '💔', sparkling_heart: '💖', heavy_check_mark: '✔️',
  white_check_mark: '✅', ballot_box_with_check: '☑️', heavy_multiplication_x: '✖️',
  x: '❌', negative_squared_cross_mark: '❎', warning: '⚠️', bangbang: '‼️',
  question: '❓', grey_question: '❔', exclamation: '❗', information_source: 'ℹ️',
  heavy_plus_sign: '➕', heavy_minus_sign: '➖', heavy_dollar_sign: '💲',
  recycle: '♻️', infinity: '♾️', 100: '💯', arrow_right: '➡️', arrow_left: '⬅️',
  arrow_up: '⬆️', arrow_down: '⬇️', arrow_up_small: '🔼', arrow_down_small: '🔽',
  small_red_triangle: '🔺', small_red_triangle_down: '🔻',

  // status / work
  rocket: '🚀', fire: '🔥', tada: '🎉', confetti_ball: '🎊', sparkles: '✨',
  star: '⭐', star2: '🌟', boom: '💥', zap: '⚡', dizzy: '💫', bulb: '💡',
  bell: '🔔', no_bell: '🔕', mag: '🔍', mag_right: '🔎', key: '🔑', lock: '🔒',
  unlock: '🔓', gear: '⚙️', wrench: '🔧', hammer: '🔨', hammer_and_wrench: '🛠️',
  package: '📦', link: '🔗', pushpin: '📌', round_pushpin: '📍', paperclip: '📎',
  memo: '📝', pencil: '📝', page_facing_up: '📄', clipboard: '📋', bookmark: '🔖',
  books: '📚', book: '📖', newspaper: '📰', calendar: '📅', date: '📅',
  alarm_clock: '⏰', hourglass: '⌛', hourglass_flowing_sand: '⏳',
  stopwatch: '⏱️', clock: '🕐', watch: '⌚', bug: '🐛', beetle: '🪲',
  construction: '🚧', traffic_light: '🚦', stop_sign: '🛑', checkered_flag: '🏁',
  trophy: '🏆', medal: '🏅', dart: '🎯', crystal_ball: '🔮', robot: '🤖',
  ghost: '👻', alien: '👽', skull: '💀', wastebasket: '🗑️', broom: '🧹',

  // data / money / charts
  chart_with_upwards_trend: '📈', chart_with_downwards_trend: '📉', bar_chart: '📊',
  chart: '💹', moneybag: '💰', money_with_wings: '💸', dollar: '💵',
  credit_card: '💳', receipt: '🧾', abacus: '🧮', balance_scale: '⚖️',
  briefcase: '💼', file_folder: '📁', open_file_folder: '📂', card_index_dividers: '🗂️',
  bank: '🏦', office: '🏢', shopping_cart: '🛒', label: '🏷️',

  // tech
  computer: '💻', desktop_computer: '🖥️', keyboard: '⌨️', iphone: '📱',
  floppy_disk: '💾', cd: '💿', printer: '🖨️', satellite: '🛰️', battery: '🔋',
  electric_plug: '🔌', telephone: '☎️', telephone_receiver: '📞', email: '📧',
  envelope: '✉️', inbox_tray: '📥', outbox_tray: '📤', mailbox: '📫',
  speech_balloon: '💬', thought_balloon: '💭', loudspeaker: '📢', mega: '📣',
  camera: '📷', video_camera: '📹', movie_camera: '🎥', headphones: '🎧',
  microphone: '🎤', musical_note: '🎵', tv: '📺', radio: '📻', globe: '🌐',
  earth_americas: '🌎', world_map: '🗺️', compass: '🧭',

  // nature / misc
  sun: '☀️', sunny: '☀️', cloud: '☁️', rain_cloud: '🌧️', snowflake: '❄️',
  umbrella: '☂️', rainbow: '🌈', ocean: '🌊', droplet: '💧', seedling: '🌱',
  herb: '🌿', four_leaf_clover: '🍀', deciduous_tree: '🌳', cactus: '🌵',
  rose: '🌹', tulip: '🌷', sunflower: '🌻', maple_leaf: '🍁',
  coffee: '☕', tea: '🍵', beer: '🍺', clinking_glasses: '🥂', pizza: '🍕',
  hamburger: '🍔', cake: '🍰', birthday: '🎂', apple: '🍎', avocado: '🥑',
  gift: '🎁', balloon: '🎈', crown: '👑', gem: '💎', dice: '🎲',
  video_game: '🎮', art: '🎨', clapper: '🎬', circus_tent: '🎪',
  airplane: '✈️', car: '🚗', bike: '🚲', train: '🚆', ship: '🚢', anchor: '⚓',
  house: '🏠', hospital: '🏥', school: '🏫', factory: '🏭',
  dog: '🐶', cat: '🐱', mouse: '🐭', bear: '🐻', panda_face: '🐼', fox_face: '🦊',
  unicorn: '🦄', penguin: '🐧', bird: '🐦', whale: '🐳', dolphin: '🐬',
  butterfly: '🦋', bee: '🐝', snail: '🐌', turtle: '🐢', snake: '🐍',
};

// `:name:` where name is the usual shortcode alphabet. The leading (?<![\w:])
// / trailing (?![\w:]) guards keep `a:b:c`, `::before` and `10:30:00` intact.
const SHORTCODE_RE = /(?<![\w:]):([a-z0-9_+-]{1,40}):(?![\w:])/gi;

// Replace known shortcodes in a plain string. Unknown ones are left verbatim —
// a bot writing "ratio :cost:" should not lose its text to a failed lookup.
export function emojify(text: string): string {
  if (!text.includes(':')) return text; // cheap bail-out, the common case
  return text.replace(SHORTCODE_RE, (whole, name: string) =>
    EMOJI_SHORTCODES[name.toLowerCase()] ?? whole,
  );
}

// Tags whose text is meant to be read literally — never emojify inside them.
const SKIP_TAGS = new Set(['CODE', 'PRE', 'KBD', 'SAMP', 'SCRIPT', 'STYLE']);

// Walk a sanitized fragment/element and emojify its text nodes in place.
export function emojifyNode(root: Node): void {
  const doc = root.ownerDocument ?? document;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      for (let p = node.parentElement; p; p = p.parentElement) {
        if (SKIP_TAGS.has(p.tagName)) return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const targets: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) targets.push(n as Text);
  for (const t of targets) {
    const next = emojify(t.data);
    if (next !== t.data) t.data = next;
  }
}
