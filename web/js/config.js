/*
 * config.js — 配置的保存 / 读取（本地）
 *
 * 一份配置包含：
 *   settings  设备设置（配置档 / 回报率 / 去抖 / 系统 / WASD / 睡眠时间）
 *   light     主灯效
 *   sideLight 侧灯效
 *   keymap    按键映射（普通层 0..N，各 512 字节）
 *   fn         Fn 层（win/mac/ios/android，各 512 字节）
 *   perkey    单键背光（384 字节 RGB）
 *   macros    宏（槽位 -> 256 字节）
 *
 * 存储位置有三处，互不干扰：
 *   1. 浏览器 localStorage —— 多个命名槽位，随时"保存/读取"
 *   2. 导出成 .json 文件 —— 可以备份/分享/换机器
 *   3. 设备本体 —— "从设备读取" / "应用到设备"
 */
import { DEFAULT_MATRIX } from './protocol.js';
import { encodeMacro, decodeMacro } from './macro.js';

export const CONFIG_VERSION = 1;
const LS_PREFIX = 'k98pro.config.';
const LS_INDEX = 'k98pro.config.index';

/* ------------------------------------------------------------------ */
/* 从设备读取                                                          */
/* ------------------------------------------------------------------ */

/**
 * 读取设备上的全部配置。
 * @param {object} dev K98Device
 * @param {(step:string, done:number, total:number)=>void} onProgress
 */
export async function readConfigFromDevice(dev, onProgress = () => {}) {
  const steps = ['settings', 'light', 'sideLight', 'keymap', 'fn', 'perkey', 'macros'];
  let done = 0;
  const tick = (s) => onProgress(s, ++done, steps.length);

  const cfg = {
    version: CONFIG_VERSION,
    savedAt: new Date().toISOString(),
    device: { deviceId: dev.deviceId, usbVersion: dev.usbVersion, rfVersion: dev.rfVersion },
  };

  // 原厂启动时还会读这几个版本/开关（0x80 RF版本、0x97 自动识别系统、0xAD OLED、0xAE 矩阵灯）。
  // 本机没有 OLED，读回来是 0；读失败不影响整体配置读取。
  try {
    cfg.device.rfVersion = await dev.getRfVersion();
    cfg.device.autoOs = await dev.getAutoOs();
    cfg.device.oledVersion = await dev.getOledVersion();
    cfg.device.mLedVersion = await dev.getMLedVersion();
  } catch (e) { /* 版本读取失败不阻塞 */ }

  // 设置
  cfg.settings = {
    profile: await dev.getCurrentProfile(),
    rate: await dev.getReportRate(),
    debounce: await dev.getDeBounce(),
    kbOption: await dev.getKbOption(),
    sleep: await dev.getSleepTime(),
  };
  tick('settings');

  cfg.light = await dev.getLightSetting();
  tick('light');
  cfg.sideLight = await dev.getSideLightSetting();
  tick('sideLight');

  // 按键映射：K98PRO 有 3 个可配置层（原厂 deviceType.layer = 3），全部读回来。
  // 只在某一层改过键时，其它层读出来仍是出厂默认 —— 所以必须逐层读，不能只读 0 层。
  cfg.keymap = {};
  for (const layer of [0, 1, 2]) {
    const m = await dev.readKeyMatrixRaw(layer, 0);
    cfg.keymap[layer] = Array.from(m);
    onProgress('keymap 层 ' + layer, ++done, steps.length);
  }
  tick('keymap');

  cfg.fn = {};
  for (const sys of ['win', 'mac']) {
    const m = await dev.readFnKeyMatrixRaw(sys, 0);
    cfg.fn[sys] = Array.from(m);
  }
  tick('fn');

  cfg.perkey = Array.from(await dev.getLightPicRaw(0));
  tick('perkey');

  cfg.macros = {};
  for (let i = 0; i < 8; i++) {
    const raw = await dev.getMacroRaw(i);
    if (raw && raw.some((b) => b !== 0)) cfg.macros[i] = Array.from(raw.slice(0, 256));
    if (i >= 0 && raw === undefined) break;   // 设备不支持则不再往下问
  }
  tick('macros');

  return cfg;
}

/* ------------------------------------------------------------------ */
/* 写入设备                                                            */
/* ------------------------------------------------------------------ */

/**
 * 把配置写到设备上。逐项写入，任何一步失败都会立刻抛出（并带上出错项）。
 * @param {object} dev
 * @param {object} cfg
 * @param {(step:string, done:number, total:number)=>void} onProgress
 */
export async function applyConfigToDevice(dev, cfg, onProgress = () => {}) {
  const steps = [];
  if (cfg.settings) steps.push('settings');
  if (cfg.light) steps.push('light');
  if (cfg.sideLight) steps.push('sideLight');
  if (cfg.keymap) steps.push('keymap');
  if (cfg.fn) steps.push('fn');
  if (cfg.perkey) steps.push('perkey');
  if (cfg.macros && Object.keys(cfg.macros).length) steps.push('macros');
  let done = 0;
  const fail = (step, e) => { const err = new Error(`写入「${step}」失败: ${e && e.message ? e.message : e}`); err.step = step; throw err; };
  const tick = (s) => onProgress(s, ++done, steps.length);

  for (const step of steps) {
    try {
      if (step === 'settings') {
        const s = cfg.settings;
        if (s.profile !== undefined) await dev.setCurrentProfile(s.profile);
        if (s.rate !== undefined) await dev.setReportRate(s.rate);
        if (s.debounce !== undefined) await dev.setDeBounce(s.debounce);
        if (s.kbOption) await dev.setKbOption(s.kbOption);
        if (s.sleep) await dev.setSleepTime(s.sleep);
      } else if (step === 'light') {
        await dev.setLightSetting(cfg.light);
      } else if (step === 'sideLight') {
        await dev.setSideLightSetting(cfg.sideLight);
      } else if (step === 'keymap') {
        for (const [layer, arr] of Object.entries(cfg.keymap)) {
          await dev.writeKeyMatrixRaw(Uint8Array.from(arr), Number(layer), 0);
        }
      } else if (step === 'fn') {
        for (const [sys, arr] of Object.entries(cfg.fn)) {
          await dev.writeFnKeyMatrixRaw(Uint8Array.from(arr), 0, sys);
        }
      } else if (step === 'perkey') {
        await dev.setLightPicRaw(Uint8Array.from(cfg.perkey), 0);
      } else if (step === 'macros') {
        for (const [slot, arr] of Object.entries(cfg.macros)) {
          await dev.setMacroRaw(Number(slot), Uint8Array.from(arr));
        }
      }
      tick(step);
    } catch (e) { fail(step, e); }
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* 浏览器本地存储                                                      */
/* ------------------------------------------------------------------ */

export function listLocalConfigs() {
  try { return JSON.parse(localStorage.getItem(LS_INDEX) || '[]'); } catch (e) { return []; }
}

function writeIndex(names) {
  localStorage.setItem(LS_INDEX, JSON.stringify(names));
}

export function saveLocalConfig(name, cfg) {
  const key = LS_PREFIX + name;
  const payload = { ...cfg, name, savedAt: new Date().toISOString() };
  localStorage.setItem(key, JSON.stringify(payload));
  const names = listLocalConfigs();
  if (!names.includes(name)) { names.push(name); writeIndex(names); }
  return payload;
}

export function loadLocalConfig(name) {
  const raw = localStorage.getItem(LS_PREFIX + name);
  if (!raw) return undefined;
  return JSON.parse(raw);
}

export function deleteLocalConfig(name) {
  localStorage.removeItem(LS_PREFIX + name);
  writeIndex(listLocalConfigs().filter((n) => n !== name));
}

/* ------------------------------------------------------------------ */
/* 文件导入导出                                                        */
/* ------------------------------------------------------------------ */

export function configToBlob(cfg) {
  const text = JSON.stringify(cfg, null, 2);
  return new Blob([text], { type: 'application/json' });
}

export function downloadConfig(cfg, filename) {
  const name = filename || `k98pro-${(cfg.device && cfg.device.deviceId) || 'config'}-${new Date().toISOString().slice(0, 10)}.json`;
  const url = URL.createObjectURL(configToBlob(cfg));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return name;
}

/** 校验一个从文件读进来的配置对象 */
export function validateConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') throw new Error('不是有效的配置对象');
  if (cfg.version === undefined) throw new Error('缺少 version 字段，可能不是本驱动的配置文件');
  if (cfg.version > CONFIG_VERSION) throw new Error(`配置版本 ${cfg.version} 比当前驱动(${CONFIG_VERSION})更新，请升级页面`);
  const need512 = (a) => Array.isArray(a) && a.length === 512;
  if (cfg.keymap) for (const [k, v] of Object.entries(cfg.keymap)) if (!need512(v)) throw new Error(`keymap[${k}] 长度应为 512，实际 ${v && v.length}`);
  if (cfg.fn) for (const [k, v] of Object.entries(cfg.fn)) if (!need512(v)) throw new Error(`fn[${k}] 长度应为 512，实际 ${v && v.length}`);
  if (cfg.perkey && (!Array.isArray(cfg.perkey) || cfg.perkey.length !== 384)) throw new Error(`perkey 长度应为 384，实际 ${cfg.perkey && cfg.perkey.length}`);
  if (cfg.macros) for (const [k, v] of Object.entries(cfg.macros)) if (!Array.isArray(v) || v.length !== 256) throw new Error(`macros[${k}] 长度应为 256`);
  return true;
}

/** 生成一个人类可读的摘要（给界面显示） */
export function summarizeConfig(cfg) {
  const l = [];
  if (cfg.device) l.push(`设备ID ${cfg.device.deviceId ?? '?'} · USB 0x${(cfg.device.usbVersion ?? 0).toString(16)}`);
  if (cfg.settings) {
    const s = cfg.settings;
    l.push(`配置档 ${s.profile ?? '-'} · 回报率 ${s.rate ?? '-'}Hz · 去抖 ${s.debounce ?? '-'}ms`);
    if (s.kbOption) l.push(`系统 ${s.kbOption.system ?? '-'}${s.kbOption.WASDSwap ? ' · WASD互换' : ''}`);
    if (s.sleep) l.push(`睡眠 2.4G ${s.sleep.time_24}s / 蓝牙 ${s.sleep.time_bt}s`);
  }
  if (cfg.light) l.push(`主灯效 ${cfg.light.type ?? '-'}（亮度 ${cfg.light.bright ?? '-'} 速度 ${cfg.light.speed ?? '-'}）`);
  if (cfg.sideLight) l.push(`侧灯 ${cfg.sideLight.type ?? '-'}`);
  if (cfg.keymap) { const n = Object.values(cfg.keymap).reduce((a, m) => a + countChanged(m), 0); l.push(`按键映射：${n} 个键与出厂不同`); }
  if (cfg.fn) l.push(`Fn 层：${Object.keys(cfg.fn).join(', ')}`);
  if (cfg.perkey) { const lit = countLit(cfg.perkey); l.push(`单键背光：${lit} 个键有颜色`); }
  if (cfg.macros) l.push(`宏：${Object.keys(cfg.macros).length} 个槽位`);
  if (cfg.savedAt) l.push(`保存于 ${new Date(cfg.savedAt).toLocaleString('zh-CN')}`);
  return l;
}

function countChanged(arr) {
  let n = 0;
  for (let i = 0; i < 128; i++) {
    const a = arr.slice(i * 4, i * 4 + 4);
    const b = Array.from(DEFAULT_MATRIX.slice(i * 4, i * 4 + 4));
    if (a.join(',') !== b.join(',')) n++;
  }
  return n;
}

function countLit(pic) {
  let n = 0;
  for (let i = 0; i < 128; i++) {
    if (pic[i * 3] || pic[i * 3 + 1] || pic[i * 3 + 2]) n++;
  }
  return n;
}
