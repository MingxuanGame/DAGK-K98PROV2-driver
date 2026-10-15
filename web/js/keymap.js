/*
 * keymap.js — 键盘设置 / Fn层设置（按原厂驱动 1:1 复刻）
 *
 * 与原厂一致：
 *   * 键盘图坐标取自原厂 keymappings（881x281），按键两行字样取自原厂 displayText
 *   * 按键四态配色 = 原厂 SVG 的"底色 #575757 + 60% 叠加色"：
 *       已修改 #74EBD5 / 固件禁用 #FAFF00 / 系统按键 #FE4545（常规 #3E3E3E，描边 #CFCFCF）
 *   * 右侧工具列：读取设备配置 / 图例 / 板载N下拉 / 恢复按键
 *   * 改键面板分类：组合键(基本字符+拓展字符) / 宏设置 / 功能 / 禁用按键（Fn 页另有 清空功能）
 *   * 页签：自定义按键 / 其他设置(睡眠时间) / 高级键(SnapKey)
 *   * 解码走 kcfg.js（原厂 matrixToConfigs 逐字移植），所以"读出来的"和原厂显示一致
 *
 * 扩展（原厂没有、但按键协议支持，单独放在「高级(扩展)」分类里）：MT / MDS / 手柄 / 压枪 / 原始字节
 */
import { KEYS, LAYOUT_WIDTH, LAYOUT_HEIGHT, BY_IDX } from './layout.js';
import { DEFAULT_MATRIX } from './protocol.js';
import {
  Un, Na, V_, gL, yw, Ir,
  configToMatrix, cellConfig, changeArrToConfig, configDisplay, MODE_COLORS,
  hidCodeMapKeyName,
} from './kcfg.js';

const esc = (s) => String(s === undefined || s === null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MODE_CLASS = { '常规': 'normal', '已修改': 'changed', '固件禁用': 'forbidden', '系统按键': 'system' };

const FACTORY_FLAT = Array.from(DEFAULT_MATRIX);
const FACTORY = [];
for (let i = 0; i < 128; i++) FACTORY.push(FACTORY_FLAT.slice(i * 4, i * 4 + 4));

/** 原厂按键图上这一格显示什么（与出厂一致 => 常规） */
function decodeCell(cfg4, idx) {
  const c = cellConfig(FACTORY_FLAT, cfg4, idx * 4);
  if (!c) return { mode: '常规', text: '' };
  return configDisplay(c);
}

/* ---------------- 104 键选键面板 ---------------- */

/** 104 键（ANSI 全尺寸）布局：每行 [htmlCode, 宽度(单位)]，null = 占位空隙 */
const L104 = [
  [['Escape', 1], [null, 0.6], ['F1', 1], ['F2', 1], ['F3', 1], ['F4', 1], [null, 0.4], ['F5', 1], ['F6', 1], ['F7', 1], ['F8', 1], [null, 0.4],
   ['F9', 1], ['F10', 1], ['F11', 1], ['F12', 1], [null, 0.4], ['PrintScreen', 1], ['ScrollLock', 1], ['Pause', 1]],
  [['Backquote', 1], ['Digit1', 1], ['Digit2', 1], ['Digit3', 1], ['Digit4', 1], ['Digit5', 1], ['Digit6', 1], ['Digit7', 1], ['Digit8', 1], ['Digit9', 1],
   ['Digit0', 1], ['Minus', 1], ['Equal', 1], ['Backspace', 2], [null, 0.25], ['Insert', 1], ['Home', 1], ['PageUp', 1], [null, 0.25], ['NumLock', 1], ['NumpadDivide', 1], ['NumpadMultiply', 1], ['NumpadSubtract', 1]],
  [['Tab', 1.5], ['KeyQ', 1], ['KeyW', 1], ['KeyE', 1], ['KeyR', 1], ['KeyT', 1], ['KeyY', 1], ['KeyU', 1], ['KeyI', 1], ['KeyO', 1], ['KeyP', 1],
   ['BracketLeft', 1], ['BracketRight', 1], ['Backslash', 1.5], [null, 0.25], ['Delete', 1], ['End', 1], ['PageDown', 1], [null, 0.25], ['Numpad7', 1], ['Numpad8', 1], ['Numpad9', 1], ['NumpadAdd', 1]],
  [['CapsLock', 1.75], ['KeyA', 1], ['KeyS', 1], ['KeyD', 1], ['KeyF', 1], ['KeyG', 1], ['KeyH', 1], ['KeyJ', 1], ['KeyK', 1], ['KeyL', 1],
   ['Semicolon', 1], ['Quote', 1], ['Enter', 2.25], [null, 0.25], [null, 3], [null, 0.25], ['Numpad4', 1], ['Numpad5', 1], ['Numpad6', 1], [null, 1]],
  [['ShiftLeft', 2.25], ['KeyZ', 1], ['KeyX', 1], ['KeyC', 1], ['KeyV', 1], ['KeyB', 1], ['KeyN', 1], ['KeyM', 1], ['Comma', 1], ['Period', 1],
   ['Slash', 1], ['ShiftRight', 2.75], [null, 1.25], ['ArrowUp', 1], [null, 1.25], ['Numpad1', 1], ['Numpad2', 1], ['Numpad3', 1], ['NumpadEnter', 1]],
  [['ControlLeft', 1.25], ['MetaLeft', 1.25], ['AltLeft', 1.25], ['Space', 6.25], ['AltRight', 1.25], ['MetaRight', 1.25], ['ContextMenu', 1.25], ['ControlRight', 1.25],
   [null, 0.25], ['ArrowLeft', 1], ['ArrowDown', 1], ['ArrowRight', 1], [null, 0.25], ['Numpad0', 2], ['NumpadDecimal', 1], [null, 1]],
];

/** 面板上的短标签（其余用原厂 value，去掉换行） */
const SHORT = {
  Escape: 'Esc', Backspace: 'Bksp', CapsLock: 'Caps', Enter: 'Enter', ShiftLeft: 'Shift', ShiftRight: 'Shift',
  ControlLeft: 'Ctrl', ControlRight: 'Ctrl', MetaLeft: 'Win', MetaRight: 'Win', AltLeft: 'Alt', AltRight: 'Alt',
  ContextMenu: 'Menu', Space: 'Space', PrintScreen: 'PrtSc', ScrollLock: 'ScrLk', Pause: 'Pause',
  NumLock: 'NumLk', NumpadDivide: 'Num/', NumpadMultiply: 'Num*', NumpadSubtract: 'Num-', NumpadAdd: 'Num+',
  NumpadEnter: 'Num↵', NumpadDecimal: 'Num.', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Insert: 'Ins', Delete: 'Del', PageUp: 'PgUp', PageDown: 'PgDn', Home: 'Home', End: 'End',
  // 小键盘加 Num 前缀：数字行的 7 和小键盘的 7 长得一样很容易点错
  //（真机踩过：想改 Home，结果写成了小键盘 7 = 0x5F）
  Numpad0: 'Num0', Numpad1: 'Num1', Numpad2: 'Num2', Numpad3: 'Num3', Numpad4: 'Num4',
  Numpad5: 'Num5', Numpad6: 'Num6', Numpad7: 'Num7', Numpad8: 'Num8', Numpad9: 'Num9',
};
const unByHtml = Object.fromEntries(Un.map((r) => [r.htmlCode, r]));
const label104 = (code) => SHORT[code] || String((unByHtml[code] || {}).value || code).replace(/\n/g, ' ');

/** 扩展区条目的极简中文说明（原文之后括号里那一小段） */
const EXT_DESC = {
  '__¥': '日元/反斜杠', '__]': '日文右方括号', '__\\': '日文反斜杠', 'L_\\': '左反斜杠',
  'No Transform(JP)': '日文无转换', 'Transform(JP)': '日文转换', Kana: '日文假名',
  Calculator: '计算器', 'U-': '音量减', 'U+': '音量加', Mute: '静音', Play: '播放/暂停', Stop: '停止',
  Prev: '上一曲', Next: '下一曲', narrow: '缩小', enlarge: '放大', Search: '搜索', 'Win_l': '左 Win',
  'Open_website': '打开网站', 'r_Fn': '右 Fn', ledMode1: '灯效模式1', ledMode2: '灯效模式2',
  'Vol-Bri': '音量/亮度切换', LED_Mode: '灯效模式', MIC: '麦克风', Emoji: '表情', Copy: '复制',
  Paste: '粘贴', SelectAll: '全选', Undo: '撤销', Cut: '剪切', Web: '打开驱动网页', DS1: '桌面1', DS2: '桌面2',
  LEDONOFF: '灯效开关', Rt: '板载层循环', OLED_FontColor: '屏幕字体颜色', OLED_BackColor: '屏幕背景颜色',
  OLED_Confirm: '屏幕确认键', WIN_L: '锁屏', WIN_D: '显示桌面', WIN_E: '打开资源管理器',
  'Ctrl_SHIFT_ESC': '任务管理器', 'Ctrl_C': '复制', 'Ctrl_V': '粘贴', Powersave: '省电',
  LEDBIRINC: '亮度加', LEDBIRDEC: '亮度减', F13: 'F13', F19: 'F19', F20: 'F20', F21: 'F21', F22: 'F22', F23: 'F23', F24: 'F24',
};
const extDesc = (r) => EXT_DESC[r.htmlCode] || EXT_DESC[r.value] || '';
/** 扩展区 = 104 键板之外的可用键（多媒体 / 浏览器 / 系统 / 日文键等） */
const BOARD_CODES = new Set(L104.flat().filter((x) => x && x[0]).map((x) => x[0]));
const EXT_KEYS = (() => {
  const seen = new Set();
  return Un.filter((r) => {
    if (BOARD_CODES.has(r.htmlCode)) return false;
    if (String(r.htmlCode).includes('_index')) return false;
    if (/^Numpad(Home|Left|Right|Up|Down|PageUp|PageDown)$/.test(String(r.htmlCode))) return false;
    // 原厂表里同一功能有重复条目（U+/Mute/Play 等），按"名称+说明"去重，界面更干净
    const sig = String(r.value) + '|' + (EXT_DESC[r.htmlCode] || EXT_DESC[r.value] || '');
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
})();



/** 功能分类图标名（原厂「功能」页里的那一组） */
const FN_ICON_KEYS = ['fn', '上一曲', '下一曲', '播放暂停', '停止', '静音', '音量加', '音量减', '播放器', '计算器',
  '邮件', '我的电脑', '搜索', '主页', '亮度加', '亮度减', '刷新', '放大', '缩小', '麦克风开关'];
/** 原厂「鼠标功能」那一组 */
const MOUSE_ORDER = ['鼠标右键', '鼠标左键', '鼠标滚轮点击', '鼠标前进', '鼠标后退', '鼠标滚轮向上', '鼠标滚轮向下'];

export function initKeymap(ctx, opts = {}) {
  const root = document.getElementById(opts.panel || 'tab-keymap');
  const isFn = !!opts.fn;
  const q = (role) => (root ? root.querySelector('[data-role="' + role + '"]') : null);

  const state = {
    layer: 0,
    maxLayer: 3,
    fnSys: 'win',
    loaded: false,
    layers: {},
    fnLayers: {},
    sel: null,
    cat: 'combo',
    dirty: new Map(),        // '位置' -> 4 字节
    combo: [],               // 组合键待应用字符（hid 列表，最多 3）
    pending: null,           // 「确认」按钮待应用的 4 字节
    pendingLabel: '',
    comboKey: null,          // 组合键格子已经按哪个键预填过
    snap: [null, null],      // SnapKey 两个槽位
    devProfile: undefined,   // 设备回报的"当前板载"索引（0 基，原厂 getCurrentProfile 的返回值）
    progress: '',
    log: [],
  };

  const kkey = (l, idx) => l + ':' + idx;
  const matrixOf = (l) => state.layers[l] || Array.from(DEFAULT_MATRIX);
  const cellOf = (l, idx) => matrixOf(l).slice(idx * 4, idx * 4 + 4);
  const shownCell = (idx) => state.dirty.get(kkey(state.layer, idx)) || cellOf(state.layer, idx);
  const factoryOf = (idx) => FACTORY[idx] || [0, 0, 0, 0];
  const isDiff = (l, idx) => !Ir(cellOf(l, idx), factoryOf(idx));
  const loadedNow = () => (isFn ? !!state.fnLayers[state.fnSys + '|' + state.layer] : !!state.layers[state.layer]);

  function klog(m) {
    state.log.unshift(new Date().toLocaleTimeString('zh-CN', { hour12: false }) + ' ' + m);
    state.log = state.log.slice(0, 40);
  }

  /* ------------------------------ 读 ------------------------------ */
  async function readLayer(l) {
    const d = ctx.device;
    if (!d) throw new Error('请先连接设备');
    const raw = await d.readKeyMatrixRaw(l, 0, {
      onProgress: (done, total) => { state.progress = '读取中 ' + done + '/' + total; paintHint(); },
    });
    state.layers[l] = Array.from(raw.slice(0, 512));
  }
  async function readFnLayer(l, sys) {
    const d = ctx.device;
    const raw = await d.readFnKeyMatrixRaw(sys, l, {
      onProgress: (done, total) => { state.progress = 'Fn 读取中 ' + done + '/' + total; paintHint(); },
    });
    state.fnLayers[sys + '|' + l] = Array.from(raw.slice(0, 512));
  }

  /**
   * 问设备"现在用的是哪个板载"（0x84）并切过去。
   * 原厂就是这么做的：getCurrentProfile() -> 当前按键层 -> 下拉显示「板载 N」(N = 索引 + 1)。
   */
  async function syncProfile() {
    const d = ctx.device;
    if (!d) return null;
    try {
      const p = await d.getCurrentProfile();
      if (typeof p !== 'number') return null;
      state.devProfile = p;
      if (p >= 0 && p < state.maxLayer) {
        state.layer = p;
        const ls = q('layerSel');
        if (ls) ls.value = String(p);
        state.sel = null;
      }
      return p;
    } catch (e) { return null; }
  }

  /*
   * 读取串行化 —— 自动读取(连接后)、进入页面时的自动读取、手动「读取设备配置」、
   * 扫描全部层，都会从这里排队执行。
   *
   * 不排队的话它们会同时在接收器的同一条控制通道上跑：真机上是控制传输互相穿插
   * （读回上一页的数据 / 直接把接收器 stall 成 EPIPE），页面上看起来就是"读出来是空的"，
   * 也就是用户说的"无线的行为和有线不一样"。
   */
  let readQueue = Promise.resolve();
  function queueRead(fn) {
    const p = readQueue.then(fn, fn);
    readQueue = p.then(() => {}, () => {});
    return p;
  }

  function doRead(opts = {}) { return queueRead(() => doReadInner(opts)); }

  async function doReadInner(opts = {}) {
    if (!opts.skipConfirm && ctx.confirmDiscard && !ctx.confirmDiscard(isFn ? '重新读取 Fn 层' : '重新读取这一档')) return;
    const b = q('btnRead') || document.getElementById('btnReadCfg'); if (b) b.disabled = true;
    state.progress = '读取中…'; paintHint();
    try {
      if (!opts.keepProfile) await syncProfile();   // 先对齐到设备正在用的板载，再读
      for (const k of Array.from(state.dirty.keys())) {
        if (Number(k.split(':')[0]) === state.layer) state.dirty.delete(k);
      }
      if (isFn) await readFnLayer(state.layer, state.fnSys);
      else await readLayer(state.layer);
      state.loaded = true;
      reportDirty();
      klog('读取成功');
      ctx.log('..', (isFn ? 'Fn层设置：' : '键盘设置：') + '层 ' + state.layer + ' 读取成功');
    } catch (e) {
      ctx.toast('读取失败：' + (e.message || e), 'err');
      klog('读取失败：' + (e.message || e));
    } finally {
      state.progress = ''; if (b) b.disabled = false; render();
    }
  }

  function doScan() { return queueRead(doScanInner); }

  async function doScanInner() {
    const d = ctx.device;
    if (!d) return ctx.toast('请先连接设备', 'err');
    if (ctx.confirmDiscard && !ctx.confirmDiscard('扫描全部层')) return;
    const b = q('btnScan'); if (b) b.disabled = true;
    const report = [];
    try {
      await syncProfile();     // 扫描前先对齐到设备正在用的板载
      for (let l = 0; l < state.maxLayer; l++) {
        state.progress = '扫描层 ' + l + '…'; paintHint();
        await readLayer(l);
        let n = 0;
        for (let i = 0; i < 128; i++) n += isDiff(l, i) ? 1 : 0;
        report.push({ layer: l, changed: n });
        await sleep(120);
      }
      state.loaded = true;
      const best = report.slice().sort((a, b2) => b2.changed - a.changed)[0];
      if (best && best.changed > 0) {
        state.layer = best.layer; state.sel = null;
        const ls = q('layerSel'); if (ls) ls.value = String(state.layer);
      }
      klog('扫描完成 ' + report.map((r) => '层' + r.layer + ':' + r.changed).join(' '));
      ctx.toast('扫描完成：' + report.map((r) => '层' + r.layer + ' ' + r.changed + ' 键').join(' / '));
    } catch (e) {
      ctx.toast('扫描中断：' + (e.message || e), 'err');
    } finally {
      state.progress = ''; if (b) b.disabled = false; render();
    }
  }

  async function doWrite() {
    const d = ctx.device;
    if (!d) return ctx.toast('请先连接设备', 'err');
    const items = Array.from(state.dirty.entries()).filter(([k]) => Number(k.split(':')[0]) === state.layer);
    if (!items.length) return ctx.toast('没有待写入的改动');
    const b = q('btnWrite'); if (b) b.disabled = true;
    let ok = 0, fail = 0;
    try {
      for (const [k, cfg] of items) {
        const idx = Number(k.split(':')[1]);
        state.progress = '写入 ' + idx + '…'; paintHint();
        try {
          if (isFn) await d.setFnKeyConfigSimple(idx, cfg, state.layer, state.fnSys);
          else await d.setKeyConfigSimple(idx, cfg, state.layer, 0);
          ok++; state.dirty.delete(k);
        } catch (e) { fail++; klog('写入 ' + idx + ' 失败：' + (e.message || e)); }
        await sleep(60);
      }
      if (ok) {
        try { if (isFn) await readFnLayer(state.layer, state.fnSys); else await readLayer(state.layer); } catch (e) { /* 读失败不改状态 */ }
        klog('写入完成 成功' + ok + (fail ? ' 失败' + fail : ''));
        ctx.toast('写入完成：' + ok + ' 个键' + (fail ? '，' + fail + ' 个失败' : ''));
      }
    } catch (e) {
      ctx.toast('写入失败：' + (e.message || e), 'err');
    } finally {
      state.progress = ''; if (b) b.disabled = false; reportDirty(); render();
    }
  }

  /* ------------------------------ 画键盘 ------------------------------ */
  function renderCanvas() {
    const stage = q('kbStage');
    if (!stage) return;
    stage.innerHTML = '';
    const loaded = loadedNow();
    for (const k of KEYS) {
      if (k.idx === null) continue;
      const cfg = isFn ? null : shownCell(k.idx);
      const d = cfg ? decodeCell(cfg, k.idx) : null;
      const el = document.createElement('button');
      el.className = 'kbk';
      el.dataset.idx = String(k.idx);
      el.style.left = k.x + 'px'; el.style.top = k.y + 'px';
      el.style.width = k.w + 'px'; el.style.height = k.h + 'px';
      let text = '';
      if (!loaded) el.classList.add('unknown');
      else if (cfg) {
        if (d.mode !== '常规') { el.classList.add(MODE_CLASS[d.mode] || 'changed'); text = d.text; }
      }
      if (state.dirty.has(kkey(state.layer, k.idx))) el.classList.add('dirty');
      if (state.sel === k.idx) el.classList.add('sel');
      const showFn = text && String(text).replace(/\n/g, '') !== String(k.label2 || k.label);
      el.innerHTML = '<span class="kbk-txt"><span class="kbk-l1">' + esc(k.label) + '</span>'
        + (k.label2 ? '<span class="kbk-l2">' + esc(k.label2) + '</span>' : '') + '</span>'
        + (showFn ? '<span class="kbk-fn">' + esc(text) + '</span>' : '');
      el.title = k.id + ' · 位置 ' + k.idx + (cfg ? ' · ' + d.mode + (text ? ' ' + text : '') : '');
      el.onclick = () => onPickKey(k.idx);
      stage.appendChild(el);
    }
    fitStage();
  }

  function fitStage() {
    const wrap = q('kbWrap'), stage = q('kbStage');
    if (!wrap || !stage) return;
    const scale = Math.min(1, (wrap.clientWidth - 28) / LAYOUT_WIDTH);
    stage.style.transform = 'scale(' + scale + ')';
    wrap.style.height = Math.round(LAYOUT_HEIGHT * scale + 24) + 'px';
  }

  function onPickKey(idx) {
    state.sel = idx;
    // 高级键页签：点键盘就是在往 SnapKey 的两个槽位里填键
    const advTab = root.querySelector('.ptab.on');
    if (advTab && advTab.dataset.ptab === 'adv') {
      const hid = factoryOf(idx)[2];
      if (state.snap[0] === null) state.snap[0] = { idx, hid };
      else if (state.snap[1] === null) state.snap[1] = { idx, hid };
      else state.snap = [{ idx, hid }, null];
      renderSnap();
    }
    render();
  }

  function paintHint() {
    const el = q('hint');
    if (el) {
      const parts = [];
      if (state.progress) parts.push('⏳ ' + state.progress);
      if (!loadedNow()) parts.push('⚠ 还没从设备读取 —— 现在显示的是出厂默认。请点「读取设备配置」');
      else {
        let n = 0;
        for (let i = 0; i < 128; i++) n += isDiff(state.layer, i) ? 1 : 0;
        const tag = isFn ? 'Fn板载 ' + (state.layer + 1) + '（' + state.fnSys + '）' : '板载 ' + (state.layer + 1);
        parts.push(tag + (state.devProfile === state.layer ? ' ← 设备当前使用' : '') + '：与出厂不同的键 ' + n + ' 个');
        if (state.dirty.size) parts.push('本次改动 ' + state.dirty.size + ' 个待写入');
      }
      if (state.log.length) parts.push(state.log[0]);
      el.textContent = parts.join(' · ');
    }
    const wb = q('btnWrite');
    if (wb) wb.disabled = state.dirty.size === 0;
    const rb = q('btnResetKey');
    if (rb) rb.disabled = state.sel === null;
    const lg = q('lgSystem');
    if (lg) lg.hidden = !isFn;
  }

  /* ------------------------------ 改键面板 ------------------------------ */
  const CATS_MAIN = [['combo', '组合键'], ['macro', '宏设置'], ['fn', '功能'], ['ban', '禁用按键'], ['adv', '高级(扩展)']];
  const CATS_FN = [['combo', '组合键'], ['macro', '宏设置'], ['fn', '功能'], ['clear', '清空功能'], ['adv', '高级(扩展)']];
  const cats = () => (isFn ? CATS_FN : CATS_MAIN);

  function renderEditor() {
    const box = q('keyedit');
    if (!box) return;
    if (state.sel === null) {
      box.innerHTML = '<div class="ke-empty">*请先到上方键盘选择按键后设置</div>';
      return;
    }
    const idx = state.sel;
    const k = BY_IDX[idx];
    const cfg = isFn ? [0, 0, 0, 0] : shownCell(idx);
    const disp = isFn ? { mode: '常规', text: '' } : decodeCell(cfg, idx);
    const cur = cellConfig(FACTORY_FLAT, cfg, idx * 4) || changeArrToConfig(cfg, 0, 0);
    const dirty = state.dirty.has(kkey(state.layer, idx));
    const head = '<div class="ke-head">'
      + '<div class="ke-title">' + esc(k ? k.label + (k.label2 ? ' / ' + k.label2 : '') : '位置 ' + idx)
      + '<span class="ke-pos">矩阵位置 ' + idx + '</span></div>'
      + '<div class="ke-now">当前：<b style="color:' + MODE_COLORS[disp.mode] + '">'
      + esc(disp.mode === '常规' ? '出厂默认（' + (k ? k.label : '键') + '）' : disp.text) + '</b>'
      + '<span class="ke-mode ' + (MODE_CLASS[disp.mode] || 'normal') + '">' + disp.mode + '</span>'
      + (dirty ? '<span class="ke-dirty">未写入</span>' : '') + '</div>'
      + '<div class="ke-raw mono">原始字节 [ ' + cfg.join(', ') + ' ] · 出厂 [ ' + factoryOf(idx).join(', ') + ' ]</div>'
      + '</div>';
    const rail = '<div class="ke-rail">' + cats().map(([id, name]) =>
      '<button class="kecat' + (state.cat === id ? ' on' : '') + '" data-c="' + id + '">' + name + '</button>').join('')
      + '<button class="ke-reset" data-role="keReset2">恢复按键</button></div>';
    const main = '<div class="ke-main">'
      + '<div class="ke-warn">*组合键最多可选择3个字符</div>'
      + '<div class="ke-body">' + catBody(state.cat, idx, cur) + '</div>'
      + '<div class="ke-foot"><button class="btn btn-confirm" data-role="keConfirm">确认</button></div></div>';
    box.innerHTML = head + rail + main;
    if (state.pending) {
      const c0 = box.querySelector('[data-role="keConfirm"]');
      c0.disabled = false;
      c0.textContent = '确认' + (state.pendingLabel ? '：' + state.pendingLabel : '');
    }
    box.querySelectorAll('.kecat').forEach((b) => {
      b.onclick = () => { state.cat = b.dataset.c; state.combo = []; renderEditor(); };
    });
    box.querySelector('[data-role="keReset2"]').onclick = () => applyCfg(factoryOf(idx), '已恢复按键');
    bindCat(state.cat, idx, cur);
  }

  /** 把"未写入改动数"报给 app.js（顶部徽标 + 刷新/退出提醒） */
  function reportDirty() {
    if (ctx.markDirty) ctx.markDirty(isFn ? 'fn' : 'keymap', state.dirty.size);
  }

  function applyCfg(cfg4, msg) {
    const idx = state.sel;
    if (idx === null) return;
    if (Ir(cfg4, cellOf(state.layer, idx))) state.dirty.delete(kkey(state.layer, idx));
    else state.dirty.set(kkey(state.layer, idx), cfg4.slice());
    state.pending = null; state.pendingLabel = '';
    reportDirty();
    if (msg) ctx.toast(msg + '（点「写入设备」保存到键盘）');
    render();
  }

  /** 104 键选键面板（按物理位置找键，比一排排按钮好找） */
  const board104 = () => {
    const rows = L104.map((row) => {
      const keys = row.map(([code, w]) => {
        // 用 grid 列跨度定位（0.25 单位 = 1 列，1 单位 = 34px），这样每一行的列都严格对齐
        if (code === null) return '<span class="kb104-gap" style="grid-column:span ' + Math.round(w * 4) + '"></span>';
        const r = unByHtml[code];
        if (!r) return '';
        // 同一 htmlCode 重复出现（如 NumpadAdd/NumpadEnter 跨行）只画一次
        if (w === 0) return '';
        const on = state.combo.includes(r.hidCode) ? ' on' : '';
        return '<button class="kk kb104-k' + on + '" style="grid-column:span ' + Math.round(w * 4) + '" data-h="' + r.hidCode + '">' + esc(label104(code)) + '</button>';
      }).join('');
      return '<div class="kb104-row">' + keys + '</div>';
    }).join('');
    return '<div class="kb104">' + rows + '</div>';
  };
  /** 扩展区：104 板上没有的键，原文之后跟一小段中文说明 */
  const extArea = () => '<div class="kk-grid">' + EXT_KEYS.map((r) => {
    const d = extDesc(r);
    const on = state.combo.includes(r.hidCode) ? ' on' : '';
    return '<button class="kk' + on + '" data-h="' + r.hidCode + '">' + esc(String(r.value).replace(/\n/g, ' '))
      + (d ? '<span class="kk-desc">' + esc(d) + '</span>' : '') + '</button>';
  }).join('') + '</div>';

  function catBody(cat, idx, cur) {
    if (cat === 'combo') {
      const sel = state.combo.map((h) => hidCodeMapKeyName(h) || h).join(' + ') || '（未选择）';
      return '<div class="ke-cat">选键（104 键盘布局，点键即选）</div>' + board104()
        + '<div class="ke-cat">扩展区（104 键之外的键）</div>' + extArea()
        + '<div class="ke-note">已选：<b>' + esc(sel) + '</b> —— 最多 3 个字符，按点选顺序组合。</div>';
    }
    if (cat === 'macro') {
      const m = cur && cur.type === 'ConfigMacro' ? cur : { macroIndex: 0, macroType: ctx.macroPlayMode || 'repeat_times' };
      const types = [['repeat_times', '循环'], ['on_off', '自动'], ['touch_repeat', '按下']];
      return '<div class="ke-cat">播放方式：</div><div class="kk-grid ke-modes">'
        + types.map(([v, n]) => '<button class="kk' + (m.macroType === v ? ' on' : '') + '" data-mt="' + v + '">' + n + '</button>').join('')
        + '</div><div class="ke-row"><label>循环次数 / 宏编号</label>'
        + '<input type="number" id="keMacroIdx" min="0" max="49" value="' + (m.macroIndex || 0) + '" />'
        + '<span class="ke-note">（宏 1 ~ 50，内容在「宏编辑」页录制）</span></div>';
    }
    if (cat === 'fn') {
      const icons = FN_ICON_KEYS.filter((n) => yw[n]);
      return '<div class="ke-cat">功能</div><div class="kk-grid">'
        + icons.map((n) => '<button class="kk" data-fn="' + esc(n) + '">' + esc(n) + '</button>').join('')
        + '</div><div class="ke-cat">鼠标功能</div><div class="kk-grid">'
        + MOUSE_ORDER.map((n) => {
          const v = Object.keys(gL).find((x) => gL[x] === n);
          return v === undefined ? '' : '<button class="kk" data-mouse="' + v + '">' + esc(n) + '</button>';
        }).join('') + '</div>';
    }
    if (cat === 'ban' || cat === 'clear') {
      const banned = [];
      for (let i = 0; i < 128; i++) if (Ir(cellOf(state.layer, i), [0, 0, 0, 0])) banned.push(i);
      return '<div class="ke-note">1. 在上方键盘选择需要' + (cat === 'ban' ? '禁用' : '清空功能的') + '按键；<br />'
        + '2. 选中按键后点击下面的按钮即可实现；<br />'
        + '3. ' + (cat === 'ban' ? '禁用后按键将无法触发。' : '清空后按键将在 Fn 层没有功能。') + '</div>'
        + '<div class="ke-btns"><button class="btn btn-confirm" data-role="keBan">' + (cat === 'ban' ? '禁用按键' : '清空功能') + '</button></div>'
        + '<div class="ke-cat">当前' + (cat === 'ban' ? '禁用项' : '清空项') + '</div>'
        + '<div class="ke-note">' + (banned.length ? banned.map((i) => (BY_IDX[i] ? BY_IDX[i].label : i)).join('、') : '（无）') + '</div>';
    }
    if (cat === 'adv') {
      const keys = '<option value="">（当前按键）</option>' + Un.map((r) => '<option value="' + r.hidCode + '">' + esc(r.value) + '</option>').join('');
      const mt = cur && cur.type === 'ConfigMT' ? cur : { keyCode: 0, keyCode2: 0, time: 200 };
      const rec = cur && cur.type === 'ConfigControlRecoil' ? cur : { method: 'normal', gunIndex: 0 };
      return '<div class="ke-note">这些是原厂界面里没有单独入口、但按键协议支持的类型（扩展）。</div>'
        + '<div class="ke-cat">MT（按住一个功能 / 单击另一个功能）</div>'
        + '<div class="ke-row"><label>按住</label><select id="mtK1">' + keys + '</select></div>'
        + '<div class="ke-row"><label>单击</label><select id="mtK2">' + keys + '</select></div>'
        + '<div class="ke-row"><label>判定时间(ms)</label><input type="number" id="mtTime" min="10" max="2000" step="10" value="' + (mt.time || 200) + '" /></div>'
        + '<div class="ke-btns"><button class="btn btn-confirm" data-role="mtApply">应用 MT</button></div>'
        + '<div class="ke-cat">MDS（一个键位按出两个键）</div>'
        + '<div class="ke-row"><label>序号</label><input type="number" id="mdsN" min="0" max="3" value="0" /></div>'
        + '<div class="ke-row"><label>绑定键</label><select id="mdsK">' + keys + '</select></div>'
        + '<div class="ke-btns"><button class="btn btn-confirm" data-role="mdsApply">应用 MDS</button></div>'
        + '<div class="ke-cat">手柄按键</div><div class="kk-grid">'
        + Object.keys(V_).map((v) => '<button class="kk" data-pad="' + esc(v) + '">' + esc(v) + '</button>').join('') + '</div>'
        + '<div class="ke-cat">压枪</div>'
        + '<div class="ke-row"><label>方式</label><select id="rcM">'
        + [['normal', '压枪'], ['switch_keep', '开关压枪-持续'], ['switch_toggle', '开关压枪-切换']]
          .map(([v, n]) => '<option value="' + v + '"' + (rec.method === v ? ' selected' : '') + '>' + n + '</option>').join('')
        + '</select></div>'
        + '<div class="ke-row"><label>枪械</label><select id="rcG">'
        + Array.from({ length: 16 }, (_, i) => '<option value="' + i + '"' + ((rec.gunIndex || 0) === i ? ' selected' : '') + '>枪械 ' + (i + 1) + '</option>').join('')
        + '</select></div>'
        + '<div class="ke-btns"><button class="btn btn-confirm" data-role="rcApply">应用压枪</button></div>';
    }
    return '';
  }

  function bindCat(cat, idx, cur) {
    const box = q('keyedit');
    const confirm = box.querySelector('[data-role="keConfirm"]');
    const setPending = (cfg4, label) => {
      state.pending = cfg4;
      state.pendingLabel = label || '';
      confirm.disabled = false;
      confirm.textContent = '确认' + (label ? '：' + label : '');
    };
    const clearPending = () => {
      state.pending = null; state.pendingLabel = '';
      if (!state.pending) { confirm.disabled = true; confirm.textContent = '确认'; }
    };
    confirm.onclick = () => { if (state.pending) applyCfg(state.pending, '已改键'); };
    if (confirm.disabled === undefined) confirm.disabled = true;
    if (cat === 'combo') {
      if (!state.pending) { confirm.disabled = true; confirm.textContent = '确认'; }
      box.querySelectorAll('.kk[data-h]').forEach((b) => {
        b.onclick = () => {
          const hid = Number(b.dataset.h);
          const i = state.combo.indexOf(hid);
          if (i >= 0) state.combo.splice(i, 1);
          else { if (state.combo.length >= 3) return ctx.toast('组合键最多 3 个字符', 'err'); state.combo.push(hid); }
          const list = state.combo.slice();
          if (list.length === 1) setPending([0, 0, list[0], 0], hidCodeMapKeyName(list[0]));
          else if (list.length === 2) setPending([0, list[0], list[1], 0], hidCodeMapKeyName(list[0]) + '+' + hidCodeMapKeyName(list[1]));
          else if (list.length === 3) setPending([0, list[0], list[1], list[2]], list.map((h) => hidCodeMapKeyName(h)).join('+'));
          else { clearPending(); }
          renderEditor();
        };
      });
      // 换到另一个按键时，如果它当前就是组合键，先把已选字符填进格子
      // （只做一次，否则用户取消选择后会被重新填回来）
      if (state.comboKey !== idx) {
        state.comboKey = idx;
        const l = (cur && cur.type === 'combo') ? [cur.skey, cur.key, cur.key2].filter((x) => x) : [];
        if (l.length) { state.combo = l; renderEditor(); }
      }
    }
    if (cat === 'macro') {
      if (!state.pending) { confirm.disabled = true; confirm.textContent = '确认'; }
      const upd = () => setPending(configToMatrix({
        type: 'ConfigMacro',
        macroIndex: Number(box.querySelector('#keMacroIdx').value) || 0,
        macroType: (box.querySelector('.ke-modes .kk.on') || {}).dataset ? box.querySelector('.ke-modes .kk.on').dataset.mt : 'repeat_times',
      }), '宏 ' + ((Number(box.querySelector('#keMacroIdx').value) || 0) + 1));
      box.querySelectorAll('[data-mt]').forEach((b) => {
        b.onclick = () => {
          box.querySelectorAll('[data-mt]').forEach((x) => x.classList.remove('on'));
          b.classList.add('on'); upd();
        };
      });
      if (!box.querySelector('.ke-modes .kk.on')) box.querySelector('[data-mt]').classList.add('on');
      box.querySelector('#keMacroIdx').oninput = upd;
      upd();
    }
    if (cat === 'fn') {
      if (!state.pending) { confirm.disabled = true; confirm.textContent = '确认'; }
      box.querySelectorAll('.kk[data-fn]').forEach((b) => {
        b.onclick = () => {
          box.querySelectorAll('.kk').forEach((x) => x.classList.remove('on'));
          b.classList.add('on');
          setPending(configToMatrix({ type: 'ConfigFunction', key: b.dataset.fn }), b.textContent);
        };
      });
      box.querySelectorAll('.kk[data-mouse]').forEach((b) => {
        b.onclick = () => {
          box.querySelectorAll('.kk').forEach((x) => x.classList.remove('on'));
          b.classList.add('on');
          setPending(configToMatrix({ type: 'ConfigMouse', key: Number(b.dataset.mouse) }), b.textContent);
        };
      });
    }
    if (cat === 'ban' || cat === 'clear') {
      if (!state.pending) { confirm.disabled = true; confirm.textContent = '确认'; }
      const btn = box.querySelector('[data-role="keBan"]');
      if (btn) btn.onclick = () => applyCfg([0, 0, 0, 0], cat === 'ban' ? '已禁用该按键' : '已清空该按键');
    }
    if (cat === 'adv') {
      if (!state.pending) { confirm.disabled = true; confirm.textContent = '确认'; }
      const K1 = box.querySelector('#mtK1'), K2 = box.querySelector('#mtK2');
      const mt = cur && cur.type === 'ConfigMT' ? cur : {};
      if (mt.keyCode) K1.value = String(mt.keyCode);
      if (mt.keyCode2) K2.value = String(mt.keyCode2);
      box.querySelector('[data-role="mtApply"]').onclick = () => applyCfg(configToMatrix({
        type: 'ConfigMT', keyCode: Number(K1.value) || 0, keyCode2: Number(K2.value) || 0,
        time: Number(box.querySelector('#mtTime').value) || 200,
      }), '已设置 MT');
      box.querySelector('[data-role="mdsApply"]').onclick = () => applyCfg(configToMatrix({
        type: 'ConfigMDS', number: Number(box.querySelector('#mdsN').value) || 0, keyCode: Number(box.querySelector('#mdsK').value) || 0,
      }), '已设置 MDS');
      box.querySelectorAll('.kk[data-pad]').forEach((b) => {
        b.onclick = () => {
          box.querySelectorAll('.kk').forEach((x) => x.classList.remove('on'));
          b.classList.add('on');
          setPending(configToMatrix({ type: 'ConfigGamepad', key: b.dataset.pad }), b.textContent);
        };
      });
      box.querySelector('[data-role="rcApply"]').onclick = () => applyCfg(configToMatrix({
        type: 'ConfigControlRecoil', method: box.querySelector('#rcM').value, gunIndex: Number(box.querySelector('#rcG').value) || 0,
      }), '已设置压枪');
    }
    void clearPending;
  }

  /* ------------------------- 其他设置（睡眠时间） ------------------------- */
  const SLEEP_FIELDS = [
    ['time_24', '2.4G 关闭背光时间', '0-1080', 2],
    ['deepTime_24', '2.4G 深度睡眠时间', '0-1080', 28],
    ['time_bt', '蓝牙关闭背光时间', '0-1080', 2],
    ['deepTime_bt', '蓝牙深度睡眠时间', '1-1080', 28],
  ];
  function renderSleep() {
    const g = q('sleepGrid');
    if (!g) return;
    g.innerHTML = SLEEP_FIELDS.map(([key, label, range]) =>
      '<label class="sleep-field"><span class="sl">' + label + '</span>'
      + '<input type="text" inputmode="numeric" data-sleep="' + key + '" placeholder="' + range + '" />'
      + '<span class="su">分钟</span></label>').join('');
  }
  async function readSleep() {
    const d = ctx.device;
    if (!d) return ctx.toast('请先连接设备', 'err');
    try {
      const t = await d.getSleepTime();
      const g = q('sleepGrid');
      g.querySelectorAll('input[data-sleep]').forEach((inp) => {
        inp.value = String(Math.round((t[inp.dataset.sleep] || 0) / 60));
      });
      ctx.toast('睡眠时间读取成功');
    } catch (e) { ctx.toast('读取失败：' + (e.message || e), 'err'); }
  }
  async function writeSleep() {
    const d = ctx.device;
    if (!d) return ctx.toast('请先连接设备', 'err');
    const g = q('sleepGrid');
    const t = {};
    g.querySelectorAll('input[data-sleep]').forEach((inp) => {
      const v = Math.max(0, Math.min(1080, Number(inp.value) || 0));
      t[inp.dataset.sleep] = v * 60;
    });
    try { await d.setSleepTime(t); ctx.toast('睡眠时间已写入设备'); }
    catch (e) { ctx.toast('写入失败：' + (e.message || e), 'err'); }
  }

  /* --------------------------- 高级键（SnapKey） --------------------------- */
  function renderSnap() {
    const s1 = q('snap1'), s2 = q('snap2');
    if (!s1 || !s2) return;
    const nm = (s) => (s === null ? '未选择按键' : (BY_IDX[s.idx] ? BY_IDX[s.idx].label : '位置 ' + s.idx));
    s1.textContent = nm(state.snap[0]);
    s2.textContent = nm(state.snap[1]);
  }
  function applySnap() {
    if (!state.snap[0] || !state.snap[1]) return ctx.toast('请先在键盘上点两个按键', 'err');
    const [a, b] = state.snap;
    state.dirty.set(kkey(state.layer, a.idx), configToMatrix({ type: 'ConfigSnap', number: 1, keyCode: b.hid }));
    state.dirty.set(kkey(state.layer, b.idx), configToMatrix({ type: 'ConfigSnap', number: 1, keyCode: a.hid }));
    ctx.toast('已绑定 SnapKey：' + (BY_IDX[a.idx] || {}).label + ' ↔ ' + (BY_IDX[b.idx] || {}).label + '（点「写入设备」保存）');
    render();
  }

  /* ------------------------------ 组装 ------------------------------ */
  function render() {
    reportDirty();
    renderCanvas();
    renderEditor();
    paintHint();
  }

  function bind() {
    const ls = q('layerSel');
    if (ls && !ls.options.length) {
      for (let i = 0; i < state.maxLayer; i++) {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = (isFn ? 'Fn板载 ' : '板载 ') + (i + 1);
        ls.appendChild(o);
      }
    }
    if (ls) ls.onchange = async () => {
      // 换板载 = 直接读这一档（不再需要单独点"读取"）；有未写入改动先问一下
      const next = Number(ls.value);
      if (next !== state.layer && ctx.confirmDiscard && !ctx.confirmDiscard('切换板载')) {
        ls.value = String(state.layer);
        return;
      }
      state.layer = Number(ls.value);
      state.sel = null;
      state.combo = []; state.comboKey = null; state.pending = null;
      render();
      if (ctx.device) await doRead({ keepProfile: true });
    };
    const fs = q('fnSysSel');
    if (fs) fs.onchange = () => { state.fnSys = fs.value; state.sel = null; render(); };
    const r = q('btnRead'); if (r) r.onclick = doRead;
    const s = q('btnScan'); if (s) s.onclick = doScan;
    const w = q('btnWrite'); if (w) w.onclick = doWrite;
    const rk = q('btnResetKey');
    if (rk) rk.onclick = () => { if (state.sel !== null) applyCfg(factoryOf(state.sel), '已恢复按键'); };
    const sp = q('btnSetProfile');
    if (sp) sp.onclick = async () => {
      const d = ctx.device;
      if (!d) return ctx.toast('请先连接设备', 'err');
      const want = state.layer;
      try {
        await d.setCurrentProfile(want);
        await new Promise((r) => setTimeout(r, 300));
        const back = await d.getCurrentProfile();          // 回读确认
        if (typeof back === 'number') state.devProfile = back;
        const now = typeof back === 'number' ? '板载 ' + (back + 1) : '未知';
        if (back === want) {
          ctx.toast('已把键盘切到「板载 ' + (want + 1) + '」（设备回读：' + now + '）');
          klog('切换板载 -> ' + now);
        } else {
          ctx.toast('已发送切换命令，但设备回读为 ' + now + '，请再试一次或检查键盘', 'err');
        }
        render();
      } catch (e) {
        ctx.toast('切换板载失败：' + (e.message || e), 'err');
      }
    };
    const sr = q('btnSleepRead'); if (sr) sr.onclick = readSleep;
    const sw = q('btnSleepWrite'); if (sw) sw.onclick = writeSleep;
    const sa = q('btnSnapApply'); if (sa) sa.onclick = applySnap;
    window.addEventListener('resize', fitStage);
  }

  renderSleep();
  bind();
  render();
  renderSnap();

  const api = {
    root,
    onShow() {
      fitStage(); render(); renderSnap();
      // 进入页面时：还没读过就自动读一次（会先对齐设备当前板载）
      if (!state.loaded && ctx.device && !state.autoReading) {
        state.autoReading = true;
        doRead().finally(() => { state.autoReading = false; });
      }
    },
    /** 供 app.js 在"连上设备后"自动读取用（会先对齐设备当前板载） */
    async autoRead() { await doRead(); },
    /** 顶部「读取设备配置」按钮用：读当前板载这一档 */
    async readConfig() { await doRead(); },
    onDeviceChange() {
      state.loaded = false; state.dirty.clear(); state.layers = {}; state.fnLayers = {}; state.sel = null;
      reportDirty();
      render();
    },
  };
  return api;
}
