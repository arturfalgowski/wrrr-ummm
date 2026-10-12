// Minimapa w HUD: zarys toru (biała linia), pozycje graczy, paczki i duch.
import { ITEM_TYPES } from './items.js';

export class Minimap {
  constructor(canvas) {
    this.c = canvas; this.ctx = canvas.getContext('2d');
    this.pts = null;
  }

  setArena(R, obstacles) {
    this.arena = { R, obstacles }; this.track = null; this.soccer = null;
    this.b = { minX: -R, maxX: R, minZ: -R, maxZ: R }; this.pts = [[0, 0]];
  }

  setSoccer(hx, hz, gw, gd) {
    this.soccer = { hx, hz, gw, gd }; this.arena = null; this.track = null;
    this.b = { minX: -hx - gd, maxX: hx + gd, minZ: -hz, maxZ: hz }; this.pts = [[0, 0]];
  }

  setTrack(track) {
    this.arena = null; this.soccer = null;
    this.track = track;
    const b = track.bounds;
    this.b = b;
    this.pts = [];
    for (let i = 0; i < track.N; i += 5) this.pts.push([track.x[i], track.z[i]]);
  }

  _fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.c.clientWidth, h = this.c.clientHeight;
    if (this.c.width !== Math.round(w * dpr) || this.c.height !== Math.round(h * dpr)) { this.c.width = Math.round(w * dpr); this.c.height = Math.round(h * dpr); }
    this.dpr = dpr; this.w = w; this.h = h;
    const pad = 14, b = this.b;
    this.s = Math.min((w - 2 * pad) / (b.maxX - b.minX), (h - 2 * pad) / (b.maxZ - b.minZ));
    this.ox = (w - (b.maxX - b.minX) * this.s) / 2 - b.minX * this.s;
    this.oz = (h - (b.maxZ - b.minZ) * this.s) / 2 - b.minZ * this.s;
  }
  _p(x, z) { return [this.ox + x * this.s, this.oz + z * this.s]; }

  /** dots: [{x,z,color,label,me,ghost}], crates: [{x,z,type}] */
  draw(dots, crates) {
    if (!this.pts) return;
    this._fit();
    const g = this.ctx;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    g.lineJoin = 'round'; g.lineCap = 'round';
    if (this.soccer) {
      const { hx, hz, gw, gd } = this.soccer, [x0, y0] = this._p(-hx, -hz), [x1, y1] = this._p(hx, hz);
      g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0); g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 5.5; g.stroke(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke();
      const [mx, my] = this._p(0, 0), [, ty] = this._p(0, -hz), [, by] = this._p(0, hz);
      g.beginPath(); g.moveTo(mx, ty); g.lineTo(mx, by); g.moveTo(mx + 9 * this.s, my); g.arc(mx, my, 9 * this.s, 0, Math.PI * 2); g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,.55)'; g.stroke();
      for (const s of [-1, 1]) { const [gx0, gy0] = this._p(s * hx, -gw), [gx1, gy1] = this._p(s * (hx + gd), gw); g.beginPath(); g.rect(Math.min(gx0, gx1), gy0, Math.abs(gx1 - gx0), gy1 - gy0); g.strokeStyle = s > 0 ? '#2f6bff' : '#e53935'; g.lineWidth = 2; g.stroke(); }
    } else if (this.arena) {
      const [cx, cy] = this._p(0, 0), R = this.arena.R * this.s;
      g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 5.5; g.stroke(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke();
      g.beginPath(); g.arc(cx, cy, 12 * this.s, 0, Math.PI * 2); g.setLineDash([3, 3]); g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1; g.stroke(); g.setLineDash([]);
      g.fillStyle = 'rgba(255,255,255,.45)';
      for (const [ox, oz] of this.arena.obstacles) { const [px, py] = this._p(ox, oz); g.beginPath(); g.arc(px, py, 2, 0, Math.PI * 2); g.fill(); }
    } else {
    g.beginPath();
    this.pts.forEach(([x, z], i) => { const [px, py] = this._p(x, z); i ? g.lineTo(px, py) : g.moveTo(px, py); });
    g.closePath();
    g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 5.5; g.stroke();
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke();
    // linia startu
    const t = this.track, [sx, sy] = this._p(t.x[0], t.z[0]), nx = -t.tz[0], nz = t.tx[0];
    g.beginPath(); g.moveTo(sx - nx * 5, sy - nz * 5); g.lineTo(sx + nx * 5, sy + nz * 5); g.strokeStyle = '#ff4f8b'; g.lineWidth = 2; g.stroke();
    }
    for (const c of crates) {
      const [px, py] = this._p(c.x, c.z);
      g.save(); g.translate(px, py); g.rotate(Math.PI / 4);
      g.fillStyle = ITEM_TYPES[c.type].color; g.fillRect(-3, -3, 6, 6);
      g.strokeStyle = '#fff'; g.lineWidth = 1; g.strokeRect(-3, -3, 6, 6); g.restore();
    }
    // duchy pod spodem, potem rywale, na końcu ja
    const order = [...dots.filter((d) => d.ghost), ...dots.filter((d) => !d.ghost && !d.me), ...dots.filter((d) => d.me)];
    for (const d of order) {
      const [px, py] = this._p(d.x, d.z);
      g.beginPath(); g.arc(px, py, d.me ? 6 : 5.5, 0, Math.PI * 2);
      if (d.ghost) { g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 1.5; g.setLineDash([2, 2]); g.stroke(); g.setLineDash([]); continue; }
      g.fillStyle = d.color; g.fill();
      if (d.ball) { g.lineWidth = 2; g.strokeStyle = '#111'; g.stroke(); continue; }
      g.lineWidth = d.me ? 2.5 : 1.5; g.strokeStyle = d.me ? '#fff' : 'rgba(0,0,0,.6)'; g.stroke();
      if (d.label) { g.fillStyle = '#fff'; g.font = '700 8px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(d.label, px, py + 0.5); }
    }
  }
}
