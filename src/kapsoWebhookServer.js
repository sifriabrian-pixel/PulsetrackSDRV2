// Servidor HTTP que recibe los webhooks de Kapso con los mensajes entrantes
// y los eventos de estado de entrega (sent/delivered/failed).
//
// OJO: esto NO es el formato crudo de webhook de Meta (entry[].changes[].value.messages[]),
// que es lo que espera normalizeWebhook() del SDK — ese helper es para cuando te
// suscribís directo a Meta. Kapso, como intermediario, manda su PROPIO formato:
// { message: {...}, conversation: {...} } con el tipo de evento en el header
// `x-webhook-event` (ej: "whatsapp.message.received"), y firma con HMAC-SHA256
// en `x-webhook-signature` (hex plano, sin el prefijo "sha256=" que usa Meta).

import express from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { handleIncomingKapso, normalizePhone } from './kapsoRouter.js';
import { getDb, isBotSentMessage } from './db.js';
import { registerDashboardRoutes } from './dashboard.js';

function verifyKapsoSignature(secret, rawBody, signatureHeader) {
  if (!secret || !signatureHeader) return false;
  try {
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(signatureHeader, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// Cuando Meta confirma que un mensaje no se pudo entregar (número no tiene WhatsApp,
// dejó de existir, etc.), lo marcamos en la DB para no dejar el prospecto colgado
// esperando una respuesta que nunca va a llegar.
function handleFailedStatus(phone, errorMsg) {
  if (!phone) return;
  const jid = `${normalizePhone(phone)}@s.whatsapp.net`;

  const db = getDb();
  const prospect = db.prepare(
    `SELECT * FROM prospects WHERE gatekeeper_jid = ? OR dm_jid = ? LIMIT 1`
  ).get(jid, jid);
  if (!prospect || ['DISCARDED', 'HANDED_OFF', 'NO_WHATSAPP'].includes(prospect.stage)) return;

  // COALESCE(notes, '') es necesario: en SQLite, NULL || texto da NULL y se pierde el detalle silenciosamente.
  db.prepare(`UPDATE prospects SET stage = 'NO_WHATSAPP', notes = COALESCE(notes, '') || ? WHERE id = ?`).run(
    `\n[${new Date().toISOString().slice(0, 16).replace('T', ' ')}] Entrega fallida: ${errorMsg || 'sin detalle'}`,
    prospect.id
  );
  console.log(`[FAILED] ${prospect.clinic_name} (${phone}) — ${errorMsg || 'sin detalle'} — marcado NO_WHATSAPP`);
}

// Cuando Brian escribe a mano — desde el inbox de Kapso, o cualquier canal que
// no sea nuestro propio código — pausamos el agente para ese prospecto. Se
// detecta por descarte: todo mensaje que MANDA el bot queda registrado por su
// wamid (ver trackSentId en kapso.js); si llega un evento "message sent" con
// un wamid que no está ahí, no lo mandamos nosotros.
function handleManualIntervention(toPhone) {
  if (!toPhone) return;
  const jid = `${normalizePhone(toPhone)}@s.whatsapp.net`;

  const db = getDb();
  const prospect = db.prepare(
    `SELECT * FROM prospects WHERE gatekeeper_jid = ? OR dm_jid = ? LIMIT 1`
  ).get(jid, jid);
  if (!prospect || ['DISCARDED', 'HANDED_OFF'].includes(prospect.stage)) return;

  db.prepare(`UPDATE prospects SET stage = 'HANDED_OFF', notes = COALESCE(notes, '') || ? WHERE id = ?`).run(
    `\n[${new Date().toISOString().slice(0, 16).replace('T', ' ')}] Brian intervino manualmente — agente pausado`,
    prospect.id
  );
  console.log(`[BRIAN] ${prospect.clinic_name} — intervención manual detectada, agente pausado (HANDED_OFF)`);
}

export function startKapsoServer() {
  const app = express();
  // Railway asigna el puerto en process.env.PORT — WEBHOOK_PORT es solo para correrlo local
  const port = process.env.PORT || process.env.WEBHOOK_PORT || 3000;

  registerDashboardRoutes(app);

  // Handshake de verificación (solo aplica si se suscribe directo a Meta — no es nuestro caso con Kapso)
  app.get('/webhook', (req, res) => {
    const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
    if (verifyToken && req.query['hub.verify_token'] === verifyToken) {
      res.send(req.query['hub.challenge']);
    } else {
      res.sendStatus(403);
    }
  });

  app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const appSecret = process.env.KAPSO_WEBHOOK_APP_SECRET;
    const signatureHeader = req.headers['x-webhook-signature'];

    if (appSecret) {
      if (!signatureHeader) {
        console.error('[KAPSO] Falta x-webhook-signature en el request — revisar config del webhook en Kapso.');
        return res.status(401).end();
      }
      if (!verifyKapsoSignature(appSecret, req.body, signatureHeader)) {
        console.error('[KAPSO] Firma x-webhook-signature inválida — KAPSO_WEBHOOK_APP_SECRET no coincide con el "secret_key" configurado en Kapso.');
        return res.status(401).end();
      }
    }

    res.sendStatus(200); // responder rápido, procesar después (evita reintentos por timeout)

    let payload;
    try {
      payload = JSON.parse(req.body.toString('utf8'));
    } catch {
      console.error('[KAPSO] payload no es JSON válido');
      return;
    }

    const eventType = req.headers['x-webhook-event'];
    console.log(`[KAPSO] Evento: ${eventType} —`, JSON.stringify(payload).slice(0, 500));

    try {
      const message = payload.message;
      if (!message) return;

      if (message.kapso?.direction === 'inbound' && message.type === 'text') {
        await handleIncomingKapso(message.from, message.text?.body || '', message.id);
        return;
      }

      if (message.kapso?.direction === 'outbound') {
        if (message.kapso?.status === 'failed') {
          const errorMsg = message.kapso?.error?.title || message.kapso?.error?.message;
          handleFailedStatus(message.to || message.from, errorMsg);
        } else if (!isBotSentMessage(message.id)) {
          handleManualIntervention(message.to || message.from);
        }
        return;
      }

      // Evento que no reconocemos todavía (ej: un tipo de status nuevo) — lo logueamos
      // completo para poder ajustar el parseo sin perder el mensaje en silencio.
      if (!['whatsapp.message.received', 'whatsapp.message.sent'].includes(eventType)) {
        console.log('[KAPSO] Evento no manejado explícitamente, payload completo:', JSON.stringify(payload));
      }
    } catch (err) {
      console.error('[KAPSO] Error procesando el webhook (revisar payload logueado arriba):', err.message);
    }
  });

  app.listen(port, () => console.log(`[KAPSO] Webhook escuchando en puerto ${port} — ruta /webhook`));
}
