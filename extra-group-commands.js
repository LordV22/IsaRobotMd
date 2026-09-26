'use strict';

const { getText, parseCommand, digits, isAdmin } = require('./group-manager');
const { readMedia, mediaFrom, quotedTarget } = require('./media-tools');
const fs = require('node:fs/promises');
const path = require('node:path');

const tempBans = new Map();
let botMode = process.env.BOT_MODE === 'public' ? 'public' : 'self';
const actionCooldowns = new Map();
const MAX_BROADCAST_GROUPS = 100;
const MAX_BROADCAST_LENGTH = 1000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function senderJid(message, sock) {
  return message?.key?.participant || (message?.key?.fromMe ? sock?.user?.id : '') || '';
}

function isCreator(message, sock, ownerNumber) {
  return Boolean(message?.key?.fromMe) || Boolean(ownerNumber && digits(senderJid(message, sock)) === digits(ownerNumber));
}

function mentionedJids(message = {}) {
  const node = message.message || {};
  const context = node.extendedTextMessage?.contextInfo
    || node.imageMessage?.contextInfo
    || node.videoMessage?.contextInfo;
  const values = [...(context?.mentionedJid || [])];
  if (context?.participant) values.push(context.participant);
  return [...new Set(values)];
}

async function requireGroupAdmin(sock, message, ownerNumber) {
  const groupJid = message.key.remoteJid;
  if (!groupJid?.endsWith('@g.us')) throw new Error('Esse comando funciona somente em grupos.');
  if (!isCreator(message, sock, ownerNumber)) throw new Error('Somente o Criador configurado pode usar esse comando.');
  const actor = senderJid(message, sock);
  const metadata = await sock.groupMetadata(groupJid);
  const ownerIsAdmin = isAdmin(metadata, actor)
    || (message.key.fromMe && isAdmin(metadata, sock.user));
  if (!ownerIsAdmin) throw new Error('O Criador precisa ser administrador deste grupo.');
  if (!isAdmin(metadata, sock.user)) throw new Error('Promova o bot a administrador para usar esse comando.');
  return metadata;
}

async function handleExtraGroupCommand(sock, message, { ownerNumber = '', env = process.env } = {}) {
  const groupJid = message?.key?.remoteJid || '';
  if (!groupJid.endsWith('@g.us')) return { handled: false, reason: 'not_group' };
  const command = parseCommand(getText(message));
  if (!command) return { handled: false, reason: 'not_command' };
  const { name, args } = command;
  const aliases = {
    setftgp: 'setftgp', setppgroup: 'setftgp', setppgrup: 'setftgp',
    setftbot: 'setftbot',
    marcar: 'marcar', hidetag: 'hidetag', del: 'del', delete: 'del',
    reviver: 'reviver', tempban: 'tempban', bcgp: 'bcgp', bcgroup: 'bcgp', bc: 'bcgp', broadcast: 'bcgp',
    public: 'mode_public', self: 'mode_self',
  };
  const action = aliases[name];
  if (!action) return { handled: false, reason: 'not_extra_group_command' };
  if (!isCreator(message, sock, ownerNumber)) return { handled: true, message: 'Somente o Criador configurado pode usar os comandos.' };
  if (action === 'mode_public' || action === 'mode_self') {
    botMode = action === 'mode_public' ? 'public' : 'self';
    const directory = path.resolve(env.AUTH_DIR || './auth_info_baileys');
    const stateFile = path.resolve(env.BOT_MODE_FILE || path.join(directory, 'bot-mode.json'));
    await fs.mkdir(path.dirname(stateFile), { recursive: true, mode: 0o700 });
    const tempFile = `${stateFile}.${process.pid}.tmp`;
    await fs.writeFile(tempFile, `${JSON.stringify({ mode: botMode })}\n`, { mode: 0o600 });
    await fs.rename(tempFile, stateFile);
    return { handled: true, message: `Modo ${botMode === 'public' ? 'público' : 'restrito ao Criador'} ativado.` };
  }
  if (action === 'setftbot') {
    const mediaMessage = mediaFrom(message) ? message : quotedTarget(message);
    if (!mediaMessage) return { handled: true, message: 'Envie ou responda a uma imagem com /setftbot.' };
    const { buffer, kind } = await readMedia(mediaMessage);
    if (kind !== 'image') return { handled: true, message: 'A foto global do bot precisa ser uma imagem.' };
    await sock.updateProfilePicture(sock.user?.id, buffer);
    return { handled: true, message: 'Foto global do bot atualizada.' };
  }
  const cooldownKey = `${message.key.remoteJid}:${action}`;
  const now = Date.now();
  if ((actionCooldowns.get(cooldownKey) || 0) > now) return { handled: true, message: 'Aguarde um instante antes de repetir essa ação.' };
  if (['marcar', 'hidetag'].includes(action)) actionCooldowns.set(cooldownKey, now + 10000);
  const body = args.join(' ').trim();
  const metadata = await requireGroupAdmin(sock, message, ownerNumber);

  if (action === 'setftgp') {
    const mediaMessage = mediaFrom(message) ? message : quotedTarget(message);
    if (!mediaMessage) return { handled: true, message: 'Envie ou responda a uma imagem com /setftgp.' };
    const { buffer, kind } = await readMedia(mediaMessage);
    if (kind !== 'image') return { handled: true, message: 'A foto do grupo precisa ser uma imagem.' };
    if (typeof sock.updateProfilePicture !== 'function') return { handled: true, message: 'A biblioteca atual não oferece suporte a trocar a foto do grupo.' };
    await sock.updateProfilePicture(groupJid, buffer);
    return { handled: true, message: 'Foto do grupo atualizada.' };
  }

  if (action === 'marcar' || action === 'hidetag') {
    const members = (metadata.participants || []).map((item) => item.id || item.jid).filter(Boolean).slice(0, 200);
    if (!members.length) return { handled: true, message: 'Não encontrei participantes para mencionar.' };
    const text = body || (action === 'marcar' ? 'Atenção, membros do grupo:' : '');
    await sock.sendMessage(groupJid, { text, mentions: members }, { quoted: message });
    return { handled: true };
  }

  if (action === 'del') {
    const node = message.message || {};
    const context = node.extendedTextMessage?.contextInfo;
    if (!context?.stanzaId || !context?.participant) return { handled: true, message: 'Responda à mensagem do próprio bot que deseja apagar e envie /del.' };
    if (digits(context.participant) !== digits(sock.user?.id)) return { handled: true, message: 'Só posso apagar uma mensagem enviada pelo próprio bot.' };
    await sock.sendMessage(groupJid, { delete: { remoteJid: groupJid, id: context.stanzaId, participant: context.participant, fromMe: true } });
    return { handled: true };
  }

  const target = mentionedJids(message)[0] || (body.match(/(?:^|\s)(\d{10,15})(?:\s|$)/)?.[1] ? `${body.match(/(?:^|\s)(\d{10,15})(?:\s|$)/)[1]}@s.whatsapp.net` : '');
  if (action === 'reviver' || action === 'tempban') {
    if (!target) return { handled: true, message: `Uso: /${action} @membro ou /${action} 55DDDNUMERO` };
    if (action === 'reviver') {
      await sock.groupParticipantsUpdate(groupJid, [target], 'add');
      return { handled: true, message: 'Convite para readicionar o membro solicitado.' };
    }
    const timerKey = `${groupJid}:${target}`;
    if (tempBans.has(timerKey)) return { handled: true, message: 'Esse membro já tem um retorno temporizado pendente.' };
    await sock.groupParticipantsUpdate(groupJid, [target], 'remove');
    const timer = setTimeout(async () => {
      tempBans.delete(timerKey);
      try {
        const current = await sock.groupMetadata(groupJid);
        if (current.participants.some((item) => digits(item.id || item.jid) === digits(target))) return;
        await sock.groupParticipantsUpdate(groupJid, [target], 'add');
      } catch (error) {
        console.error(`Falha no retorno temporizado ao grupo: ${error.message}`);
      }
    }, 5 * 60 * 1000);
    timer.unref?.();
    tempBans.set(timerKey, timer);
    return { handled: true, message: 'Membro removido por 5 minutos; o bot tentará readicioná-lo depois, se o WhatsApp permitir.' };
  }

  if (action === 'bcgp') {
    const match = body.match(/^CONFIRMAR\s+([\s\S]+)$/i);
    if (!match) return { handled: true, message: 'Para evitar envio acidental, use: /bcgp CONFIRMAR texto. Isso envia o texto a todos os grupos onde o bot está.' };
    const broadcastText = match[1].trim().slice(0, MAX_BROADCAST_LENGTH);
    if (!broadcastText) return { handled: true, message: 'Informe o texto depois de CONFIRMAR.' };
    if ((actionCooldowns.get(cooldownKey) || 0) > Date.now()) return { handled: true, message: 'Aguarde antes de iniciar outro broadcast.' };
    actionCooldowns.set(cooldownKey, Date.now() + 60000);
    const groups = await sock.groupFetchAllParticipating();
    const targets = Object.keys(groups || {}).slice(0, MAX_BROADCAST_GROUPS);
    if (!targets.length) return { handled: true, message: 'O bot não participa de grupos.' };
    await sock.sendMessage(groupJid, { text: `Confirmação recebida. Enviarei a mensagem a ${targets.length} grupo(s).` }, { quoted: message });
    let sent = 0;
    let failed = 0;
    for (const targetJid of targets) {
      try {
        await sock.sendMessage(targetJid, { text: broadcastText });
        sent += 1;
      } catch (error) {
        failed += 1;
        console.error(`Falha em broadcast de grupo: ${error.message}`);
      }
      await sleep(1500);
    }
    return { handled: true, message: `Envio concluído: ${sent} grupo(s); falhas: ${failed}. Limite por comando: ${MAX_BROADCAST_GROUPS} grupos.` };
  }

  return { handled: false };
}

async function initBotMode(env = process.env) {
  const directory = path.resolve(env.AUTH_DIR || './auth_info_baileys');
  const stateFile = path.resolve(env.BOT_MODE_FILE || path.join(directory, 'bot-mode.json'));
  try {
    const state = JSON.parse(await fs.readFile(stateFile, 'utf8'));
    if (state.mode === 'self' || state.mode === 'public') botMode = state.mode;
  } catch (error) {
    if (error.code !== 'ENOENT') console.error(`Não foi possível ler o modo salvo: ${error.message}`);
  }
  return botMode;
}

function getBotMode() { return botMode; }

module.exports = { handleExtraGroupCommand, requireGroupAdmin, isCreator, tempBans, initBotMode, getBotMode };
