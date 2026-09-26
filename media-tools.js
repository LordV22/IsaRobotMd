'use strict';

const { spawn } = require('node:child_process');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 24 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 45000;
const FFMPEG_TIMEOUT_MS = 45000;

function unwrap(message = {}) {
  let node = message.message || message;
  while (node?.ephemeralMessage?.message || node?.viewOnceMessage?.message || node?.viewOnceMessageV2?.message) {
    node = node.ephemeralMessage?.message || node.viewOnceMessage?.message || node.viewOnceMessageV2?.message;
  }
  return node || {};
}

function mediaFrom(message = {}) {
  const node = unwrap(message);
  for (const kind of ['image', 'video', 'audio', 'document', 'sticker']) {
    if (node[`${kind}Message`]) return { kind, content: node[`${kind}Message`] };
  }
  return null;
}

function quotedTarget(message = {}) {
  const node = unwrap(message);
  const context = node.extendedTextMessage?.contextInfo
    || node.imageMessage?.contextInfo
    || node.videoMessage?.contextInfo
    || node.documentMessage?.contextInfo;
  if (!context?.quotedMessage) return null;
  return {
    key: {
      remoteJid: message.key?.remoteJid,
      id: context.stanzaId,
      participant: context.participant,
      fromMe: false,
    },
    message: context.quotedMessage,
  };
}

async function readMedia(message) {
  const source = mediaFrom(message) ? message : quotedTarget(message);
  if (!source) throw new Error('Envie ou responda a uma imagem, vídeo ou áudio compatível.');
  const media = mediaFrom(source);
  if (!media || !['image', 'video', 'audio', 'document', 'sticker'].includes(media.kind)) {
    throw new Error('Este tipo de mídia não pode ser convertido.');
  }
  const declaredSize = Number(media.content.fileLength || 0);
  if (declaredSize > MAX_INPUT_BYTES) throw new Error('Arquivo acima do limite de 20 MB.');

  const stream = await downloadContentFromMessage(media.content, media.kind);
  const chunks = [];
  let total = 0;
  const timer = setTimeout(() => stream.destroy(new Error('Tempo de download excedido.')), DOWNLOAD_TIMEOUT_MS);
  try {
    for await (const chunk of stream) {
      total += chunk.length;
      if (total > MAX_INPUT_BYTES) {
        stream.destroy();
        throw new Error('Arquivo acima do limite de 20 MB.');
      }
      chunks.push(Buffer.from(chunk));
    }
  } finally {
    clearTimeout(timer);
  }
  return { buffer: Buffer.concat(chunks), kind: media.kind };
}

function runFfmpeg(input, args, format, { maxInputBytes = MAX_INPUT_BYTES, maxOutputBytes = MAX_OUTPUT_BYTES } = {}) {
  if (!Buffer.isBuffer(input) || input.length === 0) return Promise.reject(new Error('Mídia vazia ou inválida.'));
  if (input.length > maxInputBytes) return Promise.reject(new Error('Arquivo acima do limite permitido.'));

  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '2',
      '-i', 'pipe:0', ...args, '-f', format, 'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    const output = [];
    const errors = [];
    let outputSize = 0;
    let errorSize = 0;
    let settled = false;

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error('A conversão excedeu o tempo limite.'));
    }, FFMPEG_TIMEOUT_MS);

    child.on('error', (error) => finish(new Error(`Não foi possível iniciar ffmpeg: ${error.message}`)));
    child.stdout.on('data', (chunk) => {
      outputSize += chunk.length;
      if (outputSize > maxOutputBytes) {
        child.kill('SIGKILL');
        finish(new Error('O resultado ficou acima do limite de 24 MB.'));
        return;
      }
      output.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      if (errorSize < 8192) {
        const part = chunk.subarray(0, 8192 - errorSize);
        errors.push(part);
        errorSize += part.length;
      }
    });
    child.on('close', (code) => {
      if (settled) return;
      if (code !== 0 || outputSize === 0) {
        const detail = Buffer.concat(errors).toString('utf8').trim().split('\n').slice(-2).join(' ').slice(0, 300);
        finish(new Error(detail || 'Formato de mídia não suportado.'));
        return;
      }
      finish(null, Buffer.concat(output));
    });
    child.stdin.on('error', (error) => {
      if (!settled) finish(new Error(`Falha ao enviar mídia para conversão: ${error.message}`));
    });
    child.stdin.end(input);
  });
}

const stickerFilter = 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,format=rgba';

async function toSticker(input, { animated = false } = {}) {
  const args = ['-vf', stickerFilter, '-c:v', 'libwebp', '-quality', '78', '-preset', 'picture', '-an'];
  if (animated) args.push('-t', '9', '-loop', '0');
  else args.push('-frames:v', '1');
  return runFfmpeg(input, args, 'webp');
}

async function toPng(input) {
  return runFfmpeg(input, ['-frames:v', '1', '-c:v', 'png'], 'image2pipe');
}

async function toMp3(input) {
  return runFfmpeg(input, ['-vn', '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100'], 'mp3');
}

async function toVoiceNote(input) {
  return runFfmpeg(input, ['-vn', '-c:a', 'libopus', '-b:a', '64k', '-vbr', 'on', '-application', 'voip'], 'ogg');
}

const EFFECTS = Object.freeze({
  bass: ['-af', 'equalizer=f=90:width_type=o:width=2:g=8'],
  blown: ['-af', 'acrusher=bits=8:mode=log:aa=1'],
  deep: ['-af', 'asetrate=44100*0.82,aresample=44100'],
  earrape: ['-af', 'volume=3dB'],
  fast: ['-af', 'atempo=1.5'],
  fat: ['-af', 'asetrate=44100*0.85,aresample=44100'],
  nightcore: ['-af', 'asetrate=44100*1.12,aresample=44100,atempo=1.04'],
  reverse: ['-af', 'areverse'],
  robot: ['-af', "afftfilt=real='hypot(re,im)*sin(0)':imag='hypot(re,im)*cos(0)':win_size=512:overlap=0.75"],
  slow: ['-af', 'atempo=0.75'],
  smooth: ['-af', 'highpass=f=100,lowpass=f=9000'],
  tupai: ['-af', 'asetrate=44100*1.22,aresample=44100'],
});

async function applyVoiceEffect(input, effect) {
  const args = EFFECTS[effect];
  if (!args) throw new Error('Efeito de voz não disponível.');
  return runFfmpeg(input, ['-vn', ...args, '-c:a', 'libmp3lame', '-b:a', '128k'], 'mp3');
}

module.exports = {
  MAX_INPUT_BYTES,
  MAX_OUTPUT_BYTES,
  EFFECTS,
  unwrap,
  mediaFrom,
  quotedTarget,
  readMedia,
  runFfmpeg,
  toSticker,
  toPng,
  toMp3,
  toVoiceNote,
  applyVoiceEffect,
};
