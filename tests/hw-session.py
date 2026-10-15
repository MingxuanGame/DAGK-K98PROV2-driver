#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
hw-session.py — 真机会话测试（带系统通知）

特点:
  * 每做一步都记录结果；一旦接收器掉线/超时，**用系统通知告诉你"请拔插接收器"**，
    然后自动轮询等待设备重新出现，出现后继续把没测完的项目测完。
  * 严格使用原厂 10ms 时序 + 完整握手 (F7 -> F6 -> 命令 -> 等 isCanRead -> FC -> GET)。
  * 默认只做**读**操作，不会写坏你的配置；加 --write 才做可逆写入。

用法:
  python3 tests/hw-session.py              # 只读会话
  python3 tests/hw-session.py --notify     # 掉线时发系统通知（需要本地服务器在跑）
  python3 tests/hw-session.py --write      # 追加可逆写入（灯效原值写回）

通知走的是本地开发服务器的 /api/notify（-> notify-send）。
"""
import fcntl, os, time, glob, struct, sys, json, subprocess, urllib.request

SERVER = 'http://127.0.0.1:8177'
NOTIFY = '--notify' in sys.argv
DO_WRITE = '--write' in sys.argv
INTERVAL = 0.010          # 原厂 INTERVAL_24G_TIME

def notify(title, body, urgency='normal'):
    print('  [通知] %s | %s' % (title, body), flush=True)
    if not NOTIFY: return
    try:
        req = urllib.request.Request(SERVER + '/api/notify',
            data=json.dumps({'title': title, 'body': body, 'urgency': urgency}).encode(),
            headers={'Content-Type': 'application/json'})
        urllib.request.urlopen(req, timeout=5).read()
    except Exception as e:
        print('  [通知失败]', e, flush=True)

def IOC(d, nr, n): return (d << 30) | (n << 16) | (0x48 << 8) | nr
SET = lambda n: IOC(3, 0x06, n)
GET = lambda n: IOC(3, 0x07, n)
SIZE = 65

def hx(b, n=None):
    b = bytes(b) if n is None else bytes(b[:n])
    return ' '.join('%02X' % x for x in b)

def ck7(f):
    f = bytearray(f) + bytearray(max(0, 9 - len(f)))
    f[7] = (0xFF - (sum(f[:7]) & 0xFF)) & 0xFF
    return bytes(f)

def find_dongle():
    for h in sorted(glob.glob('/sys/class/hidraw/hidraw*')):
        dev = os.path.basename(os.path.realpath(os.path.join(h, 'device')))
        if '3151:5006' not in dev.upper(): continue
        try:
            rd = open(os.path.join(h, 'device', 'report_descriptor'), 'rb').read()
        except Exception:
            continue
        if b'\x06\xff\xff\x09\x02' in rd:
            return '/dev/' + os.path.basename(h)
    return None

def wait_replug(timeout=600):
    """等用户拔插：先等设备消失，再等它回来"""
    notify('K98 PRO V2：请拔插接收器',
           '接收器没有响应了。请把 2.4G 接收器拔下来再插上，脚本会自动继续。', 'critical')
    t0 = time.time()
    while time.time() - t0 < timeout:
        if find_dongle() is None:
            break
        time.sleep(1)
    while time.time() - t0 < timeout:
        n = find_dongle()
        if n:
            time.sleep(2.5)      # 给它时间稳定 + 键盘重建链路
            print('  设备已回来: %s' % n, flush=True)
            notify('K98 PRO V2：接收器已恢复', '继续测试。', 'normal')
            return n
        time.sleep(1)
    return None

class Dongle:
    def __init__(self, node):
        self.fd = os.open(node, os.O_RDWR)
        self.cur = None
    def _set(self, frame):
        time.sleep(INTERVAL)
        buf = bytearray(SIZE)
        buf[1:65] = (bytearray(frame) + bytearray(64 - len(frame)))[:64]
        fcntl.ioctl(self.fd, SET(SIZE), buf, False)
    def _get(self):
        time.sleep(INTERVAL)
        buf = bytearray(SIZE)
        fcntl.ioctl(self.fd, GET(SIZE), buf, True)
        return bytes(buf[1:SIZE])
    def status(self):
        self._set(ck7([0xF7]))
        r = self._get()
        return {'isCanRead': r[0] == 1, 'kbBat': r[1], 'msBat': r[2],
                'kbOnline': r[3] == 0, 'msOnline': r[4] == 0, 'isCanSend': r[5] == 1,
                'target': r[6], 'raw': r}
    def select(self):
        if self.cur == 'kb': return
        self._set(ck7([0xF6, 0x0A])); self.cur = 'kb'
    def transact(self, frame, wait_tries=3):
        st = self.status()
        if not st['kbOnline']: raise RuntimeError('键盘不在线')
        if not st['isCanSend']: raise RuntimeError('键盘端不可发送')
        self.select()
        self._set(ck7(frame))
        for i in range(wait_tries):
            time.sleep(0.15)
            if self.status()['isCanRead']:
                self._set(ck7([0xFC]))
                return self._get()
        raise RuntimeError('键盘没有应答')
    def close(self):
        try: os.close(self.fd)
        except Exception: pass

RESULTS = []
def rec(name, ok, detail=''):
    RESULTS.append((name, ok, detail))
    print(('  \u2713 ' if ok else '  \u2717 ') + name + (('   <' + str(detail) + '>' if detail else '')), flush=True)

def main():
    node = find_dongle()
    if not node:
        print('没找到接收器 (3151:5006)'); notify('K98 PRO V2', '找不到接收器，请插上 2.4G 接收器。', 'normal'); return 1
    print('接收器: %s' % node, flush=True)
    notify('K98 PRO V2：开始真机测试', '接收器已找到，开始只读测试。', 'low')

    d = Dongle(node)
    try:
        print('\n=== 1. F7 链路状态 ===', flush=True)
        # 首次读取也可能超时 —— 也走"通知 + 等拔插"的流程
        st = None
        for attempt in range(3):
            try:
                st = d.status()
                break
            except OSError as e:
                rec('F7 第 %d 次尝试' % (attempt + 1), False, e)
                d.close()
                n2 = wait_replug()
                if not n2:
                    return 1
                d = Dongle(n2)
        if st is None:
            return 1
        print('   ', hx(st['raw'], 12), flush=True)
        print('    键盘电量=%d%% 在线=%s 可发送=%s 目标=%d' % (st['kbBat'], st['kbOnline'], st['isCanSend'], st['target']), flush=True)
        rec('F7 链路状态可读', st['target'] in (1, 2, 3), 'target=%d' % st['target'])
        rec('键盘在线', st['kbOnline'])
        if not st['kbOnline']:
            notify('K98 PRO V2：键盘不在线', '请把键盘开关拨到 2.4G 并按一下键唤醒。', 'normal')

        print('\n=== 2. 经接收器读设备信息 (0x8F) ===', flush=True)
        r = d.transact([0x8F])
        did = struct.unpack_from('<I', r, 1)[0]
        print('    应答 %s  -> 设备ID=%d' % (hx(r, 12), did), flush=True)
        rec('经 2.4G 读到设备ID = 3780', r[0] == 0x8F and did == 3780, 'id=%d echo=0x%02X' % (did, r[0]))

        print('\n=== 3. 经接收器读主灯效 (0x87) ===', flush=True)
        r = d.transact([0x87])
        print('    效果=%d 亮度=%d rgb=(%d,%d,%d)' % (r[1], r[3], r[5], r[6], r[7]), flush=True)
        rec('经 2.4G 读主灯效', r[0] == 0x87, 'echo=0x%02X' % r[0])

        print('\n=== 4. 逐页读按键矩阵 (0x8A) ===', flush=True)
        pages_ok = 0
        for page in range(8):
            try:
                r = d.transact([0x8A, 0x00, 0xFF, page, 0x00])
                ok = r[0] == 0x8A
                pages_ok += 1 if ok else 0
                print('    页%d: %s' % (page, hx(r, 8)), flush=True)
                if page == 0:
                    rec('页0 位置0 = Esc [0,0,0x29,0]', list(r[0:4]) == [0, 0, 0x29, 0], list(r[0:4]))
            except Exception as e:
                rec('页%d 读取' % page, False, e)
                print('  第 %d 页失败 -> 请求拔插' % page, flush=True)
                d.close()
                n2 = wait_replug()
                if not n2: return 1
                d = Dongle(n2)
                break
            time.sleep(0.12)
        rec('8 页全部读取成功', pages_ok == 8, '%d/8' % pages_ok)

        if DO_WRITE:
            print('\n=== 5. 可逆写入 (灯效原值写回) ===', flush=True)
            before = d.transact([0x87])
            f = bytearray(64); f[0] = 0x07; f[1:8] = before[1:8]
            d._set(ck7(f) if False else ck7(f))
            time.sleep(0.3)
            after = d.transact([0x87])
            rec('灯效原值写回后读数不变', list(before[1:8]) == list(after[1:8]),
                '%s -> %s' % (list(before[1:8]), list(after[1:8])))
    except Exception as e:
        rec('会话中断', False, e)
        notify('K98 PRO V2：测试中断', '接收器无响应，请拔插接收器。', 'critical')
        return 1
    finally:
        try: d.close()
        except Exception: pass

    ok = sum(1 for _, o, _ in RESULTS if o)
    print('\n通过 %d / 失败 %d' % (ok, len(RESULTS) - ok), flush=True)
    notify('K98 PRO V2：真机测试结束',
           '通过 %d / 失败 %d' % (ok, len(RESULTS) - ok), 'normal')
    return 0 if ok == len(RESULTS) else 1

sys.exit(main())
