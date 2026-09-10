import 'dotenv/config';
import { initDb, updateProspect, getDb } from './src/db.js';
import { importCsv } from './data/prospects.js';
import { startFollowupScheduler } from './src/followup.js';
import { runLaunchBatch } from './src/launch.js';
import path from 'path';

const TRANSPORT = process.env.TRANSPORT === 'baileys' ? 'baileys' : 'kapso';

async function startTransport() {
  if (TRANSPORT === 'kapso') {
    const { startKapsoServer } = await import('./src/kapsoWebhookServer.js');
    startKapsoServer();
    return;
  }
  const { startWhatsApp } = await import('./src/whatsapp.js');
  await startWhatsApp();
}

const args = process.argv.slice(2);

async function main() {
  initDb();

  // ── Comando: importar CSV ────────────────────────────────────────────────
  if (args[0] === 'import') {
    const file = args[1];
    if (!file) {
      console.error('Uso: node index.js import <archivo.csv>');
      process.exit(1);
    }
    await importCsv(path.resolve(file));
    process.exit(0);
  }

  // ── Comando: pausar prospecto manualmente ───────────────────────────────
  if (args[0] === 'pause') {
    const phone = args[1]?.replace(/\D/g, '');
    if (!phone) { console.error('Uso: node index.js pause <teléfono>'); process.exit(1); }
    const db = getDb();
    const result = db.prepare(`UPDATE prospects SET stage = 'PAUSED' WHERE gatekeeper_phone = ? OR dm_phone = ?`).run(phone, phone);
    console.log(result.changes > 0
      ? `✅ Prospecto ${phone} pausado — el bot no va a responder más.`
      : `⚠ No se encontró prospecto con ese número.`);
    process.exit(0);
  }

  // ── Comando: lanzar lote ──────────────────────────────────────────────────
  if (args[0] === 'launch') {
    const limit = parseInt(args[1]) || 50;
    const country = args[2] || null;

    if (TRANSPORT === 'kapso') {
      // Con Kapso, mandar mensajes es solo un POST a la API — no hace falta
      // levantar el webhook server para esto. Si lo hiciéramos acá (ej: corriendo
      // este comando por `railway ssh` mientras el proceso principal ya está
      // escuchando en el mismo contenedor), pisaría el puerto del proceso
      // principal y colgaría el envío a mitad de camino. El proceso principal
      // (siempre corriendo) es el que escucha las respuestas entrantes.
      await runLaunchBatch(limit, country);
      console.log('✅ Lote enviado. El proceso principal (siempre activo) escucha las respuestas — no hace falta dejar este proceso corriendo.');
      process.exit(0);
    }

    // Baileys (legacy): necesita el socket activo para poder enviar, así que
    // sí se queda escuchando después del lote.
    await startTransport();
    await runLaunchBatch(limit, country);
    console.log('Agente activo — escuchando respuestas entrantes.\n');
    startFollowupScheduler();
    // No hay return — el proceso queda vivo escuchando respuestas
    return;
  }

  // ── Comando: marcar prospectos como entrega fallida a mano (para corregir
  //    los que fallaron antes de que el webhook de status empezara a procesarlos)
  if (args[0] === 'mark-no-whatsapp') {
    const phones = args.slice(1).map((p) => p.replace(/\D/g, ''));
    if (phones.length === 0) {
      console.error('Uso: node index.js mark-no-whatsapp <telefono1> [telefono2] ...');
      process.exit(1);
    }
    const db = getDb();
    for (const phone of phones) {
      const jid = `${phone}@s.whatsapp.net`;
      const prospect = db.prepare(`SELECT * FROM prospects WHERE gatekeeper_jid = ? OR dm_jid = ?`).get(jid, jid);
      if (!prospect) {
        console.log(`[SKIP] No se encontró prospecto para ${phone}`);
        continue;
      }
      updateProspect(prospect.id, { stage: 'NO_WHATSAPP' });
      console.log(`[FIXED] ${prospect.clinic_name} (${phone}) → NO_WHATSAPP`);
    }
    process.exit(0);
  }

  // ── Comando: prospecto de prueba manual — ignora a propósito el chequeo
  //    de "conversación existente" (es justamente para probar con un número
  //    que ya tiene chat abierto). Correr en el mismo proceso que ya está
  //    escuchando el webhook (ej: Railway Console), no en un proceso aparte.
  if (args[0] === 'test-lead') {
    const phone = (args[1] || '').replace(/\D/g, '');
    if (!phone) {
      console.error('Uso: node index.js test-lead <telefono> [pais]');
      process.exit(1);
    }
    const pais = args[2] || 'Argentina';
    const { resolveJid, sendFase0Apertura } = await import('./src/transport.js');
    const db = getDb();

    let prospect = db.prepare(`SELECT * FROM prospects WHERE gatekeeper_phone = ?`).get(phone);
    if (!prospect) {
      const info = db.prepare(
        `INSERT INTO prospects (clinic_name, gatekeeper_phone, country, stage) VALUES (?, ?, ?, 'PENDING')`
      ).run('TEST', phone, pais);
      prospect = db.prepare(`SELECT * FROM prospects WHERE id = ?`).get(info.lastInsertRowid);
    }

    const resolved = await resolveJid(phone);
    const jid = resolved.jid;
    updateProspect(prospect.id, {
      stage: 'FASE0_SENT',
      gatekeeper_jid: jid,
      last_message_at: new Date().toISOString(),
    });
    await sendFase0Apertura(jid);
    console.log(`[TEST-LEAD] Template enviado a ${jid} (prospecto #${prospect.id})`);
    process.exit(0);
  }

  // ── Comando: migrar LIDs de prospectos viejos (solo Baileys) ────────────
  if (args[0] === 'fix-lids') {
    const { startWhatsApp, resolveJid } = await import('./src/whatsapp.js');
    await startWhatsApp();
    const rows = getDb().prepare(`SELECT id, gatekeeper_phone FROM prospects WHERE stage = 'FASE0_SENT' AND gatekeeper_lid IS NULL`).all();
    console.log(`\n🔧 Resolviendo LIDs para ${rows.length} prospectos...\n`);
    for (const row of rows) {
      const resolved = await resolveJid(row.gatekeeper_phone);
      if (resolved?.lid) {
        updateProspect(row.id, { gatekeeper_lid: resolved.lid });
        console.log(`[LID] ${row.gatekeeper_phone} → ${resolved.lid}`);
      }
    }
    console.log('\n✅ LIDs actualizados. Reiniciá con: node index.js\n');
    return;
  }

  // ── Modo normal: escuchar respuestas entrantes vía webhook ───────────────
  try {
    await startTransport();
    console.log(`Agente activo (${TRANSPORT}) — escuchando respuestas entrantes.`);
    startFollowupScheduler();
  } catch (err) {
    console.error('[TRANSPORT] No se pudo conectar:', err.message);
  }
}

main().catch((err) => {
  console.error('Error fatal:', err);
  process.exit(1);
});
