import fs from 'node:fs/promises';
import { buildPreview, defaultPreset } from '../app/core.mjs';

const scan = JSON.parse(await fs.readFile(new URL('./sample-scan.json', import.meta.url), 'utf8'));
const preview = buildPreview(scan, structuredClone(defaultPreset));
process.stdout.write(JSON.stringify(preview, null, 2) + '\n');
