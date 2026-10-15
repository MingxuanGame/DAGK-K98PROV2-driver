/* kcfg.js —— 原厂按键配置模型（逐字移植自 app/resources/app/dist/js/index.630fe4af.js）
 *
 * 这一层保证「页面读出来的按键 = 原厂驱动显示的按键」：
 *   hidToMatrix / matrixToHid / matrixToConfigs / configToMatrix / changeArrToConfig
 *   configDisplay  == 原厂 cN()：模式（常规/已修改/固件禁用/系统按键）+ 文字 + 颜色
 *   findIndexInDefaultMatrix / configsToMatrix == 原厂 setKeyConfigSimple 的定位与整层写入
 * 表数据在 kcfg-tables.js（也由原厂 bundle 生成）。
 * 按需求已剔除 AI 相关条目。
 */
import { Ie, Un, Na, gL, V_, _w, fL } from './kcfg-tables.js';

export { Ie, Un, Na, gL, V_, _w, fL };

export const yw = Object.assign({}, _w);
export const kL = Object.values(yw);
export const hw = Object.assign({}, _w, fL);
export const bL = Object.values(hw);
export const H1 = (e) => (e ? bL : kL);
export const j_ = (e) => (e ? hw : yw);

/* ---------------------------- 原厂工具函数 ---------------------------- */

/** 原厂 S3（lodash isEqual 等价物）；矩阵比较全靠它 */
export function Ir(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!Ir(a[k], b[k])) return false;
  }
  return true;
}

/** 原厂 ws：按值找键名 */
export const ws = (tbl, t) => Object.keys(tbl).find((k) => Ir(tbl[k], t));

/** 原厂 Jk：按值找数字键（鼠标表专用） */
export const Jk = (tbl, t) => {
  const i = Object.keys(tbl).find((k) => Ir(tbl[Number(k)], t));
  return i === undefined ? undefined : Number(i);
};

/** 原厂 hL：32 位码拆 4 字节 */
export const hL = (e) => (e > 4294967295
  ? [0, 0, 0, 0]
  : [(e & 4294967295) >> 24, (e & 16777215) >> 16, (e & 65535) >> 8, e & 255]);

/* ---------------------------- 编解码 ---------------------------- */

export const hidToMatrix = (t) => {
  if (t <= 255) return [0, 0, t, 0];
  return [(t >> 24) & 255, (t >> 16) & 255, (t >> 8) & 255, t & 255];
};

export const matrixToHid = (t) => {
  if (t[0] === 0 && t[1] === 0 && t[3] === 0) return t[2];
  const r = Number(ws(Na, t));
  return isNaN(r) ? ((t[0] << 24) | (t[1] << 16) | (t[2] << 8) | t[3]) : r;
};

/**
 * 原厂 matrixToConfigs 的单格版本（按键图上"这一格是什么"就用它）。
 *
 * @param {number[]} t 出厂默认矩阵（512 字节扁平数组）
 * @param {number[]} l 这一格的当前 4 字节
 * @param {number} o 该格在矩阵里的字节偏移（用于算出"第几个同键值的键"= index）
 * @returns {object|undefined} 与出厂一致时返回 undefined
 */
export function cellConfig(t, l, o) {
  const s = t.slice(o, o + 4);
  if (Ir(l, s)) return undefined;
  let u = 0;
  for (let y = 0; y < o; y += 4) if (Ir(s, t.slice(y, y + 4))) u++;
  const m = matrixToHid(s);
  if (m === 0) return undefined;
  const n = H1(false), a = j_(false);
  if (Ir(l, [0, 0, 0, 0])) return { type: 'forbidden', original: m, index: u };
  if (l[0] === 9) {
    let y;
    switch (l[1]) { case 0: y = 'repeat_times'; break; case 1: y = 'on_off'; break; case 2: y = 'touch_repeat'; break; default: y = 'repeat_times'; }
    return { type: 'ConfigMacro', original: m, index: u, macro: [], macroType: y, repeatCount: 0, macroIndex: l[2] };
  }
  if (l[0] === 1) return { type: 'ConfigMouse', original: m, key: Jk(Na, l), index: u };
  if (l[0] === 21) {
    const y = ws(V_, [...l]);
    return y === undefined ? undefined : { type: 'ConfigGamepad', original: m, index: u, key: y };
  }
  if (l[0] === 0) return { type: 'combo', original: m, index: u, skey: l[1], key: l[2], key2: l[3] };
  if (n.some((y) => Ir(y, l))) {
    const y = ws(a, [...l]);
    return y === undefined
      ? { type: 'ConfigUnknown', original: m, index: u, value: l }
      : { type: 'ConfigFunction', original: m, index: u, key: y };
  }
  if (l[0] === 11) return { type: 'ConfigFunction', original: m, index: u, key: '火力', value: l };
  if (l[0] === 22 && (l[1] === 4 || l[1] === 6 || l[1] === 7)) {
    const y = l[1] === 4 ? 'normal' : l[1] === 6 ? 'switch_keep' : 'switch_toggle';
    return { type: 'ConfigControlRecoil', original: m, index: u, method: y, bulletCount: 0, bulletValue: [], gunIndex: l[2] };
  }
  if (l[0] === 22) return { type: 'ConfigSnap', original: m, index: u, number: l[1], keyCode: l[2] };
  if (l[0] === 23) return { type: 'ConfigMDS', original: m, index: u, number: l[1], keyCode: l[2] };
  if (l[0] === 24) return { type: 'ConfigMT', original: m, index: u, keyCode: l[1], keyCode2: l[2], time: l[3] * 10 };
  // 原厂只认 l[0]===21 的手柄项，[255,255,255,x] 那些会被显示成"系统按键"。
  // 这里补一次查表，让手柄按键也能正确显示（只影响原厂识别不了的格子，不改原厂已识别的情况）。
  {
    const y = ws(V_, [...l]);
    if (y !== undefined) return { type: 'ConfigGamepad', original: m, index: u, key: y };
  }
  return { type: 'ConfigUnknown', original: m, index: u, value: l };
}

/** 原厂 matrixToConfigs(defaultMatrix, currentMatrix)：把整层 512 字节变成"改键列表" */
export function matrixToConfigs(t, i) {
  const r = [];
  for (let o = 0; o < i.length; o += 4) {
    const c = cellConfig(t, i.slice(o, o + 4), o);
    if (c) r.push(c);
  }
  return r;
}

/** 原厂 configToMatrix(cfg)：把一条改键配置变成 4 字节 */
export function configToMatrix(t) {
  let i = [0, 0, 0, 0];
  const r = j_(false);
  switch (t.type) {
    case 'forbidden': i = [0, 0, 0, 0]; break;
    case 'combo': if (t.key <= 255) i = [0, t.skey, t.key, t.key2]; else i = hL(t.key).slice(); break;
    case 'ConfigMouse': if (Na[t.key] !== undefined) i = Na[t.key].slice(); break;
    case 'ConfigFunction': if (t.value !== undefined) i = t.value.slice(); else i = (r[t.key] || [0, 0, 0, 0]).slice(); break;
    case 'ConfigUnknown': i = t.value.slice(); break;
    case 'ConfigGamepad': if (V_[t.key] !== undefined) i = V_[t.key].slice(); break;
    case 'ConfigMacro': {
      let n;
      switch (t.macroType) { case 'repeat_times': n = 0; break; case 'touch_repeat': n = 2; break; case 'on_off': n = 1; break; default: n = 0; }
      if (t.macroIndex === undefined) throw new Error('写入宏失败');
      i = [9, n, t.macroIndex, 0];
      break;
    }
    case 'ConfigSnap': i = [22, t.number, t.keyCode, 0]; break;
    case 'ConfigMDS': i = [23, t.number, t.keyCode, 0]; break;
    case 'ConfigMT': i = [24, t.keyCode, t.keyCode2, t.time / 10]; break;
    case 'ConfigControlRecoil': i = [22, t.method === 'normal' ? 4 : t.method === 'switch_keep' ? 6 : 7, t.gunIndex, 0]; break;
    default: i = [0, 0, 0, 0]; break;
  }
  return i;
}

/** 原厂 changeArrToConfig(arr, originalHid, index)：把 4 字节还原成配置对象 */
export function changeArrToConfig(t, i, r) {
  let n;
  const a = H1(false), o = j_(false);
  if (Ir(t, [0, 0, 1, 0])) {
    n = { type: 'ConfigUnknown', original: i, value: t, index: r };
  } else if (Ir(t, [0, 0, 0, 0]) || Ir(t, [0, 0, 3, 0])) {
    n = { type: 'forbidden', original: i, index: r };
  } else if (t[0] === 0) {
    if (a.some((l) => Ir(l, t))) {
      const l = ws(o, t.slice());
      n = l === undefined
        ? { type: 'ConfigUnknown', original: i, value: t, index: r }
        : { type: 'ConfigFunction', original: i, key: l, index: r };
    } else {
      n = { type: 'combo', original: i, skey: t[1], key: t[2], key2: t[3], index: r };
    }
  } else if (t[0] === 1) {
    n = { type: 'ConfigMouse', original: i, key: Jk(Na, t), index: r };
  } else if ([3, 6, 8, 10, 13, 14, 18, 19, 2, 22].indexOf(t[0]) !== -1) {
    const l = ws(o, t.slice());
    if (l === undefined || Ir(t, [10, 24, 0, 0])) n = { type: 'ConfigUnknown', original: i, value: t, index: r };
    else n = { type: 'ConfigFunction', original: i, key: l, value: (t[0] === 22 && (t[1] === 6 || t[1] === 7)) ? t : undefined, index: r };
  } else if (t[0] === 9) {
    let l;
    switch (t[1]) { case 0: l = 'repeat_times'; break; case 2: l = 'touch_repeat'; break; case 1: l = 'on_off'; break; default: l = 'repeat_times'; }
    n = { type: 'ConfigMacro', original: i, macro: [], macroType: l, repeatCount: 0, index: r, macroIndex: t[2] };
  } else if (t[0] === 21) {
    const l = ws(V_, t.slice());
    if (l !== undefined) n = { type: 'ConfigGamepad', original: i, key: l, index: r };
  }
  return n;
}

/* ---------------------------- HTML / HID 名称 ---------------------------- */

export const hidCodeMapKeyName = (t) => { const i = Un.find((r) => r.hidCode === t); return i === undefined ? undefined : i.value; };
export const htmlCodeMapHIDCode = (t) => { const i = Un.find((r) => r.htmlCode === t); return i === undefined ? undefined : i.hidCode; };
export const htmlCodeMapKeyName = (t) => { const i = Un.find((r) => r.htmlCode === t); return i === undefined ? undefined : i.value; };
export const keyNameMapHtmlCode = (t) => { const i = Un.find((r) => r.value === t); return i === undefined ? undefined : i.htmlCode; };
export const hidToKeyCode = (t) => { if (t === undefined) return 0; const i = Un.find((r) => r.hidCode === t); return i === undefined ? 0 : Number(i.keyCode); };
export const keyCodeMapHIDCode = (t) => { const i = Un.find((r) => r.keyCode === t); return i === undefined ? undefined : i.hidCode; };
export const scanCodeMapHIDCode = (t) => { if (t === undefined) return undefined; const i = Un.find((r) => r.scanCode === t); return i === undefined ? undefined : i.hidCode; };
export const hidCodeMapHtmlCode = (t, i) => {
  if (i !== undefined) {
    const n = Un.find((a) => a.hidCode === t && typeof a.htmlCode === 'string' && a.htmlCode.endsWith(i.toString()));
    if (n) return n.htmlCode;
  }
  const r = Un.find((n) => n.hidCode === t);
  return r === undefined ? undefined : r.htmlCode;
};

/* ---------------------------- 原厂显示逻辑 cN() ---------------------------- */

export const MODE_COLORS = { '常规': '#3e3e3e', '已修改': '#58BAA8', '固件禁用': '#b9bc23', '系统按键': '#BB4C4C' };

/** 原厂 cN(config, 行程设置, snapInfo)：返回按键图上显示的模式与文字 */
export function configDisplay(t) {
  if (t !== undefined) {
    if (t.type === 'ConfigMacro') return { mode: '已修改', text: '宏' };
    if (t.type === 'forbidden') return { mode: '固件禁用', text: '禁用按键' };
    if (t.type === 'combo') {
      const n = [], a = hidCodeMapKeyName(t.skey);
      if (a !== undefined) n.push(a);
      const o = hidCodeMapKeyName(t.key);
      if (o !== undefined) n.push(o);
      const l = hidCodeMapKeyName(t.key2);
      if (l !== undefined) n.push(l);
      return { mode: '已修改', text: n.join('+') };
    }
    if (t.type === 'ConfigMouse') return { mode: '已修改', text: gL[t.key] };
    if (t.type === 'ConfigFunction') return { mode: '已修改', text: t.key };
    if (t.type === 'ConfigUnknown') return { mode: '系统按键', text: '系统按键' };
    if (t.type === 'ConfigControlRecoil') return { mode: '已修改', text: (t.method === 'normal' ? '压枪' : t.method === 'switch_keep' ? '开关压枪-持续' : '开关压枪-切换') + '_枪械' + (t.gunIndex + 1) };
    if (t.type === 'ConfigGamepad') return { mode: '已修改', text: '手柄:' + t.key };
    if (t.type === 'ConfigSnap') return { mode: '已修改', text: 'SnapKey:' + hidCodeMapKeyName(t.keyCode) };
    if (t.type === 'ConfigMDS') return { mode: '已修改', text: 'MDS:' + hidCodeMapKeyName(t.keyCode) };
    if (t.type === 'ConfigMT') return { mode: '已修改', text: 'MT' };
  }
  return { mode: '常规', text: '' };
}

/* ---------------------------- 矩阵定位 / 整层写入 ---------------------------- */

/** 原厂 findIndexInDefaultMatrix(originalHid, index)：按出厂矩阵找第 index 个同键值的位置 */
export function findIndexInDefaultMatrix(defaultMatrix, t, e) {
  if (t === 50449664) t = 50384128;
  const n = hidToMatrix(t);
  let i = 0;
  for (let s = 0; s < defaultMatrix.length; s += 4) {
    if (Ir(n, defaultMatrix.slice(s, s + 4))) {
      if ((e || 0) === i) return s / 4;
      i++;
    }
  }
  return undefined;
}

/** 出厂矩阵 + 改键列表 => 整层 512 字节（等价于原厂 _configsToMatrix） */
export function configsToMatrix(defaultMatrix, configs) {
  const e = defaultMatrix.slice();
  for (const c of configs) {
    const arr = configToMatrix(c);
    if (arr === undefined) continue;
    const idx = findIndexInDefaultMatrix(defaultMatrix, c.original, c.index);
    if (idx === undefined || idx > 127) continue;
    e[idx * 4] = arr[0]; e[idx * 4 + 1] = arr[1]; e[idx * 4 + 2] = arr[2]; e[idx * 4 + 3] = arr[3];
  }
  return e;
}

/** 整层 512 字节 => 改键列表（原厂 getKeyConfig 的结果） */
export function matrixToConfigList(defaultMatrix, currentMatrix) {
  return matrixToConfigs(defaultMatrix, Array.from(currentMatrix));
}
