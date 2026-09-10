import { getPendingProspects, updateProspect } from './db.js';
import { resolveJid, chatExists, sendFase0Apertura } from './transport.js';

// Si falla el envío N veces seguidas, es casi seguro un problema sistémico
// (número no registrado en Meta, template no aprobado, API caída) y no un
// problema puntual de cada prospecto. Sin este corte, como los prospectos que
// fallan quedan en PENDING, el loop de abajo los vuelve a traer con
// getPendingProspects() una y otra vez — reintento infinito golpeando la API.
const MAX_CONSECUTIVE_ERRORS = 5;

export async function runLaunchBatch(limit, country = null) {
  console.log(`\n🚀 Enviando mensajes a ${limit} prospectos nuevos${country ? ` (${country})` : ''}...\n`);

  let enviados = 0;
  let saltados = 0;
  let noWhatsapp = 0;
  let consecutiveErrors = 0;

  while (enviados < limit) {
    const batch = getPendingProspects(20, 0, country);
    if (batch.length === 0) {
      console.log(`No hay más prospectos en estado PENDING${country ? ` para ${country}` : ''}.`);
      break;
    }

    let hizoAlgoEsteLote = false;

    for (const prospect of batch) {
      if (enviados >= limit) break;

      try {
        const resolved = await resolveJid(prospect.gatekeeper_phone);

        if (!resolved) {
          await updateProspect(prospect.id, { stage: 'NO_WHATSAPP' });
          console.log(`[NO WA] ${prospect.clinic_name} — número no está en WhatsApp`);
          noWhatsapp++;
          consecutiveErrors = 0;
          hizoAlgoEsteLote = true;
          continue;
        }

        const { jid, lid } = resolved;

        if ((await chatExists(jid)) || (lid && (await chatExists(lid)))) {
          await updateProspect(prospect.id, { stage: 'SKIPPED', gatekeeper_jid: jid, gatekeeper_lid: lid });
          console.log(`[SKIP]  ${prospect.clinic_name} — ya tiene conversación activa`);
          saltados++;
          consecutiveErrors = 0;
          hizoAlgoEsteLote = true;
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
        consecutiveErrors = 0;
        hizoAlgoEsteLote = true;
      } catch (err) {
        // Un error puntual (ej: caída momentánea de la API) no debe tirar abajo todo el lote.
        // El prospecto queda en PENDING y se reintenta en el próximo lanzamiento.
        console.error(`[ERROR] ${prospect.clinic_name} — ${(err.message || '').slice(0, 200)} — sigo con el próximo`);
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          console.error(`\n🛑 ${consecutiveErrors} errores seguidos — corto el lote. Esto casi seguro es un problema` +
            ` de configuración (número no registrado en Meta, template no aprobado, API caída), no de los prospectos.` +
            ` Revisar antes de reintentar.\n`);
          return { enviados, saltados, noWhatsapp, abortadoPorErrores: true };
        }
      }
    }

    // Si dimos una vuelta completa al lote sin lograr avanzar en nada (ni envío,
    // ni skip, ni no-whatsapp), cortamos igual — evita loop infinito por las dudas,
    // aunque el corte de arriba ya debería haber actuado antes de llegar acá.
    if (!hizoAlgoEsteLote) {
      console.error(`\n🛑 No se pudo avanzar con ningún prospecto de este lote — corto para no loopear infinito.\n`);
      return { enviados, saltados, noWhatsapp, abortadoPorErrores: true };
    }
  }

  console.log(`\n✅ Lote completado — ${enviados} enviados, ${saltados} saltados, ${noWhatsapp} sin WhatsApp\n`);
  return { enviados, saltados, noWhatsapp };
}
