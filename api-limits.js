'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

let queue = Promise.resolve();
const DEFAULT_LIMITS = Object.freeze({ brave: 100, youtube: 30, pinterest: 20 });

function periodKey(kind, date = new Date()) {
  if (kind === 'brave') return `month:${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  return `day:${date.toISOString().slice(0, 10)}`;
}

async function consumeApiUse(kind, { env = process.env, limit = DEFAULT_LIMITS[kind] } = {}) {
  const operation = queue.then(async () => {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Limite de chamadas API inválido.');
    const directory = path.resolve(env.AUTH_DIR || './auth_info_baileys');
    const statePath = path.resolve(env.API_USAGE_FILE || path.join(directory, 'api-usage.json'));
    await fs.mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 });
    let state = {};
    try {
      state = JSON.parse(await fs.readFile(statePath, 'utf8'));
      if (!state || typeof state !== 'object' || Array.isArray(state)) state = {};
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Não foi possível ler o limite persistente de APIs.');
    }
    const key = periodKey(kind);
    const entries = { ...(state[key] || {}) };
    const used = Number(entries[kind] || 0);
    if (used >= limit) throw new Error(`Limite de segurança atingido: ${limit} chamada(s) de ${kind} nesta janela (${key.split(':')[0]}).`);
    entries[kind] = used + 1;
    const next = { ...state, [key]: entries };
    const tempPath = `${statePath}.${process.pid}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(next)}\n`, { mode: 0o600 });
    await fs.rename(tempPath, statePath);
    return { used: used + 1, limit, window: key };
  });
  queue = operation.catch(() => {});
  return operation;
}

module.exports = { DEFAULT_LIMITS, periodKey, consumeApiUse };
