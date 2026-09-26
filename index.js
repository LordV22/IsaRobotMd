'use strict';

const pino = require('pino');
const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
} = require('@whiskeysockets/baileys');
const { handleGroupMessage } = require('./group-manager');
const { formatMenu, handleFeatureMessage } = require('./feature-manager');
const { handleExtraGroupCommand, initBotMode, getBotMode } = require('./extra-group-commands');

const authDir = process.env.AUTH_DIR || './auth_info_baileys';
const ownerNumber = (process.env.OWNER_NUMBER || '').replace(/\D/g, '');
const pairingNumber = (process.env.WHATSAPP_PHONE || '').replace(/\D/g, '');

if (!ownerNumber) throw new Error('Configure OWNER_NUMBER nas variáveis privadas do serviço.');
if (!pairingNumber) throw new Error('Configure WHATSAPP_PHONE nas variáveis privadas do serviço.');

let stopping = false;
let reconnectTimer;

async function start() {
  await initBotMode({ ...process.env, AUTH_DIR: authDir });
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  let pairingRequested = false;
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr && !sock.authState.creds.registered && !pairingRequested) {
      pairingRequested = true;
      try {
        const code = await sock.requestPairingCode(pairingNumber);
        console.log(`PAIRING_CODE=${code}`);
        console.log('Digite o código no WhatsApp somente se reconhecer o nome/ambiente deste serviço.');
      } catch (error) {
        pairingRequested = false;
        console.error(`Falha ao solicitar código de pareamento: ${error.message}`);
      }
    }

    if (connection === 'open') console.log('WhatsApp conectado; comandos de grupo e ferramentas de mídia ativos.');
    if (connection === 'close' && !stopping) {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode === DisconnectReason.loggedOut) {
        console.error('WhatsApp encerrou a sessão. Remova/revogue o dispositivo antes de tentar novamente.');
        return;
      }
      if (!reconnectTimer) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = undefined;
          start().catch((error) => console.error(`Falha ao reconectar: ${error.message}`));
        }, 3000);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type, requestId }) => {
    if (type !== 'notify' || requestId) return;
    for (const message of messages || []) {
      if (!message?.message || !message.key?.remoteJid?.endsWith('@g.us')) continue;
      try {
        const context = { ownerNumber, env: process.env, menuText: formatMenu(), botMode: getBotMode() };
        let result = await handleGroupMessage(sock, message, context);
        if (!result.handled) result = await handleExtraGroupCommand(sock, message, context);
        if (!result.handled) result = await handleFeatureMessage(sock, message, context);
        if (!result.handled || !result.message) continue;
        await sock.sendMessage(message.key.remoteJid, {
          text: String(result.message).slice(0, 4000),
          ...(result.mentions?.length ? { mentions: result.mentions } : {}),
        }, { quoted: message });
      } catch (error) {
        console.error(`Falha em comando de grupo: ${error.message}`);
        const explanation = String(error.message || '').replace(/[<>\u0000-\u001f]/g, ' ').slice(0, 220);
        await sock.sendMessage(message.key.remoteJid, {
          text: explanation ? `Não consegui concluir: ${explanation}` : 'Não consegui concluir o comando.',
        }, { quoted: message }).catch(() => {});
      }
    }
  });

  return sock;
}

process.once('SIGTERM', () => { stopping = true; clearTimeout(reconnectTimer); process.exit(0); });
process.once('SIGINT', () => { stopping = true; clearTimeout(reconnectTimer); process.exit(0); });

start().catch((error) => {
  console.error(`Falha ao iniciar o bot: ${error.message}`);
  process.exitCode = 1;
});
