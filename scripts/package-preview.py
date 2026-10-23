"""Build a Cloudflare site-root ZIP without changing Vite's dist or Pages build."""
import argparse
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
import json
import mimetypes
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import urljoin, urlsplit, unquote
from zipfile import ZipFile, ZIP_DEFLATED

BASE = '/UNFORM/'
MIMES = {'.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
         '.wasm': 'application/wasm', '.html': 'text/html'}


class References(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'script' and attrs.get('src'):
            self.urls.append((attrs['src'], 'script'))
        if tag == 'link' and attrs.get('href'):
            self.urls.append((attrs['href'], attrs.get('rel', 'link')))


def content_type(path):
    return MIMES.get(path.suffix, mimetypes.guess_type(str(path))[0] or 'application/octet-stream')


def inspect_site(root):
    index = root / 'UNFORM/index.html'
    assert index.is_file(), 'Missing UNFORM/index.html'
    refs = References()
    refs.feed(index.read_text())
    entries, report = [], []

    def check(url, relative_to=BASE):
        parsed = urlsplit(urljoin('https://preview.invalid' + relative_to, url))
        assert parsed.netloc == 'preview.invalid', f'Unexpected external static resource: {url}'
        assert parsed.path.startswith(BASE), f'Resource escapes /UNFORM/: {url}'
        file = root / unquote(parsed.path).lstrip('/')
        assert file.resolve().is_relative_to((root / 'UNFORM').resolve()), f'Unsafe path: {url}'
        assert file.is_file(), f'Missing resource: {parsed.path}'
        data = file.read_bytes()
        if file.suffix in ('.js', '.mjs', '.css'):
            assert not re.match(rb'\s*(?:<!doctype|<html)', data, re.I), f'HTML returned as asset: {url}'
        if file.suffix == '.wasm':
            assert data[:8] == b'\x00asm\x01\x00\x00\x00', f'Invalid WASM: {url}'
        report.append({'url': parsed.path, 'content_type': content_type(file), 'bytes': len(data)})
        return file

    for url, kind in refs.urls:
        file = check(url)
        if kind in ('script', 'stylesheet'):
            assert url.startswith(BASE + 'assets/'), f'Wrong Vite base: {url}'
            assert re.search(r'-[\w-]{8,}\.(?:js|css)$', file.name), f'Unhashed entry asset: {url}'
            entries.append(file)
    assert any(p.suffix == '.js' for p in entries), 'Missing JS entry'
    assert any(p.suffix == '.css' for p in entries), 'Missing CSS entry'
    entry_js = '\n'.join(p.read_text() for p in entries if p.suffix == '.js')
    for url in (BASE + 'hand-worker.js', BASE + 'mediapipe/vision_bundle.mjs', BASE + 'mediapipe/wasm'):
        assert url in entry_js, f'Missing or incorrect runtime reference: {url}'
    for file in (root / 'UNFORM/assets').glob('*.js'):
        assert re.search(r'-[\w-]{8,}\.js$', file.name), f'Unhashed asset: {file.name}'
        check(BASE + 'assets/' + file.name)
        for dep in re.findall(r'(?:import\(\s*|from\s*)[\"\'](\.[^\"\']+)[\"\']', file.read_text()):
            check(dep, BASE + 'assets/' + file.name)
    for file in (root / 'UNFORM/assets').glob('*.css'):
        assert re.search(r'-[\w-]{8,}\.css$', file.name), f'Unhashed asset: {file.name}'
        check(BASE + 'assets/' + file.name)
    for url in ('hand-worker.js', 'mediapipe/vision_bundle.mjs',
                'mediapipe/wasm/vision_wasm_internal.js', 'mediapipe/wasm/vision_wasm_internal.wasm',
                'mediapipe/wasm/vision_wasm_nosimd_internal.js', 'mediapipe/wasm/vision_wasm_nosimd_internal.wasm'):
        check(BASE + url)
    return report


def package(source, output):
    assert source.is_dir(), f'Missing build directory: {source}'
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='unform-site-root-') as temporary:
        root = Path(temporary)
        # Never mutate dist: root-only Cloudflare configuration stays out of Pages.
        import shutil
        shutil.copytree(source, root / 'UNFORM')
        (root / '_headers').write_bytes(Path(__file__).with_name('cloudflare-preview.headers').read_bytes())
        report = inspect_site(root)
        files = sorted(p for p in (root / 'UNFORM').rglob('*') if p.is_file())
        version = {'commit': os.environ.get('GITHUB_SHA', 'local-working-tree'),
                   'built_at_utc': datetime.now(timezone.utc).isoformat(), 'base': BASE,
                   'files_sha256': {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}}
        (root / 'UNFORM/preview-version.json').write_text(json.dumps(version, indent=2) + '\n')
        expected = {p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob('*') if p.is_file()}
        assert {n.split('/')[0] for n in expected} == {'UNFORM', '_headers'}
        with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
            for name, data in sorted(expected.items()):
                archive.writestr(name, data)
        with ZipFile(output) as archive:
            assert archive.testzip() is None, 'Corrupt deployment ZIP'
            assert set(archive.namelist()) == set(expected), 'Incorrect ZIP layout'
            assert all(archive.read(name) == data for name, data in expected.items()), 'ZIP content mismatch'
        print(json.dumps({'zip': str(output), 'entries': sorted(expected), 'resources': report}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('dist'))
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    package(args.source, args.output)
