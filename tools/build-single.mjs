// Bundles the app into one self-contained HTML body fragment (dist/rollick.html)
// for hosts that serve a single page: no modules, no service worker.
import { readFileSync, writeFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const engine = read('src/engine.js');
const names = [...engine.matchAll(/^export (?:const|function) (\w+)/gm)].map((m) => m[1]);
const engineJs = `const E = (() => {\n${engine.replace(/^export /gm, '')}\nreturn { ${names.join(', ')} };\n})();`;

const strip = (src) => src.replace(/^import [\s\S]*?;\n/gm, '').replace(/^export /gm, '');
const profile = strip(read('src/profile.js'));
const transport = strip(read('src/transport.js'));
const ai = strip(read('src/ai.js'));
const app = strip(read('src/app.js'))
  .replace(/\nif \('serviceWorker'[\s\S]*$/, '\n');

const css = read('src/style.css')
  .replace('padding: max(12px, env(safe-area-inset-top)) 16px max(12px, env(safe-area-inset-bottom));', 'padding-block: 12px;');

const html = `<title>Rollick</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
:root { color-scheme: dark; }
${css}
body { padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
#app { padding: 12px 0; }
</style>
<div id="app"></div>
<script>
${engineJs}
${ai}
${profile}
${transport}
${app}
</script>
`;
writeFileSync(new URL('../dist/rollick.html', import.meta.url), html);
console.log('wrote dist/rollick.html', html.length, 'bytes');
