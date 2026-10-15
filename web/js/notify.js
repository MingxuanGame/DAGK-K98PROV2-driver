/*
 * notify.js — 设备掉线提醒
 *
 * 三条通道，按可用性依次尝试：
 *   1. 页面顶部常驻横幅（永远可用）—— 明确写出"请拔插接收器"，并带一个"我已重新插好"按钮
 *   2. 系统桌面通知（通过本地开发服务器的 /api/notify -> notify-send）
 *   3. 浏览器通知（Notification API，需要用户授权）
 *
 * 设计要点：同一次掉线只提醒一次（去重），避免刷屏。
 */
const $ = (id) => document.getElementById(id);

export class Notifier {
  constructor() {
    this.bridgeAvailable = false;   // 本地服务器的 /api/notify 是否可用
    this.browserNotify = false;     // 浏览器通知是否已授权
    this.lost = false;              // 当前是否处于掉线状态
    this.onRetry = null;            // 用户点"我已重新插好"时的回调
    this.lastReason = '';
    this.count = 0;
  }

  async init() {
    // 探测通知桥（部署到 Vercel 时不存在，静默忽略）
    try {
      const r = await fetch('/api/ping', { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        this.bridgeAvailable = !!j.notify;
      }
    } catch (e) { /* 没有桥，正常 */ }

    // 浏览器通知权限
    try {
      if (typeof Notification !== 'undefined') {
        if (Notification.permission === 'granted') this.browserNotify = true;
        else if (Notification.permission === 'default') {
          const p = await Notification.requestPermission();
          this.browserNotify = p === 'granted';
        }
      }
    } catch (e) { /* ignore */ }

    const banner = $('lostBanner');
    if (banner) {
      $('lostRetry').onclick = async () => {
        this.lost = false;
        banner.classList.add('hidden');
        if (this.onRetry) await this.onRetry();
      };
    }
    return { bridge: this.bridgeAvailable, browser: this.browserNotify };
  }

  /** 统一的系统通知出口 */
  async systemNotify(title, body, urgency = 'critical') {
    let ok = false;
    if (this.bridgeAvailable) {
      try {
        const r = await fetch('/api/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, body, urgency }),
        });
        ok = r.ok;
      } catch (e) { /* ignore */ }
    }
    if (!ok && this.browserNotify) {
      try { new Notification(title, { body, tag: 'k98-device' }); ok = true; } catch (e) { /* ignore */ }
    }
    return ok;
  }

  /**
   * 设备掉线 / 需要拔插。
   * @param {string} reason 给用户看的原因
   * @param {{silent?:boolean}} opts
   */
  async deviceLost(reason, opts = {}) {
    this.count++;
    this.lastReason = reason;
    const banner = $('lostBanner');
    if (banner) {
      $('lostReason').textContent = reason;
      banner.classList.remove('hidden');
    }
    if (this.lost) return;          // 去重：同一次掉线只提醒一次
    this.lost = true;
    if (!opts.silent) {
      await this.systemNotify(
        'K98 PRO V2：需要重新插拔接收器',
        reason + '\n→ 请把 2.4G 接收器拔下来再插上，然后点页面上的「我已重新插好」。',
        'critical',
      );
    }
  }

  /** 恢复正常 */
  deviceOk() {
    this.lost = false;
    const banner = $('lostBanner');
    if (banner) banner.classList.add('hidden');
  }
}
