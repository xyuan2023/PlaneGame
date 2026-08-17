/* 飞机大战 - 启动入口 */
(function () {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // 逻辑尺寸 480x700，按设备像素比放大渲染，保证高分屏清晰
  const W = 480;
  const H = 700;
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  ctx.scale(DPR, DPR);

  // 素材加载前的占位画面
  ctx.fillStyle = '#efe9d8';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#5a4a34';
  ctx.textAlign = 'center';
  ctx.font = 'bold 26px "Comic Sans MS","Segoe Print","Chalkboard SE",cursive';
  ctx.fillText('飞机大战 加载中…', W / 2, H / 2);

  const sound = new SoundManager();

  window.PG.loadImages(function () {
    new window.PG.Game(canvas, sound);
  });
})();
