/* 飞机大战 - 音效与背景音乐（Web Audio API 实时合成，无需音频素材） */
(function () {
  'use strict';

  /**
   * SoundManager
   * - 所有音效均由振荡器 + 噪声实时合成；
   * - 背景音乐为一小段循环旋律（A 小调），轻快的手绘游戏风格；
   * - AudioContext 必须在用户手势（点击/按键）后创建，因此 init() 由“开始游戏”触发。
   */
  class SoundManager {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.musicGain = null;
      this.sfxGain = null;
      this.muted = false;
      // 音乐调度
      this.musicTimer = null;
      this.nextNoteTime = 0;
      this.step = 0;
      this.bpm = 132;
    }

    /** 创建/恢复音频上下文（需在用户手势中调用） */
    init() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return; // 不支持 Web Audio 时静默降级
      try {
        this.ctx = new AC();
      } catch (e) {
        this.ctx = null;
        return;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.16;
      this.musicGain.connect(this.master);
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.5;
      this.sfxGain.connect(this.master);
    }

    /** M 键静音/恢复 */
    toggleMute() {
      this.muted = !this.muted;
      if (this.master) this.master.gain.value = this.muted ? 0 : 0.9;
      return this.muted;
    }

    /* ---------------- 基础合成工具 ---------------- */

    /** 振荡器音（音高可下滑） */
    tone(opts) {
      if (!this.ctx || this.muted) return;
      const o = Object.assign(
        { freq: 440, slide: null, type: 'square', dur: 0.15, vol: 0.2, when: 0, attack: 0.005 },
        opts
      );
      const t0 = this.ctx.currentTime + o.when;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = o.type;
      osc.frequency.setValueAtTime(Math.max(20, o.freq), t0);
      if (o.slide) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.slide), t0 + o.dur);
      }
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.001, o.vol), t0 + o.attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
      osc.connect(g);
      g.connect(this.sfxGain);
      osc.start(t0);
      osc.stop(t0 + o.dur + 0.03);
    }

    /** 噪声爆发（爆炸等） */
    noise(opts) {
      if (!this.ctx || this.muted) return;
      const o = Object.assign(
        { dur: 0.3, vol: 0.4, when: 0, freq: 1200, end: 300, type: 'lowpass' },
        opts
      );
      const t0 = this.ctx.currentTime + o.when;
      const len = Math.max(1, Math.floor(this.ctx.sampleRate * o.dur));
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const f = this.ctx.createBiquadFilter();
      f.type = o.type;
      f.frequency.setValueAtTime(Math.max(40, o.freq), t0);
      f.frequency.exponentialRampToValueAtTime(Math.max(40, o.end), t0 + o.dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(Math.max(0.001, o.vol), t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
      src.connect(f);
      f.connect(g);
      g.connect(this.sfxGain);
      src.start(t0);
      src.stop(t0 + o.dur + 0.03);
    }

    /* ---------------- 游戏音效 ---------------- */

    /** 发射子弹（短促高频啵声） */
    shoot() {
      this.tone({ freq: 780, slide: 430, type: 'square', dur: 0.07, vol: 0.07 });
    }

    /** 敌机被击中（未击毁） */
    hit() {
      this.noise({ dur: 0.06, vol: 0.14, freq: 3200, end: 900, type: 'bandpass' });
    }

    /** 敌机爆炸（按体型区分音效大小） */
    explode(size) {
      if (size === 1) {
        this.noise({ dur: 0.3, vol: 0.32, freq: 1700, end: 260 });
        this.tone({ freq: 130, slide: 42, type: 'sine', dur: 0.26, vol: 0.28 });
      } else if (size === 2) {
        this.noise({ dur: 0.45, vol: 0.45, freq: 1250, end: 180 });
        this.tone({ freq: 92, slide: 32, type: 'sine', dur: 0.42, vol: 0.4 });
      } else {
        this.noise({ dur: 0.8, vol: 0.58, freq: 1000, end: 120 });
        this.tone({ freq: 66, slide: 26, type: 'sine', dur: 0.75, vol: 0.5 });
        this.noise({ dur: 0.35, vol: 0.22, freq: 5200, end: 900, when: 0.05, type: 'highpass' });
      }
    }

    /** 主角被击中 */
    playerHit() {
      this.noise({ dur: 0.9, vol: 0.55, freq: 900, end: 100 });
      this.tone({ freq: 220, slide: 45, type: 'sawtooth', dur: 0.8, vol: 0.32 });
    }

    /** 拾取道具（上行琶音） */
    powerup() {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        this.tone({ freq: f, type: 'triangle', dur: 0.12, vol: 0.25, when: i * 0.08 });
      });
    }

    /** 炸弹引爆（大爆炸） */
    bomb() {
      this.noise({ dur: 1.1, vol: 0.68, freq: 800, end: 60 });
      this.tone({ freq: 70, slide: 22, type: 'sine', dur: 1.0, vol: 0.6 });
      this.noise({ dur: 0.5, vol: 0.28, freq: 6000, end: 800, when: 0.06, type: 'highpass' });
    }

    /** 游戏结束（下行音符） */
    gameOver() {
      [440, 349.23, 293.66, 220].forEach((f, i) => {
        this.tone({ freq: f, type: 'triangle', dur: 0.5, vol: 0.28, when: i * 0.32 });
      });
    }

    /** 界面点击 */
    click() {
      this.tone({ freq: 520, slide: 320, type: 'square', dur: 0.06, vol: 0.12 });
    }

    /* ---------------- 背景音乐 ---------------- */

    startMusic() {
      this.init();
      if (!this.ctx) return;
      this.stopMusic();
      this.step = 0;
      this.nextNoteTime = this.ctx.currentTime + 0.08;
      this.musicTimer = setInterval(() => this.schedule(), 80);
    }

    stopMusic() {
      if (this.musicTimer) {
        clearInterval(this.musicTimer);
        this.musicTimer = null;
      }
    }

    /** 暂停（挂起整个音频上下文，音乐与音效一起停） */
    pauseMusic() {
      if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
    }

    resumeMusic() {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    }

    /** 前瞻式音符调度 */
    schedule() {
      if (!this.ctx) return;
      const beat = 60 / this.bpm;
      // 16 拍旋律（A 小调，轻快往复）
      const MELODY = [
        440, 523.25, 587.33, 659.25,
        783.99, 659.25, 587.33, 523.25,
        440, 523.25, 587.33, 659.25,
        783.99, 880, 783.99, 659.25
      ];
      // 低音（每两拍一个根音，0 表示休止）
      const BASS = [
        110, 0, 130.81, 0, 98, 0, 164.81, 0,
        110, 0, 130.81, 0, 98, 0, 164.81, 0
      ];
      while (this.nextNoteTime < this.ctx.currentTime + 0.28) {
        const s = this.step % 16;
        const when = this.nextNoteTime - this.ctx.currentTime;
        this.musicNote(MELODY[s], when, beat * 0.92, 0.16, 'triangle');
        if (BASS[s]) this.musicNote(BASS[s], when, beat * 1.8, 0.1, 'sawtooth');
        if (s % 4 === 0) this.musicKick(when);
        if (s % 2 === 0) this.musicHat(when);
        this.nextNoteTime += beat;
        this.step++;
      }
    }

    musicNote(freq, when, dur, vol, type) {
      if (!this.ctx || this.muted) return;
      const t0 = this.ctx.currentTime + when;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type || 'triangle';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.001, vol), t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g);
      g.connect(this.musicGain);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }

    musicKick(when) {
      if (!this.ctx || this.muted) return;
      const t0 = this.ctx.currentTime + when;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(150, t0);
      osc.frequency.exponentialRampToValueAtTime(45, t0 + 0.1);
      g.gain.setValueAtTime(0.5, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
      osc.connect(g);
      g.connect(this.musicGain);
      osc.start(t0);
      osc.stop(t0 + 0.14);
    }

    musicHat(when) {
      if (!this.ctx || this.muted) return;
      const t0 = this.ctx.currentTime + when;
      const len = Math.floor(this.ctx.sampleRate * 0.03);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const f = this.ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 6000;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.12, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.03);
      src.connect(f);
      f.connect(g);
      g.connect(this.musicGain);
      src.start(t0);
      src.stop(t0 + 0.05);
    }
  }

  window.SoundManager = SoundManager;
})();
