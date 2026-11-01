// Builds vendor/dice3d.js (the 3D dice, with three.js inside) from tools/dice3d/dice3d.js.
// three.js and esbuild are only needed for this step, not to run the game:
//   npm install --no-save three esbuild   (in a scratch folder), then
//   DICE3D_MODULES=/path/to/scratch/node_modules node tools/build-dice3d.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const modules = process.env.DICE3D_MODULES || resolve(process.cwd(), 'node_modules');
const require = createRequire(`${modules}/`);
const esbuild = require('esbuild');
const three = JSON.parse((await import('node:fs')).readFileSync(`${modules}/three/package.json`, 'utf8'));
const out = fileURLToPath(new URL('../vendor/dice3d.js', import.meta.url));
const result = await esbuild.build({
  entryPoints: [fileURLToPath(new URL('./dice3d/dice3d.js', import.meta.url))],
  bundle: true, minify: true, format: 'iife', target: 'es2020', write: false, nodePaths: [modules],
  banner: { js: `/* Rollick 3D dice. Includes three.js r${three.version.split('.')[1]} (MIT, (c) 2010-2025 three.js authors). Source: tools/dice3d/dice3d.js */` },
});
import('node:fs').then(({ writeFileSync }) => { writeFileSync(out, result.outputFiles[0].text); console.log('wrote vendor/dice3d.js', result.outputFiles[0].text.length, 'bytes'); });
