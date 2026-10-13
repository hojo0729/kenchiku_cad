// claude.ai の公開ページ（Artifact）用に、ビルド結果を1ファイルにまとめる。
// 使い方: npm run build:artifact  → artifact/index.html
// 公開ページは <html>/<head>/<body> を自動で付けるので、中身だけを書き出す。
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const assets = readdirSync(join(dist, 'assets'));
const css = assets.filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(dist, 'assets', f), 'utf8')).join('\n');
const js = assets.filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(dist, 'assets', f), 'utf8')).join('\n');

const body = html.match(/<!--app:start-->([\s\S]*?)<!--app:end-->/);
if (!body) throw new Error('index.html に <!--app:start--> / <!--app:end--> が見つかりません');

const page = [
  '<title>建築CAD</title>',
  `<style>${css}</style>`,
  body[1].trim(),
  // </script> がJS中に現れても壊れないように
  `<script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>`,
  '',
].join('\n');

mkdirSync('artifact', { recursive: true });
writeFileSync(join('artifact', 'index.html'), page);
console.log(`artifact/index.html (${(page.length / 1024).toFixed(1)} KB)`);
