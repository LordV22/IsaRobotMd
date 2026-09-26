'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { digits, getText, parseCommand, handleGroupMessage } = require('../group-manager');

const OWNER = '55100000002';
const BOT = '55100000001';
const MEMBER = '55100000003';

test('normalizes WhatsApp JIDs to digits', () => {
  assert.equal(digits(`${OWNER}:12@s.whatsapp.net`), OWNER);
});

test('extracts command text from ordinary and ephemeral Baileys messages', () => {
  assert.equal(getText({ message: { conversation: '/ajuda' } }), '/ajuda');
  assert.equal(getText({ message: { ephemeralMessage: { message: { extendedTextMessage: { text: '/admins' } } } } }), '/admins');
});

test('parses only prefixed commands', () => {
  assert.deepEqual(parseCommand('/setname Nome do grupo'), { name: 'setname', args: ['Nome', 'do', 'grupo'] });
  assert.equal(parseCommand('oi'), null);
});

test('ignores private messages without requesting group metadata', async () => {
  let called = false;
  const sock = { groupMetadata: async () => { called = true; } };
  const result = await handleGroupMessage(sock, { key: { remoteJid: `${OWNER}@s.whatsapp.net` }, message: { conversation: '/ajuda' } }, { ownerNumber: OWNER });
  assert.equal(result.reason, 'not_group');
  assert.equal(called, false);
});

test('rejects non-owner commands and does not execute moderation', async () => {
  let actionCalled = false;
  const sock = {
    user: { id: `${BOT}@s.whatsapp.net` },
    groupMetadata: async () => ({ participants: [{ id: `${BOT}@s.whatsapp.net`, admin: 'admin' }] }),
    groupParticipantsUpdate: async () => { actionCalled = true; },
  };
  const result = await handleGroupMessage(sock, {
    key: { remoteJid: '123@g.us', participant: `${MEMBER}@s.whatsapp.net`, fromMe: false },
    message: { conversation: `/kick ${MEMBER}` },
  }, { ownerNumber: OWNER });
  assert.equal(result.ok, false);
  assert.equal(actionCalled, false);
});

test('requires the bot to be a group admin before mutations', async () => {
  let actionCalled = false;
  const sock = {
    user: { id: `${BOT}@s.whatsapp.net` },
    groupMetadata: async () => ({ participants: [{ id: `${OWNER}@s.whatsapp.net`, admin: 'admin' }, { id: `${MEMBER}@s.whatsapp.net` }] }),
    groupParticipantsUpdate: async () => { actionCalled = true; },
  };
  const result = await handleGroupMessage(sock, {
    key: { remoteJid: '123@g.us', participant: `${OWNER}@s.whatsapp.net`, fromMe: false },
    message: { conversation: `/kick ${MEMBER}` },
  }, { ownerNumber: OWNER });
  assert.match(result.message, /bot a administrador/i);
  assert.equal(actionCalled, false);
});

test('only approved admin operation executes for authorized owner and admin bot', async () => {
  let call;
  const sock = {
    user: { id: `${BOT}@s.whatsapp.net` },
    groupMetadata: async () => ({ participants: [
      { id: `${BOT}@s.whatsapp.net`, admin: 'admin' },
      { id: `${OWNER}@s.whatsapp.net`, admin: 'admin' },
      { id: `${MEMBER}@s.whatsapp.net` },
    ] }),
    groupParticipantsUpdate: async (...args) => { call = args; return [{ status: 200 }]; },
  };
  const result = await handleGroupMessage(sock, {
    key: { remoteJid: '123@g.us', participant: `${OWNER}@s.whatsapp.net`, fromMe: false },
    message: { conversation: `/kick ${MEMBER}` },
  }, { ownerNumber: OWNER });
  assert.equal(result.ok, true);
  assert.deepEqual(call, ['123@g.us', [`${MEMBER}@s.whatsapp.net`], 'remove']);
});
