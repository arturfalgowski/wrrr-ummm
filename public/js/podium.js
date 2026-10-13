// Podium na mecie: trzy stopnie z kierowcami, fajerwerki i konfetti na kanwie 2D.
const MEDAL = ['#ffd24a', '#cfd6e2', '#d98b52'];
const fmtT = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`; };

// ---------- fajerwerki i konfetti ----------
let raf = 0, fw = null;
export function stopFireworks() { cancelAnimationFrame(raf); raf = 0; fw = null; }
export function startFireworks(canvas, base = '#ffd24a', onBurst = null) {
  stopFireworks();
  const ctx = canvas.getContext('2d'); let W = 0, H = 0;
  const resize = () => { const r = devicePixelRatio || 1; W = canvas.width = innerWidth * r; H = canvas.height = innerHeight * r; ctx.setTransform(r, 0, 0, r, 0, 0); W = innerWidth; H = innerHeight; };
  resize();
  const PAL = [base, '#ff4f8b', '#ffd24a', '#5be3a1', '#6fb5ff', '#ffffff', '#ff8a3d'];
  const parts = [], conf = [], rockets = []; let t = 0, nextRocket = 0.2, nextConf = 0;
  fw = { alive: true };
  const burst = (x, y, col) => {
    const n = 70 + (Math.random() * 40 | 0), sp = 90 + Math.random() * 150;
    for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, v = sp * (0.35 + Math.random() * 0.65); parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1 + Math.random() * 0.8, age: 0, col: Math.random() < 0.25 ? '#fff' : col }); }
    onBurst?.();
  };
  let last = performance.now();
  const loop = (now) => {
    if (!fw) return;
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    if (!canvas.offsetParent && canvas.getClientRects().length === 0) return;
    ctx.clearRect(0, 0, W, H);
    if (t > nextRocket) { rockets.push({ x: W * (0.12 + Math.random() * 0.76), y: H, vy: -(H * (0.9 + Math.random() * 0.35)), ty: H * (0.15 + Math.random() * 0.3), col: PAL[Math.random() * PAL.length | 0] }); nextRocket = t + 0.35 + Math.random() * 0.7; }
    if (t > nextConf) { for (let i = 0; i < 6; i++) conf.push({ x: Math.random() * W, y: -10, vx: (Math.random() - 0.5) * 60, vy: 60 + Math.random() * 90, w: 6 + Math.random() * 7, h: 3 + Math.random() * 4, r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 9, col: PAL[Math.random() * PAL.length | 0], ph: Math.random() * 6.28 }); nextConf = t + 0.03; }
    for (let i = rockets.length - 1; i >= 0; i--) { const r = rockets[i]; r.y += r.vy * dt; ctx.fillStyle = '#fff'; ctx.fillRect(r.x - 1, r.y, 2, 10); if (r.y <= r.ty) { burst(r.x, r.y, r.col); rockets.splice(i, 1); } }
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.age += dt; if (p.age >= p.life) { parts.splice(i, 1); continue; }
      p.vy += 120 * dt; p.vx *= 1 - 0.8 * dt; p.vy *= 1 - 0.8 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      ctx.globalAlpha = 1 - p.age / p.life; ctx.fillStyle = p.col; ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;
    for (let i = conf.length - 1; i >= 0; i--) {
      const c = conf[i]; c.y += c.vy * dt; c.x += (c.vx + Math.sin(t * 3 + c.ph) * 40) * dt; c.r += c.vr * dt;
      if (c.y > H + 20) { conf.splice(i, 1); continue; }
      ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.r); ctx.scale(1, Math.cos(t * 6 + c.ph)); ctx.fillStyle = c.col; ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h); ctx.restore();
    }
  };
  raf = requestAnimationFrame(loop);
  addEventListener('resize', resize);
}
