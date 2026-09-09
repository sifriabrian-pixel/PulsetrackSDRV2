// Transporte Kapso (API Oficial de WhatsApp de Meta) — único transporte activo de este proyecto.
// No usar Baileys acá (ver whatsapp.js, que queda como legacy sin usar).

import { WhatsAppClient, buildTemplateSendPayload } from '@kapso/whatsapp-cloud-api';
import { enqueue } from './scheduler.js';
import { getDb } from './db.js';

// Instanciación perezosa: si este módulo se importa (vía transport.js) para un
// comando que no manda mensajes (ej: `import`), no debe romper por falta de
// KAPSO_API_KEY todavía no configurada.
let _client;
function getClient() {
  if (!_client) {
    _client = new WhatsAppClient({
      baseUrl: 'https://api.kapso.ai/meta/whatsapp',
      kapsoApiKey: process.env.KAPSO_API_KEY,
    });
  }
  return _client;
}

const phoneNumberId = process.env.KAPSO_PHONE_NUMBER_ID;

function phoneFromJid(jid) {
  return jid.split('@')[0];
}

export async function sendMessage(jid, text) {
  const to = phoneFromJid(jid);
  return enqueue(async () => {
    const result = await getClient().messages.sendText({ phoneNumberId, to, body: text });
    return result;
  });
}

export async function sendTemplateMessage(jid, templateName, language = 'es_AR') {
  const to = phoneFromJid(jid);
  return enqueue(async () => {
    const template = buildTemplateSendPayload({ name: templateName, language });
    const result = await getClient().messages.sendTemplate({ phoneNumberId, to, template });
    return result;
  });
}

// Argentina: los celulares necesitan un "9" extra después del 54 para que la
// API de WhatsApp los reconozca (54 9 11 XXXXXXXX), pero los números tal cual
// vienen de un CSV normal no lo traen (54 11 XXXXXXXX) — sin esto, Meta
// devuelve "Message undeliverable" en el 100% de los envíos a Argentina.
function normalizeOutboundPhone(digits) {
  if (digits.startsWith('54') && !digits.startsWith('549') && digits.length === 12) {
    return '549' + digits.slice(2);
  }
  return digits;
}

// La API oficial no tiene un chequeo de "¿este número tiene WhatsApp?" como onWhatsApp() de Baileys.
// Se intenta enviar directo; si el número no es válido, Meta devuelve error al enviar (se captura en launch.js).
export async function resolveJid(phone) {
  const clean = normalizeOutboundPhone(phone.replace(/\D/g, ''));
  return { jid: `${clean}@s.whatsapp.net`, lid: null };
}

// Ya no existe el concepto de "chats cargados" del socket de Baileys.
// Chequeamos dos cosas: 1) nuestra propia DB (ya le escribimos antes en esta campaña),
// 2) la API de Conversaciones de Kapso (ya existe un chat con ese número, aunque no
//    lo hayamos originado nosotros — evita reabrir con un lead/cliente existente).
export async function chatExists(jid) {
  try {
    const db = getDb();
    const row = db.prepare(
      `SELECT 1 FROM prospects WHERE (gatekeeper_jid = ? OR dm_jid = ?) AND stage != 'PENDING' LIMIT 1`
    ).get(jid, jid);
    if (row) return true;
  } catch {}

  try {
    const to = phoneFromJid(jid);
    const conversations = await getClient().conversations.list({ phoneNumberId, phoneNumber: to, limit: 5 });
    // messagesCount no sirve para distinguir "mensaje nuestro fallido" de "conversación real"
    // (ambos cuentan como 1) — hay que mirar los mensajes de la conversación y confirmar que
    // hubo al menos uno ENTRANTE de verdad. El filtro por teléfono en /messages no funciona,
    // pero por conversation_id sí.
    for (const conv of conversations?.data || []) {
      const messages = await getClient().request('GET', `${phoneNumberId}/messages`, {
        responseType: 'json',
        query: { conversation_id: conv.id },
      });
      if ((messages?.data || []).some((m) => m.kapso?.direction === 'inbound')) return true;
    }
    return false;
  } catch (err) {
    console.error('[KAPSO] Error chequeando conversación existente:', err.message);
    return false; // ante la duda, no bloquear el envío por un error de red/API
  }
}

export function getSock() {
  return null; // no aplica con la API oficial
}
