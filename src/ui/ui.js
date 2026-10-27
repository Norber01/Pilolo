// Small DOM helpers for menus, lobby, dice and HUD.
const $ = (id) => document.getElementById(id);
export { $ };

/** Only touches the DOM when the markup actually changed (room data updates ~30x/s). */
export function setHTML(id, html) {
  const el = $(id);
  if (el._html !== html) { el.innerHTML = html; el._html = html; }
}

export function show(id, on = true) { $(id).classList.toggle('hidden', !on); }
export function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

let toastTimer = 0;
export function toast(msg, ms = 2600) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.classList.add('out'), ms);
  setTimeout(() => el.remove(), ms + 500);
  void toastTimer;
}

export function banner(text) {
  const el = $('region');
  el.textContent = text;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
}

export const fmtTime = (s) => {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// ---- dice -----------------------------------------------------------------
const FACE_ROT = { 1: [0, 0], 2: [-90, 0], 3: [0, -90], 4: [0, 90], 5: [90, 0], 6: [0, 180] };
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const FACES = [['front', 1], ['top', 2], ['right', 3], ['left', 4], ['bottom', 5], ['back', 6]];

function cubeHTML() {
  return `<div class="cube">${FACES.map(([cls, v]) => `<div class="face ${cls}">${
    Array.from({ length: 9 }, (_, i) => `<span class="${PIPS[v].includes(i) ? 'pip' : ''}"></span>`).join('')
  }</div>`).join('')}</div>`;
}

export class DiceView {
  constructor() {
    this.row = $('dice-row');
    this.cards = new Map();
  }

  reset() { this.row.innerHTML = ''; this.cards.clear(); }

  /** players: [{id,name,color}], rolls: {id: value|null}, contenders: Set */
  render(players, rolls, contenders) {
    for (const p of players) {
      let c = this.cards.get(p.id);
      if (!c) {
        const el = document.createElement('div');
        el.className = 'die-card';
        el.innerHTML = `<div class="scene">${cubeHTML()}</div><div class="die-name"></div>`;
        this.row.appendChild(el);
        c = { el, cube: el.querySelector('.cube'), shown: null, spins: 0 };
        this.cards.set(p.id, c);
      }
      c.el.querySelector('.die-name').innerHTML = `<b style="color:${esc(p.color)}">${esc(p.name)}</b>`;
      c.el.classList.toggle('out', !contenders.has(p.id));
      const v = rolls[p.id];
      if (v && c.shown !== v) {
        c.spins += 2;
        const [rx, ry] = FACE_ROT[v];
        c.cube.style.transform = `rotateX(${rx + 360 * c.spins}deg) rotateY(${ry + 360 * c.spins}deg)`;
        c.shown = v;
      } else if (!v && c.shown) {
        c.shown = null;
      }
      c.el.classList.toggle('waiting', !v && contenders.has(p.id));
    }
    for (const [id, c] of this.cards) if (!players.find((p) => p.id === id)) { c.el.remove(); this.cards.delete(id); }
  }
}
