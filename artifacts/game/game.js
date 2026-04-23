import { submitScore, getLeaderboard, isLeaderboardEnabled } from "./firebase.js";

// ============================================================
// CANVAS SETUP
// ============================================================
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const W = canvas.width;
const H = canvas.height;

// ============================================================
// ASSETS
// ============================================================
const IMG = {};
const SPRITES = {
  chog: "./assets/chog.png",
  shramp: "./assets/shramp.png",
  bob: "./assets/bob.png",
  moncock: "./assets/moncock.png",
  emonad: "./assets/emonad.png",
};

function loadImages() {
  return Promise.all(
    Object.entries(SPRITES).map(
      ([key, src]) =>
        new Promise((resolve) => {
          const img = new Image();
          img.onload = () => { IMG[key] = img; resolve(); };
          img.onerror = () => { IMG[key] = null; resolve(); };
          img.src = src;
        }),
    ),
  );
}

// ============================================================
// AUDIO (WebAudio synthesized)
// ============================================================
let audioCtx = null;
function audio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { return null; }
  }
  return audioCtx;
}
function beep({ freq = 440, dur = 0.08, type = "square", vol = 0.06, slide = 0 }) {
  const a = audio(); if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, a.currentTime);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), a.currentTime + dur);
  g.gain.setValueAtTime(vol, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  o.connect(g); g.connect(a.destination);
  o.start(); o.stop(a.currentTime + dur);
}
const SFX = {
  shoot: () => beep({ freq: 880, dur: 0.05, type: "square", vol: 0.04, slide: -400 }),
  hit:   () => beep({ freq: 220, dur: 0.06, type: "sawtooth", vol: 0.05, slide: -100 }),
  death: () => beep({ freq: 140, dur: 0.18, type: "triangle", vol: 0.08, slide: -100 }),
  boss:  () => { beep({ freq: 90, dur: 0.5, type: "sawtooth", vol: 0.1, slide: 200 });
                 setTimeout(() => beep({ freq: 60, dur: 0.4, type: "sawtooth", vol: 0.1, slide: 100 }), 200); },
  power: () => { beep({ freq: 660, dur: 0.08, type: "sine", vol: 0.06, slide: 400 });
                 setTimeout(() => beep({ freq: 990, dur: 0.08, type: "sine", vol: 0.06, slide: 400 }), 70); },
};

// ============================================================
// GAME STATE
// ============================================================
const STATE = {
  running: false,
  startedAt: 0,
  elapsed: 0,
  score: 0,
  hp: 3,
  maxHp: 3,
  player: null,
  bullets: [],
  enemies: [],
  enemyBullets: [],
  particles: [],
  powerups: [],
  shake: 0,
  lastEnemySpawn: 0,
  lastBossSpawn: -20, // first boss at 30s
  lastShot: 0,
  flashEnemies: new Map(),
  powers: { shield: 0, triple: 0, speed: 0 }, // expire timestamps (s)
  hasShield: false,
  stars: [],
};

const KEYS = { left: false, right: false, up: false, down: false, space: false };

// ============================================================
// INPUT
// ============================================================
window.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") KEYS.left = true;
  if (e.key === "ArrowRight") KEYS.right = true;
  if (e.key === "ArrowUp") KEYS.up = true;
  if (e.key === "ArrowDown") KEYS.down = true;
  if (e.code === "Space") { KEYS.space = true; e.preventDefault(); }
});
window.addEventListener("keyup", (e) => {
  if (e.key === "ArrowLeft") KEYS.left = false;
  if (e.key === "ArrowRight") KEYS.right = false;
  if (e.key === "ArrowUp") KEYS.up = false;
  if (e.key === "ArrowDown") KEYS.down = false;
  if (e.code === "Space") KEYS.space = false;
});

// ============================================================
// ENTITIES
// ============================================================
function makePlayer() {
  return { x: W / 2, y: H - 60, w: 48, h: 48, baseSpeed: 320 };
}

function spawnEnemy(type) {
  const x = 30 + Math.random() * (W - 60);
  const base = { x, y: -40, w: 28, h: 28, type, hp: 1, maxHp: 1, vx: 0, vy: 80, score: 10 };
  if (type === "shramp") { base.hp = 1; base.maxHp = 1; base.vy = 90 + Math.random() * 30; base.score = 10; base.w = 28; base.h = 28; }
  if (type === "bob") {
    base.hp = 2; base.maxHp = 2; base.vy = 80; base.score = 20;
    base.zigT = Math.random() * Math.PI * 2; base.w = 36; base.h = 36;
  }
  if (type === "moncock") {
    base.hp = 3; base.maxHp = 3; base.vy = 70; base.score = 40; base.w = 44; base.h = 44;
    base.dashCooldown = 1 + Math.random() * 1.5;
  }
  STATE.enemies.push(base);
}

function spawnBoss() {
  STATE.enemies.push({
    x: W / 2, y: -80, w: 80, h: 80, type: "emonad",
    hp: 20, maxHp: 20, vx: 0, vy: 30, score: 100,
    isBoss: true, fireCooldown: 1.5,
  });
  STATE.shake = 14;
  SFX.boss();
}

function dropPowerup(x, y, force) {
  if (!force && Math.random() > 0.15) return;
  const types = ["shield", "triple", "speed"];
  const t = types[Math.floor(Math.random() * types.length)];
  STATE.powerups.push({ x, y, w: 24, h: 24, vy: 80, type: t });
}

function explode(x, y, color) {
  for (let i = 0; i < 18; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 60 + Math.random() * 180;
    STATE.particles.push({
      x, y,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: 0.5 + Math.random() * 0.4,
      maxLife: 0.9, color,
      size: 2 + Math.random() * 3,
    });
  }
}

function shoot() {
  const p = STATE.player;
  if (STATE.powers.triple > STATE.elapsed) {
    STATE.bullets.push({ x: p.x, y: p.y - 20, vx: 0, vy: -560, w: 4, h: 12 });
    STATE.bullets.push({ x: p.x - 14, y: p.y - 16, vx: -120, vy: -540, w: 4, h: 12 });
    STATE.bullets.push({ x: p.x + 14, y: p.y - 16, vx: 120, vy: -540, w: 4, h: 12 });
  } else {
    STATE.bullets.push({ x: p.x, y: p.y - 20, vx: 0, vy: -580, w: 4, h: 12 });
  }
  SFX.shoot();
}

// ============================================================
// COLLISION
// ============================================================
function aabb(a, b) {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 &&
         Math.abs(a.y - b.y) < (a.h + b.h) / 2;
}

// ============================================================
// UPDATE
// ============================================================
function update(dt) {
  STATE.elapsed = (performance.now() - STATE.startedAt) / 1000;

  // Player movement
  const p = STATE.player;
  const speedMul = STATE.powers.speed > STATE.elapsed ? 1.5 : 1;
  if (KEYS.left)  p.x -= p.baseSpeed * speedMul * dt;
  if (KEYS.right) p.x += p.baseSpeed * speedMul * dt;
  if (KEYS.up)    p.y -= p.baseSpeed * speedMul * dt;
  if (KEYS.down)  p.y += p.baseSpeed * speedMul * dt;
  p.x = Math.max(p.w / 2, Math.min(W - p.w / 2, p.x));
  p.y = Math.max(p.h / 2, Math.min(H - p.h / 2, p.y));

  // Auto shoot — 200ms normal, 90ms while holding SPACE
  const fireInterval = KEYS.space ? 90 : 200;
  if (performance.now() - STATE.lastShot > fireInterval) {
    shoot();
    STATE.lastShot = performance.now();
  }

  // Bullets
  for (const b of STATE.bullets) { b.x += b.vx * dt; b.y += b.vy * dt; }
  STATE.bullets = STATE.bullets.filter((b) => b.y > -20 && b.x > -20 && b.x < W + 20);

  // Enemy spawn scaling
  STATE.lastEnemySpawn += dt;
  const spawnInterval = Math.max(0.35, 1.0 - STATE.elapsed * 0.012);
  if (STATE.lastEnemySpawn > spawnInterval) {
    STATE.lastEnemySpawn = 0;
    const pool = ["shramp"];
    if (STATE.elapsed >= 10) pool.push("bob");
    if (STATE.elapsed >= 20) pool.push("moncock");
    spawnEnemy(pool[Math.floor(Math.random() * pool.length)]);
  }

  // Boss every 30s
  if (STATE.elapsed - STATE.lastBossSpawn >= 30) {
    const bossAlive = STATE.enemies.some((e) => e.isBoss);
    if (!bossAlive) {
      spawnBoss();
      STATE.lastBossSpawn = STATE.elapsed;
    }
  }

  // Enemies
  for (const e of STATE.enemies) {
    if (e.type === "shramp") { e.y += e.vy * dt; }
    else if (e.type === "bob") {
      e.zigT += dt * 3;
      e.x += Math.cos(e.zigT) * 140 * dt;
      e.y += e.vy * dt;
    } else if (e.type === "moncock") {
      e.dashCooldown -= dt;
      if (e.dashCooldown <= 0) {
        const dx = p.x - e.x;
        e.vx = Math.sign(dx) * 220;
        if (e.dashCooldown < -0.4) { e.vx = 0; e.dashCooldown = 1.2 + Math.random(); }
      }
      e.x += e.vx * dt; e.y += e.vy * dt;
      e.x = Math.max(20, Math.min(W - 20, e.x));
    } else if (e.isBoss) {
      const dx = p.x - e.x;
      e.x += Math.sign(dx) * 60 * dt;
      if (e.y < 90) e.y += e.vy * dt;
      e.fireCooldown -= dt;
      if (e.fireCooldown <= 0) {
        e.fireCooldown = 1.0;
        for (let i = -1; i <= 1; i++) {
          const ang = Math.PI / 2 + i * 0.25;
          STATE.enemyBullets.push({
            x: e.x, y: e.y + 40,
            vx: Math.cos(ang) * 220, vy: Math.sin(ang) * 220,
            w: 8, h: 8,
          });
        }
      }
    }
  }
  STATE.enemies = STATE.enemies.filter((e) => e.y < H + 80 && e.hp > 0);

  // Enemy bullets
  for (const b of STATE.enemyBullets) { b.x += b.vx * dt; b.y += b.vy * dt; }
  STATE.enemyBullets = STATE.enemyBullets.filter((b) => b.y < H + 20 && b.y > -20 && b.x > -20 && b.x < W + 20);

  // Powerups
  for (const u of STATE.powerups) u.y += u.vy * dt;
  STATE.powerups = STATE.powerups.filter((u) => u.y < H + 30);

  // Particles
  for (const pt of STATE.particles) {
    pt.x += pt.vx * dt; pt.y += pt.vy * dt;
    pt.vx *= 0.96; pt.vy *= 0.96;
    pt.life -= dt;
  }
  STATE.particles = STATE.particles.filter((p) => p.life > 0);

  // Stars (parallax)
  for (const s of STATE.stars) {
    s.y += s.vy * dt;
    if (s.y > H) { s.y = -2; s.x = Math.random() * W; }
  }

  // Bullet vs Enemy
  for (const b of STATE.bullets) {
    for (const e of STATE.enemies) {
      if (aabb(b, e)) {
        e.hp -= 1;
        b.dead = true;
        STATE.flashEnemies.set(e, 0.08);
        SFX.hit();
        if (e.hp <= 0) {
          STATE.score += e.score;
          explode(e.x, e.y, e.isBoss ? "#ff5fcf" : "#f0c84a");
          dropPowerup(e.x, e.y, !!e.isBoss);
          if (e.isBoss) STATE.shake = 12;
          SFX.death();
        }
        break;
      }
    }
  }
  STATE.bullets = STATE.bullets.filter((b) => !b.dead);

  // Enemy vs Player
  for (const e of STATE.enemies) {
    if (aabb(e, p)) {
      hurtPlayer(e.isBoss ? 2 : 1);
      e.hp = 0;
      explode(e.x, e.y, "#ff3b6b");
    }
  }
  STATE.enemies = STATE.enemies.filter((e) => e.hp > 0);

  // Enemy bullets vs Player
  for (const b of STATE.enemyBullets) {
    if (aabb(b, p)) { hurtPlayer(1); b.dead = true; }
  }
  STATE.enemyBullets = STATE.enemyBullets.filter((b) => !b.dead);

  // Powerup vs Player
  for (const u of STATE.powerups) {
    if (aabb(u, p)) {
      u.dead = true;
      SFX.power();
      if (u.type === "shield") { STATE.hasShield = true; }
      if (u.type === "triple") { STATE.powers.triple = STATE.elapsed + 5; }
      if (u.type === "speed")  { STATE.powers.speed  = STATE.elapsed + 5; }
    }
  }
  STATE.powerups = STATE.powerups.filter((u) => !u.dead);

  // Flash decay
  for (const [e, t] of STATE.flashEnemies) {
    const nt = t - dt;
    if (nt <= 0) STATE.flashEnemies.delete(e); else STATE.flashEnemies.set(e, nt);
  }

  // Shake decay
  STATE.shake = Math.max(0, STATE.shake - dt * 30);

  // HUD
  syncHUD();

  if (STATE.hp <= 0) gameOver();
}

function hurtPlayer(dmg) {
  if (STATE.hasShield) {
    STATE.hasShield = false;
    STATE.shake = 6;
    SFX.hit();
    return;
  }
  STATE.hp -= dmg;
  STATE.shake = 8;
  SFX.hit();
}

// ============================================================
// RENDER
// ============================================================
function render() {
  ctx.save();
  if (STATE.shake > 0.1) {
    ctx.translate((Math.random() - 0.5) * STATE.shake, (Math.random() - 0.5) * STATE.shake);
  }

  // background
  ctx.fillStyle = "#06010f";
  ctx.fillRect(0, 0, W, H);

  // stars
  for (const s of STATE.stars) {
    ctx.fillStyle = `rgba(180,140,255,${s.a})`;
    ctx.fillRect(s.x, s.y, s.size, s.size);
  }

  // powerups
  for (const u of STATE.powerups) {
    ctx.save();
    ctx.translate(u.x, u.y);
    const colors = { shield: "#4ad0f0", triple: "#f04ad0", speed: "#d0f04a" };
    ctx.fillStyle = colors[u.type];
    ctx.shadowColor = colors[u.type];
    ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#06010f";
    ctx.font = "bold 14px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(u.type[0].toUpperCase(), 0, 1);
    ctx.restore();
  }

  // player
  const p = STATE.player;
  if (p) {
  drawSprite("chog", p.x, p.y, p.w, p.h);
  if (STATE.hasShield) {
    ctx.strokeStyle = "rgba(74,208,240,0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, 34, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = "rgba(74,208,240,0.3)";
    ctx.beginPath(); ctx.arc(p.x, p.y, 38, 0, Math.PI * 2); ctx.stroke();
  }
  }

  // bullets
  for (const b of STATE.bullets) {
    ctx.fillStyle = "#00aaff";
    ctx.shadowColor = "#00aaff"; ctx.shadowBlur = 8;
    ctx.fillRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);
    ctx.shadowBlur = 0;
  }

  // enemies
  for (const e of STATE.enemies) {
    const flash = STATE.flashEnemies.get(e);
    drawSprite(e.type, e.x, e.y, e.w, e.h, flash ? "#fff" : null);
    if (e.isBoss || e.maxHp > 1) {
      const bw = e.w; const bh = 4;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(e.x - bw / 2, e.y - e.h / 2 - 8, bw, bh);
      ctx.fillStyle = e.isBoss ? "#ff5fcf" : "#ff9b2b";
      ctx.fillRect(e.x - bw / 2, e.y - e.h / 2 - 8, bw * (e.hp / e.maxHp), bh);
    }
  }

  // enemy bullets
  for (const b of STATE.enemyBullets) {
    ctx.fillStyle = "#ff5fcf";
    ctx.shadowColor = "#ff5fcf"; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
  }

  // particles
  for (const pt of STATE.particles) {
    ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
    ctx.fillStyle = pt.color;
    ctx.fillRect(pt.x, pt.y, pt.size, pt.size);
  }
  ctx.globalAlpha = 1;

  ctx.restore();
}

function drawSprite(key, x, y, w, h, tint) {
  const img = IMG[key];
  if (img) {
    ctx.drawImage(img, x - w / 2, y - h / 2, w, h);
    if (tint) {
      ctx.globalCompositeOperation = "source-atop";
      ctx.fillStyle = tint;
      ctx.globalAlpha = 0.6;
      ctx.fillRect(x - w / 2, y - h / 2, w, h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }
  } else {
    ctx.fillStyle = "#7a4af0";
    ctx.fillRect(x - w / 2, y - h / 2, w, h);
  }
}

// ============================================================
// LOOP
// ============================================================
let lastT = 0;
function loop(t) {
  const dt = Math.min(0.05, (t - lastT) / 1000 || 0);
  lastT = t;
  if (STATE.running) update(dt);
  render();
  requestAnimationFrame(loop);
}

// ============================================================
// HUD
// ============================================================
const elScore = document.getElementById("score");
const elTime = document.getElementById("time");
const elHpFill = document.getElementById("hpfill");
const elPowers = document.getElementById("powers");

function syncHUD() {
  elScore.textContent = STATE.score;
  elTime.textContent = Math.floor(STATE.elapsed) + "s";
  elHpFill.style.width = Math.max(0, (STATE.hp / STATE.maxHp) * 100) + "%";
  const p = [];
  if (STATE.hasShield) p.push(`<span class="pwr shield">SHIELD</span>`);
  if (STATE.powers.triple > STATE.elapsed) p.push(`<span class="pwr triple">TRIPLE ${(STATE.powers.triple - STATE.elapsed).toFixed(1)}s</span>`);
  if (STATE.powers.speed > STATE.elapsed)  p.push(`<span class="pwr speed">SPEED ${(STATE.powers.speed - STATE.elapsed).toFixed(1)}s</span>`);
  elPowers.innerHTML = p.join("") || `<span style="font-size:11px;color:#5a4a8a">—</span>`;
}

// ============================================================
// GAME OVER + LEADERBOARD
// ============================================================
const overlay = document.getElementById("overlay");
const panel = document.getElementById("panel");
const startBtn = document.getElementById("startBtn");

startBtn.addEventListener("click", startGame);

function startGame() {
  STATE.running = true;
  STATE.startedAt = performance.now();
  STATE.elapsed = 0;
  STATE.score = 0;
  STATE.hp = 3; STATE.maxHp = 3;
  STATE.player = makePlayer();
  STATE.bullets = []; STATE.enemies = []; STATE.enemyBullets = [];
  STATE.particles = []; STATE.powerups = [];
  STATE.lastEnemySpawn = 0; STATE.lastBossSpawn = -20; STATE.lastShot = 0;
  STATE.flashEnemies = new Map();
  STATE.powers = { shield: 0, triple: 0, speed: 0 };
  STATE.hasShield = false;
  STATE.shake = 0;
  STATE.stars = Array.from({ length: 80 }, () => ({
    x: Math.random() * W, y: Math.random() * H,
    vy: 30 + Math.random() * 60, size: Math.random() < 0.7 ? 1 : 2,
    a: 0.3 + Math.random() * 0.6,
  }));
  audio();
  overlay.classList.remove("show");
}

function isPlausible(score, time) {
  if (time < 1) return score < 50;
  // ~150 pts/sec is generous (boss + multiple kills)
  return score <= time * 150 + 200;
}

async function gameOver() {
  STATE.running = false;
  const finalScore = STATE.score;
  const finalTime = Math.floor(STATE.elapsed);
  const valid = isPlausible(finalScore, finalTime);

  panel.innerHTML = `
    <h1>GAME OVER</h1>
    <div class="sub">YOU FELL TO THE SWARM</div>
    <div class="stats">
      <div class="stat"><div class="l">SCORE</div><div class="n">${finalScore}</div></div>
      <div class="stat"><div class="l">TIME</div><div class="n">${finalTime}s</div></div>
    </div>
    ${
      isLeaderboardEnabled() && valid
        ? `<input id="nameInput" maxlength="16" placeholder="ENTER NAME" />
           <button id="submitBtn">SUBMIT SCORE</button>`
        : isLeaderboardEnabled()
          ? `<div class="hint" style="color:#ff5fcf">Score rejected by anti-cheat.</div>`
          : `<div class="hint">Leaderboard offline. Configure firebase.js to enable.</div>`
    }
    <button id="restartBtn">PLAY AGAIN</button>
  `;
  overlay.classList.add("show");
  document.getElementById("restartBtn").addEventListener("click", startGame);

  if (isLeaderboardEnabled() && valid) {
    const submitBtn = document.getElementById("submitBtn");
    const nameInput = document.getElementById("nameInput");
    submitBtn.addEventListener("click", async () => {
      const name = (nameInput.value || "").trim().slice(0, 16);
      if (!name) return;
      submitBtn.disabled = true;
      submitBtn.textContent = "SUBMITTING...";
      const r = await submitScore(name, finalScore, finalTime);
      if (r.ok) {
        submitBtn.textContent = "SUBMITTED";
        await refreshLeaderboard();
      } else {
        submitBtn.textContent = "FAILED";
      }
    });
  }
}

async function refreshLeaderboard() {
  const list = document.getElementById("lb-list");
  const status = document.getElementById("lb-status");
  if (!isLeaderboardEnabled()) {
    list.innerHTML = "";
    status.textContent = "Configure firebase.js to enable leaderboard.";
    return;
  }
  status.textContent = "Loading...";
  const rows = await getLeaderboard(10);
  if (rows.length === 0) {
    list.innerHTML = "";
    status.textContent = "No scores yet — be the first.";
    return;
  }
  list.innerHTML = rows.map((r, i) => `
    <div class="lb-row">
      <span class="rk">${i + 1}</span>
      <span class="nm">${escapeHtml(r.name)}</span>
      <span class="sc">${r.score}</span>
    </div>
  `).join("");
  status.textContent = "";
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

// ============================================================
// BOOT
// ============================================================
loadImages().then(() => {
  refreshLeaderboard();
  requestAnimationFrame(loop);
});
