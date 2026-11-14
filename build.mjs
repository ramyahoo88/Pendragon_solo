import { mkdir, readFile, writeFile } from 'node:fs/promises'

// Preserve module namespaces while keeping the distributable usable from file://.
const modules = ['data','cards','scenarios','position','sequence','battle','commands','operations','grants','epoch-economy','events','event-policy','bots','action-resolution','session','ui']
const read = path => readFile(new URL(path,import.meta.url),'utf8')
const asset = async path => (await readFile(new URL(path,import.meta.url))).toString('base64')
let css = await read('./src/style.css')
for (const file of ['fonts/inter.woff2','fonts/cinzel.woff2','fort.webp']) {
  css = css.replace('ASSET_'+file,await asset('./src/'+file))
}
const namespaces = modules.map(name => JSON.stringify(name)+':{}').join(',')
const code = (await Promise.all(modules.map(async name => {
  const source = await read('./src/'+name+'.mjs')
  const exported = [...source.matchAll(/^export\s+(?:async\s+)?(?:const|let|function|class)\s+(\w+)/gm)].map(match => match[1])
  const local = source.replace(/^import\s+\{([^}]+)\}\s+from\s+'\.\/(.+?)\.mjs'\s*$/gm,(_,bindings,dependency) => {
    if (!modules.includes(dependency)) throw new Error('Unexpected module '+dependency)
    return 'const {'+bindings.replaceAll(/\s+as\s+/g,': ')+'} = modules['+JSON.stringify(dependency)+']'
  }).replace(/^export /gm,'')
  if (/^import |^export /m.test(local)) throw new Error('Unsupported module syntax in '+name)
  return '(() => {\n'+local+'\nObject.assign(modules['+JSON.stringify(name)+'],{'+exported.join(',')+'})\n})()'
}))).join('\n;\n')
const html = (await read('./src/index.html')).replace('/* APP_STYLES */',() => css)
  .replace('/* APP_BUNDLE */',() => '\n(() => {\n"use strict"\nconst modules = {'+namespaces+'}\n;\n'+code+'\n})()\n')
// The first argument is useful when byte-verifying the release.
const target = process.argv[2] || new URL('./dist/index.html',import.meta.url)
if (!process.argv[2]) await mkdir(new URL('./dist/',import.meta.url),{recursive:true})
await writeFile(target,html)
