import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/package-preview.py', import.meta.url));
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'unform-package-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'dist'), output = join(root, 'UNFORM-Cloudflare-preview.zip');
  const put = (path, value) => { const file = join(source, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, value); };
  put('index.html', '<!doctype html><link rel="icon" href="./favicon.svg"><script type="module" src="/UNFORM/assets/index-12345678.js"></script><link rel="stylesheet" href="/UNFORM/assets/index-12345678.css">');
  put('assets/index-12345678.js', 'const paths=["/UNFORM/hand-worker.js","/UNFORM/mediapipe/vision_bundle.mjs","/UNFORM/mediapipe/wasm"];import("./vision_bundle-12345678.js");');
  put('assets/vision_bundle-12345678.js', 'export const vision = true;');
  put('assets/index-12345678.css', 'body{background:#101111}');
  put('favicon.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
  put('hand-worker.js', 'self.onmessage=()=>{};');
  put('mediapipe/vision_bundle.mjs', 'export const vision=true;');
  for (const suffix of ['internal', 'nosimd_internal']) {
    put(`mediapipe/wasm/vision_wasm_${suffix}.js`, 'const wasm=true;');
    put(`mediapipe/wasm/vision_wasm_${suffix}.wasm`, Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
  }
  const run = () => spawnSync('python3', [script, '--source', source, '--output', output], { encoding: 'utf8', env: { ...process.env, GITHUB_SHA: 'test-commit' } });
  return { source, output, put, run };
}
function inspect(output) {
  const result = spawnSync('python3', ['-c', 'import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({"entries":z.namelist(),"corrupt":z.testzip(),"headers":z.read("_headers").decode(),"version":json.loads(z.read("UNFORM/preview-version.json"))}))', output], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
}
function rulesFor(text, path) {
  const result = []; let pattern;
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!line.startsWith(' ')) { pattern = line.trim(); continue; }
    const [start, end] = pattern.split('*');
    const matches = end === undefined ? path === pattern : path.startsWith(start) && path.endsWith(end);
    if (matches) { const p = line.indexOf(':'); result.push([line.slice(0, p).trim(), line.slice(p + 1).trim()]); }
  }
  return result;
}

test('deployment ZIP is a site root with _headers and UNFORM, no artifact wrapper or nested ZIP', t => {
  const f = fixture(t), result = f.run(); assert.equal(result.status, 0, result.stderr);
  const z = inspect(f.output), report = JSON.parse(result.stdout);
  assert.deepEqual(new Set(z.entries.map(n => n.split('/')[0])), new Set(['_headers', 'UNFORM']));
  assert.equal(z.corrupt, null); assert.ok(z.entries.includes('UNFORM/index.html'));
  assert.ok(!z.entries.some(n => n.endsWith('.zip') || n.startsWith('UNFORM/UNFORM/')));
  assert.equal(z.version.commit, 'test-commit'); assert.equal(z.version.base, '/UNFORM/');
  assert.ok(z.version.files_sha256['UNFORM/assets/index-12345678.js']);
  assert.ok(!existsSync(join(f.source, '_headers'))); assert.ok(!existsSync(join(f.source, 'preview-version.json')));
  assert.ok(report.resources.some(r => r.content_type === 'text/css'));
  assert.ok(report.resources.some(r => r.content_type === 'text/javascript'));
  assert.ok(report.resources.some(r => r.content_type === 'application/wasm'));
});

test('Cloudflare rules avoid HTML staleness and only cache hashed assets immutably', t => {
  const f = fixture(t); assert.equal(f.run().status, 0); const { headers } = inspect(f.output);
  const cache = path => rulesFor(headers, path).filter(([key]) => key === 'Cache-Control').map(([, value]) => value);
  for (const path of ['/UNFORM', '/UNFORM/', '/UNFORM/index.html', '/UNFORM/preview-version.json']) assert.deepEqual(cache(path), ['no-store']);
  assert.deepEqual(cache('/UNFORM/assets/index-12345678.js'), ['public, max-age=31536000, immutable']);
  assert.deepEqual(cache('/UNFORM/assets/index-12345678.css'), ['public, max-age=31536000, immutable']);
  for (const path of ['/UNFORM/hand-worker.js', '/UNFORM/mediapipe/vision_bundle.mjs', '/UNFORM/mediapipe/wasm/vision_wasm_internal.wasm']) assert.deepEqual(cache(path), ['no-cache']);
  assert.ok(rulesFor(headers, '/UNFORM/mediapipe/wasm/vision_wasm_internal.wasm').some(([k, v]) => k === 'Content-Type' && v === 'application/wasm'));
  assert.deepEqual(rulesFor(headers, '/other-site/'), []);
});

test('extracted deployment root serves real HTML/JS/CSS/Worker/WASM at /UNFORM/ with proper MIME', t => {
  const f = fixture(t), built = f.run(); assert.equal(built.status, 0, built.stderr);
  const code = `
import sys,json,zipfile,threading,http.server,functools,urllib.request
from pathlib import Path
archive=Path(sys.argv[1]); root=archive.parent/'http-root'
with zipfile.ZipFile(archive) as z: z.extractall(root)
class Quiet(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*args): pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(root)))
threading.Thread(target=server.serve_forever,daemon=True).start()
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
try:
 urls={r['url'] for r in json.loads(sys.argv[2])['resources']}|{'/UNFORM/index.html'}
 for path in urls:
  with opener.open(f'http://127.0.0.1:{server.server_port}'+path,timeout=5) as r:
   assert r.status==200
   assert r.read()==(root/path.lstrip('/')).read_bytes()
   mime=r.headers.get_content_type()
   if path.endswith(('.js','.mjs')): assert mime in ('text/javascript','application/javascript'),mime
   if path.endswith('.css'): assert mime=='text/css',mime
   if path.endswith('.wasm'): assert mime=='application/wasm',mime
   if path.endswith('.html'): assert mime=='text/html',mime
 print(json.dumps({'checked':len(urls)}))
finally: server.shutdown();server.server_close()
`;
  const result = spawnSync('python3', ['-c', code, f.output, built.stdout], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.ok(JSON.parse(result.stdout).checked >= 10);
});

for (const [name, change, error] of [
  ['wrong base', f => f.put('index.html', '<script src="/assets/index-12345678.js"></script>'), /escapes \/UNFORM/],
  ['missing CSS', f => rmSync(join(f.source, 'assets/index-12345678.css')), /Missing resource/],
  ['HTML disguised as JavaScript', f => f.put('assets/index-12345678.js', '<!doctype html>fallback'), /HTML returned as asset/],
  ['missing dynamic import', f => rmSync(join(f.source, 'assets/vision_bundle-12345678.js')), /Missing resource/],
  ['unhashed asset in immutable directory', f => f.put('assets/fixed.js', 'const fixed=true;'), /Unhashed asset/],
  ['missing Worker', f => rmSync(join(f.source, 'hand-worker.js')), /Missing resource/],
  ['wrong runtime Worker base', f => f.put('assets/index-12345678.js', readFileSync(join(f.source, 'assets/index-12345678.js'), 'utf8').replace('/UNFORM/hand-worker.js', '/hand-worker.js')), /incorrect runtime reference/],
  ['HTML disguised as WASM', f => f.put('mediapipe/wasm/vision_wasm_internal.wasm', '<html>fallback</html>'), /Invalid WASM/],
]) test(`packaging fails for ${name}`, t => {
  const f = fixture(t); change(f); const result = f.run();
  assert.notEqual(result.status, 0); assert.match(result.stderr, error);
});
