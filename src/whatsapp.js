import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import readline from 'readline';
import { handleIncoming } from './router.js';
import { setSocket } from './notifier.js';
import { enqueue } from './scheduler.js';
import { getDb } from './db.js';
import { FASE0_APERTURA } from '../data/sequences.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import qrcode from 'qrcode-terminal';

const SESSION_PATH = process.env.SESSION_PATH || './sessions';
const logger = pino({ level: 'silent' });

let sock;
const existingChats = new Set();
const agentSentIds = new Set(); // IDs de mensajes enviados por el agente

// Mapa bidireccional LID ↔ JID telefono
const lidToJid = new Map(); // "123@lid" → "549...@s.whatsapp.net"
const jidToLid = new Map(); // "549...@s.whatsapp.net" → "123@lid"

export function chatExists(jid) {
  return existingChats.has(jid);
}

export function resolveIncomingJid(jid) {
  if (!jid) return jid;
  const normalized = jid.replace(/:[\d]+(@s\.whatsapp\.net)$/, '$1');

  if (normalized.endsWith('@lid')) {
    // 1. Buscar en mapa en memoria
    if (lidToJid.has(normalized)) return lidToJid.get(normalized);

    // 2. Leer archivo de sesión: lid-mapping-{number}_reverse.json
    const lidNumber = normalized.replace('@lid', '');
    try {
      const file = join(SESSION_PATH, `lid-mapping-${lidNumber}_reverse.json`);
      const phone = JSON.parse(readFileSync(file, 'utf8'));
      const phoneJid = `${phone}@s.whatsapp.net`;
      mapLid(normalized, phoneJid);
      return phoneJid;
    } catch {}

    return normalized; // no se pudo resolver
  }
  return normalized;
}

// Registra una relación LID ↔ JID y la persiste en la DB
function mapLid(lid, phoneJid) {
  if (!lid || !phoneJid) return;
  if (lidToJid.has(lid)) return; // ya mapeado
  lidToJid.set(lid, phoneJid);
  jidToLid.set(phoneJid, lid);

  // Persistir en DB para los prospectos que ya tienen ese JID
  try {
    const db = getDb();
    db.prepare(`UPDATE prospects SET gatekeeper_lid = ? WHERE gatekeeper_jid = ? AND gatekeeper_lid IS NULL`).run(lid, phoneJid);
    db.prepare(`UPDATE prospects SET dm_lid = ? WHERE dm_jid = ? AND dm_lid IS NULL`).run(lid, phoneJid);
  } catch {}
}

function loadContacts(contacts) {
  for (const c of contacts) {
    if (c.lid && c.id && !c.id.endsWith('@lid')) {
      mapLid(c.lid, c.id);
    }
  }
}

function preguntarNumero() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('\n📱 Ingresá el número del agente (con código de país, sin +, ej: 5491112345678): ', (num) => {
      rl.close();
      resolve(num.trim().replace(/\D/g, ''));
    });
  });
}

export async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
  const { version } = await fetchLatestBaileysVersion();

  const useQr = process.env.USE_QR === '1';

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'),
  });

  setSocket(sock);
  sock.ev.on('creds.update', saveCreds);

  // Mapear contactos desde eventos
  sock.ev.on('contacts.set', ({ contacts }) => {
    loadContacts(contacts);
    if (lidToJid.size > 0) console.log(`   ${lidToJid.size} LIDs mapeados desde contactos ✓`);
  });
  sock.ev.on('contacts.upsert', (contacts) => loadContacts(contacts));
  sock.ev.on('contacts.update', (contacts) => loadContacts(contacts));

  // Chats existentes
  sock.ev.on('chats.upsert', (chats) => {
    for (const chat of chats) existingChats.add(chat.id);
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const msg of messages) {

      // Detectar si Brian intervino manualmente en una conversación
      if (msg.key.fromMe && type === 'notify' && !msg.key.remoteJid?.endsWith('@g.us')) {
        const msgId = msg.key.id;
        if (msgId && !agentSentIds.has(msgId)) {
          // Mensaje enviado desde este WhatsApp pero NO por el agente → Brian intervino
          const rawJid = msg.key.remoteJid;
          const fromJid = resolveIncomingJid(rawJid);
          const { getProspectByJid, updateProspect } = await import('./db.js');
          const prospect = getProspectByJid(fromJid) || getProspectByJid(rawJid);
          if (prospect && !['HANDED_OFF', 'DISCARDED', 'PAUSED'].includes(prospect.stage)) {
            updateProspect(prospect.id, {
              stage: 'PAUSED',
              notes: `${prospect.notes || ''}\n[Brian intervino manualmente — agente pausado]`.trim(),
            });
            console.log(`[PAUSED] ${prospect.clinic_name} — intervención manual detectada`);
          }
        }
      }

      // Capturar LID desde eco de mensaje enviado por nosotros
      if (msg.key.fromMe && msg.key.remoteJid?.endsWith('@lid')) {
        const lid = msg.key.remoteJid.replace(/:[\d]+(@lid)$/, '$1');
        if (!lidToJid.has(lid)) {
          const sentText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
          if (sentText === FASE0_APERTURA) {
            // Buscar el último prospecto FASE0_SENT sin LID — ese es el que acabamos de enviar
            const db = getDb();
            const prospect = db.prepare(`
              SELECT * FROM prospects
              WHERE stage = 'FASE0_SENT' AND gatekeeper_lid IS NULL
              ORDER BY last_message_at DESC LIMIT 1
            `).get();
            if (prospect) {
              mapLid(lid, prospect.gatekeeper_jid);
              console.log(`[LID-MAP] ${prospect.clinic_name}: ${prospect.gatekeeper_jid} ↔ ${lid}`);
            }
          }
        }
      }

      if (type !== 'notify') continue;
      if (msg.key.fromMe) continue;
      if (!msg.message) continue;
      await handleIncoming(msg, sock);
    }
  });

  // Vinculación por QR (modo alternativo, USE_QR=1)
  if (!state.creds.registered && useQr) {
    sock.ev.on('connection.update', ({ qr }) => {
      if (qr) {
        console.log('\n📷 Escaneá este QR con WhatsApp → Dispositivos vinculados → Vincular un dispositivo:\n');
        qrcode.generate(qr, { small: true });
      }
    });
  }

  // Vinculación por código (solo primera vez, si no se pidió QR)
  if (!state.creds.registered && !useQr) {
    const numero = process.env.AGENT_PHONE
      ? process.env.AGENT_PHONE.replace(/\D/g, '')
      : await preguntarNumero();

    console.log(`   Pidiendo código de vinculación para: ${numero}`);

    const requestCode = async (intentos = 0) => {
      if (intentos > 5) {
        console.error('No se pudo obtener el código después de varios intentos. Reiniciá el agente.');
        return;
      }
      try {
        const code = await sock.requestPairingCode(numero);
        console.log(`\n🔑 Tu código de vinculación: ${code}`);
        console.log('   WhatsApp → Dispositivos vinculados → Vincular con número de teléfono\n');
      } catch (err) {
        console.log(`   Reintentando código (intento ${intentos + 1})...`);
        await new Promise(r => setTimeout(r, 3000));
        await requestCode(intentos + 1);
      }
    };

    setTimeout(() => requestCode(), 5000);
  }

  const ready = new Promise((resolve) => {
    let isOpen = false;
    let chatsLoaded = false;

    function checkReady() {
      if (isOpen && chatsLoaded) resolve();
    }

    sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
      if (connection === 'close') {
        const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
        const shouldReconnect = code !== DisconnectReason.loggedOut;
        console.log(`Conexión cerrada (${code}). Reconectando: ${shouldReconnect}`);
        if (shouldReconnect) setTimeout(startWhatsApp, 5000);
        else console.log('Sesión cerrada. Borrá sessions/ y reiniciá.');
      }
      if (connection === 'open') {
        console.log('✅ WhatsApp conectado — cargando chats...');
        isOpen = true;
        setTimeout(() => {
          if (!chatsLoaded) {
            console.log('   (sin chats previos)');
            chatsLoaded = true;
            checkReady();
          }
        }, 8000);
        checkReady();
      }
    });

    sock.ev.on('chats.set', ({ chats }) => {
      for (const chat of chats) existingChats.add(chat.id);
      console.log(`   ${existingChats.size} chats cargados ✓`);
      chatsLoaded = true;
      checkReady();
    });
  });

  await ready;
  return sock;
}

export function getSock() { return sock; }

export async function resolveJid(phone) {
  const clean = phone.replace(/\D/g, '');
  const [result] = await sock.onWhatsApp(clean);
  if (result?.exists) return { jid: result.jid, lid: result.lid || null };
  return null;
}

export async function sendMessage(jid, text) {
  return enqueue(async () => {
    const result = await sock.sendMessage(jid, { text });
    if (!result?.key?.id) throw new Error('sendMessage sin confirmación');
    // Registrar ID para distinguir mensajes del agente vs de Brian
    agentSentIds.add(result.key.id);
    // Capturar LID del eco de mensaje enviado
    if (result.key.remoteJid && result.key.remoteJid !== jid) {
      if (result.key.remoteJid.endsWith('@lid')) {
        mapLid(result.key.remoteJid, jid);
      }
    }
    return result;
  });
}
