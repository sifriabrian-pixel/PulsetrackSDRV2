// ─────────────────────────────────────────────────────────────────────────────
// Envío de prueba aislado — manda FASE0 a UN SOLO número, sin tocar la cola PENDING
// Uso: node scripts/test_send_one.js <telefono>
// ─────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import { initDb, getDb, updateProspect } from '../src/db.js';
import { startWhatsApp, sendMessage, resolveJid } from '../src/whatsapp.js';
import { FASE0_APERTURA } from '../data/sequences.js';

const phone = (process.argv[2] || '').replace(/\D/g, '');
if (!phone) {
  console.error('Uso: node scripts/test_send_one.js <telefono>');
  process.exit(1);
}

async function main() {
  initDb();
  const row = getDb().prepare('SELECT * FROM prospects WHERE gatekeeper_phone = ?').get(phone);
  if (!row) {
    console.error(`No existe ningún prospecto con el teléfono ${phone} en la base.`);
    process.exit(1);
  }

  await startWhatsApp();
  const resolved = await resolveJid(phone);
  if (!resolved) {
    console.error('Ese número no está en WhatsApp.');
    process.exit(1);
  }

  const { jid, lid } = resolved;
  await updateProspect(row.id, {
    stage: 'FASE0_SENT',
    gatekeeper_jid: jid,
    gatekeeper_lid: lid,
    last_message_at: new Date().toISOString(),
  });
  await sendMessage(jid, FASE0_APERTURA);
  console.log(`[SENT] ${row.clinic_name} (${phone}) → ${jid}`);
  console.log('Listo. El proceso queda vivo escuchando la respuesta de este número únicamente vía la app normal.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Error fatal:', err.message);
  process.exit(1);
});
