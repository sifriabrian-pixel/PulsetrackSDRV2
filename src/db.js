import Database from 'better-sqlite3';

const DB_PATH = process.env.DB_PATH || './pulsetrack.db';

let db;

export function initDb() {
  db = new Database(DB_PATH);

  db.exec(`
    CREATE TABLE IF NOT EXISTS prospects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clinic_name TEXT NOT NULL,
      gatekeeper_phone TEXT NOT NULL,
      gatekeeper_jid TEXT,
      gatekeeper_lid TEXT,
      dm_name TEXT,
      dm_phone TEXT,
      dm_jid TEXT,
      dm_lid TEXT,
      city TEXT,
      country TEXT,
      stage TEXT NOT NULL DEFAULT 'PENDING',
      rejection_count INTEGER NOT NULL DEFAULT 0,
      last_message_at TEXT,
      last_reply_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_stage ON prospects(stage);
    CREATE INDEX IF NOT EXISTS idx_gatekeeper_jid ON prospects(gatekeeper_jid);
    CREATE INDEX IF NOT EXISTS idx_dm_jid ON prospects(dm_jid);

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prospect_id INTEGER NOT NULL,
      direction TEXT NOT NULL, -- 'in' | 'out'
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_messages_prospect ON messages(prospect_id);

    -- Dedup de mensajes entrantes por wamid. Tiene que ser persistente (no en
    -- memoria): un redeploy borra cualquier Set en memoria, y si justo en ese
    -- momento Kapso reintenta entregar un webhook (o llega tarde por el reintento
    -- de un fallo previo), el mismo mensaje se reprocesa como si fuera nuevo.
    -- Pasó de verdad en producción durante los redeploys seguidos arreglando el
    -- webhook: un prospecto recibió el Mensaje 2 duplicado.
    CREATE TABLE IF NOT EXISTS seen_messages (
      message_id TEXT PRIMARY KEY,
      seen_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- wamids de los mensajes que MANDÓ el bot (vía sendMessage/sendTemplateMessage).
    -- Sirve para detectar intervención manual: si llega un evento "message sent"
    -- con un wamid que no está acá, no lo mandamos nosotros — alguien escribió a
    -- mano desde el inbox de Kapso — y hay que pausar el agente para ese prospecto.
    CREATE TABLE IF NOT EXISTS bot_sent_messages (
      message_id TEXT PRIMARY KEY,
      sent_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  return db;
}

// Devuelve true si ese wamid ya se procesó antes (y lo registra si es la
// primera vez) — atómico vía INSERT OR IGNORE, sobrevive a redeploys.
export function alreadySeenMessage(messageId) {
  if (!messageId) return false;
  const result = getDb().prepare(`INSERT OR IGNORE INTO seen_messages (message_id) VALUES (?)`).run(messageId);
  return result.changes === 0;
}

export function markBotSentMessage(messageId) {
  if (!messageId) return;
  try {
    getDb().prepare(`INSERT OR IGNORE INTO bot_sent_messages (message_id) VALUES (?)`).run(messageId);
  } catch { /* no crítico */ }
}

export function isBotSentMessage(messageId) {
  if (!messageId) return false;
  return !!getDb().prepare(`SELECT 1 FROM bot_sent_messages WHERE message_id = ?`).get(messageId);
}

// Registra un mensaje (entrante o saliente) para poder mostrar la conversación
// completa en el dashboard — `notes` solo guarda resúmenes de clasificación,
// no el texto real de cada mensaje.
export function logMessage(prospectId, direction, text) {
  if (!prospectId || !text) return;
  getDb().prepare(
    `INSERT INTO messages (prospect_id, direction, text) VALUES (?, ?, ?)`
  ).run(prospectId, direction, text);
}

export function getMessages(prospectId) {
  return getDb().prepare(
    `SELECT * FROM messages WHERE prospect_id = ? ORDER BY created_at ASC, id ASC`
  ).all(prospectId);
}

export function getProspectById(id) {
  return getDb().prepare(`SELECT * FROM prospects WHERE id = ?`).get(id);
}

export function getDb() {
  if (!db) throw new Error('DB not initialized — call initDb() first');
  return db;
}

export function getProspectByJid(jid) {
  const d = getDb();
  return d.prepare(`
    SELECT * FROM prospects
    WHERE gatekeeper_jid = ? OR dm_jid = ?
       OR gatekeeper_lid = ? OR dm_lid = ?
    LIMIT 1
  `).get(jid, jid, jid, jid);
}

export function updateProspect(id, fields) {
  const d = getDb();
  const entries = Object.entries(fields);
  const set = entries.map(([k]) => `${k} = ?`).join(', ');
  const values = entries.map(([, v]) => v);
  d.prepare(`UPDATE prospects SET ${set} WHERE id = ?`).run(...values, id);
}

export function insertProspects(rows) {
  const d = getDb();
  const stmt = d.prepare(`
    INSERT OR IGNORE INTO prospects (clinic_name, gatekeeper_phone, city, country)
    VALUES (@clinic_name, @gatekeeper_phone, @city, @country)
  `);
  const insertMany = d.transaction((list) => {
    for (const row of list) stmt.run(row);
  });
  insertMany(rows);
}

// Prospecto más reciente contactado que aún no tiene LID asignado
// Se usa para mapear LIDs desconocidos al primer respondedor
export function getRecentContactedWithoutLid() {
  return getDb().prepare(`
    SELECT * FROM prospects
    WHERE stage != 'PENDING'
      AND stage != 'NO_WHATSAPP'
      AND stage != 'SKIPPED'
      AND gatekeeper_lid IS NULL
    ORDER BY last_message_at DESC
    LIMIT 1
  `).get();
}

export function getPendingProspects(limit = 50, offset = 0, country = null) {
  if (country) {
    const countries = Array.isArray(country) ? country : country.split(',').map((c) => c.trim());
    const clause = countries.map(() => `country LIKE ?`).join(' OR ');
    const params = countries.map((c) => `%${c}%`);
    return getDb().prepare(
      `SELECT * FROM prospects WHERE stage = 'PENDING' AND (${clause}) LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);
  }
  return getDb().prepare(`SELECT * FROM prospects WHERE stage = 'PENDING' LIMIT ? OFFSET ?`).all(limit, offset);
}

export function getAllProspects() {
  return getDb().prepare(`SELECT * FROM prospects ORDER BY created_at DESC`).all();
}

// Prospectos en FASE2_PORTERO sin respuesta hace más de 24hs → necesitan follow-up
export function getProspectsNeedingFollowup() {
  return getDb().prepare(`
    SELECT * FROM prospects
    WHERE stage = 'FASE2_PORTERO'
    AND last_message_at < datetime('now', '-24 hours')
    AND (last_reply_at IS NULL OR last_reply_at < last_message_at)
  `).all();
}

// Prospectos con follow-up enviado y sin respuesta hace más de 24hs → cerrar
export function getProspectsNoReply() {
  return getDb().prepare(`
    SELECT * FROM prospects
    WHERE stage = 'FASE2_FOLLOWUP_SENT'
    AND last_message_at < datetime('now', '-24 hours')
    AND (last_reply_at IS NULL OR last_reply_at < last_message_at)
  `).all();
}
