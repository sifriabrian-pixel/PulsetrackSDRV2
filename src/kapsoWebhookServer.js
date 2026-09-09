// Servidor HTTP que recibe los webhooks de Kapso/Meta con los mensajes entrantes
// y los eventos de estado de entrega (sent/delivered/failed).

import express from 'express';
import { normalizeWebhook, verifySignature } from '@kapso/whatsapp-cloud-api/server';
import { handleIncomingKapso, normalizePhone } from './kapsoRouter.js';
import { getDb } from './db.js';

// Cuando Meta confirma que un mensaje no se pudo entregar (número no tiene WhatsApp,
// dejó de existir, etc.), lo marcamos en la DB para no dejar el prospecto colgado
// esperando una respuesta que nunca va a llegar.
function handleFailedStatus(status) {
  const phone = status.recipientId;
  if (!phone) return;
  const jid = `${normalizePhone(phone)}@s.whatsapp.net`;

  const db = getDb();
  const prospect = db.prepare(
    `SELECT * FROM prospects WHERE gatekeeper_jid = ? OR dm_jid = ? LIMIT 1`
  ).get(jid, jid);
  if (!prospect || ['DISCARDED', 'HANDED_OFF', 'NO_WHATSAPP'].includes(prospect.stage)) return;

  const errorMsg = status.errors?.[0]?.title || status.errors?.[0]?.message || 'sin detalle';
  // COALESCE(notes, '') es necesario: en SQLite, NULL || texto da NULL y se pierde el detalle silenciosamente.
  db.prepare(`UPDATE prospects SET stage = 'NO_WHATSAPP', notes = COALESCE(notes, '') || ? WHERE id = ?`).run(
    `\n[${new Date().toISOString().slice(0, 16).replace('T', ' ')}] Entrega fallida: ${errorMsg}`,
    prospect.id
  );
  console.log(`[FAILED] ${prospect.clinic_name} (${phone}) — ${errorMsg} — marcado NO_WHATSAPP`);
}

// Cuando Brian escribe a mano desde la app de WhatsApp Business (no vía nuestra API),
// Meta lo notifica como un "eco" del mensaje enviado desde el teléfono (coexistence).
// Kapso lo marca con kapso.source = "smb_message_echo". Ahí pausamos el agente.
function handleManualIntervention(message) {
  const phone = message.to;
  if (!phone) return;
  const jid = `${normalizePhone(phone)}@s.whatsapp.net`;

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

  // Handshake de verificación (solo aplica si se suscribe directo a Meta)
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
    if (appSecret) {
      const ok = verifySignature({
        appSecret,
        rawBody: req.body,
        signatureHeader: req.headers['x-hub-signature-256'],
      });
      if (!ok) return res.status(401).end();
    }

    res.sendStatus(200); // responder rápido, procesar después (evita reintentos de Meta por timeout)

    let payload;
    try {
      payload = JSON.parse(req.body.toString('utf8'));
    } catch {
      console.error('[KAPSO] payload no es JSON válido');
      return;
    }

    console.log('[KAPSO-RAW]', JSON.stringify(payload).slice(0, 800));

    try {
      const events = normalizeWebhook(payload);
      for (const message of events.messages || []) {
        if (message.type === 'text' && message.kapso?.direction === 'inbound') {
          await handleIncomingKapso(message.from, message.text?.body || '', message.id);
        }
        if (message.kapso?.direction === 'outbound' && message.kapso?.source === 'smb_message_echo') {
          handleManualIntervention(message);
        }
      }
      for (const status of events.statuses || []) {
        if (status.status === 'failed') handleFailedStatus(status);
      }
    } catch (err) {
      console.error('[KAPSO] Error normalizando webhook (revisar formato del payload arriba):', err.message);
    }
  });

  app.listen(port, () => console.log(`[KAPSO] Webhook escuchando en puerto ${port} — ruta /webhook`));
}
