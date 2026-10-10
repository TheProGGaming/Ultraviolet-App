import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = process.env.MCS_DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const FILE = join(DIR, 'db.json');

const empty = () => ({ settings: {}, leads: {}, hashtagIds: {}, hashtagLog: [] });
let db = null;

function load() {
  if (db) return db;
  mkdirSync(DIR, { recursive: true });
  db = existsSync(FILE) ? { ...empty(), ...JSON.parse(readFileSync(FILE, 'utf8')) } : empty();
  return db;
}

function save() {
  const tmp = FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
  renameSync(tmp, FILE);
}

export const store = {
  get: () => load(),
  save,
  reset() {
    db = empty();
    save();
  },
};
