'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { handleExtraGroupCommand, initBotMode, getBotMode } = require('../extra-group-commands');

const OWNER = '5511999999999';

function command(name) {
  return { key: { remoteJid: '123@g.us', participant: `${OWNER}@s.whatsapp.net`, fromMe: false }, message: { conversation: `/${name}` } };
}

test('Creator can switch Public/Self; mode persists in private state', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'isabot-mode-'));
  const env = { AUTH_DIR: directory };
  const sock = {};
  try {
    assert.equal((await handleExtraGroupCommand(sock, command('public'), { ownerNumber: OWNER, env })).message, 'Modo público ativado.');
    assert.equal(getBotMode(), 'public');
    const state = JSON.parse(await fs.readFile(path.join(directory, 'bot-mode.json'), 'utf8'));
    assert.deepEqual(state, { mode: 'public' });
    await handleExtraGroupCommand(sock, command('self'), { ownerNumber: OWNER, env });
    assert.equal(await initBotMode(env), 'self');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
    await initBotMode({ AUTH_DIR: path.join(directory, 'missing') });
  }
});

test('broadcast refuses to run without the exact confirmation prefix', async () => {
  let groupsFetched = false;
  const sock = {
    user: { id: '5511888888888@s.whatsapp.net' },
    groupMetadata: async () => ({ participants: [
      { id: `${OWNER}@s.whatsapp.net`, admin: 'admin' },
      { id: '5511888888888@s.whatsapp.net', admin: 'admin' },
    ] }),
    groupFetchAllParticipating: async () => { groupsFetched = true; return { '123@g.us': {} }; },
  };
  const msg = command('bcgp');
  const result = await handleExtraGroupCommand(sock, msg, { ownerNumber: OWNER });
  assert.match(result.message, /CONFIRMAR/);
  assert.equal(groupsFetched, false);
});
