'use strict';

const pino = require('pino');
const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
} = require('@whiskeysockets/baileys');
const { handleGroupMessage } = require('./group-manager');

const authDir = process.env.AUTH_DIR || './auth_info_baileys';
const ownerNumber = (process.env.OWNER_NUMBER || '').replace(/\D/g, '');
const pairingNumber = (process.env.WHATSAPP_PHONE || '').replace(/\D/g, '');

if (!ownerNumber) throw new Error('Configure OWNER_NUMBER nas variáveis privadas do serviço.');
if (!pairingNumber) throw new Error('Configure WHATSAPP_PHONE nas variáveis privadas do serviço.');

let stopping = false;
let reconnectTimer;

async function start() {
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

    if (connection === 'open') console.log('WhatsApp conectado; modo restrito de gerenciamento de grupos ativo.');
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
        const result = await handleGroupMessage(sock, message, { ownerNumber });
        if (!result.handled || !result.message) continue;
        await sock.sendMessage(message.key.remoteJid, {
          text: result.message,
          ...(result.mentions?.length ? { mentions: result.mentions } : {}),
        }, { quoted: message });
      } catch (error) {
        console.error(`Falha em comando de grupo: ${error.message}`);
        await sock.sendMessage(message.key.remoteJid, { text: 'Não consegui concluir o comando. Verifique permissões de administrador.' }, { quoted: message }).catch(() => {});
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
