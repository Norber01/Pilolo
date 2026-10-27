// Map in the corner (press M / tap it to enlarge). Seekers get shrinking "hint" circles here.
import { REGIONS } from '../world/regions.js';
import { WORLD } from '../config.js';

export class Minimap {
  constructor(canvas, terrain) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.terrain = terrain;
    this.big = false;
    this.base = this.renderBase(256);
    canvas.addEventListener('click', () => this.toggle());
    addEventListener('keydown', (e) => { if (e.code === 'KeyM' && e.target.tagName !== 'INPUT') this.toggle(); });
  }

  toggle() {
    this.big = !this.big;
    this.canvas.classList.toggle('big', this.big);
  }

  renderBase(size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    const t = this.terrain;
    const cols = REGIONS.map((r) => {
      const n = parseInt(r.map.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    });
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const wx = (x / size - 0.5) * t.size, wz = (y / size - 0.5) * t.size;
        const h = t.getHeight(wx, wz);
        const hx = t.getHeight(wx + 6, wz);
        const shade = Math.max(0.55, Math.min(1.3, 1 + (h - hx) * 0.06));
        let [r, g, b] = cols[t.regionAt(wx, wz)];
        if (h < WORLD.waterLevel) { r = 52; g = 84; b = 92; }
        else if (h > 85) { r = g = b = 230; }
        const i = (y * size + x) * 4;
        img.data[i] = r * shade; img.data[i + 1] = g * shade; img.data[i + 2] = b * shade; img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  /** marks: [{x,z,color,self?,heading?}], hint: {x,z,r} | null */
  draw(marks, hint) {
    const cv = this.canvas, ctx = this.ctx;
    const S = cv.width;
    const t = this.terrain;
    const toPx = (v) => (v / t.size + 0.5) * S;
    ctx.clearRect(0, 0, S, S);
    ctx.drawImage(this.base, 0, 0, S, S);
    // Camp
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.round(S / 22)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.fillText('⛺', toPx(0), toPx(0) + 4);
    if (hint) {
      ctx.strokeStyle = 'rgba(255,230,80,0.95)';
      ctx.fillStyle = 'rgba(255,230,80,0.18)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(toPx(hint.x), toPx(hint.z), (hint.r / t.size) * S, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    for (const m of marks) {
      const x = toPx(m.x), y = toPx(m.z);
      ctx.fillStyle = m.color;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;
      if (m.self) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(-m.heading + Math.PI);
        ctx.beginPath();
        ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      }
    }
  }
}
