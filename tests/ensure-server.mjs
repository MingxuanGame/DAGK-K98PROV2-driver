/*
 * ensure-server.mjs — 保证本地静态服务在跑
 *
 * e2e / 帧比对这类"真浏览器"测试需要一个 http 服务把仓库喂给 Chrome。
 *   * 端口上已经有服务（例如你正开着 npm run dev）-> 直接复用，测试结束不动它；
 *   * 没有 -> 自己起一个 tests/serve.mjs，测试结束自动关掉。
 * 这样 npm run test:e2e 单独跑也能过，不需要记得先开服务。
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function reachable(url) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 800);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    return r.ok;
  } catch (e) { return false; }
}

/** @returns {Promise<{port:number, started:boolean, stop:()=>void}>} */
export async function ensureServer(port = Number(process.env.PORT || 8177)) {
  const ping = `http://127.0.0.1:${port}/api/ping`;
  if (await reachable(ping)) return { port, started: false, stop() {} };

  const { spawn } = await import('node:child_process');
  const entry = new URL('./serve.mjs', import.meta.url).pathname;
  const child = spawn(process.execPath, [entry, String(port)], { stdio: 'ignore' });
  child.on('error', () => {});

  for (let i = 0; i < 80; i++) {
    await sleep(100);
    if (await reachable(ping)) {
      return { port, started: true, stop() { try { child.kill('SIGKILL'); } catch (e) {} } };
    }
  }
  try { child.kill('SIGKILL'); } catch (e) {}
  throw new Error('无法在端口 ' + port + ' 上启动本地服务（nodemon tests/serve.mjs ' + port + ' 手工试试）');
}
