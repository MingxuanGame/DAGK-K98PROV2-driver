/*
 * rf-tests.mjs — 2.4G 接收器转发相关自测（**不在 npm test 里跑**，需要时单独跑）
 * 运行: node tests/rf-tests.mjs   或   npm run test:rf
 */
import assert from 'node:assert/strict';
import { HidTransport } from '../web/js/transport.js';
import { K98Device, MODE, CMD } from '../web/js/protocol.js';
import { MockHidDevice, MockDongleDevice, checksumOk } from './mock-device.mjs';
import { skipIfMissing } from './detect-mode.mjs';

// 条件：只有真的连着 2.4G 接收器才跑（FORCE=1 可强制用假设备跑）
if (skipIfMissing('dongle')) process.exit(0);

let pass = 0, fail = 0;
const results = [];
async function t(name, fn) {
  try { await fn(); pass++; results.push('  ✓ ' + name); }
  catch (e) { fail++; results.push('  ✗ ' + name + '\n      ' + (e.message || e)); }
}

/* ---------------- 2.4G 接收器转发 ---------------- */
const kb = new MockHidDevice();
const dongle = new MockDongleDevice({ keyboard: kb });
const dhid = new HidTransport(dongle);
const rdev = new K98Device(dhid, MODE.RF24G);
await dhid.open();

await t('2.4G: 状态轮询解码 (电量/在线/可收发)', async () => {
  const st = await rdev.relay.pollStatus();
  assert.equal(st.keyboard.isOnline, true);
  assert.equal(st.keyboard.battery, 77);
  assert.equal(st.keyboard.isCanSend, true);
  assert.equal(st.keyboard.isCanRead, true);
});

await t('2.4G: 通过接收器读设备信息', async () => {
  const info = await rdev.fetchDeviceInfo();
  assert.equal(info.deviceId, 3780);
});

await t('2.4G: 命令被逐字节转发给键盘', async () => {
  const before = dongle.forwarded.length;
  await rdev.getLightSetting();
  assert.ok(dongle.forwarded.length > before, '接收器应转发命令');
  const f = dongle.forwarded[dongle.forwarded.length - 1];
  assert.equal(f[0], CMD.GET_LEDPARAM);
  assert.ok(checksumOk(f), '转发帧校验和必须正确');
});

await t('2.4G: 经接收器读按键矩阵 (0x8A 全 8 页) 数据正确', async () => {
  const m = await rdev.readKeyMatrixRaw(0, 0);
  assert.equal(m.length, 512);
  assert.deepEqual(Array.from(m.slice(0, 4)), [0, 0, 0x29, 0], '位置0 应为 Esc');
  assert.deepEqual(Array.from(m.slice(36, 40)), [0, 0, 0x04, 0], '位置9 应为 A');
  assert.deepEqual(Array.from(m.slice(65 * 4, 65 * 4 + 4)), [10, 1, 0, 0], '位置65 应为 Fn');
});

await t('2.4G: 读矩阵不会把 F7 状态帧当成键盘应答', async () => {
  // 真实踩过的坑: 接收器本地控制帧(F7/F6/FC)不得覆盖键盘应答缓存，
  // 否则 FC 之后读回的是 F7 的状态帧。第 0 页首字节若为 1 就说明串味了。
  const m = await rdev.readKeyMatrixRaw(0, 0);
  assert.notEqual(m[0], 1, '第0页返回的像是 F7 状态帧 (首字节=1)');
  assert.equal(m[0], 0);
});

await t('2.4G: 某一页失败时立即中止, 不再把剩下几页打完', async () => {
  const kb2 = new MockHidDevice();
  const dg2 = new MockDongleDevice({ keyboard: kb2 });
  const fail = { at: 3, armed: true };
  const orig = kb2._handle.bind(kb2);
  kb2._handle = (d) => {
    if (fail.armed && d[0] === 0x8a && d[3] === fail.at) { fail.armed = false; throw new Error('模拟第 3 页无响应'); }
    orig(d);
  };
  const h2 = new HidTransport(dg2);
  const dev2 = new K98Device(h2, MODE.RF24G);
  await h2.open();
  const pagesSeen = [];
  const origHandle2 = dg2._handle.bind(dg2);
  dg2._handle = (d) => { if (d[0] === 0x8a) pagesSeen.push(d[3]); return origHandle2(d); };
  let threw = false;
  try { await dev2.readKeyMatrixRaw(0, 0); } catch (e) { threw = true; }
  assert.ok(threw, '第 3 页失败后应当抛错');
  assert.ok(!pagesSeen.includes(4), '失败后不应再请求第 4 页 (实际请求了 ' + pagesSeen.join(',') + ')');
  assert.ok(!pagesSeen.includes(7), '失败后不应再请求第 7 页');
  assert.ok(pagesSeen.length <= 4, '最多只该请求到失败那一页, 实际 ' + pagesSeen.length + ' 页');
  await dev2.close();
});

await t('2.4G: 一页只做 1 次预检 (不是发送前/读取前各轮询一次)', async () => {
  const kb3 = new MockHidDevice();
  const dg3 = new MockDongleDevice({ keyboard: kb3 });
  const h3 = new HidTransport(dg3);
  const dev3 = new K98Device(h3, MODE.RF24G);
  await h3.open();
  await dev3.readKeyMatrixRaw(0, 0, { only: 0 });
  const f7 = dg3.dongleFrames.filter((f) => f[0] === 0xf7).length;
  assert.ok(f7 <= 2, '1 页最多 2 次 F7 预检, 实际 ' + f7);
  const fc = dg3.dongleFrames.filter((f) => f[0] === 0xfc).length;
  assert.equal(fc, 1, '每页只该有 1 次 FC, 实际 ' + fc);
  await dev3.close();
});

await t('2.4G: sendMsg/readMsg 不会意外启动后台轮询', async () => {
  rdev.relay.stopPolling();
  await rdev.getDeBounce();
  assert.equal(rdev.relay.isPolling, false, '一次读写之后不应处于轮询状态');
});

await t('2.4G: 转发序列含 F7 轮询 / F6 选目标 / FC 读通知', () => {
  const cmds = dongle.dongleFrames.map((f) => f[0]);
  assert.ok(cmds.includes(0xf7), '缺少 F7 状态轮询');
  assert.ok(cmds.includes(0xf6), '缺少 F6 选目标');
  assert.ok(cmds.includes(0xfc), '缺少 FC 读通知');
  const sel = dongle.dongleFrames.find((f) => f[0] === 0xf6);
  assert.equal(sel[1], 10, '键盘目标码应为 10');
});

await t('2.4G: isCanRead 一直为 0 时，只要回包正确就照收（真机踩坑，2026-10-15）', async () => {
  const kb4 = new MockHidDevice();
  const dg4 = new MockDongleDevice({ keyboard: kb4 });
  dg4.noCanRead = true;                       // 模拟接收器不回 isCanRead=1
  const h4 = new HidTransport(dg4);
  const dev4 = new K98Device(h4, MODE.RF24G);
  await h4.open();
  const st = await dev4.relay.pollStatus();
  assert.equal(st.keyboard.isCanRead, false, '假设备应报告 isCanRead=0');
  const s = await dev4.getDeBounce();         // 仍应拿到正确回包
  assert.ok(s !== undefined, 'isCanRead=0 时也应读到数据');
  await dev4.close();
});

await t('2.4G: 有线帧与无线帧内容一致 (同一 64 字节报文)', async () => {
  const wiredMock = new MockHidDevice();
  const wiredHid = new HidTransport(wiredMock);
  const wiredDev = new K98Device(wiredHid, MODE.USB);
  await wiredHid.open();
  await wiredDev.getDeBounce();
  const wf = wiredMock.frames.find((f) => f[0] === CMD.GET_DEBOUNCE);
  await rdev.getDeBounce();
  const rf = dongle.forwarded.find((f) => f[0] === CMD.GET_DEBOUNCE);
  assert.ok(wf, '有线侧缺少 0x86 帧');
  assert.ok(rf, '无线侧缺少 0x86 帧');
  assert.deepEqual(Array.from(rf), Array.from(wf));
  await wiredDev.close();
});

await rdev.close();

console.log('=== 2.4G 接收器转发自测 ===');
console.log(results.join('\n'));
console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
