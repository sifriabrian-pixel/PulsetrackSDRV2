import { getProspectByJid, getDb } from './db.js';
import { handleMessage } from './stateMachine.js';
import { resolveIncomingJid, getSock } from './whatsapp.js';

// Lock por prospecto: evita procesar dos mensajes del mismo prospecto en paralelo
const processing = new Set();

function extractText(msg) {
  return (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    ''
  );
}

// Intenta encontrar un prospecto buscando qué número de teléfono corresponde al LID
async function tryMatchLid(lid) {
  try {
    const db = getDb();
    const sock = getSock();
    // Buscar todos los prospectos contactados sin LID guardado
    const candidates = db.prepare(
      `SELECT * FROM prospects
       WHERE stage NOT IN ('PENDING', 'NO_WHATSAPP', 'SKIPPED', 'DISCARDED', 'HANDED_OFF', 'PAUSED')
       AND gatekeeper_lid IS NULL`
    ).all();

    const normalizedLid = lid.replace(/:[\d]+(@lid)$/, '$1');

    for (const p of candidates) {
      const phone = p.gatekeeper_phone.replace(/\D/g, '');
      const [result] = await sock.onWhatsApp(phone);
      if (result?.exists && result.lid === normalizedLid) {
        // Guardar el LID para no repetir esta búsqueda
        db.prepare(`UPDATE prospects SET gatekeeper_lid = ? WHERE id = ?`).run(lid, p.id);
        return p;
      }
    }
  } catch (err) {
    console.error('[LID-MATCH error]', err.message);
  }
  return null;
}

export async function handleIncoming(msg, sock) {
  const rawJid = msg.key.remoteJid;
  if (!rawJid || rawJid.endsWith('@g.us')) return; // ignorar grupos

  // Resuelve @lid → @s.whatsapp.net usando el mapa de contactos
  const fromJid = resolveIncomingJid(rawJid);

  const text = extractText(msg).trim();
  if (!text) return;

  // Buscar por JID resuelto Y también por el JID original (por si acaso)
  const prospect = getProspectByJid(fromJid) || (fromJid !== rawJid ? getProspectByJid(rawJid) : null);

  if (!prospect) {
    // Último recurso: si es @lid, buscar el prospecto por número de teléfono
    if (rawJid.endsWith('@lid')) {
      const foundProspect = await tryMatchLid(rawJid);
      if (foundProspect) {
        console.log(`[LID-MATCH] ${rawJid} → ${foundProspect.clinic_name}`);
        if (!['DISCARDED', 'HANDED_OFF', 'PAUSED'].includes(foundProspect.stage)) {
          console.log(`[IN] ${foundProspect.clinic_name} (${foundProspect.stage}): "${text.slice(0, 60)}"`);
          try {
            await handleMessage(foundProspect, text, foundProspect.gatekeeper_jid);
          } catch (err) {
            console.error(`[ERROR] ${foundProspect.clinic_name} — ${err.message}`);
            console.error(err.stack?.split('\n')[1] || '');
          }
        }
        return;
      }
    }
    console.log(`[UNKNOWN] ${rawJid} → resuelto: ${fromJid}`);
    return;
  }

  if (['DISCARDED', 'HANDED_OFF', 'PAUSED'].includes(prospect.stage)) return;

  // Si ya estamos procesando un mensaje de este prospecto, ignorar el duplicado
  if (processing.has(prospect.id)) {
    console.log(`[SKIP-DUP] ${prospect.clinic_name} — mensaje ignorado, ya procesando otro`);
    return;
  }

  console.log(`[IN] ${prospect.clinic_name} (${prospect.stage}): "${text.slice(0, 60)}"`);

  processing.add(prospect.id);
  try {
    await handleMessage(prospect, text, fromJid);
  } catch (err) {
    console.error(`[ERROR] ${prospect.clinic_name} — ${err.message}`);
    console.error(err.stack?.split('\n')[1] || '');
  } finally {
    processing.delete(prospect.id);
  }
}
