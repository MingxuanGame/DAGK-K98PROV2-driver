#!/usr/bin/env python3
# 只读检查: 接收器 + 键盘链路状态 (会发系统通知)
import sys, os, time, glob, json, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib.util
spec = importlib.util.spec_from_file_location('hws', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'hw-session.py'))
# 不能直接 import (会 sys.exit), 这里复制最小逻辑
def IOC(d,nr,n): return (d<<30)|(n<<16)|(0x48<<8)|nr
SET=lambda n: IOC(3,0x06,n); GET=lambda n: IOC(3,0x07,n)
SIZE=65
def hx(b,n=None): b=bytes(b) if n is None else bytes(b[:n]); return ' '.join('%02X'%x for x in b)
def ck7(f):
    f=bytearray(f)+bytearray(9-len(f)); f[7]=(0xFF-(sum(f[:7])&0xFF))&0xFF; return bytes(f)
def find():
    for h in sorted(glob.glob('/sys/class/hidraw/hidraw*')):
        d=os.path.basename(os.path.realpath(os.path.join(h,'device')))
        if '3151:5006' not in d.upper(): continue
        try: rd=open(os.path.join(h,'device','report_descriptor'),'rb').read()
        except Exception: continue
        if b'\x06\xff\xff\x09\x02' in rd: return '/dev/'+os.path.basename(h)
    return None
def notify(t,b,u='normal'):
    print('[通知]',t,'|',b)
    try:
        r=urllib.request.Request('http://127.0.0.1:8177/api/notify',
            data=json.dumps({'title':t,'body':b,'urgency':u}).encode(),
            headers={'Content-Type':'application/json'})
        urllib.request.urlopen(r,timeout=5).read()
    except Exception as e: print('  (通知失败)',e)

node=find()
print('接收器节点:', node)
if not node:
    notify('K98 PRO V2','找不到接收器，请插上 2.4G 接收器。','normal'); raise SystemExit(1)
fd=os.open(node, os.O_RDWR)
def setf(fr):
    time.sleep(0.01); b=bytearray(SIZE); b[1:65]=(bytearray(fr)+bytearray(64-len(fr)))[:64]
    import fcntl; fcntl.ioctl(fd, SET(SIZE), b, False)
def getf():
    import fcntl; time.sleep(0.01); b=bytearray(SIZE); fcntl.ioctl(fd, GET(SIZE), b, True); return bytes(b[1:SIZE])
try:
    setf(ck7([0xF7])); r=getf()
    print('F7:', hx(r,12))
    print('  键盘电量=%d%% 在线=%s 可发送=%s 目标=%d' % (r[1], r[3]==0, r[5]==1, r[6]))
    if r[3]!=0 or r[6] not in (1,3):
        notify('K98 PRO V2：键盘不在线',
               '接收器正常，但键盘没连上。请把键盘开关拨到 2.4G 档，并按一下键唤醒。','normal')
    else:
        notify('K98 PRO V2：链路正常','键盘在线，电量 %d%%。' % r[1],'low')
except OSError as e:
    print('失败:', e)
    notify('K98 PRO V2：接收器无响应','请拔插一次 2.4G 接收器。','critical')
os.close(fd)
