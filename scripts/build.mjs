import { stripTypeScriptTypes } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
const check = process.argv.includes('--check');
for (const name of ['model', 'main']) {
  const source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8');
  const output = '// Generated from src/' + name + '.ts by npm run build.\n' + stripTypeScriptTypes(source, { mode: 'strip' });
  const target = new URL(`../dist/${name}.js`, import.meta.url);
  if (check) {
    if (await readFile(target, 'utf8') !== output) throw new Error(`${name}.js устарел: выполните npm run build`);
  } else await writeFile(target, output);
}
console.log(check ? 'Готовые файлы соответствуют TypeScript.' : 'TypeScript собран без внешних зависимостей.');
