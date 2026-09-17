// Panel simple para que Brian vea las conversaciones y responda a mano cuando
// el bot hace handoff — necesario porque el número quedó como "Dedicated"
// (sin app de WhatsApp en ningún celular), así que no hay otra forma de
// escribirle a un lead salvo por acá o por el dashboard de Kapso.

import express from 'express';
import { getDb, getProspectById, getMessages, updateProspect, logMessage } from './db.js';
import { sendMessage } from './transport.js';

function requireAuth(req, res, next) {
  const user = process.env.DASHBOARD_USER;
  const pass = process.env.DASHBOARD_PASSWORD;
  if (!user || !pass) {
    res.status(503).send('Dashboard deshabilitado: faltan DASHBOARD_USER / DASHBOARD_PASSWORD en las variables de entorno.');
    return;
  }
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const [u, p] = Buffer.from(encoded, 'base64').toString('utf8').split(':');
    if (u === user && p === pass) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Pulsetrack Dashboard"');
  res.status(401).send('Autenticación requerida');
}

function targetJid(prospect) {
  // Prioridad: DM (con quien está la conversación de venta real) sobre recepción
  return prospect.dm_jid || prospect.gatekeeper_jid;
}

const PAGE = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Pulsetrack — Conversaciones</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, Segoe UI, Roboto, sans-serif; background: #f4f5f7; color: #1a1a1a; }
  #app { display: flex; height: 100vh; }
  #list { width: 340px; border-right: 1px solid #ddd; background: #fff; overflow-y: auto; flex-shrink: 0; }
  #list h1 { font-size: 15px; padding: 14px 16px; margin: 0; border-bottom: 1px solid #eee; }
  .item { padding: 12px 16px; border-bottom: 1px solid #f0f0f0; cursor: pointer; }
  .item:hover { background: #f7f8fa; }
  .item.active { background: #eef2ff; }
  .item .name { font-weight: 600; font-size: 14px; }
  .item .meta { font-size: 12px; color: #666; margin-top: 2px; }
  .badge { display: inline-block; font-size: 11px; padding: 2px 6px; border-radius: 4px; margin-top: 4px; }
  .badge.HANDED_OFF { background: #fde68a; color: #92400e; }
  .badge.PENDING { background: #e5e7eb; color: #374151; }
  .badge.DISCARDED { background: #fecaca; color: #991b1b; }
  .badge.default { background: #dbeafe; color: #1e40af; }
  #main { flex: 1; display: flex; flex-direction: column; }
  #header { padding: 14px 20px; border-bottom: 1px solid #ddd; background: #fff; }
  #header h2 { margin: 0; font-size: 16px; }
  #header .sub { font-size: 13px; color: #666; margin-top: 2px; }
  #messages { flex: 1; overflow-y: auto; padding: 20px; }
  .msg { max-width: 70%; margin-bottom: 10px; padding: 8px 12px; border-radius: 10px; font-size: 14px; line-height: 1.4; white-space: pre-wrap; }
  .msg.in { background: #fff; border: 1px solid #e5e7eb; margin-right: auto; }
  .msg.out { background: #dcfce7; margin-left: auto; }
  .msg .time { font-size: 10px; color: #999; margin-top: 4px; }
  #composer { display: flex; padding: 14px; border-top: 1px solid #ddd; background: #fff; gap: 8px; }
  #composer textarea { flex: 1; resize: none; padding: 8px 10px; border: 1px solid #ccc; border-radius: 6px; font-size: 14px; font-family: inherit; }
  #composer button { padding: 0 18px; border: none; background: #16a34a; color: #fff; border-radius: 6px; font-size: 14px; cursor: pointer; }
  #composer button:disabled { background: #999; cursor: not-allowed; }
  #empty { display: flex; align-items: center; justify-content: center; height: 100%; color: #999; }
  #notes { padding: 10px 20px; background: #fffbeb; border-bottom: 1px solid #fde68a; font-size: 12px; color: #78350f; white-space: pre-wrap; max-height: 120px; overflow-y: auto; }
</style>
</head>
<body>
<div id="app">
  <div id="list"><h1>Prospectos</h1><div id="items"></div></div>
  <div id="main"><div id="empty">Elegí un prospecto de la izquierda</div></div>
</div>
<script>
let current = null;
let prospects = [];

async function loadList() {
  const res = await fetch('/dashboard/api/prospects');
  prospects = await res.json();
  const items = document.getElementById('items');
  items.innerHTML = prospects.map(p => \`
    <div class="item \${current === p.id ? 'active' : ''}" onclick="openProspect(\${p.id})">
      <div class="name">\${p.clinic_name}</div>
      <div class="meta">\${p.city || ''} \${p.country || ''}</div>
      <span class="badge \${['HANDED_OFF','PENDING','DISCARDED'].includes(p.stage) ? p.stage : 'default'}">\${p.stage}</span>
    </div>
  \`).join('');
}

async function openProspect(id) {
  current = id;
  await loadList();
  const res = await fetch('/dashboard/api/prospects/' + id);
  const { prospect, messages } = await res.json();

  const main = document.getElementById('main');
  main.innerHTML = \`
    <div id="header">
      <h2>\${prospect.clinic_name}</h2>
      <div class="sub">\${prospect.city || ''} \${prospect.country || ''} · \${prospect.dm_phone || prospect.gatekeeper_phone} · Estado: \${prospect.stage}</div>
    </div>
    \${prospect.notes ? '<div id="notes">' + prospect.notes.trim() + '</div>' : ''}
    <div id="messages"></div>
    <div id="composer">
      <textarea id="text" rows="2" placeholder="Escribí tu respuesta..."></textarea>
      <button id="sendBtn" onclick="sendReply(\${id})">Enviar</button>
    </div>
  \`;

  const msgsEl = document.getElementById('messages');
  msgsEl.innerHTML = messages.map(m => \`
    <div class="msg \${m.direction}">
      \${m.text}
      <div class="time">\${new Date(m.created_at + 'Z').toLocaleString('es-AR')}</div>
    </div>
  \`).join('') || '<div style="color:#999">Sin mensajes todavía</div>';
  msgsEl.scrollTop = msgsEl.scrollHeight;
}

async function sendReply(id) {
  const textEl = document.getElementById('text');
  const btn = document.getElementById('sendBtn');
  const text = textEl.value.trim();
  if (!text) return;
  btn.disabled = true;
  try {
    const res = await fetch('/dashboard/api/prospects/' + id + '/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert('Error al enviar: ' + (err.error || res.statusText));
      return;
    }
    textEl.value = '';
    await openProspect(id);
  } finally {
    btn.disabled = false;
  }
}

loadList();
setInterval(() => { if (current) openProspect(current); else loadList(); }, 15000);
</script>
</body>
</html>`;

export function registerDashboardRoutes(app) {
  const router = express.Router();
  router.use(requireAuth);
  router.use(express.json());

  router.get('/', (req, res) => {
    res.type('html').send(PAGE);
  });

  router.get('/api/prospects', (req, res) => {
    const rows = getDb().prepare(`
      SELECT id, clinic_name, city, country, stage, gatekeeper_phone, dm_phone, last_message_at, last_reply_at
      FROM prospects
      WHERE stage NOT IN ('PENDING', 'NO_WHATSAPP', 'SKIPPED')
      ORDER BY
        CASE WHEN stage = 'HANDED_OFF' THEN 0 ELSE 1 END,
        COALESCE(last_reply_at, last_message_at) DESC
      LIMIT 200
    `).all();
    res.json(rows);
  });

  router.get('/api/prospects/:id', (req, res) => {
    const prospect = getProspectById(req.params.id);
    if (!prospect) return res.status(404).json({ error: 'No encontrado' });
    const messages = getMessages(req.params.id);
    res.json({ prospect, messages });
  });

  router.post('/api/prospects/:id/reply', async (req, res) => {
    const prospect = getProspectById(req.params.id);
    if (!prospect) return res.status(404).json({ error: 'No encontrado' });
    const text = (req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Texto vacío' });

    const jid = targetJid(prospect);
    if (!jid) return res.status(400).json({ error: 'Este prospecto no tiene un número de WhatsApp asociado todavía' });

    try {
      await sendMessage(jid, text);
      logMessage(prospect.id, 'out', text);
      // Responder a mano desde acá es una intervención manual — el bot no
      // tiene que seguir contestando este prospecto por su cuenta después.
      const fields = { last_message_at: new Date().toISOString() };
      if (!['DISCARDED', 'HANDED_OFF'].includes(prospect.stage)) fields.stage = 'HANDED_OFF';
      updateProspect(prospect.id, fields);
      res.json({ ok: true });
    } catch (err) {
      // Fuera de la ventana de 24hs, texto libre no funciona — hace falta un template.
      res.status(502).json({ error: err.message });
    }
  });

  app.use('/dashboard', router);
  console.log('[DASHBOARD] Panel disponible en /dashboard');
}
