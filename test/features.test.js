'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { formatMenu, featureAvailability, encodeBinary, decodeBinary, searchBrave, searchYouTube } = require('../feature-manager');
const { periodKey, consumeApiUse } = require('../api-limits');
const { toSticker, toPng, runFfmpeg } = require('../media-tools');

const TINY_PNG = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=16x16', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1']);

test('original menu includes implemented functions and honest blocked command information', () => {
  const menu = formatMenu({});
  for (const command of ['/menu2', '/Setname', '/Setftgp', '/Marcar', '/Hidetag', '/Tempban', '/Bcgp', '/F', '/Toimg', '/Toaud', '/Tomp3', '/Reverse', '/Yts', '/Google', '/Gimagem', '/Pinterest', '/Wikimedia', '/Metadinha', '/Semfundo', '/Public', '/Self']) {
    assert.match(menu, new RegExp(command.replace('/', '\\/'), 'i'));
  }
  assert.match(menu, /desativad[oa]/i);
  assert.match(menu, /CONFIRMAR/);
});

test('API features are unavailable until credentials are configured', () => {
  assert.deepEqual(featureAvailability({}), {
    ffmpeg: true, brave: false, youtube: false, pinterest: false, removeBg: false, publicUploads: false,
  });
});

test('search APIs fail closed when keys are missing', async () => {
  await assert.rejects(() => searchBrave('test', { env: {} }), /BRAVE_API_KEY/);
  await assert.rejects(() => searchYouTube('test', {}), /YOUTUBE_API_KEY/);
});

test('binary encoding round-trips Portuguese and non-Latin Unicode', () => {
  const input = 'Olá, Criador ⚡ — 你好';
  assert.equal(decodeBinary(encodeBinary(input)), input);
  assert.throws(() => decodeBinary('2 10'), /inválido/);
});

test('periodic API quota windows are deterministic', () => {
  const date = new Date('2026-09-25T12:00:00Z');
  assert.equal(periodKey('brave', date), 'month:2026-09');
  assert.equal(periodKey('youtube', date), 'day:2026-09-25');
});

test('API usage limit is persisted privately and then denies overage', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'isabot-api-'));
  const env = { AUTH_DIR: directory };
  try {
    const first = await consumeApiUse('youtube', { env, limit: 1 });
    assert.equal(first.used, 1);
    await assert.rejects(() => consumeApiUse('youtube', { env, limit: 1 }), /Limite de segurança/);
    const stats = await fs.stat(path.join(directory, 'api-usage.json'));
    assert.equal(stats.mode & 0o077, 0);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('ffmpeg converts a tiny local PNG into a WebP sticker and back to PNG', async () => {
  const webp = await toSticker(TINY_PNG);
  assert.ok(webp.length > 12);
  assert.equal(webp.subarray(0, 4).toString(), 'RIFF');
  assert.equal(webp.subarray(8, 12).toString(), 'WEBP');
  const png = await toPng(webp);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
});

test('ffmpeg wrapper rejects empty content', async () => {
  await assert.rejects(() => runFfmpeg(Buffer.alloc(0), [], 'webp'), /vazia/);
});
