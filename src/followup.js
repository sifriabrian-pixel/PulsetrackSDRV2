import { getProspectsNeedingFollowup, getProspectsNoReply, updateProspect } from './db.js';
import { sendFollowup } from './transport.js';
import { FASE2_FOLLOWUP } from '../data/sequences.js';

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // revisar cada 30 minutos

async function runFollowupCheck() {
  // 1. Enviar follow-up a los que no respondieron en 24hs
  const needFollowup = getProspectsNeedingFollowup();
  for (const prospect of needFollowup) {
    try {
      const jid = prospect.gatekeeper_jid;
      if (!jid) continue;
      await sendFollowup(jid, FASE2_FOLLOWUP);
      await updateProspect(prospect.id, {
        stage: 'FASE2_FOLLOWUP_SENT',
        last_message_at: new Date().toISOString(),
      });
      console.log(`[FOLLOWUP] ${prospect.clinic_name} — follow-up enviado`);
    } catch (err) {
      console.error(`[FOLLOWUP ERROR] ${prospect.clinic_name} — ${err.message}`);
    }
  }

  // 2. Cerrar prospectos con follow-up enviado y sin respuesta en 24hs más
  const noReply = getProspectsNoReply();
  for (const prospect of noReply) {
    await updateProspect(prospect.id, { stage: 'NO_REPLY' });
    console.log(`[NO_REPLY] ${prospect.clinic_name} — sin respuesta, contacto cerrado`);
  }
}

export function startFollowupScheduler() {
  // Primera revisión a los 5 minutos de arrancar
  setTimeout(async () => {
    await runFollowupCheck();
    setInterval(runFollowupCheck, CHECK_INTERVAL_MS);
  }, 5 * 60 * 1000);

  console.log('⏰ Follow-up scheduler activo — revisa cada 30 minutos');
}
