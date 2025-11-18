import fs from 'fs/promises';
const DATA_PATH = process.env.RAILWAY_ENVIRONMENT ? '/data' : './data';

export async function ensureDataPath() {
  await fs.mkdir(DATA_PATH, { recursive: true });
}

export async function save(file, data) {
  await ensureDataPath();
  const p = `${DATA_PATH}/${file}`;
  await fs.writeFile(p, JSON.stringify(data, null, 2));
}

export async function load(file) {
  await ensureDataPath();
  const p = `${DATA_PATH}/${file}`;
  try {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
