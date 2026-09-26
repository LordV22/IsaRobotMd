'use strict';

const { getText, parseCommand, digits } = require('./group-manager');
const media = require('./media-tools');
const { consumeApiUse } = require('./api-limits');

const MAX_QUERY_LENGTH = 180;
const MAX_EXTERNAL_BYTES = 12 * 1024 * 1024;
const USER_AGENT = 'IsaBot/2.1 (+https://github.com/LordV22/IsaRobotMd)';
const lastUsed = new Map();

function decodeHtml(value = '') {
  return String(value)
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function cleanText(value = '', max = 500) {
  return String(value).replace(/[<>\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

async function boundedFetch(url, { hosts, headers = {}, maxBytes = MAX_EXTERNAL_BYTES, timeoutMs = 12000 } = {}) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !hosts.includes(parsed.hostname)) throw new Error('Destino externo não permitido.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(parsed, { headers: { 'user-agent': USER_AGENT, ...headers }, signal: controller.signal, redirect: 'error' });
    if (!response.ok) throw new Error(`Serviço externo respondeu ${response.status}.`);
    const length = Number(response.headers.get('content-length') || 0);
    if (length > maxBytes) throw new Error('Resposta externa excedeu o limite permitido.');
    if (!response.body) throw new Error('Resposta externa vazia.');
    const chunks = [];
    let total = 0;
    for await (const chunk of response.body) {
      total += chunk.length;
      if (total > maxBytes) throw new Error('Resposta externa excedeu o limite permitido.');
      chunks.push(Buffer.from(chunk));
    }
    return { response, buffer: Buffer.concat(chunks) };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, options) {
  const { response, buffer } = await boundedFetch(url, { ...options, maxBytes: 2 * 1024 * 1024 });
  if (!String(response.headers.get('content-type') || '').includes('json')) throw new Error('Formato inesperado da API.');
  return JSON.parse(buffer.toString('utf8'));
}

function encodeBinary(text) {
  const input = String(text || '');
  if (!input || input.length > 5000) throw new Error('Informe um texto de até 5.000 caracteres.');
  return Array.from(input, (character) => character.codePointAt(0).toString(2)).join(' ');
}

function decodeBinary(text) {
  const input = String(text || '').trim();
  if (!input || input.length > 25000) throw new Error('Informe até 25.000 caracteres binários.');
  const chunks = input.split(/\s+/);
  if (chunks.length > 5000 || chunks.some((chunk) => !/^[01]{1,21}$/.test(chunk))) {
    throw new Error('Formato inválido. Use grupos binários separados por espaço.');
  }
  const codepoints = chunks.map((chunk) => Number.parseInt(chunk, 2));
  if (codepoints.some((point) => point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff))) {
    throw new Error('O texto binário contém um caractere inválido.');
  }
  return String.fromCodePoint(...codepoints);
}

function featureAvailability(env = process.env) {
  return {
    ffmpeg: env.MEDIA_TOOLS_ENABLED !== 'false',
    brave: Boolean(env.BRAVE_API_KEY),
    youtube: Boolean(env.YOUTUBE_API_KEY),
    pinterest: Boolean(env.PINTEREST_ACCESS_TOKEN),
    removeBg: false,
    publicUploads: false,
  };
}

function formatMenu(env = process.env) {
  const available = featureAvailability(env);
  const lines = [
    'Olá, Criador 👋',
    '',
    'Menu2 original — envie /menu2 para abrir; funções compatíveis neste worker:',
    '',
    '┏━「💟 *FIGURINHA*」━┓',
    '┃ • /F — imagem/vídeo para figurinha (vídeo máx. 9s)',
    '┃ • /Toimg — figurinha para PNG',
    '┗━━━━━━━━━━━━━━┛',
    '',
    '┏━「💬 *GRUPOS*」━┓',
    '┃ • /Setname, /Setdesc, /Setftgp',
    '┃ • /Marcar, /Hidetag, /Gp abrir|fechar',
    '┃ • /Modoedit abrir|fechar, /Linkgp, /Admins',
    '┃ • /Del, /Kick, /Add, /Reviver',
    '┃ • /Promote, /Demote, /Tempban (5 min)',
    '┃ • /Bcgp — exige /Bcgp CONFIRMAR texto',
    '┃ • /Infomsg e /Onlines: desativados por privacidade',
    '┃ • /Clonn: desativado; cria grupos em massa',
    '┗━━━━━━━━━━━━━━┛',
    '',
    '┏━「⚙️ *TOOLS*」━┓',
    '┃ • /Codificar, /Decodificar — binário',
    '┃ • /Toaud, /Tomp3, /Tovn',
    available.publicUploads ? '┃ • /Tourl — upload público habilitado' : '┃ • /Tourl — desativado; exige serviço externo e opt-in',
    '┗━━━━━━━━━━━━━━┛',
    '',
    '┏━「🔎 *PESQUISA*」━┓',
    available.youtube ? '┃ • /Yts e /Play — pesquisa YouTube (links)' : '┃ • /Yts e /Play — configurar YOUTUBE_API_KEY',
    available.brave ? '┃ • /Google e /Gimagem — via Brave Search' : '┃ • /Google e /Gimagem — configurar BRAVE_API_KEY',
    available.pinterest ? '┃ • /Pinterest — API oficial (beta; se liberada)' : '┃ • /Pinterest — aguardando acesso/token oficial',
  ];
  lines.push('┗━━━━━━━━━━━━━━━━━━━━━━┛', '');
  lines.push('┏━「🖼 *IMAGENS*」━┓');
  lines.push('┃ • /Metadinha — busca de imagens com fonte/licença');
  lines.push('┃ • /Coffe, /Wallpaper, /Wikimedia — Wikimedia Commons');
  lines.push('┃ • /Semfundo — pendente API/migração + consentimento de terceiros');
  lines.push('┗━━━━━━━━━━━━━━┛', '');
  lines.push('┏━「▶️ *YOUTUBE*」━┓', '┃ • /Play e /Yts — links para assistir no YouTube', '┃ • Downloads de áudio/vídeo não são redistribuídos', '┗━━━━━━━━━━━━━━┛', '');
  lines.push('┏━「🔊 *VOICE CHANGER*」━┓');
  lines.push('┃ • /Bass, /Blown, /Deep, /Earrape, /Fast, /Fat');
  lines.push('┃ • /Nightcore, /Reverse, /Robot, /Slow, /Smooth, /Tupai');
  lines.push('┗━━━━━━━━━━━━━━━━━━━━━━┛', '');
  lines.push('┏━「👤 *DONO*」━┓', '┃ • /Public, /Self — alternar modo de comandos gerais', '┃ • /Setftbot — imagem respondida muda a foto do bot', '┗━━━━━━━━━━━━━┛');
  lines.push('ℹ️ Arquivos para conversão: até 20 MB; use respondendo à mídia.');
  lines.push('⚠️ O Criador e o bot precisam ser admins para alterar o grupo.');
  return lines.join('\n');
}

function isImageMessage(message) {
  const info = media.mediaFrom(message);
  return Boolean(info && ['image', 'video', 'sticker'].includes(info.kind));
}

function mediaCaption(result, index, query) {
  const info = result.imageinfo?.[0] || {};
  const license = info.extmetadata?.LicenseShortName?.value || 'licença indicada na página';
  const artist = cleanText(decodeHtml(info.extmetadata?.Artist?.value || 'autor na página de origem'), 120);
  const description = cleanText(decodeHtml(result.title?.replace(/^File:/, '') || query), 180);
  return `${description}\nAutor: ${artist}\nLicença: ${cleanText(decodeHtml(license), 80)}\nFonte: ${info.descriptionurl || 'Wikimedia Commons'}`.slice(0, 850);
}

async function getCommonsPages(query, limit = 6) {
  const term = cleanText(query, MAX_QUERY_LENGTH);
  if (!term) throw new Error('Informe o que você quer pesquisar. Exemplo: /wikimedia café');
  const endpoint = new URL('https://commons.wikimedia.org/w/api.php');
  for (const [key, value] of Object.entries({
    action: 'query', generator: 'search', gsrsearch: term, gsrnamespace: '6', gsrwhat: 'text',
    gsrlimit: String(Math.min(10, limit)), prop: 'imageinfo', iiprop: 'url|extmetadata|size', iiurlwidth: '900', format: 'json',
  })) endpoint.searchParams.set(key, value);
  const data = await fetchJson(endpoint, { hosts: ['commons.wikimedia.org'] });
  const pages = Object.values(data.query?.pages || {}).filter((page) => page.imageinfo?.[0]?.thumburl || page.imageinfo?.[0]?.url);
  return { pages, term };
}

async function sendCommonsPage(sock, message, selected, query) {
  const info = selected.imageinfo[0];
  const imageUrl = info.thumburl || info.url;
  const parsed = new URL(imageUrl);
  if (!['upload.wikimedia.org'].includes(parsed.hostname) || parsed.protocol !== 'https:') throw new Error('A imagem retornada não passou na validação de origem.');
  const { response, buffer } = await boundedFetch(parsed, { hosts: ['upload.wikimedia.org'], maxBytes: MAX_EXTERNAL_BYTES });
  if (!String(response.headers.get('content-type') || '').startsWith('image/')) throw new Error('O resultado não era uma imagem válida.');
  await sock.sendMessage(message.key.remoteJid, { image: buffer, mimetype: response.headers.get('content-type'), caption: mediaCaption(selected, 0, query) }, { quoted: message });
}

async function searchCommons(sock, message, query) {
  const { pages, term } = await getCommonsPages(query, 6);
  if (!pages.length) return { handled: true, message: 'Não encontrei imagens para esse termo.' };
  await sendCommonsPage(sock, message, pages[0], term);
  return { handled: true };
}

async function searchBrave(query, { image = false, env = process.env } = {}) {
  if (!env.BRAVE_API_KEY) throw new Error('Busca geral requer BRAVE_API_KEY nas variáveis privadas do Railway.');
  await consumeApiUse('brave', { env, limit: Number(env.BRAVE_MONTHLY_LIMIT || 900) });
  const url = new URL(`https://api.search.brave.com/res/v1/${image ? 'images' : 'web'}/search`);
  url.searchParams.set('q', cleanText(query, MAX_QUERY_LENGTH));
  url.searchParams.set('count', '5');
  url.searchParams.set('safesearch', 'strict');
  if (image) url.searchParams.set('country', 'BR');
  const { response, buffer } = await boundedFetch(url, {
    hosts: ['api.search.brave.com'], maxBytes: 2 * 1024 * 1024,
    headers: { accept: 'application/json', 'x-subscription-token': env.BRAVE_API_KEY },
  });
  if (!String(response.headers.get('content-type') || '').includes('json')) throw new Error('Resposta inesperada da Brave Search API.');
  const data = JSON.parse(buffer.toString('utf8'));
  return image ? data.results || [] : data.web?.results || [];
}

async function searchYouTube(query, env = process.env) {
  if (!env.YOUTUBE_API_KEY) throw new Error('Busca YouTube não está configurada: falta YOUTUBE_API_KEY.');
  await consumeApiUse('youtube', { env, limit: Number(env.YOUTUBE_DAILY_LIMIT || 30) });
  const url = new URL('https://youtube.googleapis.com/youtube/v3/search');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('type', 'video');
  url.searchParams.set('maxResults', '5');
  url.searchParams.set('q', cleanText(query, MAX_QUERY_LENGTH));
  url.searchParams.set('key', env.YOUTUBE_API_KEY);
  const data = await fetchJson(url, { hosts: ['youtube.googleapis.com'] });
  return data.items || [];
}

async function searchPinterest(query, env = process.env) {
  if (!env.PINTEREST_ACCESS_TOKEN) throw new Error('Pinterest requer PINTEREST_ACCESS_TOKEN e aprovação beta do endpoint oficial. Não uso scraping.');
  await consumeApiUse('pinterest', { env, limit: Number(env.PINTEREST_DAILY_LIMIT || 20) });
  const url = new URL('https://api.pinterest.com/v5/search/partner/pins');
  url.searchParams.set('term', cleanText(query, MAX_QUERY_LENGTH));
  url.searchParams.set('country_code', 'BR');
  url.searchParams.set('limit', '5');
  const data = await fetchJson(url, { hosts: ['api.pinterest.com'], headers: { authorization: `Bearer ${env.PINTEREST_ACCESS_TOKEN}` } });
  return data.items || [];
}

async function handleFeatureMessage(sock, message, { env = process.env, ownerNumber = '', botMode = 'public', now = Date.now() } = {}) {
  if (!message?.key?.remoteJid?.endsWith('@g.us')) return { handled: false, reason: 'not_group' };
  const command = parseCommand(getText(message));
  if (!command) return { handled: false, reason: 'not_command' };
  const { name, args } = command;
  const query = args.join(' ').trim();
  const content = media.unwrap(message);
  const context = content.extendedTextMessage?.contextInfo || {};
  const quotedMessage = context.quotedMessage;
  const mediaMessage = isImageMessage(message) ? message : quotedMessage ? { message: quotedMessage } : message;
  const sender = digits(message.key.participant || 'unknown');

  const localCommands = new Set([
    'fig', 'f', 'figu', 'figurinha', 'toimg', 'toimage', 'toaudio', 'toaud', 'tomp3',
    'tovn', 'toptt', 'codificar', 'decodificar', ...Object.keys(media.EFFECTS),
  ]);
  const searchCommands = new Set(['wikimedia', 'wallpaper', 'gimagem', 'imagens', 'google', 'gimg', 'yts', 'ytsearch', 'play', 'ytplay', 'coffe', 'coffee', 'kopi', 'pinterest', 'metadinha', 'semfundo', 'removebg', 'remove-bg', 'tourl', 'setftbot', 'clonn', 'onlines', 'liston', 'infomsg']);
  if (!localCommands.has(name) && !searchCommands.has(name)) return { handled: false, reason: 'not_feature_command' };
  if (botMode === 'self' && !message.key.fromMe && digits(message.key.participant || '') !== digits(ownerNumber)) {
    return { handled: true, message: 'O bot está no modo Self; apenas o Criador pode usar essas ferramentas.' };
  }

  const last = lastUsed.get(`${sender}:${name}`) || 0;
  if (now - last < 3500) return { handled: true, message: 'Aguarde um instante antes de repetir esse comando.' };
  lastUsed.set(`${sender}:${name}`, now);
  if (lastUsed.size > 2000) {
    for (const [key, timestamp] of lastUsed) if (now - timestamp > 60000) lastUsed.delete(key);
  }

  if (['codificar', 'decodificar'].includes(name)) {
    const text = query || getText({ message: quotedMessage || {} }).replace(/^\s*\/[a-z]+\s*/i, '');
    return { handled: true, message: name === 'codificar' ? encodeBinary(text) : decodeBinary(text) };
  }

  if (['semfundo', 'removebg', 'remove-bg'].includes(name)) {
    if (!(env.REMOVE_BG_API_KEY && env.ENABLE_REMOVE_BG === 'true')) return { handled: true, message: 'Remoção de fundo está desativada. A ativação requer uma chave oficial, opt-in e consentimento para enviar a imagem a um serviço terceiro.' };
    return { handled: true, message: 'A API standalone do remove.bg será encerrada em 01/12/2026; migração para a nova API ainda pendente. Nenhuma imagem foi enviada.' };
  }
  if (['tourl', 'setftbot', 'clonn', 'onlines', 'liston', 'infomsg'].includes(name)) {
    const reason = name === 'tourl' ? 'publicaria sua mídia em hospedagem externa e requer endpoint autorizado/consentido.'
      : ['onlines', 'liston', 'infomsg'].includes(name) ? 'exporia presença/recibos de leitura dos participantes.'
        : name === 'clonn' ? 'cria grupos/mensagens em massa sem finalidade de administração simples.'
          : 'alteraria a foto global da conta, fora do escopo do grupo.';
    return { handled: true, message: `/${name} não está habilitado: ${reason}` };
  }

  if (localCommands.has(name)) {
    const loaded = await media.readMedia(mediaMessage);
    if (['fig', 'f', 'figu', 'figurinha'].includes(name)) {
      const sticker = await media.toSticker(loaded.buffer, { animated: loaded.kind === 'video' });
      await sock.sendMessage(message.key.remoteJid, { sticker }, { quoted: message });
      return { handled: true };
    }
    if (['toimg', 'toimage'].includes(name)) {
      const image = await media.toPng(loaded.buffer);
      await sock.sendMessage(message.key.remoteJid, { image, mimetype: 'image/png', fileName: 'imagem.png' }, { quoted: message });
      return { handled: true };
    }
    if (['toaudio', 'toaud', 'tomp3', 'tovn', 'toptt'].includes(name)) {
      if (!['audio', 'video', 'document'].includes(loaded.kind)) throw new Error('Envie ou responda a um áudio/vídeo para converter.');
      const audio = ['tovn', 'toptt'].includes(name) ? await media.toVoiceNote(loaded.buffer) : await media.toMp3(loaded.buffer);
      if (['tovn', 'toptt'].includes(name)) {
        await sock.sendMessage(message.key.remoteJid, { audio, mimetype: 'audio/ogg; codecs=opus', ptt: true }, { quoted: message });
      } else if (name === 'tomp3') {
        await sock.sendMessage(message.key.remoteJid, { document: audio, mimetype: 'audio/mpeg', fileName: 'audio.mp3' }, { quoted: message });
      } else {
        await sock.sendMessage(message.key.remoteJid, { audio, mimetype: 'audio/mpeg' }, { quoted: message });
      }
      return { handled: true };
    }
    if (Object.hasOwn(media.EFFECTS, name)) {
      if (loaded.kind !== 'audio') throw new Error('Responda diretamente a uma mensagem de áudio para aplicar esse efeito.');
      const audio = await media.applyVoiceEffect(loaded.buffer, name);
      await sock.sendMessage(message.key.remoteJid, { audio, mimetype: 'audio/mpeg' }, { quoted: message });
      return { handled: true };
    }
  }

  if (['wikimedia', 'wallpaper', 'coffe', 'coffee', 'kopi'].includes(name)) {
    const term = ['coffe', 'coffee', 'kopi'].includes(name) ? (query || 'coffee cup') : query;
    return searchCommons(sock, message, term);
  }
  if (name === 'metadinha') {
    const { pages, term } = await getCommonsPages(query || 'couple portrait', 10);
    if (pages.length < 2) return { handled: true, message: 'Não encontrei duas imagens adequadas para metadinha.' };
    await sendCommonsPage(sock, message, pages[0], term);
    await sendCommonsPage(sock, message, pages[1], term);
    return { handled: true };
  }
  if (name === 'google') {
    const items = await searchBrave(query, { env });
    const lines = items.map((item, index) => `${index + 1}. ${cleanText(item.title, 150)}\n${cleanText(item.description, 260)}\n${item.url}`).join('\n\n');
    return { handled: true, message: lines || 'A pesquisa não retornou resultados.' };
  }
  if (['gimg', 'gimagem', 'imagens'].includes(name)) {
    const items = await searchBrave(query, { image: true, env });
    const first = items[0];
    if (!first?.thumbnail?.src || !first?.url) return { handled: true, message: 'A pesquisa não retornou imagens.' };
    const parsed = new URL(first.thumbnail.src);
    if (!parsed.hostname.endsWith('.search.brave.com')) throw new Error('Thumbnail de imagem não veio do proxy da Brave.');
    const { response, buffer } = await boundedFetch(parsed, { hosts: [parsed.hostname], maxBytes: MAX_EXTERNAL_BYTES });
    if (!String(response.headers.get('content-type') || '').startsWith('image/')) throw new Error('A URL não retornou uma imagem válida.');
    await sock.sendMessage(message.key.remoteJid, { image: buffer, mimetype: response.headers.get('content-type'), caption: `${cleanText(first.title, 180)}\nOrigem: ${cleanText(first.source || '', 120)}\nPágina/licença: ${first.url}` }, { quoted: message });
    return { handled: true };
  }
  if (name === 'pinterest') {
    const items = await searchPinterest(query, env);
    if (!items.length) return { handled: true, message: 'O Pinterest não retornou Pins.' };
    for (const item of items.slice(0, 3)) {
      const images = item.media?.images || {};
      const imageUrl = images['400x300']?.url || images['600x']?.url || images['150x150']?.url;
      if (!imageUrl) continue;
      const parsed = new URL(imageUrl);
      if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('pinimg.com')) continue;
      const { response, buffer } = await boundedFetch(parsed, { hosts: [parsed.hostname], maxBytes: MAX_EXTERNAL_BYTES });
      if (!String(response.headers.get('content-type') || '').startsWith('image/')) continue;
      await sock.sendMessage(message.key.remoteJid, { image: buffer, mimetype: response.headers.get('content-type'), caption: `${cleanText(item.title || item.description || 'Pinterest Pin', 180)}\nFonte: ${item.link || 'Pinterest'}` }, { quoted: message });
    }
    return { handled: true };
  }
  if (['yts', 'ytsearch', 'play', 'ytplay'].includes(name)) {
    const items = await searchYouTube(query, env);
    const lines = items.map((item, index) => {
      const id = item.id?.videoId;
      if (!id) return '';
      const snippet = item.snippet || {};
      return `${index + 1}. ${cleanText(snippet.title, 150)}\nCanal: ${cleanText(snippet.channelTitle, 100)}\nhttps://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
    }).filter(Boolean).join('\n\n');
    return { handled: true, message: `${lines || 'A pesquisa não retornou vídeos.'}\n\nDownloads de áudio/vídeo foram desativados.` };
  }
  return { handled: false };
}

module.exports = {
  decodeHtml,
  cleanText,
  boundedFetch,
  fetchJson,
  encodeBinary,
  decodeBinary,
  featureAvailability,
  formatMenu,
  searchCommons,
  searchBrave,
  searchYouTube,
  searchPinterest,
  handleFeatureMessage,
};
