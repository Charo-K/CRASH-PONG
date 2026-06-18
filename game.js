// ═══════════════════════════════════════════════
//  PONG  ·  game.js  v2
//  Canvas 480 × 720  —  portrait / vertical
//  Player = bottom paddle   CPU = top paddle
// ═══════════════════════════════════════════════

const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');
const W = 720, H = 586;
canvas.width = W; canvas.height = H;

// ── CRT post-process: offscreen glow source ────
const glowCanvas = document.createElement('canvas');
glowCanvas.width  = W;
glowCanvas.height = H;
const glowCtx = glowCanvas.getContext('2d');

// Noise canvas (1/4 res — scaled up for performance)
const noiseCanvas = document.createElement('canvas');
noiseCanvas.width  = 180;
noiseCanvas.height = 146;
const noiseCtx = noiseCanvas.getContext('2d');

// ── Organic screen clip (from screenclippingmask.svg) ───────────────
// The screenclippingmask.svg is a 372×298 normalised version of the
// organic curved screen shape from the computer SVG.
// Mapping to canvas (720×586) — derived from SVG bounding-box analysis:
//   canvas_x = 19.6 + sm_x × 1.828
//   canvas_y = 20.9 + sm_y × 1.835
// Applied via setTransform before ctx.clip() so no manual coordinate math.
const organicClipPath = new Path2D(
    'M191.477 296.741 ' +
    'C236.688 298.53 324.729 291.385 340.195 289.606 ' +
    'C355.661 287.817 361.017 275.326 363.991 260.453 ' +
    'C366.966 245.581 371.729 171.819 371.127 148.023 ' +
    'C370.534 124.226 370.339 89.6396 368.152 68.9052 ' +
    'C365.77 46.3044 363.389 26.0754 356.847 16.5588 ' +
    'C351.52 8.8113 330.076 7.04214 330.076 7.04214 ' +
    'C290.813 1.09302 191.467 0.500008 191.467 0.500008 ' +
    'H180.21 ' +
    'C180.21 0.500008 80.8637 1.09302 41.6015 7.04214 ' +
    'C41.6015 7.04214 20.1574 8.8113 14.8304 16.5588 ' +
    'C8.28833 26.0754 5.90674 46.3044 3.52515 68.9052 ' +
    'C1.33797 89.6494 1.14355 124.226 0.550582 148.023 ' +
    'C-0.0423866 171.819 4.71108 245.581 7.68564 260.453 ' +
    'C10.6602 275.326 16.0164 287.817 31.4821 289.606 ' +
    'C46.9479 291.395 134.989 298.53 180.2 296.741 ' +
    'H191.457 H191.477 Z'
);

// ── Theme ─────────────────────────────────────
const T = {
    bg        : '#050C01',                   // near-black phosphor green
    accent    : '#81F416',                   // full lime — primary
    white     : '#B9EC6C',                   // bright tint (replaces pure white)
    dim       : 'rgba(129,244,22,0.38)',     // mid-bright green
    dimmer    : 'rgba(129,244,22,0.12)',     // ghost green
    overlay   : 'rgba(3,9,0,0.84)',          // dark green overlay
    btnBg     : '#000000',                   // inactive button face — solid black
    btnBorder : 'rgba(129,244,22,0.22)',     // green border
    scoreHigh : '#81F416',                   // full bright score
    scoreLow  : 'rgba(129,244,22,0.38)',     // dimmed score
    label     : 'rgba(129,244,22,0.22)',     // faint label
    paddleCpu : 'rgba(129,244,22,0.50)',     // semi-bright CPU paddle
    shadow    : 'rgba(129,244,22,0.32)',     // retro button drop shadow
};

// ── Assets ─────────────────────────────────────
const smileyImg = new Image();
smileyImg.src   = 'PongGameAssets/smiley.svg';

const sadfaceImg = new Image();
sadfaceImg.src   = 'PongGameAssets/sadface.svg';

const cursorImg = new Image();
cursorImg.src   = 'PongGameAssets/cursor.svg';

// ── Audio (synthesised — no files needed) ──────
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function resumeAudio() { if (audioCtx.state === 'suspended') audioCtx.resume(); }

function beep(freq, dur, type = 'square', vol = 0.13) {
    if (!settings.sound) return;
    try {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.connect(g); g.connect(audioCtx.destination);
        o.type = type;
        o.frequency.setValueAtTime(freq, audioCtx.currentTime);
        g.gain.setValueAtTime(vol, audioCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
        o.start(); o.stop(audioCtx.currentTime + dur);
    } catch (_) {}
}

const SFX = {
    paddle : ()  => beep(520, 0.055, 'square', 0.14),
    wall   : ()  => beep(300, 0.045, 'square', 0.09),
    score  : ()  => { beep(260, 0.12, 'sine', 0.11); setTimeout(() => beep(190, 0.20, 'sine', 0.09), 130); },
};

// ── Settings ───────────────────────────────────
const settings = {
    difficulty : 'medium',   // easy | medium | hard
    scoreToWin : 5,          // 3 | 5 | 10 | 15 | 20
    slowServe  : true,       // ball starts slow, ramps on first hit
    serveRule  : 'loser',    // winner | loser | alternate
    sound      : true,
};

const DIFF_SPEEDS = { easy: 2.2, medium: 3.8, hard: 5.8 };
const SCORE_OPTS  = [3, 5, 10, 15, 20];
const SERVE_OPTS  = ['winner', 'loser', 'alternate'];

// ── Physics constants ──────────────────────────
const PADDLE_W      = 140;
const PADDLE_H      = 14;
const PADDLE_MARGIN = 52;
const BALL_R        = 40;
const BALL_SPEED    = 5;
const BALL_SLOW     = 2.5;
const SPEED_CAP     = 13;
const SPEED_FACTOR  = 1.04;

// ── Game state ─────────────────────────────────
let gameState   = 'menu'; // menu | countdown | playing | paused | gameover
let canContinue = false;  // true when a game is in progress and can be resumed
let serveCount = 0;

// ── Entities ───────────────────────────────────
const player = { x: W/2 - PADDLE_W/2, y: H - PADDLE_MARGIN - PADDLE_H, w: PADDLE_W, h: PADDLE_H };
const cpu    = { x: W/2 - PADDLE_W/2, y: PADDLE_MARGIN,                 w: PADDLE_W, h: PADDLE_H };

const ball = {
    x: W/2, y: H/2,
    vx: 0, vy: 0,
    angle: 0, omega: 0,
    firstHit: false,
    serveDir: 1,
};

const score = { player: 0, cpu: 0 };

// ── Countdown ──────────────────────────────────
let cdValue  = 3;
let cdFrames = 0;
const CD_FRAMES = 45; // 0.75 s per step at 60 fps

// ── Button registry ────────────────────────────
let buttons = [];
function reg(x, y, w, h, action) { buttons.push({ x, y, w, h, action }); }

// ── Input ──────────────────────────────────────
const keys = new Set();
let mouseX = W / 2;
let mouseY = H / 2;
let cRect  = canvas.getBoundingClientRect();

window.addEventListener('resize', () => { cRect = canvas.getBoundingClientRect(); });

document.addEventListener('keydown', e => {
    keys.add(e.key);
    resumeAudio();
    if (e.key === 'p' || e.key === 'P') {
        if (gameState === 'playing') gameState = 'paused';
        else if (gameState === 'paused') gameState = 'playing';
    }
    if (e.key === 'Escape') {
        if (gameState === 'gameover') goToMenu();
        else if (['playing','paused','countdown'].includes(gameState)) goToMenuKeepGame();
    }
});
document.addEventListener('keyup', e => keys.delete(e.key));

canvas.addEventListener('mousemove', e => {
    cRect  = canvas.getBoundingClientRect();
    mouseX = (e.clientX - cRect.left) * (W / cRect.width);
    mouseY = (e.clientY - cRect.top)  * (H / cRect.height);
});

canvas.addEventListener('click', e => {
    resumeAudio();
    cRect = canvas.getBoundingClientRect();
    const cx = (e.clientX - cRect.left) * (W / cRect.width);
    const cy = (e.clientY - cRect.top)  * (H / cRect.height);
    for (const btn of buttons) {
        if (cx >= btn.x && cx <= btn.x + btn.w && cy >= btn.y && cy <= btn.y + btn.h) {
            btn.action();
            return;
        }
    }
});

// ── Helpers ────────────────────────────────────
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ── Game flow ──────────────────────────────────
function goToMenu() {
    gameState    = 'menu';
    canContinue  = false;
    score.player = 0;
    score.cpu    = 0;
    serveCount   = 0;
}

// Go to menu but keep the current game resumable
function goToMenuKeepGame() {
    canContinue = true;
    gameState   = 'menu';
}

function startGame() {
    canContinue  = false;
    score.player = 0;
    score.cpu    = 0;
    serveCount   = 0;
    beginServe(1); // first serve goes toward player
}

function beginServe(dir) {
    ball.x        = W / 2;
    ball.y        = H / 2;
    ball.vx       = 0;
    ball.vy       = 0;
    ball.angle    = 0;
    ball.omega    = 0;
    ball.firstHit = false;
    ball.serveDir = dir;
    cdValue       = 3;
    cdFrames      = 0;
    gameState     = 'countdown';
}

function launch() {
    // Guarantee at least 10° from vertical so the ball never serves nearly-horizontal
    const sign = Math.random() < 0.5 ? -1 : 1;
    const a    = sign * (Math.random() * 20 + 10) * Math.PI / 180; // ±10°–30°
    const sp = settings.slowServe ? BALL_SLOW : BALL_SPEED;
    ball.vx = Math.sin(a) * sp;
    ball.vy = ball.serveDir * Math.cos(a) * sp;
    gameState = 'playing';
}

function onScore(who) {
    if (who === 'player') score.player++;
    else                  score.cpu++;
    serveCount++;
    SFX.score();

    if (score.player >= settings.scoreToWin || score.cpu >= settings.scoreToWin) {
        gameState = 'gameover';
        return;
    }

    let nextDir;
    switch (settings.serveRule) {
        case 'winner'   : nextDir = who === 'player' ? 1 : -1;             break;
        case 'loser'    : nextDir = who === 'player' ? -1 : 1;             break;
        case 'alternate': nextDir = serveCount % 2 === 0 ? 1 : -1;         break;
    }
    beginServe(nextDir);
}

// ── AI ─────────────────────────────────────────
function updateCPU() {
    const speed = DIFF_SPEEDS[settings.difficulty];
    let   target = ball.x;

    // Hard: predict ball position at CPU's y
    if (settings.difficulty === 'hard' && ball.vy < 0) {
        const t = (cpu.y + cpu.h - ball.y) / ball.vy;
        if (t > 0) {
            let px = ball.x + ball.vx * t;
            const lo = BALL_R, hi = W - BALL_R, span = hi - lo;
            px -= lo;
            px  = ((px % (2*span)) + 2*span) % (2*span);
            if (px > span) px = 2*span - px;
            target = px + lo;
        }
    }

    // Easy: occasional intentional drift away from ball
    if (settings.difficulty === 'easy' && ball.vy < 0 && Math.random() < 0.006) {
        target = Math.random() < 0.5 ? 0 : W;
    }

    const dest = target - cpu.w / 2;
    cpu.x += clamp(dest - cpu.x, -speed, speed);
    cpu.x  = clamp(cpu.x, 0, W - cpu.w);
}

// ── Ball bounce off paddle ─────────────────────
function bounce(paddle, dirY) {
    const rel  = (ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2); // -1…+1
    const ang  = rel * 55 * Math.PI / 180;
    let   spd  = Math.hypot(ball.vx, ball.vy);

    if (!ball.firstHit) {
        ball.firstHit = true;
        spd = BALL_SPEED;  // snap to normal speed on first touch (slow-serve ramp-up)
    } else {
        spd = clamp(spd * SPEED_FACTOR, BALL_SPEED, SPEED_CAP);
    }

    ball.vx    = Math.sin(ang) * spd;
    ball.vy    = dirY * Math.cos(ang) * spd;
    ball.omega = ball.vx * 0.07;
    SFX.paddle();
}

// ── Update ─────────────────────────────────────
function updateCountdown() {
    if (++cdFrames >= CD_FRAMES) {
        cdFrames = 0;
        if (--cdValue <= 0) launch();
    }
}

function update() {
    if (gameState === 'countdown') { updateCountdown(); return; }
    if (gameState !== 'playing')   return;

    // Player paddle
    player.x = mouseX - player.w / 2;
    if (keys.has('ArrowLeft')  || keys.has('a')) player.x -= 7;
    if (keys.has('ArrowRight') || keys.has('d')) player.x += 7;
    player.x = clamp(player.x, 0, W - player.w);

    // CPU paddle
    updateCPU();

    // Ball movement + spin
    ball.x += ball.vx;
    ball.y += ball.vy;
    ball.angle += ball.omega;
    ball.omega *= 0.995;

    // Wall bounces — enforce minimum vertical component to avoid shallow loops
    const MIN_VY_SIN = Math.sin(22 * Math.PI / 180); // 22° minimum from horizontal
    function enforceMinVy() {
        const spd = Math.hypot(ball.vx, ball.vy);
        const minVy = spd * MIN_VY_SIN;
        if (Math.abs(ball.vy) < minVy) {
            const vySign = ball.vy >= 0 ? 1 : -1;
            ball.vy = vySign * minVy;
            ball.vx = Math.sign(ball.vx) * Math.sqrt(Math.max(0, spd * spd - ball.vy * ball.vy));
        }
    }
    if (ball.x - BALL_R < 0) {
        ball.x  = BALL_R;
        ball.vx = Math.abs(ball.vx);
        ball.omega = -ball.omega * 0.7;
        enforceMinVy();
        SFX.wall();
    }
    if (ball.x + BALL_R > W) {
        ball.x  = W - BALL_R;
        ball.vx = -Math.abs(ball.vx);
        ball.omega = -ball.omega * 0.7;
        enforceMinVy();
        SFX.wall();
    }

    // Player paddle collision
    if (ball.vy > 0 &&
        ball.y + BALL_R >= player.y && ball.y - BALL_R <= player.y + player.h &&
        ball.x + BALL_R >= player.x && ball.x - BALL_R <= player.x + player.w) {
        ball.y = player.y - BALL_R;
        bounce(player, -1);
    }

    // CPU paddle collision
    if (ball.vy < 0 &&
        ball.y - BALL_R <= cpu.y + cpu.h && ball.y + BALL_R >= cpu.y &&
        ball.x + BALL_R >= cpu.x && ball.x - BALL_R <= cpu.x + cpu.w) {
        ball.y = cpu.y + cpu.h + BALL_R;
        bounce(cpu, 1);
    }

    // Scoring
    if (ball.y - BALL_R > H) onScore('cpu');
    if (ball.y + BALL_R < 0) onScore('player');
}

// ── Draw primitives ────────────────────────────
function bg() { ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H); }

// Retro 3-D button — shadow offset block beneath the face
function rBtn(x, y, w, h, fill, border, r = 2) {
    const S = 4;
    ctx.setLineDash([]);
    // Drop shadow
    ctx.beginPath(); ctx.roundRect(x + S, y + S, w, h, r);
    ctx.fillStyle = T.shadow; ctx.fill();
    // Button face
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
    ctx.fillStyle = fill; ctx.fill();
    if (border) { ctx.strokeStyle = border; ctx.lineWidth = 1.5; ctx.stroke(); }
}

function divider() {
    ctx.save();
    ctx.setLineDash([7, 14]);
    ctx.strokeStyle = T.dimmer;
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.moveTo(24, H/2); ctx.lineTo(W-24, H/2);
    ctx.stroke();
    ctx.restore();
}

function borders() {
    ctx.save();
    ctx.strokeStyle = T.dim;
    ctx.lineWidth   = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(0.5,     0); ctx.lineTo(0.5,     H);
    ctx.moveTo(W - 0.5, 0); ctx.lineTo(W - 0.5, H);
    ctx.stroke();
    ctx.restore();
}

function drawPaddle(p, color) {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.roundRect(p.x, p.y, p.w, p.h, 7); ctx.fill();
}

function drawBall() {
    ctx.save();
    ctx.translate(ball.x, ball.y);
    ctx.rotate(ball.angle);
    ctx.drawImage(smileyImg, -BALL_R, -BALL_R, BALL_R*2, BALL_R*2);
    ctx.restore();
}

function scoreHUD() {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '700 56px "JetBrains Mono",monospace';
    ctx.fillStyle = T.scoreLow;  ctx.fillText(score.cpu,    W/2, H/2 - 38);
    ctx.fillStyle = T.scoreHigh; ctx.fillText(score.player, W/2, H/2 + 50);
    ctx.font = '600 27px "JetBrains Mono",monospace';
    ctx.fillStyle = T.label;
    ctx.fillText('THE REST', W/2, H/2 - 96);
    ctx.fillText('THE BEST', W/2, H/2 + 108);
}

// ── Option row (label left, pill buttons right) ─
function optRow(label, opts, current, y, onChange) {
    const PAD      = 60;
    const GAP      = 6;
    const BTN_H    = 36;
    const AREA_W   = 400;
    const n        = opts.length;
    const btnW     = Math.floor((AREA_W - GAP * (n-1)) / n);
    const startX   = W - PAD - AREA_W;

    // Label
    ctx.setLineDash([]);
    ctx.fillStyle    = T.dim;
    ctx.font         = '500 13px "JetBrains Mono",monospace';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label.toUpperCase(), PAD, y);

    opts.forEach((opt, i) => {
        const bx     = startX + i * (btnW + GAP);
        const by     = y - BTN_H / 2;
        const active = String(opt) === String(current);

        rBtn(bx, by, btnW, BTN_H, active ? T.accent : T.btnBg, active ? T.accent : T.btnBorder);

        // Shorten long labels to fit
        let lbl = String(opt).toUpperCase();
        if (lbl === 'ALTERNATE') lbl = 'ALTER';
        if (lbl === 'MEDIUM')    lbl = 'MED';

        ctx.fillStyle    = active ? T.bg : T.white;
        ctx.font         = `${active ? '700' : '500'} 11px "JetBrains Mono",monospace`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(lbl, bx + btnW/2, by + BTN_H/2);

        reg(bx, by, btnW, BTN_H, () => onChange(opt));
    });
}

// ── DRAW: Menu ────────────────────────────────
function drawMenu() {
    buttons = [];
    bg();

    // Title
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '700 47px "JetBrains Mono",monospace';
    ctx.fillStyle = T.white;
    const titleText = 'CRASH PONG';
    const metrics   = ctx.measureText(titleText);
    const titleW    = metrics.width;
    // True visual height of the caps, measured from the textBaseline='middle' point
    const textH     = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
    const smSize    = Math.round(textH); // square smiley = same height as text
    const smGap     = 12;
    // Shift smileys so their visual centre matches the text's visual centre
    const smCenterY = 76 + (metrics.actualBoundingBoxDescent - metrics.actualBoundingBoxAscent) / 2;
    const smY       = smCenterY - smSize / 2;
    ctx.drawImage(smileyImg, W/2 - titleW/2 - smGap - smSize, smY, smSize, smSize);
    ctx.drawImage(smileyImg, W/2 + titleW/2 + smGap,          smY, smSize, smSize);
    ctx.fillText(titleText, W/2, 76);

    ctx.font = '600 16px "JetBrains Mono",monospace';
    ctx.fillStyle = T.white;
    ctx.fillText('CLASSIC  ARCADE', W/2, 124);

    let topY = 148;

    // Section header — split divider with SETTINGS label in the gap
    const divY   = topY + 18;
    const sLabel = 'SETTINGS';
    ctx.font = '600 13px "JetBrains Mono",monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const sLabelW = ctx.measureText(sLabel).width + 20; // padding around text
    ctx.setLineDash([]);
    ctx.strokeStyle = T.dim; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(24, divY); ctx.lineTo(W/2 - sLabelW/2, divY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W/2 + sLabelW/2, divY); ctx.lineTo(W-24, divY); ctx.stroke();
    ctx.fillStyle = T.accent;
    ctx.fillText(sLabel, W/2, divY);

    // Settings rows
    const ROW_H = 50;
    let   ry    = divY + 44;

    optRow('Difficulty',   ['easy','medium','hard'], settings.difficulty,                ry, v => { settings.difficulty = v; }); ry += ROW_H;
    optRow('Score to Win', SCORE_OPTS,               settings.scoreToWin,                ry, v => { settings.scoreToWin = v; }); ry += ROW_H;
    optRow('Slow Serve',   ['yes','no'],              settings.slowServe ? 'yes' : 'no',  ry, v => { settings.slowServe = v === 'yes'; }); ry += ROW_H;
    optRow('Serve Rule',   SERVE_OPTS,               settings.serveRule,                 ry, v => { settings.serveRule  = v; }); ry += ROW_H;

    // Sound row — icon toggle, aligned as optRow
    ry += 4;
    {
        const PAD2 = 60;
        ctx.setLineDash([]);
        ctx.fillStyle    = T.dim;
        ctx.font         = '500 13px "JetBrains Mono",monospace';
        ctx.textAlign    = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('SOUND', PAD2, ry);

        const iW = 50, iH = 36;
        const ibx = W - PAD2 - iW, iby = ry - iH / 2;
        rBtn(ibx, iby, iW, iH, T.btnBg, settings.sound ? T.accent : T.btnBorder);

        // Speaker icon
        const s   = 8;
        const col = settings.sound ? T.accent : T.dim;
        ctx.save();
        ctx.translate(ibx + iW / 2, ry);
        ctx.fillStyle   = col;
        ctx.strokeStyle = col;
        ctx.lineWidth   = 1.5;
        ctx.setLineDash([]);

        // Body: rectangle back + rightward-opening cone
        ctx.beginPath();
        ctx.moveTo(-s * 1.5, -s * 0.65);
        ctx.lineTo(-s * 0.55, -s * 0.65);
        ctx.lineTo( s * 0.45, -s * 1.3);
        ctx.lineTo( s * 0.45,  s * 1.3);
        ctx.lineTo(-s * 0.55,  s * 0.65);
        ctx.lineTo(-s * 1.5,   s * 0.65);
        ctx.closePath();
        ctx.fill();

        if (settings.sound) {
            // Two sound-wave arcs
            ctx.beginPath(); ctx.arc(-s * 0.1, 0, s * 1.0, -Math.PI * 0.38, Math.PI * 0.38); ctx.stroke();
            ctx.beginPath(); ctx.arc(-s * 0.1, 0, s * 1.55, -Math.PI * 0.34, Math.PI * 0.34); ctx.stroke();
        } else {
            // X mark to the right of the cone
            ctx.lineWidth = 2;
            const xo = s * 0.85, xd = s * 0.4;
            ctx.beginPath(); ctx.moveTo(xo - xd, -xd); ctx.lineTo(xo + xd,  xd); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(xo - xd,  xd); ctx.lineTo(xo + xd, -xd); ctx.stroke();
        }
        ctx.restore();
        reg(ibx, iby, iW, iH, () => { settings.sound = !settings.sound; });
    }

    // Divider before PLAY
    ry += 36 + 14;
    ctx.setLineDash([]);
    ctx.strokeStyle = T.dimmer; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(24, ry); ctx.lineTo(W-24, ry); ctx.stroke();
    ry += 14;

    // Bottom action buttons
    const ph = 44;
    ctx.font = '700 15px "JetBrains Mono",monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (canContinue) {
        // CONTINUE (primary) + START OVER (secondary) side by side
        const bw = 260, gap = 12;
        const leftX  = W/2 - bw - gap/2;
        const rightX = W/2 + gap/2;
        rBtn(leftX,  ry, bw, ph, T.accent, null);
        ctx.fillStyle = T.bg;
        ctx.fillText('▶  CONTINUE', leftX  + bw/2, ry + ph/2);
        reg(leftX,  ry, bw, ph, () => { gameState = 'playing'; });
        rBtn(rightX, ry, bw, ph, T.btnBg, T.accent);
        ctx.fillStyle = T.accent;
        ctx.fillText('START OVER', rightX + bw/2, ry + ph/2);
        reg(rightX, ry, bw, ph, startGame);
    } else {
        const pw = 260, pxBtn = W/2 - pw/2;
        rBtn(pxBtn, ry, pw, ph, T.accent, null);
        ctx.fillStyle = T.bg;
        ctx.fillText('▶  PLAY', W/2, ry + ph/2);
        reg(pxBtn, ry, pw, ph, startGame);
    }

    // Footer hint
    ctx.font = '400 9px "JetBrains Mono",monospace';
    ctx.fillStyle = T.label;
    ctx.textAlign = 'center';
    ctx.fillText('ESC  ·  QUIT', W/2, H - 22);
}

// ── DRAW: Countdown ───────────────────────────
function drawCountdown() {
    bg(); divider(); scoreHUD();
    drawPaddle(cpu,    T.paddleCpu);
    drawPaddle(player, T.white);

    const progress = cdFrames / CD_FRAMES;
    ctx.save();
    ctx.translate(W/2, H/2);
    ctx.scale(1 + progress * 0.38, 1 + progress * 0.38);
    ctx.globalAlpha = 1 - progress * 0.45;
    ctx.font = '700 80px "JetBrains Mono",monospace';
    ctx.fillStyle = T.white;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(cdValue, 0, 0);
    ctx.restore();
}

// ── DRAW: Playing ─────────────────────────────
function drawGame() {
    buttons = [];
    bg(); divider(); scoreHUD();
    drawPaddle(cpu,    T.paddleCpu);
    drawPaddle(player, T.white);
    drawBall();

    // Sound toggle + PAUSE + MENU — upper-right column (x anchor = W-59)
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';

    // Sound icon + SOUND label — above PAUSE (same style as PAUSE/MENU)
    ctx.font = '700 22px "JetBrains Mono",monospace';
    ctx.fillStyle = settings.sound ? T.dim : T.dimmer;
    ctx.fillText(settings.sound ? '♪ SOUND' : '♩ SOUND', W - 59, 68);
    reg(W - 59 - 140, 63, 145, 28, () => { settings.sound = !settings.sound; });

    // PAUSE label (22 px = 0.5× of 45) — clickable: toggle pause
    ctx.font = '700 22px "JetBrains Mono",monospace';
    ctx.fillStyle = T.dim;
    ctx.fillText('PAUSE', W - 59, 97);
    reg(W - 59 - 100, 94, 105, 26, () => { gameState = 'paused'; });

    // MENU label — clickable: go to main menu
    ctx.fillText('MENU',  W - 59, 126);
    reg(W - 59 - 80,  123, 85,  26, goToMenuKeepGame);
}

// ── DRAW: Paused ──────────────────────────────
function drawPaused() {
    drawGame(); // render game underneath

    // Clear game-layer buttons — only pause-screen controls are interactive while paused
    buttons = [];

    ctx.fillStyle = T.overlay; ctx.fillRect(0, 0, W, H);

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '700 46px "JetBrains Mono",monospace';
    ctx.fillStyle = T.white;
    ctx.fillText('PAUSED', W/2, H/2 - 23);

    // Clickable ▶ resume icon
    const iconR = 28;
    const iconX = W/2;
    const iconY = H/2 + 30;
    ctx.beginPath();
    ctx.arc(iconX, iconY, iconR, 0, Math.PI * 2);
    ctx.strokeStyle = T.accent;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = '700 24px "JetBrains Mono",monospace';
    ctx.fillStyle = T.accent;
    ctx.fillText('▶', iconX + 2, iconY); // +2 optical centre for ▶ glyph
    reg(iconX - iconR, iconY - iconR, iconR * 2, iconR * 2, () => { gameState = 'playing'; });

    // Main menu button
    const bw = 190, bh = 34, bx = W/2 - 95, by = H/2 + 78;
    rBtn(bx, by, bw, bh, T.btnBg, T.btnBorder);
    ctx.font = '500 11px "JetBrains Mono",monospace';
    ctx.fillStyle = T.dim;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('MAIN MENU', W/2, by + bh/2);
    reg(bx, by, bw, bh, goToMenuKeepGame);
}

// ── DRAW: Game Over ───────────────────────────
function drawGameOver() {
    buttons = [];
    bg(); divider();
    ctx.fillStyle = T.overlay; ctx.fillRect(0, 0, W, H);

    const won = score.player >= settings.scoreToWin;

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    // Visible screen clip runs y ≈ 22–566 (544 px).
    // Content block height ≈ 322 px → equal top/bottom margins of ~111 px → centered.
    const cy        = H/2 - 10;  // 283
    const headlineY = cy - 44;   // 239 — "THE BEST" / "THE REST"

    // Face (60 × 60) — topmost element; order: face → WINNER → headline
    // sadface.svg is 88 × 108; face circle fills only top 88 × 88 —
    // the bottom 20 px are empty, so we crop the source to 88 × 88.
    const faceSize = 60;
    const faceTop  = headlineY - 106; // 133  (60 face + 8 gap + 10 WINNER + 8 gap + 20 ½-headline)
    const faceX    = W/2 - faceSize/2;

    if (won) {
        ctx.drawImage(smileyImg,  faceX, faceTop, faceSize, faceSize);
    } else {
        // 9-arg form: crop source to 88 × 88 to drop the empty bottom strip
        ctx.drawImage(sadfaceImg, 0, 0, 88, 88, faceX, faceTop, faceSize, faceSize);
    }

    // "WINNER" tiny label — 8 px below the face
    const winnerY = faceTop + faceSize + 8 + 5; // 206  (5 = ½ of 10 px font)
    ctx.font = '600 10px "JetBrains Mono",monospace';
    ctx.fillStyle = T.dim;
    ctx.fillText('WINNER', W/2, winnerY);

    // Headline
    ctx.font = '700 40px "JetBrains Mono",monospace';
    ctx.fillStyle = won ? T.accent : T.white;
    ctx.fillText(won ? 'THE BEST' : 'THE REST', W/2, headlineY);

    // Score
    ctx.font = '700 52px "JetBrains Mono",monospace';
    ctx.fillStyle = T.white;
    ctx.fillText(`${score.player}  ·  ${score.cpu}`, W/2, cy + 11); // 294

    ctx.font = '400 9px "JetBrains Mono",monospace';
    ctx.fillStyle = T.label;
    ctx.fillText('THE BEST  ·  THE REST', W/2, cy + 44); // 327

    // PLAY AGAIN
    const bw = 210, bh = 40;
    let   by = cy + 82; // 365
    rBtn(W/2 - bw/2, by, bw, bh, T.accent, null);
    ctx.font = '700 13px "JetBrains Mono",monospace';
    ctx.fillStyle = T.bg;
    ctx.fillText('PLAY AGAIN', W/2, by + bh/2);
    reg(W/2 - bw/2, by, bw, bh, startGame);

    // MAIN MENU
    by += bh + 10; // 415
    rBtn(W/2 - bw/2, by, bw, bh, T.btnBg, T.btnBorder);
    ctx.font = '700 13px "JetBrains Mono",monospace';
    ctx.fillStyle = T.dim;
    ctx.fillText('MAIN MENU', W/2, by + bh/2);
    reg(W/2 - bw/2, by, bw, bh, goToMenu);
}

// ── Custom cursor ──────────────────────────────
function drawCursor() {
    // cursor.svg is 117×184 — render at ~25% (29×46)
    ctx.drawImage(cursorImg, mouseX, mouseY, 29, 46);
}

// ── CRT post-processing overlay ────────────────
let crtFrame = 0;
function drawCRTOverlay() {
    crtFrame++;
    const t = crtFrame / 60; // elapsed seconds at 60 fps

    // 1. Phosphor glow — blur the current frame and screen-blend back
    glowCtx.clearRect(0, 0, W, H);
    glowCtx.filter = 'blur(6px)';
    glowCtx.drawImage(canvas, 0, 0);
    glowCtx.filter = 'none';
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.28;
    ctx.drawImage(glowCanvas, 0, 0);
    ctx.restore();

    // 2. Scanlines — dark horizontal stripe every 3 px
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
    ctx.restore();

    // 3. Aperture grille — subtle vertical shadow every 3 px
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.07)';
    for (let x = 0; x < W; x += 3) ctx.fillRect(x, 0, 1, H);
    ctx.restore();

    // 4. Analog noise (rendered at 1/4 res, scaled up; updated every other frame)
    if (crtFrame % 2 === 0) {
        const nd = noiseCtx.createImageData(180, 146);
        const d  = nd.data;
        for (let i = 0; i < d.length; i += 4) {
            const v = (Math.random() * 55) | 0;
            d[i] = 0; d[i+1] = v; d[i+2] = 0; d[i+3] = 22; // green grain
        }
        noiseCtx.putImageData(nd, 0, 0);
    }
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(noiseCanvas, 0, 0, W, H);
    ctx.restore();

    // 5. Vignette — radial gradient darkening the edges
    ctx.save();
    const vg = ctx.createRadialGradient(W/2, H/2, H * 0.20, W/2, H/2, H * 0.82);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.70)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    // 6. Flicker — subtle sinusoidal brightness oscillation
    const flicker = Math.sin(t * 8.3) * 0.009
                  + Math.sin(t * 27.1) * 0.006
                  + (Math.random() - 0.5) * 0.018;
    if (flicker < 0) {
        ctx.save();
        ctx.fillStyle = `rgba(0,0,0,${(-flicker).toFixed(3)})`;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
    }
}

// ── Main draw switch ───────────────────────────
function draw() {
    // Pre-fill the full canvas so the area outside the organic clip
    // is always the background colour (no frame accumulation artefacts)
    ctx.fillStyle = T.bg;
    ctx.fillRect(0, 0, W, H);

    // ── Apply organic screen clip ─────────────────
    // setTransform maps screenclippingmask coords (372×298) → canvas (720×586)
    ctx.save();
    ctx.setTransform(1.828, 0, 0, 1.835, 19.6, 20.9);
    ctx.beginPath();
    ctx.clip(organicClipPath);
    ctx.setTransform(1, 0, 0, 1, 0, 0); // reset to canvas coords; clip stays in device space

    switch (gameState) {
        case 'menu':      drawMenu();      break;
        case 'countdown': drawCountdown(); break;
        case 'playing':   drawGame();      break;
        case 'paused':    drawPaused();    break;
        case 'gameover':  drawGameOver();  break;
    }
    drawCursor();
    ctx.restore(); // remove organic clip

    drawCRTOverlay();  // CRT effects on full canvas (no clip)
}

// ── Loop ───────────────────────────────────────
function loop() { update(); draw(); requestAnimationFrame(loop); }
loop();
