import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const source = process.argv[2];
if (!source) throw new Error('Pass the downloaded mumuy/data_location list.json path.');
const names = JSON.parse(readFileSync(source, 'utf8'));
const output = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'roadtrip-planner', 'assets', 'locations.js');
const rows = Object.entries(names).map(([code, name]) => {
  const province = names[`${code.slice(0, 2)}0000`] || '';
  const city = names[`${code.slice(0, 4)}00`] || '';
  const level = code.endsWith('0000') ? 1 : code.endsWith('00') ? 2 : 3;
  const parents = [level === 3 ? city : '', level > 1 ? province : ''].filter(Boolean);
  return [code, name, city, province, [name, ...parents.filter(parent => parent !== name)].join(' · '), level];
});
writeFileSync(output, `// Administrative divisions from mumuy/data_location (MIT), version 2026-04.\nwindow.ROADTRIP_LOCATIONS=${JSON.stringify(rows)};\n`);
console.log(`Wrote ${rows.length} locations to ${output}`);
