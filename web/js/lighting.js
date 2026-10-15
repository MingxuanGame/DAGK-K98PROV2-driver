/*
 * lighting.js — 灯光设置（灯光 / 灯光编辑 / 灯带），按原厂界面结构复刻
 *
 * 原厂界面元素（work/orig-ui/pages/09-灯光设置.txt / .controls.json）：
 *   灯效：21 项，顺序 = 随波逐流 碧波荡漾 繁星点点 川流不息 如影随形 重峦叠嶂 正弦波 彩泉涌动
 *                          踏雪无痕 百花争艳 一石二鸟 峰回路转 多彩纵横 漫天飞雪 流星 常亮
 *                          动态呼吸 光谱循环 自定义 音乐律动 光影
 *   颜色：炫彩 / 自定义色彩        灯光亮度：暗 0 … 亮 4
 *   灯光速度：慢 0 … 快 0          灯光播放模式：无 / 图案1..图案5（选「自定义」才可用）
 *
 * 协议（b469c422.js setLightSetting/getLightSetting）：0x87 / 0x07（Bit8 校验）
 *      侧灯 0x88 / 0x08；单键背光 0x8C 读 6 页 / 0x0C 写 7 块
 */
import { COMMONCOLOR } from './protocol.js';
import { KEYS, LAYOUT_WIDTH, LAYOUT_HEIGHT } from './layout.js';

const $ = (id) => document.getElementById(id);
const hx = (n) => '#' + (n & 0xffffff).toString(16).padStart(6, '0');
const un = (s) => parseInt(String(s).replace('#', ''), 16) & 0xffffff;

/** 原厂「灯效」列表（顺序照抄界面；第二项是协议枚举名） */
export const LIGHT_EFFECTS = [
  ['随波逐流', 'LightWave'], ['碧波荡漾', 'LightRipple'], ['繁星点点', 'LightRaindrop'], ['川流不息', 'LightSnake'],
  ['如影随形', 'LightPressAction'], ['重峦叠嶂', 'LightConverage'], ['正弦波', 'LightSineWave'], ['彩泉涌动', 'LightKaleidoscope'],
  ['踏雪无痕', 'LightPressActionOff'], ['百花争艳', 'LightLineWave'], ['一石二鸟', 'LightLaser'], ['峰回路转', 'LightCircleWave'],
  ['多彩纵横', 'LightDazzing'], ['漫天飞雪', 'LightRainDown'], ['流星', 'LightMeteor'], ['常亮', 'LightAlwaysOn'],
  ['动态呼吸', 'LightBreath'], ['光谱循环', 'LightNeon'], ['自定义', 'LightUserPicture'], ['音乐律动', 'LightMusicFollow2'],
  ['光影', 'LightScreenColor'],
];
/** 灯带（侧灯）——原厂侧灯枚举只有这几种（i18n sideLight*） */
export const SIDE_EFFECTS = [
  ['关闭', 'LightOff'], ['恒亮', 'LightAlwaysOn'], ['呼吸', 'LightBreath'],
  ['霓虹', 'LightNeon'], ['光波', 'LightWave'], ['跑马', 'LightSnake'],
];
/** 速度可调的灯效（其余为固定速度，原厂速度滑块此时是禁用态） */
const SPEED_OK = new Set(['LightWave', 'LightRipple', 'LightRaindrop', 'LightSnake', 'LightConverage',
  'LightSineWave', 'LightKaleidoscope', 'LightLineWave', 'LightLaser', 'LightCircleWave', 'LightDazzing',
  'LightRainDown', 'LightMeteor', 'LightBreath', 'LightNeon', 'LightMusicFollow2', 'LightUserPicture']);

export function initLighting(ctx) {
  const pic = { rgb: new Uint8Array(384) };        // 128 位置 x RGB
  const state = {
    main: { type: 'LightWave', bright: 4, speed: 0, option: 0, dazzle: false, rgb: 0x74ebd5 },
    side: { type: 'LightWave', bright: 4, speed: 0, option: 0, dazzle: false, rgb: 0x74ebd5 },
  };

  /* ---------- 通用：一组灯效按钮 + 颜色选项 + 滑块 ---------- */
  function effectButtons(box, list, cur, onPick) {
    box.innerHTML = list.map(([name, key]) =>
      '<button class="lp-effect' + (key === cur ? ' on' : '') + '" data-k="' + key + '">' + name + '</button>').join('');
    box.querySelectorAll('.lp-effect').forEach((b) => { b.onclick = () => onPick(b.dataset.k); });
  }
  function swatches(box, cur, onPick) {
    box.innerHTML = Object.keys(COMMONCOLOR).map((k) => {
      const c = COMMONCOLOR[k];
      return '<button class="lp-sw' + (c === cur ? ' on' : '') + '" data-c="' + c + '" style="background:' + hx(c) + '"></button>';
    }).join('') + '<input type="color" class="lp-color" value="' + hx(cur) + '" />';
    box.querySelectorAll('.lp-sw').forEach((b) => { b.onclick = () => onPick(Number(b.dataset.c)); });
    const inp = box.querySelector('.lp-color');
    if (inp) inp.oninput = () => onPick(un(inp.value));
  }
  function colorOpts(box, cur, onPick) {
    const isDazzle = cur.dazzle;
    box.querySelectorAll('.lp-opt').forEach((b) => {
      const on = (b.dataset.c === 'dazzle') === isDazzle;
      b.classList.toggle('on', on);
      b.onclick = () => onPick(b.dataset.c === 'dazzle');
    });
  }

  /* ---------- 主灯 / 灯带 渲染 ---------- */
  function renderMain() {
    const s = state.main;
    effectButtons($('lightEffects'), LIGHT_EFFECTS, s.type, (k) => {
      s.type = k;
      $('lightSpeed').disabled = !SPEED_OK.has(k);
      $('lightOption').disabled = k !== 'LightUserPicture';
      renderMain();
    });
    colorOpts($('lightColorOpts'), s, (dazzle) => { s.dazzle = dazzle; $('lightDazzle').checked = dazzle; renderMain(); });
    $('lightSwatches').style.display = s.dazzle ? 'none' : 'flex';
    if (!s.dazzle) swatches($('lightSwatches'), s.rgb, (c) => { s.rgb = c; renderMain(); });
    $('lightDazzle').checked = s.dazzle;
    $('lightColor').value = hx(s.rgb);
    $('lightBright').value = String(s.bright);
    $('lightSpeed').value = String(s.speed);
    $('lightSpeed').disabled = !SPEED_OK.has(s.type);
    $('lightOption').value = String(s.option);
    $('lightOption').disabled = s.type !== 'LightUserPicture';
    $('lightBrightVal').textContent = String(s.bright);
    $('lightSpeedVal').textContent = String(s.speed);
  }
  function renderSide() {
    const s = state.side;
    effectButtons($('sideEffects'), SIDE_EFFECTS, s.type, (k) => { s.type = k; renderSide(); });
    colorOpts($('sideColorOpts'), s, (dazzle) => { s.dazzle = dazzle; $('sideDazzle').checked = dazzle; renderSide(); });
    $('sideSwatches').style.display = s.dazzle ? 'none' : 'flex';
    if (!s.dazzle) swatches($('sideSwatches'), s.rgb, (c) => { s.rgb = c; renderSide(); });
    $('sideDazzle').checked = s.dazzle;
    $('sideColor').value = hx(s.rgb);
    $('sideBright').value = String(s.bright);
    $('sideSpeed').value = String(s.speed);
    $('sideBrightVal').textContent = String(s.bright);
    $('sideSpeedVal').textContent = String(s.speed);
  }

  $('lightBright').oninput = () => { state.main.bright = Number($('lightBright').value); $('lightBrightVal').textContent = $('lightBright').value; };
  $('lightSpeed').oninput = () => { state.main.speed = Number($('lightSpeed').value); $('lightSpeedVal').textContent = $('lightSpeed').value; };
  $('lightOption').onchange = () => { state.main.option = Number($('lightOption').value); };
  $('sideBright').oninput = () => { state.side.bright = Number($('sideBright').value); $('sideBrightVal').textContent = $('sideBright').value; };
  $('sideSpeed').oninput = () => { state.side.speed = Number($('sideSpeed').value); $('sideSpeedVal').textContent = $('sideSpeed').value; };

  /* ---------- 读 / 写 ---------- */
  async function readMain() {
    const d = ctx.device; if (!d) return ctx.toast('请先连接设备', 'err');
    try {
      const s = await d.getLightSetting();
      if (!s) return ctx.toast('读取失败', 'err');
      Object.assign(state.main, {
        type: s.type, bright: s.bright, speed: s.speed, option: s.option,
        dazzle: !!s.dazzle, rgb: s.rgb,
      });
      $('lightDazzle').checked = !!s.dazzle;
      $('lightColor').value = hx(s.rgb);
      renderMain();
      ctx.log('..', '主灯效: ' + JSON.stringify(s));
      ctx.toast('已读取主灯效');
    } catch (e) { ctx.toast('读取失败：' + (e.message || e), 'err'); }
  }
  async function applyMain() {
    const d = ctx.device; if (!d) return ctx.toast('请先连接设备', 'err');
    try {
      const ok = await d.setLightSetting({ ...state.main, rgb: state.main.rgb });
      ctx.toast(ok ? '主灯效已写入设备' : '写入失败', ok ? '' : 'err');
    } catch (e) { ctx.toast('写入失败：' + (e.message || e), 'err'); }
  }
  async function readSide() {
    const d = ctx.device; if (!d) return ctx.toast('请先连接设备', 'err');
    try {
      const s = await d.getSideLightSetting();
      if (!s) return ctx.toast('读取失败', 'err');
      Object.assign(state.side, { type: s.type, bright: s.bright, speed: s.speed, dazzle: !!s.dazzle, rgb: s.rgb });
      renderSide();
      ctx.log('..', '侧灯效: ' + JSON.stringify(s));
      ctx.toast('已读取灯带');
    } catch (e) { ctx.toast('读取失败：' + (e.message || e), 'err'); }
  }
  async function applySide() {
    const d = ctx.device; if (!d) return ctx.toast('请先连接设备', 'err');
    try {
      const ok = await d.setSideLightSetting({ ...state.side, option: 0 });
      ctx.toast(ok ? '灯带已写入设备' : '写入失败', ok ? '' : 'err');
    } catch (e) { ctx.toast('写入失败：' + (e.message || e), 'err'); }
  }
  $('btnLightRead').onclick = readMain;
  $('btnLightApply').onclick = applyMain;
  $('btnSideRead').onclick = readSide;
  $('btnSideApply').onclick = applySide;

  /* ---------- 灯光编辑（单键背光） ---------- */
  function renderPic() {
    const stage = $('picStage');
    if (!stage) return;
    stage.innerHTML = '';
    for (const k of KEYS) {
      if (k.idx === null) continue;
      const o = k.idx * 3;
      const el = document.createElement('button');
      el.className = 'kbk';
      el.style.left = k.x + 'px'; el.style.top = k.y + 'px';
      el.style.width = k.w + 'px'; el.style.height = k.h + 'px';
      el.style.background = 'rgb(' + pic.rgb[o] + ',' + pic.rgb[o + 1] + ',' + pic.rgb[o + 2] + ')';
      el.style.color = '#fff';
      el.innerHTML = '<span class="kbk-txt"><span class="kbk-l1">' + k.label + '</span>'
        + (k.label2 ? '<span class="kbk-l2">' + k.label2 + '</span>' : '') + '</span>';
      el.onclick = () => {
        const c = un($('picColor').value);
        pic.rgb[o] = (c >> 16) & 255; pic.rgb[o + 1] = (c >> 8) & 255; pic.rgb[o + 2] = c & 255;
        renderPic();
      };
      stage.appendChild(el);
    }
    const wrap = $('picWrap');
    if (wrap) {
      const sc = Math.min(1, (wrap.clientWidth - 28) / LAYOUT_WIDTH);
      stage.style.transform = 'scale(' + sc + ')';
      wrap.style.height = Math.round(LAYOUT_HEIGHT * sc + 24) + 'px';
    }
  }

  $('btnPicRead').onclick = async () => {
    const d = ctx.device; if (!d) return ctx.toast('请先连接设备', 'err');
    try {
      ctx.toast('读取单键背光…（6 页）');
      pic.rgb = await d.getLightPicRaw(0);
      renderPic();
      ctx.toast('已读取单键背光');
    } catch (e) { ctx.toast('读取失败：' + (e.message || e), 'err'); }
  };
  $('btnPicWrite').onclick = async () => {
    const d = ctx.device; if (!d) return ctx.toast('请先连接设备', 'err');
    try {
      await d.setLightPicRaw(pic.rgb, 0);
      ctx.toast('单键背光已写入（主灯效请选「自定义」）');
    } catch (e) { ctx.toast('写入失败：' + (e.message || e), 'err'); }
  };
  $('btnPicFill').onclick = () => {
    const c = un($('picColor').value);
    for (let i = 0; i < 128; i++) {
      pic.rgb[i * 3] = (c >> 16) & 255; pic.rgb[i * 3 + 1] = (c >> 8) & 255; pic.rgb[i * 3 + 2] = c & 255;
    }
    renderPic();
  };
  $('btnPicClear').onclick = () => { pic.rgb = new Uint8Array(384); renderPic(); };

  renderMain();
  renderSide();
  renderPic();
  window.addEventListener('resize', renderPic);

  return {
    root: document.getElementById('tab-light'),
    onShow() { renderPic(); },
    /** 供 app.js 自动读取用：主灯效 + 灯带 */
    async autoRead() { await readMain(); await readSide(); },
    /** 顶部「读取设备配置」用 */
    async readConfig() { await readMain(); await readSide(); },
    onShowPerKey() { renderPic(); },
    onDeviceChange() { renderMain(); renderSide(); },
  };
}
