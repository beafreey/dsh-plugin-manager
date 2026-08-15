/**
 * Build the runtime artifacts with rolldown (the tsc step only emits .d.ts):
 *
 *  - lib/index.js        host half — ESM bundle of src/index.ts; the
 *                        @deepseek-ai/* SDK packages, schemastery, and node
 *                        builtins stay external (resolved by the host).
 *  - lib/invariant.js    invariant companion — ESM bundle, same externals.
 *  - lib/client.js       browser half — single CommonJS chunk wrapped in the
 *                        dsh module-loader handoff the web shell expects for
 *                        /plugins/<id>/client.js; react is bundled in.
 *                        No CSS pipeline — the panel injects its stylesheet
 *                        from JS at mount time.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { rolldown } from 'rolldown'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const id = packageJson.name

/** Host externals: the dsh SDK, runtime deps, and node builtins. */
const hostExternal = [/^@deepseek-ai\//, /^schemastery$/, /^node:/]

async function buildHost(entry, outPath) {
  const bundle = await rolldown({
    input: join(root, entry),
    platform: 'node',
    external: hostExternal,
  })
  const { output } = await bundle.generate({ format: 'esm' })
  const code = output[0].code
  writeFileSync(join(root, outPath), code)
  console.log(`[dsh-plugin-manager] host bundle written: ${outPath} (${Buffer.byteLength(code)} bytes)`)
}

async function buildClient() {
  const bundle = await rolldown({
    input: join(root, 'src', 'client', 'index.ts'),
    platform: 'browser',
  })
  const { output } = await bundle.generate({ format: 'cjs' })
  const body = output[0].code
  const wrapped = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(id)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
${body}
\t\treturn module.exports;
\t}
});
`
  writeFileSync(join(root, 'lib', 'client.js'), wrapped)
  console.log(`[dsh-plugin-manager] client bundle written: lib/client.js (${Buffer.byteLength(wrapped)} bytes)`)
}

await buildHost('src/index.ts', 'lib/index.js')
await buildHost('src/invariant.ts', 'lib/invariant.js')
await buildClient()
