import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const file = () => process.env.MCS_MCP_DATA || join(homedir(), '.mcs-mcp', 'db.json');
const empty = () => ({ events: {}, vendors: {}, orders: {}, notes: [], imports: [] });
let db = null, loadedFrom = null;

export function get() {
  if (db && loadedFrom === file()) return db;
  loadedFrom = file();
  db = existsSync(loadedFrom) ? { ...empty(), ...JSON.parse(readFileSync(loadedFrom, 'utf8')) } : empty();
  return db;
}

export function save() {
  const f = file();
  mkdirSync(dirname(f), { recursive: true });
  const tmp = `${f}.tmp`;
  writeFileSync(tmp, JSON.stringify(db, null, 1), { mode: 0o600 });
  renameSync(tmp, f);
}

export const resetForTests = () => { db = null; loadedFrom = null; };
