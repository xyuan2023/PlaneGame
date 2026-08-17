/* 飞机大战 - 素材加载器 */
(function () {
  'use strict';

  window.PG = window.PG || {};
  window.PG.images = {};

  // 所有需要加载的素材文件名（与 images/ 目录一致）
  var IMG_NAMES = [
    'background',
    // 主角
    'me1', 'me2',
    'me_destroy_1', 'me_destroy_2', 'me_destroy_3', 'me_destroy_4',
    // 小型敌机
    'enemy1',
    'enemy1_down1', 'enemy1_down2', 'enemy1_down3', 'enemy1_down4',
    // 中型敌机
    'enemy2', 'enemy2_hit',
    'enemy2_down1', 'enemy2_down2', 'enemy2_down3', 'enemy2_down4',
    // 大型敌机
    'enemy3_n1', 'enemy3_n2', 'enemy3_hit',
    'enemy3_down1', 'enemy3_down2', 'enemy3_down3',
    'enemy3_down4', 'enemy3_down5', 'enemy3_down6',
    // 子弹与道具
    'bullet1', 'bullet2',
    'bomb_supply', 'bullet_supply',
    // HUD
    'life', 'bomb',
    // 按钮
    'pause_nor', 'pause_pressed',
    'resume_nor', 'resume_pressed',
    'again', 'gameover'
  ];

  /**
   * 加载全部素材。全部加载完成（无论成功失败）后回调 onDone。
   * @param {Function} onDone
   */
  window.PG.loadImages = function (onDone) {
    var total = IMG_NAMES.length;
    var done = 0;
    IMG_NAMES.forEach(function (name) {
      var img = new Image();
      img.onload = function () { finish(); };
      img.onerror = function () {
        console.warn('[assets] 加载失败: images/' + name + '.png');
        finish();
      };
      img.src = 'images/' + name + '.png';
      window.PG.images[name] = img;
    });

    function finish() {
      done++;
      if (done >= total && onDone) {
        onDone();
      }
    }
  };
})();
