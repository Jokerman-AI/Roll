// Bundles the app into one self-contained HTML body fragment (dist/roll-for-it.html)
// for hosts that serve a single page: no modules, no service worker.
import { readFileSync, writeFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const engine = read('src/engine.js');
const names = [...engine.matchAll(/^export (?:const|function) (\w+)/gm)].map((m) => m[1]);
const engineJs = `const E = (() => {\n${engine.replace(/^export /gm, '')}\nreturn { ${names.join(', ')} };\n})();`;

const ai = read('src/ai.js').replace(/^import .*$/gm, '').replace(/^export /gm, '');
const app = read('src/app.js')
  .replace(/^import .*$/gm, '')
  .replace(/\nif \('serviceWorker'[\s\S]*$/, '\n');

const css = read('src/style.css')
  .replace('padding: max(12px, env(safe-area-inset-top)) 16px max(12px, env(safe-area-inset-bottom));', 'padding-block: 12px;');

const html = `<title>Roll for It</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
:root { color-scheme: dark; }
${css}
body { padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
#app { padding-inline: 0; }
</style>
<div id="app"></div>
<script>
${engineJs}
${ai}
${app}
</script>
`;
writeFileSync(new URL('../dist/roll-for-it.html', import.meta.url), html);
console.log('wrote dist/roll-for-it.html', html.length, 'bytes');
