import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const project = path.dirname(root);
const dist = path.join(project, 'dist');

const copyIfExists = async (relative) => {
  try {
    const src = path.join(project, relative);
    const dest = path.join(dist, relative);
    await mkdir(path.dirname(dest), { recursive: true });
    await cp(src, dest, { recursive: true, force: true });
  } catch (error) {
    // ignore if source is missing
  }
};

const copyFiles = async () => {
  await Promise.all([
    copyIfExists('tools'),
    copyIfExists('plugins'),
    copyIfExists('docs'),
    copyIfExists('infected.config.json'),
    copyIfExists('infected.config.json.example'),
  ]);
};

await copyFiles();
