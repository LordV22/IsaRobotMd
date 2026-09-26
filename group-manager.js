'use strict';

const PREFIX = '/';

function digits(value = '') {
  return String(value).split('@')[0].split(':')[0].replace(/\D/g, '');
}

function getText(message = {}) {
  const payload = message.message || message;
  const node = payload.ephemeralMessage?.message
    || payload.viewOnceMessage?.message
    || payload.viewOnceMessageV2?.message
    || payload;
  return node.conversation
    || node.extendedTextMessage?.text
    || node.imageMessage?.caption
    || node.videoMessage?.caption
    || node.documentMessage?.caption
    || '';
}

function parseCommand(text = '') {
  const trimmed = text.trim();
  if (!trimmed.startsWith(PREFIX)) return null;
  const [name = '', ...args] = trimmed.slice(PREFIX.length).split(/\s+/);
  return name ? { name: name.toLowerCase(), args } : null;
}

function findTarget(message, args) {
  const mentioned = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  if (mentioned) return mentioned;
  const quoted = message.message?.extendedTextMessage?.contextInfo?.participant;
  if (args.length === 0 && quoted) return quoted;
  const candidate = args[0] || '';
  const clean = candidate.replace(/[^0-9]/g, '');
  if (clean.length < 10 || clean.length > 15) return null;
  return `${clean}@s.whatsapp.net`;
}

function identityTokens(value) {
  const candidates = Array.isArray(value) ? value : [value];
  return new Set(candidates.flatMap((item) => {
    const fields = typeof item === 'string'
      ? [item]
      : [item?.id, item?.jid, item?.lid].filter(Boolean);
    return fields.map((field) => {
      const jid = String(field);
      return jid.endsWith('@lid') ? jid : digits(jid);
    }).filter(Boolean);
  }));
}

function isAdmin(metadata, identity) {
  const expected = identityTokens(identity);
  const participant = metadata?.participants?.find((item) => {
    const actual = identityTokens(item);
    return [...expected].some((token) => actual.has(token));
  });
  return Boolean(participant?.admin || participant?.isAdmin || participant?.isSuperAdmin);
}

async function handleGroupMessage(sock, message, { ownerNumber = '', menuText = '', botMode = 'public' } = {}) {
  const groupJid = message?.key?.remoteJid || '';
  if (!groupJid.endsWith('@g.us')) return { handled: false, reason: 'not_group' };

  const text = getText(message);
  const command = parseCommand(text);
  if (!command) return { handled: false, reason: 'not_command' };

  const authorJid = message.key.participant
    || (message.key.fromMe ? sock.user?.id : '')
    || '';
  const owner = digits(ownerNumber);
  // Own-account messages can carry a LID instead of the phone JID; `fromMe`
  // is the authoritative marker for the linked account in that case.
  const isOwner = Boolean(message.key.fromMe)
    || Boolean(owner && digits(authorJid) === owner)
    || isAdmin({ participants: [{ id: authorJid, jid: authorJid }] }, sock.user);
  const ownerOnlyCommands = new Set([
    'ajuda', 'help', 'menu', 'menu2', '?', 'admins', 'kick', 'add', 'promote', 'demote',
    'setname', 'setsubject', 'setdesc', 'setdesk', 'gp', 'modoedit', 'linkgp', 'linkgc',
    'setftgp', 'setppgroup', 'setppgrup', 'marcar', 'hidetag', 'del', 'delete',
    'reviver', 'tempban', 'bcgp', 'bcgroup', 'bc', 'broadcast', 'public', 'self',
  ]);
  if (!isOwner && (botMode === 'self' || ownerOnlyCommands.has(command.name))) {
    return { handled: true, ok: false, message: 'Somente o Criador configurado pode usar os comandos administrativos.' };
  }

  const metadata = await sock.groupMetadata(groupJid);
  const botIsAdmin = isAdmin(metadata, sock.user);
  const ownerIsAdmin = isAdmin(metadata, authorJid)
    || (message.key.fromMe && isAdmin(metadata, sock.user));
  const { name, args } = command;
  const target = () => findTarget(message, args);

  if (name === 'ajuda' || name === 'help' || name === 'menu' || name === 'menu2' || name === '?') {
    return {
      handled: true,
      ok: true,
      message: menuText || [
        'Olá, Criador 👋',
        '',
        '┏━「💬 *GRUPOS*」━┓',
        '┃ • /Setname',
        '┃ • /Setdesc',
        '┃ • /Gp abrir',
        '┃ • /Gp fechar',
        '┃ • /Modoedit abrir',
        '┃ • /Modoedit fechar',
        '┃ • /Linkgp',
        '┃ • /Kick @membro',
        '┃ • /Add 55DDDNUMERO',
        '┃ • /Promote @membro',
        '┃ • /Demote @membro',
        '',
        '┗━━━━━━━━━━━━━━┛',
        '',
        '┏━「ℹ️ *INFORMAÇÕES*」━┓',
        '┃ • /Admins',
        '┃ • /Menu',
        '┗━━━━━━━━━━━━━━━━━┛',
        '',
        '⚠️ O Criador e o bot precisam ser administradores do grupo para executar os comandos.',
      ].join('\n'),
    };
  }

  if (name === 'admins') {
    const admins = (metadata.participants || [])
      .filter((participant) => participant.admin)
      .map((participant) => `• @${digits(participant.id)}`);
    return {
      handled: true,
      ok: true,
      message: admins.length ? `Administradores de ${metadata.subject || 'grupo'}:\n${admins.join('\n')}` : 'Não encontrei administradores.',
      mentions: (metadata.participants || []).filter((participant) => participant.admin).map((participant) => participant.id)
    };
  }

  const moderationCommands = new Set([
    'kick', 'add', 'promote', 'demote', 'setname', 'setsubject', 'setdesc', 'setdesk',
    'gp', 'modoedit', 'linkgp', 'linkgc',
  ]);
  if (!moderationCommands.has(name)) return { handled: false, reason: 'not_group_command' };
  if (!ownerIsAdmin) return { handled: true, ok: false, message: 'O responsável precisa ser administrador deste grupo.' };
  if (!botIsAdmin) return { handled: true, ok: false, message: 'Promova o bot a administrador para usar esse comando.' };

  switch (name) {
    case 'kick':
    case 'add':
    case 'promote':
    case 'demote': {
      const member = target();
      if (!member) return { handled: true, ok: false, message: 'Marque/responda à pessoa ou informe um número internacional válido.' };
      const action = { kick: 'remove', add: 'add', promote: 'promote', demote: 'demote' }[name];
      const result = await sock.groupParticipantsUpdate(groupJid, [member], action);
      return { handled: true, ok: true, message: `Ação ${name} solicitada.`, result };
    }
    case 'setname':
    case 'setsubject': {
      const subject = args.join(' ').trim();
      if (!subject) return { handled: true, ok: false, message: 'Uso: /setname NOVO NOME' };
      await sock.groupUpdateSubject(groupJid, subject);
      return { handled: true, ok: true, message: 'Nome do grupo atualizado.' };
    }
    case 'setdesc':
    case 'setdesk': {
      const description = args.join(' ').trim();
      if (!description) return { handled: true, ok: false, message: 'Uso: /setdesc NOVA DESCRIÇÃO' };
      await sock.groupUpdateDescription(groupJid, description);
      return { handled: true, ok: true, message: 'Descrição do grupo atualizada.' };
    }
    case 'gp': {
      const mode = args[0]?.toLowerCase();
      if (!['abrir', 'fechar'].includes(mode)) return { handled: true, ok: false, message: 'Uso: /gp abrir|fechar' };
      await sock.groupSettingUpdate(groupJid, mode === 'fechar' ? 'announcement' : 'not_announcement');
      return { handled: true, ok: true, message: mode === 'fechar' ? 'Somente administradores podem enviar mensagens.' : 'Todos os membros podem enviar mensagens.' };
    }
    case 'modoedit': {
      const mode = args[0]?.toLowerCase();
      if (!['abrir', 'fechar'].includes(mode)) return { handled: true, ok: false, message: 'Uso: /modoedit abrir|fechar' };
      await sock.groupSettingUpdate(groupJid, mode === 'fechar' ? 'locked' : 'unlocked');
      return { handled: true, ok: true, message: mode === 'fechar' ? 'Somente administradores podem editar os dados do grupo.' : 'Administradores e membros podem editar os dados do grupo.' };
    }
    case 'linkgp':
    case 'linkgc': {
      const code = await sock.groupInviteCode(groupJid);
      return { handled: true, ok: true, message: `Link de convite: https://chat.whatsapp.com/${code}` };
    }
    default:
      return { handled: false, reason: 'not_group_command' };
  }
}

module.exports = { digits, getText, parseCommand, findTarget, isAdmin, handleGroupMessage };
