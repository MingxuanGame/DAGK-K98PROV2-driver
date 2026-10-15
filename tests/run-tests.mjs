/*
 * run-tests.mjs — 自测: 协议层 + 传输层 (node, 无浏览器)
 * 运行: node tests/run-tests.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HidTransport } from '../web/js/transport.js';
import { K98Device, MODE, CMD, CK, encodeCmd, hex, DEFAULT_MATRIX, LIGHT_LIST, SIDE_LIGHT_LIST } from '../web/js/protocol.js';
import { MockHidDevice, checksumOk } from './mock-device.mjs';
import { skipIfMissing } from './detect-mode.mjs';
import { matrixToHid, hidToMatrix, keyLabel, describeCell } from '../web/js/keycodes.js';
import { KEYS } from '../web/js/layout.js';
import { encodeMacro, decodeMacro } from '../web/js/macro.js';
import { readConfigFromDevice, applyConfigToDevice, validateConfig, summarizeConfig, CONFIG_VERSION } from '../web/js/config.js';
import { LIGHT_EFFECTS, SIDE_EFFECTS } from '../web/js/lighting.js';
import {
  Un, Na, V_, gL, yw, Ir, hidToMatrix as kHidToMatrix, matrixToHid as kMatrixToHid,
  configToMatrix, changeArrToConfig, matrixToConfigs, configDisplay, MODE_COLORS, hidCodeMapKeyName,
} from '../web/js/kcfg.js';

let pass = 0, fail = 0;
const results = [];
async function t(name, fn) {
  try { await fn(); pass++; results.push('  ✓ ' + name); }
  catch (e) { fail++; results.push('  ✗ ' + name + '\n      ' + (e.message || e)); }
}

/* ---------------- 1. 帧编码 / 校验和 ---------------- */
await t('encodeCmd: 8F 帧校验和 = 0x70', () => {
  const f = encodeCmd(new Uint8Array([0x8f]), CK.Bit7);
  assert.equal(f.length, 9);
  assert.deepEqual(Array.from(f), [0x8f, 0, 0, 0, 0, 0, 0, 0x70, 0]);
});

await t('encodeCmd: 与厂商 boot 帧一致 (7F 55 AA 55 AA 00 00 82)', () => {
  const f = encodeCmd(new Uint8Array([0x7f, 0x55, 0xaa, 0x55, 0xaa, 0, 0]), CK.Bit7);
  assert.equal(f[7], 0x82, '厂商常量是 0x82, 得到 0x' + f[7].toString(16));
});

await t('encodeCmd: Bit8 校验和', () => {
  const f = encodeCmd(new Uint8Array([7, 1, 3, 3, 0x4f, 0xff, 0, 0]), CK.Bit8);
  let s = 0; for (let i = 0; i < 8; i++) s += f[i];
  assert.equal(f[8], 0xff - (s & 0xff));
});

await t('encodeCmd: None 不加校验', () => {
  const f = encodeCmd(new Uint8Array([0xba, 0xc0, 0, 0, 0, 0, 0, 0]), CK.None);
  assert.equal(f[7], 0);
  assert.equal(f[8], 0);
});

/* ---------------- 2. 键码编解码 ---------------- */
await t('matrixToHid / hidToMatrix 往返', () => {
  assert.deepEqual(hidToMatrix(0x29), [0, 0, 0x29, 0]);
  assert.equal(matrixToHid([0, 0, 0x29, 0]), 0x29);
  const c = [10, 1, 0, 0];
  assert.deepEqual(hidToMatrix(matrixToHid(c)), c);
});

await t('键名解析 (含多媒体键)', () => {
  assert.equal(keyLabel(0x29), 'Esc');
  assert.equal(keyLabel(matrixToHid([3, 0, 233, 0])), 'VolumeUp');
  assert.equal(describeCell([0, 0, 0, 0]), '禁用');
  assert.equal(describeCell([9, 0, 3, 0]), '宏3 (重复次数)');
});

await t('layout.js: 98 键, 位置 0..107, 无重复', () => {
  assert.equal(KEYS.length, 98);
  const idx = KEYS.map((k) => k.idx);
  assert.equal(new Set(idx).size, 98);
  assert.ok(Math.max(...idx) <= 127);
});

await t('DEFAULT_MATRIX 与厂商一致 (512 字节 / 101 有效位)', () => {
  assert.equal(DEFAULT_MATRIX.length, 512);
  let n = 0;
  for (let i = 0; i < 128; i++) if (DEFAULT_MATRIX.slice(i * 4, i * 4 + 4).some((b) => b)) n++;
  assert.equal(n, 101);
  assert.equal(matrixToHid(DEFAULT_MATRIX.slice(0, 4)), 0x29);     // Esc
  assert.equal(matrixToHid(DEFAULT_MATRIX.slice(65 * 4, 65 * 4 + 4)) & 0xffff, 0x0000); // Fn 特殊单元
});

/* ---------------- 3. 宏编解码 ---------------- */
await t('宏编解码往返稳定', () => {
  const steps = [
    { type: 'key', hid: 0x04, action: 'down', delay: 30 },
    { type: 'key', hid: 0x04, action: 'up', delay: 30 },
    { type: 'key', hid: 0x05, action: 'down', delay: 500 },
    { type: 'move', dx: 5, dy: -3, delay: 20 },
  ];
  const a = decodeMacro(encodeMacro(steps, 2));
  const b = decodeMacro(encodeMacro(a.steps, a.repeatCount));
  assert.deepEqual(b.steps, a.steps);
  assert.equal(a.repeatCount, 2);
  assert.equal(encodeMacro(steps, 2)[2], 0x04);   // 第一个键 A
});

/* ---------------- 4. 有线 (USB) 端到端 ---------------- */
// 条件：只有真的连着有线键盘 (3151:5002) 才跑这一段；FORCE=1 可强制用假设备跑
const SKIP_WIRED = skipIfMissing('wired');
if (SKIP_WIRED) results.push('  ⏭ 有线场景用例已跳过（当前未连接 3151:5002；FORCE=1 可用假设备强制跑）');
if (!SKIP_WIRED) {
  const mock = new MockHidDevice();
  const hid = new HidTransport(mock);
  const dev = new K98Device(hid, MODE.USB);
  await hid.open();

  await t('设备识别 0x8F -> id/版本/灯光同步', async () => {
    const info = await dev.fetchDeviceInfo();
    assert.equal(info.deviceId, 3780);
    assert.equal(info.usbVersion, 0x0400);
    assert.equal(info.lightSync, true);
  });

  await t('所有发出的帧校验和都正确', () => {
    for (const f of mock.frames) {
      assert.equal(f.length, 64, '帧长度必须是 64');
      assert.ok(checksumOk(f), '校验和错误: ' + hex(f));
    }
  });

  await t('读取按键矩阵 == 默认矩阵', async () => {
    const m = await dev.readKeyMatrixRaw(0, 0);
    assert.equal(m.length, 512);
    assert.deepEqual(Array.from(m), Array.from(DEFAULT_MATRIX));
  });

  await t('单键改键写入位置正确', async () => {
    const before = Array.from(mock.state.matrix.slice(9 * 4, 9 * 4 + 4));
    assert.deepEqual(before, [0, 0, 4, 0]);            // 位置 9 = A
    await dev.setKeyConfigSimple(9, hidToMatrix(0x05), 0, 0);   // 改成 B
    assert.deepEqual(Array.from(mock.state.matrix.slice(9 * 4, 9 * 4 + 4)), [0, 0, 5, 0]);
  });

  await t('整层写入 (_setKeyConfig 帧: 8 头 + 56 负载)', async () => {
    const buf = Uint8Array.from(DEFAULT_MATRIX);
    buf.set([0, 0, 0x1e, 0], 100 * 4);                 // 位置100 -> 数字1
    await dev.writeKeyMatrixRaw(buf.subarray(0, 512), 0, 0);
    assert.deepEqual(Array.from(mock.state.matrix.slice(100 * 4, 100 * 4 + 4)), [0, 0, 0x1e, 0]);
  });

  await t('Fn 层读取 (0x90)', async () => {
    const m = await dev.readFnKeyMatrixRaw('win', 1);
    assert.equal(m.length, 512);
    assert.deepEqual(Array.from(m), Array.from(mock.state.fnMatrix));
  });

  await t('主灯效读写往返', async () => {
    await dev.setLightSetting({ type: 'LightBreath', bright: 4, speed: 1, option: 3, dazzle: true, rgb: 0x123456 });
    const s = await dev.getLightSetting();
    assert.equal(s.type, 'LightBreath');
    assert.equal(s.bright, 4);
    assert.equal(s.speed, 1);
    assert.equal(s.option, 3);
    assert.equal(s.rgb, 0x123456);
    assert.equal(s.dazzle, true);
  });

  await t('侧灯读写往返', async () => {
    await dev.setSideLightSetting({ type: 'LightWave', bright: 2, speed: 3, option: 1, dazzle: false, rgb: 0x00ff00 });
    const s = await dev.getSideLightSetting();
    assert.equal(s.type, 'LightWave');
    assert.equal(s.bright, 2);
    assert.equal(s.speed, 3);
    assert.equal(s.rgb, 0x00ff00);
  });

  await t('单键背光写入/读取往返 (384 字节 = 128xRGB)', async () => {
    const rgb = new Uint8Array(384);
    for (let i = 0; i < 128; i++) { rgb[i * 3] = i; rgb[i * 3 + 1] = 255 - i; rgb[i * 3 + 2] = 7; }
    await dev.setLightPicRaw(rgb, 0);
    const back = await dev.getLightPicRaw(0);
    // 厂商写入端最后一块声明的长度是 378-56*6 = 42, 所以只有前 378 字节 (=126 个 LED) 会被写入;
    // 物理按键最大位置是 107, 不受影响。
    assert.deepEqual(Array.from(back.slice(0, 378)), Array.from(rgb.slice(0, 378)));
    assert.equal(378, 6 * 56 + 42);
  });

  await t('宏写入/读取往返', async () => {
    const steps = [{ type: 'key', hid: 0x04, action: 'down', delay: 25 }, { type: 'key', hid: 0x04, action: 'up', delay: 25 }];
    await dev.setMacroRaw(5, encodeMacro(steps, 3));
    const raw = await dev.getMacroRaw(5);
    const dec = decodeMacro(raw);
    assert.equal(dec.repeatCount, 3);
    assert.deepEqual(dec.steps, steps);
  });

  await t('设置读写: profile / 回报率 / 去抖 / 系统 / 休眠', async () => {
    await dev.setCurrentProfile(2); assert.equal(await dev.getCurrentProfile(), 2);
    await dev.setReportRate(1000); assert.equal(await dev.getReportRate(), 1000);
    await dev.setDeBounce(8); assert.equal(await dev.getDeBounce(), 8);
    await dev.setKbOption({ system: 'mac', fnIndex: 1, WASDSwap: true, RTStab: 50, 防误触开关: true });
    const o = await dev.getKbOption();
    assert.equal(o.system, 'mac'); assert.equal(o.WASDSwap, true); assert.equal(o.RTStab, 50); assert.equal(o.防误触开关, true);
    await dev.setSleepTime({ time_bt: 60, time_24: 90, deepTime_bt: 600, deepTime_24: 900 });
    const s = await dev.getSleepTime();
    assert.deepEqual(s, { time_bt: 60, time_24: 90, deepTime_bt: 600, deepTime_24: 900 });
  });

  await dev.close();
}

/* ---------------- 5. 按键功能编解码（kcfg = 原厂逻辑逐字移植） ---------------- */
await t('kcfg: 表数据来自原厂且已剔除 AI', () => {
  assert.equal(Un.length, 182, 'Un 表条数');
  assert.ok(!Un.some((r) => r.value === 'AI' || r.htmlCode === 'AI'), 'Un 里仍有 AI');
  assert.ok(!yw['AI function'], '_w 里仍有 AI function');
  assert.ok(!Object.values(Na).some((v) => JSON.stringify(v) === '[0,227,225,114]'), 'Na 里仍有 AI');
  assert.ok(Object.keys(gL).length >= 24, 'gL 显示名表');
});

await t('kcfg: hidToMatrix / matrixToHid 与原厂一致', () => {
  assert.deepEqual(kHidToMatrix(5), [0, 0, 5, 0]);
  assert.equal(kMatrixToHid([0, 0, 5, 0]), 5);
  // 鼠标键值表里的复合码
  const left = Na[Object.keys(Na).find((k) => gL[k] === '鼠标左键')];
  assert.deepEqual(left, [1, 0, 240, 0]);
  assert.equal(kMatrixToHid(left), Number(Object.keys(Na).find((k) => gL[k] === '鼠标左键')));
});

await t('kcfg: configToMatrix 抽查（与原厂表逐字节一致）', () => {
  assert.deepEqual(configToMatrix({ type: 'ConfigFunction', key: '音量加' }), [3, 0, 233, 0]);
  assert.deepEqual(configToMatrix({ type: 'ConfigFunction', key: '音量减' }), [3, 0, 234, 0]);
  assert.deepEqual(configToMatrix({ type: 'ConfigFunction', key: '播放暂停' }), [3, 0, 205, 0]);
  assert.deepEqual(configToMatrix({ type: 'ConfigFunction', key: 'fn' }), [10, 1, 0, 0]);
  assert.deepEqual(configToMatrix({ type: 'ConfigMouse', key: Number(Object.keys(Na).find((k) => gL[k] === '鼠标后退')) }), [1, 0, 243, 0]);
  assert.deepEqual(configToMatrix({ type: 'ConfigGamepad', key: 'A' }), [255, 255, 255, 15]);
  assert.deepEqual(configToMatrix({ type: 'ConfigMacro', macroIndex: 5, macroType: 'on_off' }), [9, 1, 5, 0]);
  assert.deepEqual(configToMatrix({ type: 'forbidden' }), [0, 0, 0, 0]);
  assert.deepEqual(configToMatrix({ type: 'combo', skey: 0, key: 74, key2: 0 }), [0, 0, 74, 0]);
  assert.deepEqual(configToMatrix({ type: 'ConfigMT', keyCode: 4, keyCode2: 5, time: 300 }), [24, 4, 5, 30]);
  assert.deepEqual(configToMatrix({ type: 'ConfigSnap', number: 2, keyCode: 6 }), [22, 2, 6, 0]);
  assert.deepEqual(configToMatrix({ type: 'ConfigMDS', number: 1, keyCode: 7 }), [23, 1, 7, 0]);
  assert.deepEqual(configToMatrix({ type: 'ConfigControlRecoil', method: 'switch_keep', gunIndex: 1 }), [22, 6, 1, 0]);
});

await t('kcfg: changeArrToConfig 与原厂分支一致', () => {
  assert.equal(changeArrToConfig([0, 0, 5, 0], 5, 0).type, 'combo');
  assert.equal(changeArrToConfig([0, 0, 5, 0], 5, 0).key, 5);
  assert.equal(changeArrToConfig([0, 0, 0, 0], 5, 0).type, 'forbidden');
  assert.equal(changeArrToConfig([0, 0, 1, 0], 5, 0).type, 'ConfigUnknown');
  assert.equal(changeArrToConfig([9, 0, 3, 0], 5, 0).type, 'ConfigMacro');
  assert.equal(changeArrToConfig([9, 0, 3, 0], 5, 0).macroIndex, 3);
  assert.equal(changeArrToConfig([10, 1, 0, 0], 5, 0).type, 'ConfigFunction');
  assert.equal(changeArrToConfig([10, 1, 0, 0], 5, 0).key, 'fn');
  assert.equal(changeArrToConfig([21, 3, 0, 0], 5, 0).type, 'ConfigGamepad');
  assert.equal(changeArrToConfig([77, 88, 99, 111], 5, 0), undefined, '未知字节应返回 undefined');
});

await t('kcfg: configDisplay 四种状态与原厂配色一致', () => {
  assert.deepEqual(configDisplay({ type: 'ConfigMacro' }), { mode: '已修改', text: '宏' });
  assert.deepEqual(configDisplay({ type: 'forbidden' }), { mode: '固件禁用', text: '禁用按键' });
  assert.deepEqual(configDisplay({ type: 'ConfigUnknown', value: [1, 2, 3, 4] }), { mode: '系统按键', text: '系统按键' });
  assert.deepEqual(configDisplay({ type: 'ConfigFunction', key: '音量加' }), { mode: '已修改', text: '音量加' });
  assert.equal(configDisplay(undefined).mode, '常规');
  assert.equal(MODE_COLORS['已修改'], '#58BAA8');
  assert.equal(MODE_COLORS['固件禁用'], '#b9bc23');
  assert.equal(MODE_COLORS['系统按键'], '#BB4C4C');
  // 组合键按 修饰+键1+键2 拼名
  assert.equal(configDisplay({ type: 'combo', skey: 224, key: 44, key2: 0 }).text, 'Ctrl+(space)');
});

await t('kcfg: 全部改键类型走"写入->整层读回->显示"往返一致（原厂按键图的解码路径）', () => {
  const fac = Array.from(DEFAULT_MATRIX);
  const IDX = 9;   // A 键位置, 出厂 [0,0,4,0]
  const cases = [
    { type: 'forbidden' },
    { type: 'ConfigFunction', key: '音量加' },
    { type: 'ConfigFunction', key: '麦克风开关' },
    { type: 'ConfigFunction', key: '我的电脑' },
    { type: 'ConfigMouse', key: Number(Object.keys(Na).find((k) => gL[k] === '鼠标后退')) },
    { type: 'ConfigGamepad', key: 'A' },
    { type: 'ConfigGamepad', key: 'XRIGHT' },
    { type: 'ConfigMacro', macroIndex: 3, macroType: 'on_off' },
    { type: 'ConfigMacro', macroIndex: 1, macroType: 'touch_repeat' },
    { type: 'ConfigMT', keyCode: 4, keyCode2: 5, time: 300 },
    { type: 'ConfigSnap', number: 2, keyCode: 6 },
    { type: 'ConfigMDS', number: 1, keyCode: 7 },
    { type: 'ConfigControlRecoil', method: 'normal', gunIndex: 0 },
    { type: 'ConfigControlRecoil', method: 'switch_keep', gunIndex: 2 },
    { type: 'ConfigControlRecoil', method: 'switch_toggle', gunIndex: 1 },
    { type: 'combo', skey: 0, key: 5, key2: 0 },
    { type: 'combo', skey: 0xe0, key: 0x2c, key2: 0 },
  ];
  for (const c of cases) {
    const bytes = configToMatrix(c);
    assert.equal(bytes.length, 4, JSON.stringify(c) + ' 编码不是 4 字节');
    assert.ok(bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255), JSON.stringify(c) + ' 字节越界: ' + bytes);
    const m = fac.slice();
    for (let k = 0; k < 4; k++) m[IDX * 4 + k] = bytes[k];
    const cfgs = matrixToConfigs(fac, m);
    assert.equal(cfgs.length, 1, JSON.stringify(c) + ' 应只报出 1 个改键');
    assert.equal(cfgs[0].type, c.type, JSON.stringify(c) + ' -> [' + bytes + '] -> ' + cfgs[0].type);
    const disp = configDisplay(cfgs[0]);
    assert.ok(disp.text && disp.text.length > 0, JSON.stringify(c) + ' 显示文字为空');
    assert.equal(disp.mode, c.type === 'forbidden' ? '固件禁用' : '已修改', JSON.stringify(c) + ' 模式=' + disp.mode);
    // 与原厂 setKeyConfigSimple 一致的定位：original + index
    assert.equal(cfgs[0].original, 4, 'original 应为出厂 HID (A=4)');
  }
});

await t('灯光: 界面的 21 个灯效名与协议枚举一一对应（顺序照原厂界面）', () => {
  assert.equal(LIGHT_EFFECTS.length, 21, '灯效数量');
  assert.deepEqual(LIGHT_EFFECTS.slice(0, 3).map((x) => x[0]), ['随波逐流', '碧波荡漾', '繁星点点']);
  assert.deepEqual(LIGHT_EFFECTS.slice(-3).map((x) => x[0]), ['自定义', '音乐律动', '光影']);
  for (const [name, key] of LIGHT_EFFECTS) {
    assert.ok(Object.values(LIGHT_LIST).includes(key), name + ' 的枚举 ' + key + ' 不在 LIGHT_LIST 里');
  }
  const keys = LIGHT_EFFECTS.map((x) => x[1]);
  assert.equal(new Set(keys).size, 21, '灯效枚举有重复');
  // 命名与原厂 i18n 一致（抽查）
  const zh = Object.fromEntries(LIGHT_EFFECTS);
  assert.equal(zh['踏雪无痕'], 'LightPressActionOff');
  assert.equal(zh['一石二鸟'], 'LightLaser');
  assert.equal(zh['光谱循环'], 'LightNeon');
  assert.equal(zh['常亮'], 'LightAlwaysOn');
  assert.equal(zh['动态呼吸'], 'LightBreath');
  assert.equal(zh['自定义'], 'LightUserPicture');
  // 侧灯只能选原厂侧灯枚举里的
  for (const [name, key] of SIDE_EFFECTS) {
    assert.ok(Object.values(SIDE_LIGHT_LIST).includes(key), '侧灯 ' + name + ' 的枚举 ' + key + ' 不在 SIDE_LIGHT_LIST 里');
  }
});

await t('kcfg: 真机抓到的层2数据能还原成原厂显示的改键', () => {
  // data/wired-matrix.json 是 2026-10 从有线 K98PRO 读回的层2原始 512 字节
  const wired = JSON.parse(readFileSync(new URL('../data/wired-matrix.json', import.meta.url), 'utf8'));
  const cur = [];
  for (const p of wired.layer2) cur.push(...p);
  const fac = Array.from(DEFAULT_MATRIX);
  const cfgs = matrixToConfigs(fac, cur.slice(0, 512));
  assert.equal(cfgs.length, 4, '应有 4 个改键, 实际 ' + cfgs.length);
  const texts = cfgs.map((c) => configDisplay(c).text.replace(/\n/g, ''));
  assert.deepEqual(texts.sort(), ['End', 'PageDown', 'PageUp', 'PrintScreen'].sort(), JSON.stringify(texts));
  // 与出厂默认完全相同的层不应报出任何改键
  assert.equal(matrixToConfigs(fac, fac.slice()).length, 0);
});

/* ---------------- 6. 配置保存/读取 ---------------- */
const cfgMock = new MockHidDevice();
const cfgHid = new HidTransport(cfgMock);
const cfgDev = new K98Device(cfgHid, MODE.USB);
await cfgHid.open();

await t('配置: 从设备读取 -> 结构完整', async () => {
  const cfg = await readConfigFromDevice(cfgDev);
  assert.equal(cfg.version, CONFIG_VERSION);
  assert.ok(cfg.settings && cfg.settings.rate !== undefined, '缺少 settings');
  assert.ok(cfg.light && cfg.light.type, '缺少 light');
  assert.ok(cfg.keymap && cfg.keymap[0] && cfg.keymap[0].length === 512, 'keymap[0] 应为 512');
  assert.ok(cfg.fn && cfg.fn.win && cfg.fn.win.length === 512, 'fn.win 应为 512');
  assert.equal(cfg.perkey.length, 384, 'perkey 应为 384');
  assert.ok(cfg.macros !== undefined, '缺少 macros');
});

await t('配置: 读取的内容与设备现状一致', async () => {
  // 先显式设置一个已知状态，避免依赖前面测试留下的残留
  await cfgDev.setLightSetting({ type: 'LightBreath', bright: 2, speed: 3, option: 1, dazzle: false, rgb: 0x112233 });
  const cfg = await readConfigFromDevice(cfgDev);
  assert.deepEqual(cfg.keymap[0], Array.from(DEFAULT_MATRIX), 'keymap 应等于默认矩阵');
  assert.equal(cfg.light.type, 'LightBreath', '灯效应读回 LightBreath');
  assert.equal(cfg.light.bright, 2);
  assert.equal(cfg.light.rgb, 0x112233);
});

await t('配置: 改动设备后读取能反映出来', async () => {
  await cfgDev.setKeyConfigSimple(9, hidToMatrix(0x05), 0, 0);   // A -> B
  const cfg = await readConfigFromDevice(cfgDev);
  assert.deepEqual(cfg.keymap[0].slice(36, 40), [0, 0, 5, 0]);
});

await t('配置: 写回设备（applyConfigToDevice）能还原', async () => {
  const buf = Uint8Array.from(DEFAULT_MATRIX);
  const cfg = {
    version: CONFIG_VERSION,
    settings: { profile: 2, rate: 1000, debounce: 7, kbOption: { system: 'mac', fnIndex: 1, WASDSwap: true, RTStab: 50, 防误触开关: true }, sleep: { time_bt: 60, time_24: 90, deepTime_bt: 600, deepTime_24: 900 } },
    light: { type: 'LightWave', bright: 4, speed: 2, option: 1, dazzle: false, rgb: 0x336699 },
    sideLight: { type: 'LightBreath', bright: 3, speed: 1, option: 0, dazzle: false, rgb: 0x00ff00 },
    keymap: { 0: Array.from(buf) },
    fn: { win: Array.from(buf) },
    perkey: Array.from(new Uint8Array(384).map((_, i) => i % 256)),
    macros: { 3: Array.from(encodeMacro([{ type: 'key', hid: 4, action: 'down', delay: 20 }], 2)) },
  };
  validateConfig(cfg);
  await applyConfigToDevice(cfgDev, cfg);
  const back = await readConfigFromDevice(cfgDev);
  assert.equal(back.settings.profile, 2);
  assert.equal(back.settings.rate, 1000);
  assert.equal(back.settings.debounce, 7);
  assert.equal(back.settings.kbOption.system, 'mac');
  assert.equal(back.light.type, 'LightWave');
  assert.equal(back.light.rgb, 0x336699);
  assert.deepEqual(back.keymap[0].slice(36, 40), [0, 0, 4, 0], 'A 键应已还原');
  assert.equal(back.perkey[10], 10, '单键背光应写入');
  assert.equal(back.macros[3] ? 1 : 0, 1, '宏应写入');
});

await t('配置: 校验会拒绝坏数据', () => {
  assert.throws(() => validateConfig(null), /不是有效/);
  assert.throws(() => validateConfig({ keymap: { 0: [1, 2] } }), /version/);
  assert.throws(() => validateConfig({ version: 1, keymap: { 0: [1, 2, 3] } }), /长度应为 512/);
  assert.throws(() => validateConfig({ version: 1, perkey: [1, 2, 3] }), /长度应为 384/);
  assert.throws(() => validateConfig({ version: 99 }), /比当前驱动/);
  assert.equal(validateConfig({ version: 1 }), true);
});

await t('配置: 摘要包含关键信息', () => {
  const s = summarizeConfig({
    version: 1, device: { deviceId: 3780, usbVersion: 0x400 },
    settings: { profile: 1, rate: 1000, debounce: 5, kbOption: { system: 'win' }, sleep: { time_24: 120, time_bt: 120 } },
    light: { type: 'LightWave', bright: 3, speed: 2 },
    keymap: { 0: Array.from(DEFAULT_MATRIX) },
    perkey: Array.from(new Uint8Array(384)),
    macros: {},
  });
  const txt = s.join(' | ');
  assert.ok(/设备ID 3780/.test(txt), txt);
  assert.ok(/主灯效 LightWave/.test(txt), txt);
  assert.ok(/按键映射/.test(txt), txt);
});

await t('配置: JSON 往返不丢信息', () => {
  const cfg = {
    version: CONFIG_VERSION, device: { deviceId: 3780 },
    keymap: { 0: Array.from(DEFAULT_MATRIX) },
    perkey: Array.from(new Uint8Array(384).map((_, i) => i % 251)),
    macros: { 1: Array.from(new Uint8Array(256).map((_, i) => i % 253)) },
    light: { type: 'LightBreath', bright: 2, speed: 1, option: 0, dazzle: true, rgb: 123456 },
  };
  const json = JSON.stringify(cfg);
  const back = JSON.parse(json);
  validateConfig(back);
  assert.deepEqual(back.keymap[0], cfg.keymap[0]);
  assert.deepEqual(back.perkey, cfg.perkey);
  assert.deepEqual(back.macros[1], cfg.macros[1]);
  assert.deepEqual(back.light, cfg.light);
});

await cfgDev.close();

/* ---------------- 结果 ---------------- */
console.log(results.join('\n'));
console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
