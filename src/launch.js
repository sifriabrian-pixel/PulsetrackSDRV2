import { getPendingProspects, updateProspect } from './db.js';
import { resolveJid, chatExists, sendFase0Apertura } from './transport.js';

export async function runLaunchBatch(limit, country = null) {
  console.log(`\n🚀 Enviando mensajes a ${limit} prospectos nuevos${country ? ` (${country})` : ''}...\n`);

  let enviados = 0;
  let saltados = 0;
  let noWhatsapp = 0;

  while (enviados < limit) {
    const batch = getPendingProspects(20, 0, country);
    if (batch.length === 0) {
      console.log(`No hay más prospectos en estado PENDING${country ? ` para ${country}` : ''}.`);
      break;
    }

    for (const prospect of batch) {
      if (enviados >= limit) break;

      try {
        const resolved = await resolveJid(prospect.gatekeeper_phone);

        if (!resolved) {
          await updateProspect(prospect.id, { stage: 'NO_WHATSAPP' });
          console.log(`[NO WA] ${prospect.clinic_name} — número no está en WhatsApp`);
          noWhatsapp++;
          continue;
        }

        const { jid, lid } = resolved;

        if ((await chatExists(jid)) || (lid && (await chatExists(lid)))) {
          await updateProspect(prospect.id, { stage: 'SKIPPED', gatekeeper_jid: jid, gatekeeper_lid: lid });
          console.log(`[SKIP]  ${prospect.clinic_name} — ya tiene conversación activa`);
          saltados++;
          continue;
        }

        // Mandar primero, marcar FASE0_SENT solo si el envío realmente funcionó
        await sendFase0Apertura(jid);
        await updateProspect(prospect.id, {
          stage: 'FASE0_SENT',
          gatekeeper_jid: jid,
          gatekeeper_lid: lid,
          last_message_at: new Date().toISOString(),
        });
        console.log(`[SENT]  ${prospect.clinic_name} → ${jid}`);
        enviados++;
      } catch (err) {
        // Un error puntual (ej: caída momentánea de la API) no debe tirar abajo todo el lote.
        // El prospecto queda en PENDING y se reintenta en el próximo lanzamiento.
        console.error(`[ERROR] ${prospect.clinic_name} — ${(err.message || '').slice(0, 200)} — sigo con el próximo`);
      }
    }
  }

  console.log(`\n✅ Lote completado — ${enviados} enviados, ${saltados} saltados, ${noWhatsapp} sin WhatsApp\n`);
  return { enviados, saltados, noWhatsapp };
}
