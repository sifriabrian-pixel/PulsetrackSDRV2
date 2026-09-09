// Equivalente a router.js pero para mensajes entrantes vía webhook de Kapso.
// No hay LIDs en la API Oficial — siempre es el número de teléfono real.

import { getDb, getProspectByJid } from './db.js';
import { handleMessage } from './stateMachine.js';

const processing = new Set();

// México: los números de celular llegan por webhook como 521XXXXXXXXXX (con un "1"
// extra después del 52), pero nosotros los guardamos/mandamos como 52XXXXXXXXXX
// (como vienen en el CSV, sin el 1). Sin esto, las respuestas de México no
// encuentran al prospecto y caen como [UNKNOWN].
export function normalizePhone(phone) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('521')) {
    return '52' + digits.slice(3);
  }
  return digits;
}

// Buffer por prospecto: agrupa mensajes seguidos (ej: "Hola" + "En que te ayudo?")
// y espera un período de silencio antes de contestar, para no responder a cada
// mensaje suelto y para dar tiempo a que la otra persona termine de escribir.
const pending = new Map(); // prospectId -> { texts: string[], fromJid, timer }
const DEBOUNCE_MS = 30 * 1000;

// Meta puede reentregar el mismo webhook más de una vez (documentado). Sin esto,
// un mensaje reentregado después de que ya avanzamos de etapa se vuelve a
// clasificar bajo la etapa nueva, como si fuera la respuesta a otra pregunta.
const seenMessageIds = new Set();
const seenMessageIdsOrder = [];
const MAX_SEEN_IDS = 1000;

function alreadySeen(messageId) {
  if (!messageId) return false;
  if (seenMessageIds.has(messageId)) return true;
  seenMessageIds.add(messageId);
  seenMessageIdsOrder.push(messageId);
  if (seenMessageIdsOrder.length > MAX_SEEN_IDS) {
    const oldest = seenMessageIdsOrder.shift();
    seenMessageIds.delete(oldest);
  }
  return false;
}

export async function handleIncomingKapso(fromPhone, text, messageId) {
  if (!fromPhone || !text) return;
  if (alreadySeen(messageId)) {
    console.log(`[DUP] mensaje ${messageId} ya procesado — ignorando reentrega del webhook`);
    return;
  }

  const fromJid = `${normalizePhone(fromPhone)}@s.whatsapp.net`;
  const prospect = getProspectByJid(fromJid);

  if (!prospect) {
    console.log(`[UNKNOWN] ${fromJid}: "${text.slice(0, 60)}"`);
    return;
  }

  if (['DISCARDED', 'HANDED_OFF', 'PAUSED'].includes(prospect.stage)) return;

  const existing = pending.get(prospect.id);
  if (existing) {
    clearTimeout(existing.timer);
    existing.texts.push(text);
    existing.timer = setTimeout(() => flush(prospect.id), DEBOUNCE_MS);
    console.log(`[BUFFER] ${prospect.clinic_name} — mensaje agregado (${existing.texts.length} en cola)`);
    return;
  }

  const entry = { texts: [text], fromJid, timer: null };
  entry.timer = setTimeout(() => flush(prospect.id), DEBOUNCE_MS);
  pending.set(prospect.id, entry);
}

async function flush(prospectId) {
  const entry = pending.get(prospectId);
  if (!entry) return;
  pending.delete(prospectId);

  if (processing.has(prospectId)) return; // ya se está procesando (no debería pasar)
  processing.add(prospectId);

  try {
    // Releer el prospecto por si cambió de estado mientras esperábamos el buffer
    const prospect = getDb().prepare(`SELECT * FROM prospects WHERE id = ?`).get(prospectId);
    if (!prospect || ['DISCARDED', 'HANDED_OFF', 'PAUSED'].includes(prospect.stage)) return;

    const combinedText = entry.texts.join('\n');
    const tag = entry.texts.length > 1 ? ` (${entry.texts.length} mensajes agrupados)` : '';
    console.log(`[IN] ${prospect.clinic_name} (${prospect.stage}): "${combinedText.slice(0, 60)}"${tag}`);

    await handleMessage(prospect, combinedText, entry.fromJid);
  } catch (err) {
    console.error(`[ERROR] prospecto #${prospectId} — ${err.message}`);
    console.error(err.stack?.split('\n')[1] || '');
  } finally {
    processing.delete(prospectId);
  }
}
