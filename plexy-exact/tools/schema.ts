const path = new URL('../lib/schema.sql', import.meta.url);
const generated = '// Generated from schema.sql by tools/schema.ts.\nexport default ' + JSON.stringify(await Bun.file(path).text()) + ';\n';
const target = new URL('../lib/schema.ts', import.meta.url);
if (process.argv.includes('--check')) {
  if (await Bun.file(target).text() !== generated) throw new Error('Run bun tools/schema.ts to refresh schema.ts');
} else await Bun.write(target, generated);
