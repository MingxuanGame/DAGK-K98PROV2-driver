#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
dongle-test.py — 在真实 2.4G 接收器 (3151:5006) 上验证完整的转发握手

严格按原厂 class wB 的顺序:
    F7 轮询(等 isCanSend) -> [F6 目标码] -> sleep 10ms -> SET_FEATURE(命令)
    -> F7 轮询(等 isCanRead) -> [FC] -> sleep 10ms -> GET_FEATURE(应答)

坑位记录:
  * HIDIOCSFEATURE = 0x06 (发送) / HIDIOCGFEATURE = 0x07 (读取), 不能混用。
  * 无 Report ID 的设备, usbhid 会做 buf++/count--, ioctl 长度要用 65。
  * 若跳过 F6/FC 直接发命令, 接收器会 stall (后续 EPIPE)。
    恢复方法(不用拔插): 
      echo -n "6-1.1:1.2" | sudo tee /sys/bus/usb/drivers/usbhid/unbind
      sleep 1.5
      echo -n "6-1.1:1.2" | sudo tee /sys/bus/usb/drivers/usbhid/bind
"""
import fcntl, os, time, glob, struct, sys, subprocess

def IOC(d, nr, n): return (d << 30) | (n << 16) | (0x48 << 8) | nr
SET = lambda n: IOC(3, 0x06, n)
GET = lambda n: IOC(3, 0x07, n)
SIZE = 65                      # 64 字节报文 + usbhid 的 report-number 占位

def hx(b, n=None):
    b = bytes(b) if n is None else bytes(b[:n])
    return ' '.join('%02X' % x for x in b)

def ck7(frame):
    f = bytearray(frame) + bytearray(max(0, 9 - len(frame)))
    f[7] = (0xFF - (sum(f[:7]) & 0xFF)) & 0xFF
    return bytes(f)

def ck8(frame):
    f = bytearray(frame) + bytearray(max(0, 9 - len(frame)))
    f[8] = (0xFF - (sum(f[:8]) & 0xFF)) & 0xFF
    return bytes(f)

def find_dongle():
    for h in sorted(glob.glob('/sys/class/hidraw/hidraw*')):
        dev = os.path.basename(os.path.realpath(os.path.join(h, 'device')))
        if '3151:5006' not in dev.upper(): continue
        rd = open(os.path.join(h, 'device', 'report_descriptor'), 'rb').read()
        if b'\x06\xff\xff\x09\x02' in rd:
            iface = os.path.basename(os.path.dirname(os.path.realpath(os.path.join(h, 'device'))))
            return '/dev/' + os.path.basename(h), iface
    return None, None

def recover(iface='6-1.1:1.2'):
    """接口级重挂, 无需拔插"""
    for op in ('unbind', 'bind'):
        subprocess.run(['sudo', 'tee', '/sys/bus/usb/drivers/usbhid/' + op], input=iface.encode(),
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(1.5)

class Dongle:
    def __init__(self, node): self.fd = os.open(node, os.O_RDWR); self.cur_target = None
    def set_feature(self, frame):
        buf = bytearray(SIZE); buf[1:65] = (bytearray(frame) + bytearray(64 - len(frame)))[:64]
        fcntl.ioctl(self.fd, SET(SIZE), buf, False)
    def get_feature(self):
        buf = bytearray(SIZE); fcntl.ioctl(self.fd, GET(SIZE), buf, True)
        return bytes(buf[1:SIZE])
    def poll(self):
        """F7 状态轮询"""
        self.set_feature(ck7([0xF7])); time.sleep(0.02)
        r = self.get_feature()
        return {'isCanRead': r[0] == 1, 'kbBattery': r[1], 'msBattery': r[2],
                'kbOnline': r[3] == 0, 'msOnline': r[4] == 0, 'isCanSend': r[5] == 1,
                'target': r[6], 'isRFBoot': r[8] == 1, 'raw': r}
    def select(self, name):
        """F6 选目标 (keyboard=10, mouse=5, both=13)"""
        if self.cur_target == name: return True
        code = {'keyboard': 10, 'mouse': 5, 'both': 13}[name]
        time.sleep(0.01)
        self.set_feature(ck7([0xF6, code]))
        self.cur_target = name
        return True
    def wait_can_send(self, tries=5):
        for _ in range(tries):
            time.sleep(0.1)
            if self.poll()['isCanSend']:
                self.select('keyboard')
                return True
        return False
    def wait_can_read(self, tries=5):
        for _ in range(tries):
            time.sleep(0.1)
            if self.poll()['isCanRead']:
                time.sleep(0.01); self.set_feature(ck7([0xFC]))
                return True
        return False
    def command(self, frame, kind='bit7', tries=8):
        """一次完整的 命令->应答 往返"""
        if not self.wait_can_send(): raise RuntimeError('接收器报告 键盘不可发送 (isCanSend=0)')
        time.sleep(0.01)
        self.set_feature(ck7(frame) if kind == 'bit7' else ck8(frame) if kind == 'bit8' else bytes(frame))
        for _ in range(tries):
            time.sleep(0.1)
            st = self.poll()
            if st['isCanRead']:
                time.sleep(0.01); self.set_feature(ck7([0xFC])); time.sleep(0.01)
                return self.get_feature()
        return None
    def close(self): os.close(self.fd)

PASS, FAIL = [], []
def check(name, cond, extra=''):
    (PASS if cond else FAIL).append(name)
    print(('  \u2713 ' if cond else '  \u2717 ') + name + (('   <' + str(extra) + '>') if (extra and not cond) else ''))

def main():
    node, iface = find_dongle()
    if not node:
        print('没找到 2.4G 接收器 (3151:5006) 的厂商接口'); return 1
    print('接收器厂商接口: %s  (%s)' % (node, iface))
    d = Dongle(node)
    try:
        print('\n=== 1. F7 链路状态 ===')
        st = d.poll()
        print('  原始: %s' % hx(st['raw'], 12))
        print('  键盘: 电量=%d%% 在线=%s | 鼠标: 电量=%d%% 在线=%s' % (
            st['kbBattery'], st['kbOnline'], st['msBattery'], st['msOnline']))
        print('  可发送=%s 可读取=%s 目标=%s isRFBoot=%s' % (
            st['isCanSend'], st['isCanRead'], {1:'键盘',2:'鼠标',3:'键鼠'}.get(st['target'],'?'), st['isRFBoot']))
        check('接收器响应 F7', st['target'] in (1, 2, 3), st['target'])
        check('键盘在线 (2.4G)', st['kbOnline'] if st['target'] in (1, 3) else True, 'kbOnline=%s' % st['kbOnline'])

        if not (st['kbOnline'] and st['target'] in (1, 3)):
            print('\n  键盘不在线, 无法继续转发测试。请把键盘开关拨到 2.4G 并按一下键唤醒。')
            return 1 if FAIL else 0

        print('\n=== 2. 经接收器读设备信息 (0x8F) — 完整握手 ===')
        r = d.command([0x8F])
        if r is None:
            check('经 2.4G 读 0x8F', False, '无应答(键盘可能睡着了)')
        else:
            dev_id = struct.unpack_from('<I', r, 1)[0]
            usb_ver = struct.unpack_from('<H', r, 7)[0]
            print('  应答: %s' % hx(r, 16))
            check('回显 0x8F', r[0] == 0x8F, hex(r[0]))
            check('经 2.4G 读到 K98PRO 设备ID = 3780', dev_id == 3780, dev_id)
            print('  USB 版本 = 0x%04X  lightSync=%d' % (usb_ver, r[11]))

        print('\n=== 3. 经接收器读灯效 / 按键矩阵 ===')
        r = d.command([0x87])
        if r is not None:
            check('经 2.4G 读主灯效 (0x87)', r[0] == 0x87, hex(r[0]))
            print('  效果=%d 速度=%d 亮度=%d option=0x%02X rgb=(%d,%d,%d)' % (r[1], r[2], r[3], r[4], r[5], r[6], r[7]))
        else:
            check('经 2.4G 读主灯效 (0x87)', False, '无应答')

        r = d.command([0x8A, 0x00, 0xFF, 0x00, 0x00])
        if r is not None:
            check('经 2.4G 读按键矩阵第0页 (0x8A)', r[0] == 0x8A, hex(r[0]))
            print('  页0 前12字节: %s' % hx(r, 12))
            print('  位置0(Esc) = %s' % list(r[0:4]))
            check('矩阵位置0 == Esc [0,0,0x29,0]', list(r[0:4]) == [0, 0, 0x29, 0], list(r[0:4]))
        else:
            check('经 2.4G 读按键矩阵第0页 (0x8A)', False, '无应答')

        print('\n=== 4. 链路状态复查 (确认没有把接收器搞挂) ===')
        st2 = d.poll()
        check('连续通信后仍能读状态', st2['target'] in (1, 2, 3), st2['target'])
        print('  键盘电量=%d%% 在线=%s' % (st2['kbBattery'], st2['kbOnline']))
    except OSError as e:
        print('\n!! 接收器 stall: %s' % e)
        print('   正在尝试接口级恢复…')
        d.close()
        recover(iface)
        node2, _ = find_dongle()
        if node2:
            d2 = Dongle(node2)
            try:
                st = d2.poll()
                print('   恢复成功, F7 -> %s' % hx(st['raw'], 12))
            finally:
                d2.close()
        FAIL.append('接收器 stall')
    finally:
        try: d.close()
        except Exception: pass

    print('\n通过 %d / 失败 %d' % (len(PASS), len(FAIL)))
    if FAIL: print('失败项: ' + ', '.join(FAIL))
    return 1 if FAIL else 0

sys.exit(main())
