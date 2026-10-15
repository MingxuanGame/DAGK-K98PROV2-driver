#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
hidraw-test.py — 在真实 DAGK K98 PRO V2 上验证逆向出的 HID 协议

用法:
  python3 tests/hidraw-test.py                 # 自动找设备(厂商接口), 只读测试
  python3 tests/hidraw-test.py --pid 0x5006    # 指定设备 (有线 0x5002 / 接收器 0x5006)
  python3 tests/hidraw-test.py --write         # 追加可逆写入测试(自动还原)
  python3 tests/hidraw-test.py --list          # 只列出设备与接口

!! 关键实现说明 (踩过的坑, 很重要) !!
1) Linux hidraw 的 ioctl 号: HIDIOCSFEATURE = 0x06 (发送), HIDIOCGFEATURE = 0x07 (读取)。
   两者不能混用 —— 早期版本两个方向都写了 0x07, 结果只读不写, 设备永远收不到命令,
   现象就是"设备无响应, 读回全 0"。这个 bug 一度让人误判设备坏了。
2) 本设备报告描述符没有 Report ID; Linux usbhid 对 report number==0 会做 buf++/count--,
   所以 ioctl 长度要用 65, 设备才会正好收到 64 字节报文。
"""
import fcntl, os, time, glob, struct, sys

VENDOR_DESC = b'\x06\xff\xff\x09\x02'      # UsagePage 0xFFFF / Usage 0x02
def IOC(dir_, nr, size): return (dir_ << 30) | (size << 16) | (0x48 << 8) | nr
GET_FEATURE = lambda n: IOC(3, 0x07, n)
SET_FEATURE = lambda n: IOC(3, 0x06, n)

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

def iter_devices():
    for h in sorted(glob.glob('/sys/class/hidraw/hidraw*')):
        name = os.path.basename(h)
        dev = os.path.basename(os.path.realpath(os.path.join(h, 'device')))
        if '3151:' not in dev.upper():
            continue
        try:
            rd = open(os.path.join(h, 'device', 'report_descriptor'), 'rb').read()
        except Exception:
            rd = b''
        iface = os.path.basename(os.path.dirname(os.path.realpath(os.path.join(h, 'device'))))
        yield {'node': '/dev/' + name, 'hid': dev, 'iface': iface, 'desc': rd,
               'vendor': VENDOR_DESC in rd}

def find_device(pid=None):
    cands = list(iter_devices())
    if pid is not None:
        cands = [c for c in cands if ('%04X' % pid) in c['hid'].upper()]
    for c in cands:
        if c['vendor']:
            return c
    return cands[0] if cands else None

class Dev:
    def __init__(self, node, size=65):
        self.fd = os.open(node, os.O_RDWR)
        self.size = size
    def send(self, frame):
        f = bytearray(frame) + bytearray(64 - len(frame))
        buf = bytearray(self.size)
        buf[1:65] = f[:64]
        fcntl.ioctl(self.fd, SET_FEATURE(self.size), buf, False)
    def recv(self):
        buf = bytearray(self.size)
        fcntl.ioctl(self.fd, GET_FEATURE(self.size), buf, True)
        return bytes(buf[1:self.size])
    def cmd(self, frame, kind='bit7', send_delay=0.01, read_delay=0.02, timeout_ok=False):
        f = ck7(frame) if kind == 'bit7' else ck8(frame) if kind == 'bit8' else bytes(frame)
        try:
            time.sleep(send_delay); self.send(f)
        except TimeoutError:
            if timeout_ok: return None
            raise
        time.sleep(read_delay)
        try:
            return self.recv()
        except TimeoutError:
            if timeout_ok: return None
            raise
    def close(self): os.close(self.fd)

PASS, FAIL = [], []
def check(name, cond, extra=''):
    (PASS if cond else FAIL).append(name)
    print(('  \u2713 ' if cond else '  \u2717 ') + name + (('   <' + str(extra) + '>') if (extra and not cond) else ''))

def main():
    args = sys.argv[1:]
    if '--list' in args:
        for c in iter_devices():
            print('%s  %s  iface=%s  vendor_iface=%s' % (c['node'], c['hid'], c['iface'], c['vendor']))
        return 0
    pid = None
    if '--pid' in args:
        pid = int(args[args.index('--pid') + 1], 0)
    do_write = '--write' in args

    dev = find_device(pid)
    if not dev:
        print('!! 没有找到 3151:xxxx 的 hidraw 设备（先插上键盘或接收器）'); return 1
    print('设备 %s   %s   iface=%s' % (dev['node'], dev['hid'], dev['iface']))
    print('报告描述符 %s' % hx(dev['desc']))
    is_dongle = '5006' in dev['hid'].upper()
    d = Dev(dev['node'])

    if is_dongle:
        print('\n=== [接收器] 0xF7 链路状态 ===')
        r = d.cmd([0xF7], timeout_ok=True)
        if r is None:
            check('接收器响应 0xF7', False, '超时')
        else:
            print('  原始: %s' % hx(r, 16))
            check('接收器响应 0xF7', r[6] in (1, 2, 3), 'byte6=%d' % r[6])
            tgt = {1: '键盘', 2: '鼠标', 3: '键鼠'}.get(r[6], '?')
            print('  键盘电量=%d%%  对象=%s  键盘在线=%s  可发送=%s  可读取=%s' % (
                r[1], tgt, r[3] == 0, r[5] == 1, r[0] == 1))
            if r[6] in (1, 3) and r[3] != 0:
                print('\n  !! 键盘当前不在线(2.4G)。请把键盘开关拨到 2.4G 并按一下键唤醒后重跑。')
            elif r[6] in (1, 3):
                print('\n  键盘在线, 继续测试转发通道…')
                rs = d.cmd([0x8F], timeout_ok=True)
                if rs:
                    print('  经接收器读设备ID: 回显=0x%02X ID=%d' % (rs[0], struct.unpack_from('<I', rs, 1)[0]))
                    check('经 2.4G 读到 K98PRO 设备ID=3780', struct.unpack_from('<I', rs, 1)[0] == 3780,
                          struct.unpack_from('<I', rs, 1)[0])
        d.close()
        print('\n通过 %d / 失败 %d' % (len(PASS), len(FAIL)))
        return 1 if FAIL else 0

    print('\n=== 1. 识别 (0x8F) ===')
    r = d.cmd([0x8F], timeout_ok=True)
    if r is None:
        check('设备响应 0x8F', False, '超时(设备可能不在有线模式)')
    else:
        dev_id = struct.unpack_from('<I', r, 1)[0]
        usb_ver = struct.unpack_from('<H', r, 7)[0]
        print('  原始应答: %s' % hx(r, 16))
        check('应答回显命令 0x8F', r[0] == 0x8F, hex(r[0]))
        check('设备 ID == 3780 (K98PRO)', dev_id == 3780, dev_id)
        print('  USB 版本 = 0x%04X, byte9(isBoot)=%d, byte11(lightSync)=%d' % (usb_ver, r[9], r[11]))

    print('\n=== 2. 读取设置 ===')
    for name, fr, idx in [('profile', [0x84], 1), ('回报率', [0x83], 2), ('去抖', [0x86], 1), ('键盘选项', [0x89], 1)]:
        r = d.cmd(fr, timeout_ok=True)
        if r is None:
            check('读取 %s' % name, False, '超时'); continue
        check('读取 %s (回显 0x%02X)' % (name, fr[0]), r[0] == fr[0], hex(r[0]))
        if name == '回报率':
            print('    %s = %s Hz' % (name, {0:8000,1:4000,2:2000,3:1000,4:500,5:250,6:125}.get(r[idx])))
        else:
            print('    %s = %d' % (name, r[idx]))

    print('\n=== 3. 主灯效 (0x87) ===')
    r = d.cmd([0x87], timeout_ok=True)
    if r is None:
        check('读取主灯效', False, '超时')
    else:
        check('读取主灯效', r[0] == 0x87, hex(r[0]))
        print('    效果=%d 速度=%d 亮度=%d option/mode=0x%02X rgb=(%d,%d,%d)' % (r[1], r[2], r[3], r[4], r[5], r[6], r[7]))

    print('\n=== 4. 按键矩阵 (0x8A, 8 页) ===')
    matrix = bytearray(); ok = 0
    for page in range(8):
        r = d.cmd([0x8A, 0x00, 0xFF, page, 0x00], timeout_ok=True)
        if r is None:
            matrix += bytes(64); continue
        matrix += r[:64]
        if r[0] == 0x8A: ok += 1
    check('8 页全部应答 0x8A', ok == 8, ok)
    if ok:
        check('矩阵位置0 == Esc [0,0,0x29,0]', list(matrix[0:4]) == [0,0,0x29,0], list(matrix[0:4]))
        check('矩阵位置9 == A [0,0,0x04,0]', list(matrix[36:40]) == [0,0,0x04,0], list(matrix[36:40]))
        nz = sum(1 for i in range(128) if any(matrix[i*4:i*4+4]))
        check('有效按键位置数 90..110', 90 <= nz <= 110, nz)
        print('    位置0=%s 位置9(A)=%s 位置65(Fn)=%s 有效位置=%d' % (
            list(matrix[0:4]), list(matrix[36:40]), list(matrix[260:264]), nz))

    if do_write and not FAIL:
        print('\n=== 5. 可逆写入测试 ===')
        before = d.cmd([0x87], timeout_ok=True)
        if before:
            f = bytearray(64); f[0] = 0x07; f[1:8] = before[1:8]
            d.cmd(f, 'bit8', timeout_ok=True)
            time.sleep(0.3)
            after = d.cmd([0x87], timeout_ok=True)
            if after:
                check('灯效原值写回后读数不变', list(before[1:8]) == list(after[1:8]),
                      '%s -> %s' % (list(before[1:8]), list(after[1:8])))
    elif do_write:
        print('\n!! 设备未正确应答, 跳过写入测试')

    d.close()
    print('\n通过 %d / 失败 %d' % (len(PASS), len(FAIL)))
    if FAIL:
        print('失败项: ' + ', '.join(FAIL))
        print('''
提示: 若读取全部超时或全 0, 说明设备的 USB 厂商配置通道没有响应。
常见原因: 键盘模式开关不在"有线(USB)"档。请拨到有线档后重跑。''')
    return 1 if FAIL else 0

sys.exit(main())
