/* 飞机大战 - 游戏主逻辑（Canvas 渲染 / 实体 / 碰撞 / HUD / 状态机） */
(function () {
  'use strict';

  // 画布逻辑尺寸：与 background.png 一致（480 x 700，竖屏）
  const W = 480;
  const H = 700;

  const IMG = window.PG.images;

  /* ================= 数值设计 =================
   * 所有手感数值集中在这里，便于后续调整。
   * 坐标单位为像素，时间为秒。
   */
  const PLAYER_SPEED = 396;        // 主角移动速度 px/s（+20%）
  const PLAYER_SCALE = 0.7;        // 主角贴图缩放（缩小 30%）
  const FIRE_INTERVAL = 0.18;      // 发射间隔 s（约 5.5 发/秒，一颗一颗连发）
  const BULLET_SPEED = 540;        // 子弹上升速度 px/s
  const BULLET_DAMAGE = 1;         // 单发子弹伤害
  const BG_SPEED = 49;             // 背景滚动速度 px/s（原 70，减慢 30%）
  const POWERUP_SPEED = 75;        // 道具下落速度 px/s
  const POWERUP_DROP_CHANCE = 0.07; // 击毁敌机掉落道具的概率
  const POWERUP_PITY_TIME = 25;    // 超过该秒数未掉落，则下一架击毁的敌机必定掉落
  const BULLET_POWER_TIME = 30;    // 双发强化持续时间 s
  const INVULN_TIME = 2;           // 被击中后的无敌时间 s
  const MAX_BOMBS = 9;             // 炸弹持有上限
  const MAX_LIVES = 3;             // 初始生命

  // 敌机基础数据（w/h 为贴图原始尺寸，实际显示尺寸 = 原始 × scale）
  // speed 为 [最小, 最大] px/s，最终速度还会乘以“难度系数”（随分数增长）
  const ENEMY_STATS = {
    1: { w: 57,  h: 43,  scale: 1,   hp: 1,  speed: [95, 150],  score: 100,  expInt: 0.075 },
    2: { w: 69,  h: 99,  scale: 0.8, hp: 5,  speed: [60, 95],   score: 500,  expInt: 0.08  },
    3: { w: 169, h: 258, scale: 0.8, hp: 22, speed: [28, 48],   score: 4000, expInt: 0.09  }
  };

  // 各体型爆炸动画帧
  const EXP_FRAMES = {
    1: ['enemy1_down1', 'enemy1_down2', 'enemy1_down3', 'enemy1_down4'],
    2: ['enemy2_down1', 'enemy2_down2', 'enemy2_down3', 'enemy2_down4'],
    3: ['enemy3_down1', 'enemy3_down2', 'enemy3_down3', 'enemy3_down4', 'enemy3_down5', 'enemy3_down6'],
    player: ['me_destroy_1', 'me_destroy_2', 'me_destroy_3', 'me_destroy_4']
  };

  // 界面按钮区域（画布逻辑坐标）
  const PAUSE_RECT = { x: 12, y: 12, w: 60, h: 45 };
  const RESUME_RECT = { x: W / 2 - 30, y: H / 2 - 8, w: 60, h: 45 };
  const START_RECT = { x: W / 2 - 100, y: 480, w: 200, h: 64 };
  const AGAIN_RECT = { x: W / 2 - 150, y: 508, w: 300, h: 41 };

  /* ---------------- 工具函数 ---------------- */
  function rand(a, b) { return a + Math.random() * (b - a); }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /** AABB 矩形相交检测 */
  function rectHit(x1, y1, w1, h1, x2, y2, w2, h2) {
    return x1 < x2 + w2 && x1 + w1 > x2 && y1 < y2 + h2 && y1 + h1 > y2;
  }

  /** 兼容性更好的圆角矩形路径（ctx.roundRect 需要较新浏览器） */
  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  /* ---------------- 游戏主体 ---------------- */
  class Game {
    constructor(canvas, sound) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.sound = sound;

      this.keys = {};
      this.mouse = { x: -1, y: -1 };
      this.pressPause = false;
      this.pressResume = false;
      this.pressStart = false;
      this.pressAgain = false;

      this.highScore = this.loadHighScore();
      this.isNewRecord = false;
      this.state = 'start';        // start | playing | paused | dying | gameover
      this.time = 0;
      this.bgScroll = 0;

      this.reset();
      this.state = 'start';

      this.bindEvents();
      this.lastT = performance.now();
      this.loop = this.loop.bind(this);
      requestAnimationFrame(this.loop);
    }

    /* ---------------- 初始 / 重置 ---------------- */

    reset() {
      this.score = 0;
      this.lives = MAX_LIVES;
      this.bombs = 0;
      this.bulletLevel = 1;        // 1 = bullet1 单发, 2 = bullet2 双发
      this.powerTimer = 0;

      this.enemies = [];
      this.bullets = [];
      this.powerups = [];
      this.explosions = [];

      this.spawnTimer = 1.4;       // 开局缓冲
      this.pityTimer = 0;          // 道具保底计时
      this.fireTimer = 0.25;
      this.flash = 0;
      this.shake = 0;

      this.player = this.makePlayer();
      // 注意：reset() 不设置 state，由调用方决定（构造时进入 start 界面，开始/重开时进入 playing）
    }

    makePlayer() {
      return {
        x: (W - Math.round(102 * PLAYER_SCALE)) / 2,
        y: H - Math.round(126 * PLAYER_SCALE) - 60,   // 屏幕中下部分
        w: Math.round(102 * PLAYER_SCALE),
        h: Math.round(126 * PLAYER_SCALE),
        frame: 0,
        animT: 0,
        invuln: 0,
        dead: false
      };
    }

    startGame() {
      this.sound.init();
      this.sound.click();
      this.reset();
      this.state = 'playing';
      this.sound.startMusic();
    }

    restart() {
      this.sound.click();
      this.reset();
      this.state = 'playing';
      this.sound.startMusic();
    }

    togglePause() {
      if (this.state === 'playing') {
        this.state = 'paused';
        this.sound.click();
        this.sound.pauseMusic();
      } else if (this.state === 'paused') {
        this.state = 'playing';
        this.sound.click();
        this.sound.resumeMusic();
        this.lastT = performance.now();
      }
    }

    /* ---------------- 输入 ---------------- */

    bindEvents() {
      window.addEventListener('keydown', (e) => {
        const k = e.key.toLowerCase();
        if (k === ' ' || k.startsWith('arrow')) e.preventDefault();
        this.keys[k] = true;

        if (k === 'enter') {
          if (this.state === 'start') this.startGame();
          else if (this.state === 'gameover') this.restart();
        }
        if (k === 'p' || k === 'escape') this.togglePause();
        if (k === 'm') this.sound.toggleMute();
        if (k === ' ' && !e.repeat && this.state === 'playing') this.activateBomb();
      });

      window.addEventListener('keyup', (e) => {
        this.keys[e.key.toLowerCase()] = false;
      });

      // 切出页面自动暂停
      window.addEventListener('blur', () => {
        if (this.state === 'playing') this.togglePause();
      });

      this.canvas.addEventListener('mousemove', (e) => {
        this.mouse = this.toCanvas(e);
      });
      this.canvas.addEventListener('mouseleave', () => {
        this.mouse = { x: -1, y: -1 };
      });

      this.canvas.addEventListener('mousedown', (e) => {
        const p = this.toCanvas(e);
        if (this.state === 'playing' && this.inRect(p, PAUSE_RECT)) this.pressPause = true;
        if (this.state === 'paused' && this.inRect(p, RESUME_RECT)) this.pressResume = true;
        if (this.state === 'start' && this.inRect(p, START_RECT)) this.pressStart = true;
        if (this.state === 'gameover' && this.inRect(p, AGAIN_RECT)) this.pressAgain = true;
      });

      this.canvas.addEventListener('mouseup', (e) => {
        const p = this.toCanvas(e);
        const wasPause = this.pressPause;
        const wasResume = this.pressResume;
        const wasStart = this.pressStart;
        const wasAgain = this.pressAgain;
        this.pressPause = this.pressResume = this.pressStart = this.pressAgain = false;
        if (wasPause && this.inRect(p, PAUSE_RECT)) this.togglePause();
        if (wasResume && this.inRect(p, RESUME_RECT)) this.togglePause();
        if (wasStart && this.inRect(p, START_RECT)) this.startGame();
        if (wasAgain && this.inRect(p, AGAIN_RECT)) this.restart();
      });
    }

    /** 屏幕坐标 -> 画布逻辑坐标（画布被 CSS 缩放，需要换算） */
    toCanvas(e) {
      const r = this.canvas.getBoundingClientRect();
      return {
        x: (e.clientX - r.left) * (W / r.width),
        y: (e.clientY - r.top) * (H / r.height)
      };
    }

    inRect(p, r) {
      return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
    }

    /* ---------------- 主循环 ---------------- */

    loop(now) {
      const dt = Math.min((now - this.lastT) / 1000, 0.05);
      this.lastT = now;
      this.update(dt);
      this.render();
      requestAnimationFrame(this.loop);
    }

    /* ---------------- 更新 ---------------- */

    update(dt) {
      if (this.state === 'paused') return;
      this.time += dt;
      this.updateBackground(dt);
      this.updateExplosions(dt);

      if (this.state === 'playing') {
        // 敌机生成
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
          this.spawnEnemy();
          this.spawnTimer = this.currentSpawnInterval();
        }
        this.pityTimer += dt;

        this.handlePlayer(dt);
        this.updateBullets(dt);
        this.updateEnemies(dt);
        this.updatePowerups(dt);
        this.checkBulletHits();
        this.checkPlayerHits();
        this.checkPowerupPickups();

        this.flash = Math.max(0, this.flash - dt * 2.2);
        this.shake = Math.max(0, this.shake - dt * 1.5);
      } else if (this.state === 'dying') {
        // 主角阵亡后世界继续运转，等爆炸动画放完进入结算
        this.updateBullets(dt);
        this.updateEnemies(dt);
        this.updatePowerups(dt);
        this.flash = Math.max(0, this.flash - dt * 2.2);
        this.shake = Math.max(0, this.shake - dt * 1.5);
        this.deathTimer -= dt;
        if (this.deathTimer <= 0) {
          this.state = 'gameover';
          this.isNewRecord = this.score > this.highScore;
          if (this.isNewRecord) this.highScore = this.score;
          this.saveHighScore();
          this.sound.stopMusic();
          this.sound.gameOver();
        }
      }
    }

    updateBackground(dt) {
      this.bgScroll = (this.bgScroll + BG_SPEED * dt) % H;
    }

    /** 当前敌机生成间隔：随分数提高而缩短（下限 0.28s） */
    currentSpawnInterval() {
      return Math.max(0.28, 0.75 - Math.min(this.score / 30000, 1) * 0.47);
    }

    /** 难度系数：随分数提高，敌机更快（上限 2 倍） */
    speedFactor() {
      return 1 + Math.min(this.score / 30000, 1);
    }

    /**
     * 按分数分配敌机类型权重：
     * - 开局以小型为主（~86.5%），中型小幅下调（~12%），大型大幅下调（~1.5%）；
     * - 随分数增加，中型（最高 32%）、大型（最高 9.5%）概率缓慢上升，小型相应回落。
     */
    pickType() {
      const s = this.score;
      const w2 = 12 + Math.min(s / 2500, 20);   // 中型：初始 12%，每 2500 分 +1，上限 32%
      const w3 = 1.5 + Math.min(s / 8000, 8);   // 大型：初始 1.5%，每 8000 分 +1，上限 9.5%
      const w1 = 100 - w2 - w3;                 // 小型：其余权重
      const r = Math.random() * 100;
      if (r < w1) return 1;
      if (r < w1 + w2) return 2;
      return 3;
    }

    spawnEnemy() {
      const type = this.pickType();
      const st = ENEMY_STATS[type];
      const w = st.w * st.scale;               // 实际显示尺寸（中型/大型缩小 20%）
      const h = st.h * st.scale;
      const speed = rand(st.speed[0], st.speed[1]) * this.speedFactor();
      const margin = 10;
      const x = rand(w / 2 + margin, W - w / 2 - margin);
      this.enemies.push({
        type: type,
        x: x - w / 2,
        y: -h - 10,
        w: w,
        h: h,
        hp: st.hp,
        maxHp: st.hp,
        speed: speed,
        hitFlash: 0,
        animT: 0,
        frame: 0
      });
    }

    handlePlayer(dt) {
      const p = this.player;
      if (p.dead) return;
      p.invuln = Math.max(0, p.invuln - dt);
      p.animT += dt;
      p.frame = ((p.animT / 0.18) | 0) % 2; // me1/me2 交替 = 引擎动态

      let dx = 0, dy = 0;
      if (this.keys.a || this.keys.arrowleft) dx -= 1;
      if (this.keys.d || this.keys.arrowright) dx += 1;
      if (this.keys.w || this.keys.arrowup) dy -= 1;
      if (this.keys.s || this.keys.arrowdown) dy += 1;
      if (dx !== 0 && dy !== 0) { dx *= 0.7071; dy *= 0.7071; }

      p.x += dx * PLAYER_SPEED * dt;
      p.y += dy * PLAYER_SPEED * dt;
      p.x = clamp(p.x, 4, W - p.w - 4);
      p.y = clamp(p.y, 4, H - p.h - 4);

      // 自动连发
      this.fireTimer -= dt;
      if (this.fireTimer <= 0) {
        this.fireTimer = FIRE_INTERVAL;
        this.fireBullet();
      }

      // 双发强化倒计时
      if (this.powerTimer > 0) {
        this.powerTimer -= dt;
        if (this.powerTimer <= 0) this.bulletLevel = 1;
      }
    }

    fireBullet() {
      const cx = this.player.x + this.player.w / 2;
      const y = this.player.y + 4;
      if (this.bulletLevel >= 2) {
        // 双发并排
        this.bullets.push({ x: cx - 10, y: y, w: 5, h: 11 });
        this.bullets.push({ x: cx + 5, y: y, w: 5, h: 11 });
      } else {
        this.bullets.push({ x: cx - 2.5, y: y, w: 5, h: 11 });
      }
      this.sound.shoot();
    }

    updateBullets(dt) {
      for (let i = this.bullets.length - 1; i >= 0; i--) {
        const b = this.bullets[i];
        b.y -= BULLET_SPEED * dt;
        if (b.y < -20) this.bullets.splice(i, 1);
      }
    }

    updateEnemies(dt) {
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const e = this.enemies[i];
        e.y += e.speed * dt;
        e.animT += dt;
        if (e.type === 3) e.frame = ((e.animT / 0.15) | 0) % 2; // 大型敌机常态双帧
        e.hitFlash = Math.max(0, e.hitFlash - dt);
        if (e.y > H + 30) this.enemies.splice(i, 1); // 飞出屏幕底部，无惩罚
      }
    }

    updatePowerups(dt) {
      for (let i = this.powerups.length - 1; i >= 0; i--) {
        const p = this.powerups[i];
        p.y += POWERUP_SPEED * dt;
        p.x += Math.sin(this.time * 2.4 + p.phase) * 0.5; // 轻微左右摆动
        if (p.y > H + 40) this.powerups.splice(i, 1);
      }
    }

    updateExplosions(dt) {
      for (let i = this.explosions.length - 1; i >= 0; i--) {
        const ex = this.explosions[i];
        if (ex.kind === 'ring') {
          ex.t += dt;
          if (ex.t >= ex.dur) this.explosions.splice(i, 1);
          continue;
        }
        ex.t += dt;
        if (ex.t >= ex.interval) {
          ex.idx++;
          ex.t = 0;
          if (ex.idx >= ex.frames.length) this.explosions.splice(i, 1);
        }
      }
    }

    /* ---------------- 碰撞 ---------------- */

    checkBulletHits() {
      outer: for (let i = this.bullets.length - 1; i >= 0; i--) {
        const b = this.bullets[i];
        for (let j = this.enemies.length - 1; j >= 0; j--) {
          const e = this.enemies[j];
          if (rectHit(b.x, b.y, b.w, b.h, e.x + e.w * 0.08, e.y + e.h * 0.08, e.w * 0.84, e.h * 0.84)) {
            this.bullets.splice(i, 1);
            e.hp -= BULLET_DAMAGE;
            if (e.hp <= 0) {
              this.explodeEnemy(j, true);
            } else {
              e.hitFlash = 0.09; // 受伤闪白
              this.sound.hit();
            }
            continue outer;
          }
        }
      }
    }

    checkPlayerHits() {
      const p = this.player;
      if (p.dead || p.invuln > 0) return;
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const e = this.enemies[i];
        // 判定框按比例内缩（贴图的 ~12%），保证手感公平
        const ix = e.w * 0.12;
        const iy = e.h * 0.12;
        if (rectHit(p.x + 6, p.y + 6, p.w - 12, p.h - 12, e.x + ix, e.y + iy, e.w - ix * 2, e.h - iy * 2)) {
          this.explodeEnemy(i, false); // 撞机爆炸不计分
          this.hurtPlayer();
          return;
        }
      }
    }

    checkPowerupPickups() {
      const p = this.player;
      if (p.dead) return;
      for (let i = this.powerups.length - 1; i >= 0; i--) {
        const pu = this.powerups[i];
        if (rectHit(p.x, p.y, p.w, p.h, pu.x, pu.y, pu.w, pu.h)) {
          this.powerups.splice(i, 1);
          if (pu.type === 'bomb') {
            this.bombs = Math.min(MAX_BOMBS, this.bombs + 1);
          } else {
            this.bulletLevel = 2;
            this.powerTimer = BULLET_POWER_TIME;
          }
          this.sound.powerup();
        }
      }
    }

    /** 敌机爆炸并（可选）计分、掉落道具 */
    explodeEnemy(index, awardScore) {
      const e = this.enemies[index];
      this.enemies.splice(index, 1);
      const st = ENEMY_STATS[e.type];
      const cx = e.x + e.w / 2;
      const cy = e.y + e.h / 2;
      this.explosions.push({
        x: cx, y: cy,
        frames: EXP_FRAMES[e.type].map(n => IMG[n]),
        idx: 0, t: 0,
        interval: st.expInt,
        scale: st.scale
      });
      this.sound.explode(e.type);
      if (awardScore) {
        this.score += st.score;
        this.rollPowerup(cx, cy);
      }
    }

    /** 击毁敌机后按概率掉落道具；超过保底时间必定掉落 */
    rollPowerup(cx, cy) {
      const forced = this.pityTimer >= POWERUP_PITY_TIME;
      if (!forced && Math.random() >= POWERUP_DROP_CHANCE) return;
      this.pityTimer = 0;
      const type = Math.random() < 0.5 ? 'bomb' : 'bullet';
      const w = type === 'bomb' ? 60 : 58;
      const h = type === 'bomb' ? 107 : 88;
      this.powerups.push({ type: type, x: cx - w / 2, y: cy - h / 2, w: w, h: h, phase: Math.random() * Math.PI * 2 });
    }

    /** 主角受击 */
    hurtPlayer() {
      const p = this.player;
      this.lives -= 1;
      this.shake = 0.35;
      this.sound.playerHit();
      if (this.lives <= 0) {
        // 最终阵亡：播放主角爆炸动画
        p.dead = true;
        this.explosions.push({
          x: p.x + p.w / 2, y: p.y + p.h / 2,
          frames: EXP_FRAMES.player.map(n => IMG[n]),
          idx: 0, t: 0, interval: 0.12,
          scale: PLAYER_SCALE
        });
        this.state = 'dying';
        this.deathTimer = 1.5;
      } else {
        // 非致命伤：短暂无敌 + 光圈提示
        p.invuln = INVULN_TIME;
        this.explosions.push({ kind: 'ring', x: p.x + p.w / 2, y: p.y + p.h / 2, t: 0, dur: 0.35 });
      }
    }

    /** 空格引爆炸弹：全屏敌机爆炸 */
    activateBomb() {
      if (this.state !== 'playing' || this.bombs <= 0) return;
      this.bombs -= 1;
      this.flash = 1;
      this.shake = 0.5;
      this.sound.bomb();
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        this.explodeEnemy(i, true); // 炸弹炸掉的敌机同样计分
      }
    }

    /* ---------------- 最高分 ---------------- */

    loadHighScore() {
      try {
        return parseInt(localStorage.getItem('plane_game_high') || '0', 10) || 0;
      } catch (e) {
        return 0;
      }
    }

    saveHighScore() {
      try {
        localStorage.setItem('plane_game_high', String(this.highScore));
      } catch (e) { /* 忽略（如隐私模式） */ }
    }

    /* ================= 渲染 ================= */

    render() {
      const ctx = this.ctx;
      ctx.save();
      // 屏幕震动
      if (this.shake > 0) {
        ctx.translate(rand(-7, 7) * this.shake, rand(-7, 7) * this.shake);
      }

      this.drawBackground(ctx);

      const s = this.state;
      if (s === 'playing' || s === 'paused') {
        this.drawPowerups(ctx);
        this.drawEnemies(ctx);
        this.drawBullets(ctx);
        this.drawPlayer(ctx);
        this.drawExplosions(ctx);
        this.drawHUD(ctx);
        if (s === 'playing') this.drawPauseButton(ctx);
      } else if (s === 'dying') {
        this.drawPowerups(ctx);
        this.drawEnemies(ctx);
        this.drawBullets(ctx);
        this.drawExplosions(ctx);
        this.drawHUD(ctx);
      }

      ctx.restore();

      // 覆盖层（不参与震动）
      if (s === 'start') this.drawStartOverlay(ctx);
      if (s === 'paused') this.drawPauseOverlay(ctx);
      if (s === 'gameover') this.drawGameOverOverlay(ctx);

      // 炸弹白光
      if (this.flash > 0) {
        ctx.fillStyle = 'rgba(255,255,255,' + (this.flash * 0.5).toFixed(3) + ')';
        ctx.fillRect(0, 0, W, H);
      }
    }

    drawBackground(ctx) {
      const bg = IMG.background;
      const off = this.bgScroll;
      // 背景向下滚动（内容向下移动，营造“向上飞行”的纵版射击感）
      ctx.drawImage(bg, 0, off);
      ctx.drawImage(bg, 0, off - H);
    }

    drawPlayer(ctx) {
      const p = this.player;
      if (p.dead) return;
      // 无敌闪烁
      if (p.invuln > 0 && Math.floor(p.invuln * 14) % 2 === 0) return;
      ctx.drawImage(IMG[p.frame === 0 ? 'me1' : 'me2'], p.x, p.y, p.w, p.h);
    }

    drawEnemies(ctx) {
      for (const e of this.enemies) {
        if (e.type === 3) {
          if (e.hitFlash > 0) ctx.drawImage(IMG.enemy3_hit, e.x, e.y);
          else ctx.drawImage(IMG[e.frame === 0 ? 'enemy3_n1' : 'enemy3_n2'], e.x, e.y);
        } else if (e.type === 2) {
          if (e.hitFlash > 0) ctx.drawImage(IMG.enemy2_hit, e.x, e.y);
          else ctx.drawImage(IMG.enemy2, e.x, e.y);
        } else {
          ctx.drawImage(IMG.enemy1, e.x, e.y);
        }
        // 血条（仅受伤后显示）
        if (e.maxHp > 1 && e.hp < e.maxHp) {
          const bw = e.w;
          const bx = e.x;
          const by = e.y - 8;
          ctx.fillStyle = 'rgba(30,20,10,0.7)';
          ctx.fillRect(bx, by, bw, 4);
          ctx.fillStyle = '#ff5a3c';
          ctx.fillRect(bx, by, bw * (e.hp / e.maxHp), 4);
        }
      }
    }

    drawBullets(ctx) {
      const img = IMG[this.bulletLevel >= 2 ? 'bullet2' : 'bullet1'];
      for (const b of this.bullets) {
        ctx.drawImage(img, b.x, b.y);
      }
    }

    drawPowerups(ctx) {
      for (const p of this.powerups) {
        const img = IMG[p.type === 'bomb' ? 'bomb_supply' : 'bullet_supply'];
        const s = 1 + Math.sin(this.time * 4 + p.phase) * 0.045; // 轻微呼吸
        const w = img.width * s;
        const h = img.height * s;
        ctx.drawImage(img, p.x + p.w / 2 - w / 2, p.y + p.h / 2 - h / 2, w, h);
      }
    }

    drawExplosions(ctx) {
      for (const ex of this.explosions) {
        if (ex.kind === 'ring') {
          const k = ex.t / ex.dur;
          ctx.strokeStyle = 'rgba(255,230,150,' + (1 - k).toFixed(3) + ')';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(ex.x, ex.y, 20 + k * 60, 0, Math.PI * 2);
          ctx.stroke();
          continue;
        }
        const img = ex.frames[Math.min(ex.idx, ex.frames.length - 1)];
        const s = ex.scale || 1;
        ctx.drawImage(img, ex.x - (img.width * s) / 2, ex.y - (img.height * s) / 2, img.width * s, img.height * s);
      }
    }

    /* ---------------- HUD ---------------- */

    /** 手绘风格文字：深色描边 + 填充 */
    pencilText(ctx, text, x, y, size, color, align) {
      ctx.font = 'bold ' + size + 'px "Comic Sans MS","Segoe Print","Chalkboard SE",cursive';
      ctx.textAlign = align || 'left';
      ctx.textBaseline = 'top';
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(2, size / 7);
      ctx.strokeStyle = 'rgba(40,30,20,0.9)';
      ctx.strokeText(text, x, y);
      ctx.fillStyle = color || '#fff';
      ctx.fillText(text, x, y);
    }

    drawHUD(ctx) {
      // 右上角：分数
      this.pencilText(ctx, '分数', W - 14, 14, 15, '#fff', 'right');
      this.pencilText(ctx, String(this.score), W - 14, 34, 30, '#fff', 'right');

      // 左下角：生命 + 炸弹 + 强化剩余时间
      const ly = H - 12 - 57;
      for (let i = 0; i < MAX_LIVES; i++) {
        ctx.globalAlpha = i < this.lives ? 1 : 0.22;
        ctx.drawImage(IMG.life, 14 + i * 50, ly);
      }
      ctx.globalAlpha = 1;

      const bx = 14 + MAX_LIVES * 50 + 12;
      ctx.drawImage(IMG.bomb, bx, ly + 10, 36, 33);
      this.pencilText(ctx, '×' + this.bombs, bx + 40, ly + 12, 24, '#fff');

      if (this.powerTimer > 0) {
        const px = bx + 96;
        ctx.drawImage(IMG.bullet_supply, px, ly + 6, 26, 40);
        this.pencilText(ctx, String(Math.ceil(this.powerTimer)), px + 30, ly + 12, 24, '#ffd76a');
      }
    }

    drawPauseButton(ctx) {
      const hovering = this.inRect(this.mouse, PAUSE_RECT);
      const img = IMG[hovering || this.pressPause ? 'pause_pressed' : 'pause_nor'];
      ctx.drawImage(img, PAUSE_RECT.x, PAUSE_RECT.y);
    }

    /* ---------------- 覆盖层 ---------------- */

    drawStartOverlay(ctx) {
      ctx.fillStyle = 'rgba(20,16,12,0.45)';
      ctx.fillRect(0, 0, W, H);

      // 标题上方的主角小飞机（与游戏内主角同尺寸）
      ctx.drawImage(IMG.me1, W / 2 - 36, 76, 72, 89);

      // 标题（轻微倾斜，手绘感）
      ctx.save();
      ctx.translate(W / 2, 196);
      ctx.rotate(-0.03);
      this.pencilText(ctx, '飞机大战', 0, 0, 58, '#fff', 'center');
      ctx.restore();

      this.pencilText(ctx, '手绘风 · 竖屏射击小游戏', W / 2, 262, 16, '#ffe9c4', 'center');

      const lines = [
        'W A S D / 方向键  移动飞机',
        '自动发射子弹  ·  空格键 引爆炸弹',
        'P / Esc  暂停  ·  M  静音'
      ];
      lines.forEach((t, i) => {
        this.pencilText(ctx, t, W / 2, 336 + i * 28, 16, '#f4ead2', 'center');
      });

      this.pencilText(ctx, '历史最高分  ' + this.highScore, W / 2, 432, 18, '#ffd76a', 'center');

      // 开始按钮（手绘风格圆角按钮）
      const r = START_RECT;
      const hovering = this.inRect(this.mouse, r);
      const pressed = this.pressStart;
      ctx.save();
      ctx.translate(0, pressed ? 3 : 0);
      ctx.fillStyle = hovering ? '#ffeecf' : '#fff7e6';
      ctx.strokeStyle = '#5a4a34';
      ctx.lineWidth = 3;
      roundRectPath(ctx, r.x, r.y, r.w, r.h, 14);
      ctx.fill();
      ctx.stroke();
      this.pencilText(ctx, '开 始 游 戏', W / 2, r.y + r.h / 2 - 16, 28, '#5a4a34', 'center');
      ctx.restore();
      this.pencilText(ctx, '点击开始 或 按 Enter', W / 2, r.y + r.h + 14, 14, '#e8dcc0', 'center');
    }

    drawPauseOverlay(ctx) {
      ctx.fillStyle = 'rgba(20,16,12,0.55)';
      ctx.fillRect(0, 0, W, H);
      this.pencilText(ctx, '已 暂 停', W / 2, H / 2 - 110, 42, '#fff', 'center');
      this.pencilText(ctx, '按 P / Esc 或点击按钮继续', W / 2, H / 2 - 60, 15, '#e8dcc0', 'center');

      const hovering = this.inRect(this.mouse, RESUME_RECT);
      const img = IMG[hovering || this.pressResume ? 'resume_pressed' : 'resume_nor'];
      ctx.drawImage(img, RESUME_RECT.x, RESUME_RECT.y);
    }

    drawGameOverOverlay(ctx) {
      ctx.fillStyle = 'rgba(20,16,12,0.6)';
      ctx.fillRect(0, 0, W, H);

      ctx.drawImage(IMG.gameover, W / 2 - 150, 190);

      this.pencilText(ctx, '最终得分  ' + this.score, W / 2, 270, 34, '#fff', 'center');

      if (this.isNewRecord) {
        this.pencilText(ctx, '★ 新纪录！', W / 2, 322, 24, '#ffd76a', 'center');
        this.pencilText(ctx, '历史最高分  ' + this.highScore, W / 2, 358, 18, '#ffd76a', 'center');
      } else {
        this.pencilText(ctx, '历史最高分  ' + this.highScore, W / 2, 322, 22, '#ffd76a', 'center');
      }

      // 重新开始按钮
      const pressed = this.pressAgain;
      ctx.drawImage(IMG.again, AGAIN_RECT.x + (pressed ? 1 : 0), AGAIN_RECT.y + (pressed ? 3 : 0));
      this.pencilText(ctx, '点击重新开始 或 按 Enter', W / 2, AGAIN_RECT.y + AGAIN_RECT.h + 16, 15, '#eee', 'center');
    }
  }

  window.PG.Game = Game;
})();
