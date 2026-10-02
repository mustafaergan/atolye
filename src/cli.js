#!/usr/bin/env node
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createServer } from './server.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Önce uygulama klasöründeki .env, sonra çalıştırılan klasördeki .env (varsa) okunur.
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });
dotenv.config({ quiet: true });

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const port = Number(flag('--port') || process.env.ATOLYE_PORT || 3210);
const defaultCwd = path.resolve(flag('--cwd') || process.env.ATOLYE_CWD || process.cwd());
const noOpen = args.includes('--no-open') || process.env.ATOLYE_NO_OPEN === '1';

try {
  await createServer({ port, defaultCwd });
} catch (err) {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} kullanımda. Başka bir port deneyin: atolye --port 3211`);
    process.exit(1);
  }
  throw err;
}

const url = `http://127.0.0.1:${port}`;
console.log(`\n  Atölye çalışıyor → ${url}`);
console.log(`  Varsayılan klasör: ${defaultCwd}`);
if (process.env.ANTHROPIC_BASE_URL) console.log(`  Gateway: ${process.env.ANTHROPIC_BASE_URL}`);
console.log('  Durdurmak için Ctrl+C\n');

if (!noOpen) openBrowser(url);

function openBrowser(target) {
  const cmd =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', target]]
    : process.platform === 'darwin' ? ['open', [target]]
    : ['xdg-open', [target]];
  try {
    spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* tarayıcı açılamazsa adres zaten konsolda */
  }
}
