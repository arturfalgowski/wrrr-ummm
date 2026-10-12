// Muzyka w tle: losowy utwór z public/music na starcie menu i każdego poziomu; domyślnie 30% głośności.
const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* brak storage */ } },
};

export class Music {
  constructor() {
    this.el = new Audio(); this.el.preload = 'none';
    this.tracks = []; this.last = -1; this.pending = false;
    this.enabled = store.get('tc_music', '1') !== '0';
    const v = parseFloat(store.get('tc_music_vol', '0.3'));
    this.vol = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.3;
    this.el.volume = this.vol;
    this.el.addEventListener('ended', () => this.playRandom());
    this.el.addEventListener('error', () => { this.pending = false; });
    const unlock = () => { if (this.pending) this._play(); };
    window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock);
  }

  async load() {
    try { this.tracks = await (await fetch('api/music')).json(); } catch { this.tracks = []; }
  }

  _play() {
    if (!this.enabled || !this.el.src) return;
    this.el.play().then(() => { this.pending = false; }).catch(() => { this.pending = true; });
  }

  /** losuje utwór (inny niż poprzedni) i odtwarza */
  playRandom() {
    if (!this.tracks.length) return;
    let i = Math.floor(Math.random() * this.tracks.length);
    if (this.tracks.length > 1 && i === this.last) i = (i + 1 + Math.floor(Math.random() * (this.tracks.length - 1))) % this.tracks.length;
    this.last = i;
    this.el.src = `music/${encodeURIComponent(this.tracks[i])}`;
    this.el.volume = this.vol;
    this._play();
  }

  setEnabled(on) {
    this.enabled = on; store.set('tc_music', on ? '1' : '0');
    if (!on) { this.el.pause(); this.pending = false; }
    else if (this.el.src) this._play(); else this.playRandom();
  }
  toggle() { this.setEnabled(!this.enabled); return this.enabled; }

  setVolume(v) { this.vol = Math.min(1, Math.max(0, v)); this.el.volume = this.vol; store.set('tc_music_vol', String(this.vol)); }
  setMuted(m) { this.el.muted = m; }
}
