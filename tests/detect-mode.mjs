/*
 * detect-mode.mjs — 看看当前机器上插着哪种 DAGK 设备（有线键盘 / 2.4G 接收器）
 * 用于"只有对应模式连着才跑对应用例"的条件判断。
 *   有线  K98PRO        3151:5002
 *   2.4G  接收器        3151:5006
 * 想强制用假设备跑（不看真机）：环境变量 FORCE=1
 */
import { readdirSync, readFileSync, realpathSync } from 'node:fs';

function usbIds(hidrawPath) {
  // /sys/class/hidraw/hidrawN/device -> 往上找到带 idVendor 的那层
  let p = realpathSync(hidrawPath + '/device');
  for (let i = 0; i < 8 && p !== '/'; i++) {
    try {
      const vid = readFileSync(p + '/idVendor', 'utf8').trim();
      const pid = readFileSync(p + '/idProduct', 'utf8').trim();
      return { vid, pid };
    } catch (e) { p = p.replace(/\/[^/]+$/, '') || '/'; }
  }
  return null;
}

export function detectModes() {
  const out = { wired: [], dongle: [] };
  if (process.env.K98_NO_DEVICE === '1') return out;   // 用来验证"没插设备时跳过"的分支
  let nodes = [];
  try { nodes = readdirSync('/sys/class/hidraw'); } catch (e) { return out; }
  for (const n of nodes) {
    let ids;
    try { ids = usbIds('/sys/class/hidraw/' + n); } catch (e) { continue; }
    if (!ids || ids.vid !== '3151') continue;
    if (ids.pid === '5002') out.wired.push('/dev/' + n);
    if (ids.pid === '5006') out.dongle.push('/dev/' + n);
  }
  return out;
}

/** 未连接时的统一提示（返回 true 表示应该跳过） */
export function skipIfMissing(mode, forceEnv = 'FORCE') {
  const modes = detectModes();
  const forced = process.env[forceEnv] === '1';
  const present = mode === 'wired' ? modes.wired.length > 0 : modes.dongle.length > 0;
  if (present || forced) return false;
  const what = mode === 'wired' ? '有线键盘 (3151:5002)' : '2.4G 接收器 (3151:5006)';
  console.log('  ⏭ 跳过：当前没有连接 ' + what + '。');
  console.log('     ' + (mode === 'wired' ? '插上 USB 数据线' : '插上接收器并把键盘拨到 2.4G') + '后再跑；');
  console.log('     只想用假设备跑一遍：' + forceEnv + '=1 重跑。');
  return true;
}
