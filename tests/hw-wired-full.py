#!/usr/bin/env python3
# 有线 K98PRO 全功能真机验证（一次性跑完，安全：写回原值再核对）
#   1) 设备识别            0x8F
#   2) 主灯效 / 侧灯效      0x87 / 0x88  读 -> 原值写回 -> 再读（比对）
#   3) 回报率/去抖/键盘选项/休眠  0x83 / 0x86 / 0x89 / 0x91  同上
#   4) 宏槽位 0            0x8B 读 -> 原值写回 -> 再读（比对）
#   5) 三层按键矩阵         0x8A 逐层读 + 与出厂默认做差异统计
#   6) 单键写入回环         0x0A 写入 -> 读回 -> 还原 -> 读回（整层 md5 比对）
# 用法: npm run test:hw   （或 python3 tests/hw-wired-full.py [/dev/hidrawN]，需要真机 3151:5002）
# 读的是 data/k98_matrices.json 里的出厂默认矩阵，报告写到 work/wired-full-test.json
import fcntl, os, sys, time, json, hashlib

DEV = sys.argv[1] if len(sys.argv) > 1 else None
def find_dev():
    import glob, re
    for d in sorted(glob.glob('/sys/class/hidraw/hidraw*')):
        p = os.path.realpath(os.path.join(d, 'device'))
        while p != '/' and not os.path.exists(os.path.join(p, 'idVendor')):
            p = os.path.dirname(p)
        try:
            if open(os.path.join(p, 'idVendor')).read().strip() == '3151' and \
               open(os.path.join(p, 'idProduct')).read().strip() == '5002':
                return '/dev/' + os.path.basename(d)
        except Exception:
            pass
    return None

if not DEV:
    DEV = find_dev()
if not DEV:
    print('没找到有线键盘 3151:5002 —— 请先插上 USB 数据线'); sys.exit(2)

def IOC(size, rw): return (3 << 30) | (size << 16) | (0x48 << 8) | rw
def hx(b, n=16): return ' '.join('%02X' % x for x in b[:n])
fd = os.open(DEV, os.O_RDWR | os.O_NONBLOCK)

def xfer(frame, bits=7, gap=0.02):
    f = bytearray(frame) + bytearray(64 - len(frame))
    if bits >= 7: f[7] = (0xFF - (sum(f[:7]) & 0xFF)) & 0xFF
    if bits >= 8: f[8] = (0xFF - (sum(f[:8]) & 0xFF)) & 0xFF
    snd = bytearray(65); snd[1:65] = f
    fcntl.ioctl(fd, IOC(65, 6), snd, False)
    time.sleep(gap)
    rb = bytearray(65)
    fcntl.ioctl(fd, IOC(65, 7), rb, True)
    return bytes(rb[1:65])

def read_layer(l):
    out = bytearray()
    for p in range(8):
        out += xfer([0x8A, l, 255, p, 0])[:64]
        time.sleep(0.01)
    return bytes(out[:512])

results = {}
print('设备:', DEV)
r = xfer([0x8F]); dev_id = r[1] | (r[2] << 8)
print('1) 0x8F 识别 -> deviceId=%d usbVersion=0x%04X  %s' % (dev_id, r[7] | (r[8] << 8), hx(r)))
results['deviceId'] = dev_id

print('2/3) 读 -> 原值写回 -> 再读:')
CASES = [('主灯效', 0x87, 0x07, 8), ('侧灯效', 0x88, 0x08, 8), ('回报率', 0x83, 0x03, 7),
         ('去抖', 0x86, 0x06, 7), ('键盘选项', 0x89, 0x09, 7), ('休眠', 0x91, 0x11, 7)]
for name, get, set_, bits in CASES:
    r1 = xfer([get]); time.sleep(0.05)
    w = bytearray(r1); w[0] = set_
    xfer(bytes(w), bits=bits); time.sleep(0.12)
    r3 = xfer([get])
    same = r3[:12] == r1[:12]
    results[name] = same
    print('   %-6s %s  写回后 %s  %s' % (name, hx(r1, 9), hx(r3, 9), '✓ 一致' if same else '✗ 不一致'))

print('4) 宏槽位 1: 0x8B 读 -> 原值写回 -> 再读')
m1 = b''
for p in range(4):
    m1 += xfer([0x8B, 0, p])[:64]
time.sleep(0.1)
for i in range(4):
    part = bytearray(m1[i*56:(i+1)*56])
    fr = bytearray([0x0B, 0, i, len(part), 1 if i == 3 else 0]) + part
    xfer(bytes(fr))
    time.sleep(0.05)
time.sleep(0.15)
m2 = b''
for p in range(4):
    m2 += xfer([0x8B, 0, p])[:64]
results['宏'] = (m1 == m2)
print('   宏数据 %s  %s' % (hx(m1, 12), '✓ 一致' if m1 == m2 else '✗ 不一致'))

print('5) 三层矩阵差异:')
import json as _json
fac = None
try:
    dm = _json.load(open('data/k98_matrices.json'))['defaultMatrix']
    fac = bytes(x for e in dm for x in e['matrix'])
except Exception as e:
    print('   (读不到出厂默认矩阵: %s)' % e)
for l in range(3):
    m = read_layer(l)
    if fac:
        n = sum(1 for i in range(0, 512, 4) if m[i:i+4] != fac[i:i+4])
        which = [i//4 for i in range(0, 512, 4) if m[i:i+4] != fac[i:i+4]]
        print('   层%d: 与出厂不同 %d 个键 %s' % (l, n, which[:12]))
    else:
        print('   层%d: md5=%s' % (l, hashlib.md5(m).hexdigest()))
    time.sleep(0.12)

print('6) 单键写入回环（层2 位置78）:')
backup = read_layer(2)
orig4 = list(backup[78*4:78*4+4])
xfer([0x0A, 2, 78, 0, 0, 1, 0, 0, 0x00, 0x00, 0x4A, 0x00]); time.sleep(0.15)
after = read_layer(2)
ok_write = list(after[78*4:78*4+4]) == [0, 0, 0x4A, 0]
xfer([0x0A, 2, 78, 0, 0, 1, 0, 0] + orig4); time.sleep(0.15)
final = read_layer(2)
ok_restore = final == backup
results['单键写入'] = ok_write
results['写后还原'] = ok_restore
print('   写入 [00 00 4A 00] -> 读回 %s  %s' % (hx(after[78*4:78*4+4], 4), '✓' if ok_write else '✗'))
print('   还原原值 %s     -> md5 %s  %s' % (hx(bytes(orig4), 4), hashlib.md5(final).hexdigest()[:12],
      '✓ 与原备份一致' if ok_restore else '✗ 不一致'))

os.makedirs('work', exist_ok=True)
json.dump(results, open('work/wired-full-test.json', 'w'), indent=1, ensure_ascii=False)
print('报告已写入 work/wired-full-test.json')
os.close(fd)
bad = [k for k, v in results.items() if v is False]
print('\n结果: %d 项通过, %d 项失败 %s' % (len([v for v in results.values() if v is not False]), len(bad), bad))
sys.exit(1 if bad else 0)
