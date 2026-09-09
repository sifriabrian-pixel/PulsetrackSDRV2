import { updateProspect } from './db.js';
import { sendMessage, sendFase3Apertura } from './transport.js';
import { sendHandoff } from './notifier.js';
import {
  detectRole,
  classifyGatekeeperReply,
  classifyPorteroEsDM,
} from './claude.js';
import {
  FASE0_BOT_REPLY,
  FASE1_INICIAL,
  FASE2_OBJECIONES,
  FASE2_CIERRE_PORTERO,
  FASE3_APERTURA,
  FASE3_APERTURA_B,
} from '../data/sequences.js';

function appendNote(existing, note) {
  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
  return `${existing || ''}\n[${ts}] ${note}`.trim();
}

export async function handleMessage(prospect, incomingText, fromJid) {
  const { stage, country, dm_name, notes } = prospect;
  const pais = country || '[país]';

  // ─── FASE 0: esperando que un humano responda al saludo de apertura ───────
  if (stage === 'FASE0_SENT') {
    const { role } = await detectRole(incomingText);

    if (role === 'BOT') {
      await sendMessage(fromJid, FASE0_BOT_REPLY);
      return;
    }

    if (role === 'DM') {
      // Quien respondió ya se identifica como decisor → pitch directo en tuteo
      await updateProspect(prospect.id, {
        stage: 'FASE3_BIFURCACION',
        dm_jid: fromJid,
        gatekeeper_jid: fromJid,
        last_reply_at: new Date().toISOString(),
        notes: appendNote(notes, `Decisor detectado directamente en Fase 0`),
      });
      await sendMessage(fromJid, FASE3_APERTURA_B());
      await updateProspect(prospect.id, { last_message_at: new Date().toISOString() });
      return;
    }

    // Humano respondió (portero o unknown) → Mensaje 2: identificación + pedido al DM
    await updateProspect(prospect.id, {
      stage: 'FASE2_PORTERO',
      gatekeeper_jid: fromJid,
      last_reply_at: new Date().toISOString(),
      notes: appendNote(notes, `Humano respondió apertura (rol: ${role})`),
    });
    await sendMessage(fromJid, FASE1_INICIAL(pais));
    await updateProspect(prospect.id, { last_message_at: new Date().toISOString() });
    return;
  }

  // ─── FASE 2: conversación con la recepción/portero ───────────────────────
  if (['FASE2_PORTERO', 'FASE2_OBJECION', 'FASE2_YA_TIENEN'].includes(stage)) {
    const result = await classifyGatekeeperReply(incomingText);

    if (result.action === 'GAVE_CONTACT') {
      const dmPhone = result.dm_phone;
      const dmName = result.dm_name || 'hola';

      if (dmPhone) {
        const dmJid = `${dmPhone.replace(/\D/g, '')}@s.whatsapp.net`;
        await updateProspect(prospect.id, {
          stage: 'FASE3_BIFURCACION',
          dm_phone: dmPhone,
          dm_name: result.dm_name || null,
          dm_jid: dmJid,
          last_reply_at: new Date().toISOString(),
          notes: appendNote(notes, `Recepción dio contacto: ${dmPhone} (${result.dm_name || 'sin nombre'})`),
        });
        await sendMessage(fromJid, FASE2_CIERRE_PORTERO);
        // Número nuevo, sin conversación previa → mensaje frío, necesita template aprobado
        await sendFase3Apertura(dmJid, dmName, pais);
        await updateProspect(prospect.id, { last_message_at: new Date().toISOString() });
      } else {
        await updateProspect(prospect.id, {
          stage: 'FASE3_BIFURCACION',
          dm_name: result.dm_name || null,
          dm_jid: fromJid,
          last_reply_at: new Date().toISOString(),
          notes: appendNote(notes, `Recepción deriva internamente al decisor`),
        });
        await sendMessage(fromJid, FASE3_APERTURA(dmName, pais));
        await updateProspect(prospect.id, { last_message_at: new Date().toISOString() });
      }
      return;
    }

    if (result.action === 'YO_AYUDO') {
      await sendMessage(fromJid, FASE2_OBJECIONES.calificar_portero());
      await updateProspect(prospect.id, {
        stage: 'FASE2_CALIFICANDO',
        last_message_at: new Date().toISOString(),
        last_reply_at: new Date().toISOString(),
        notes: appendNote(notes, `Portero se ofreció a escuchar — calificando si es decisor`),
      });
      return;
    }

    if (result.action === 'QUIERE_INFO') {
      await sendMessage(fromJid, FASE2_OBJECIONES.que_se_trata(pais));
      await updateProspect(prospect.id, {
        stage: 'FASE2_OBJECION',
        last_message_at: new Date().toISOString(),
        last_reply_at: new Date().toISOString(),
      });
      return;
    }

    if (result.action === 'MANDAME_INFO') {
      await sendMessage(fromJid, FASE2_OBJECIONES.mandame_info(pais));
      await updateProspect(prospect.id, {
        stage: 'FASE2_OBJECION',
        last_message_at: new Date().toISOString(),
        last_reply_at: new Date().toISOString(),
      });
      return;
    }

    if (result.action === 'NO_CONTACTO') {
      await sendMessage(fromJid, FASE2_OBJECIONES.no_contacto());
      await updateProspect(prospect.id, {
        stage: 'FASE2_PIDIENDO_NOMBRE',
        last_message_at: new Date().toISOString(),
        last_reply_at: new Date().toISOString(),
      });
      return;
    }

    if (result.action === 'PIDE_WEB') {
      await sendMessage(fromJid, FASE2_OBJECIONES.piden_web());
      await updateProspect(prospect.id, {
        stage: 'FASE2_OBJECION',
        last_message_at: new Date().toISOString(),
        last_reply_at: new Date().toISOString(),
      });
      return;
    }

    if (result.action === 'YA_TIENEN' || result.action === 'REJECTED') {
      if (stage === 'FASE2_YA_TIENEN') {
        // Ya se les pidió el contacto una vez tras un "ya tienen" — insisten, cerramos
        await sendMessage(fromJid, FASE2_OBJECIONES.ya_tienen_insiste());
        await updateProspect(prospect.id, {
          stage: 'DISCARDED',
          notes: appendNote(notes, `Descartado: recepción insistió en "ya tenemos"/rechazo`),
        });
        console.log(`[DISCARDED] ${prospect.clinic_name} — recepción insistió`);
      } else {
        await sendMessage(fromJid, FASE2_OBJECIONES.ya_tienen());
        await updateProspect(prospect.id, {
          stage: 'FASE2_YA_TIENEN',
          last_message_at: new Date().toISOString(),
          last_reply_at: new Date().toISOString(),
          notes: appendNote(notes, `Recepción dijo "ya tienen"/rechazo — pedido de contacto enviado`),
        });
      }
      return;
    }

    // UNKNOWN — fallback genérico
    await sendMessage(fromJid, FASE2_OBJECIONES.fallback_generico());
    await updateProspect(prospect.id, {
      stage: 'FASE2_OBJECION',
      last_message_at: new Date().toISOString(),
    });
    return;
  }

  // ─── FASE 2 — pidiendo nombre del director (3D, primer paso) ─────────────
  if (stage === 'FASE2_PIDIENDO_NOMBRE') {
    await updateProspect(prospect.id, {
      last_reply_at: new Date().toISOString(),
      notes: appendNote(notes, `Recepción respondió pedido de nombre: "${incomingText.slice(0, 80)}"`),
    });
    await sendMessage(fromJid, FASE2_OBJECIONES.pide_linkedin_email());
    await updateProspect(prospect.id, {
      stage: 'FASE2_PIDIENDO_LINKEDIN',
      last_message_at: new Date().toISOString(),
    });
    return;
  }

  // ─── FASE 2 — pidiendo LinkedIn/email (3D, segundo paso) ──────────────────
  if (stage === 'FASE2_PIDIENDO_LINKEDIN') {
    const tieneDato = /@|linkedin|\.com|\.[a-z]{2,3}\b/i.test(incomingText);

    if (tieneDato) {
      await updateProspect(prospect.id, {
        stage: 'HANDED_OFF',
        notes: appendNote(notes, `Recepción dio LinkedIn/email: "${incomingText.trim()}" — seguimiento manual`),
      });
      await sendHandoff({ ...prospect, stage: 'HANDED_OFF' });
      console.log(`[HANDOFF] ${prospect.clinic_name} — recepción dio LinkedIn/email, seguimiento manual`);
    } else {
      await sendMessage(fromJid, FASE2_OBJECIONES.no_dan_nada(pais));
      await updateProspect(prospect.id, {
        stage: 'DISCARDED',
        notes: appendNote(notes, `Descartado: recepción no dio ningún dato de contacto`),
      });
      console.log(`[DISCARDED] ${prospect.clinic_name} — sin datos de contacto`);
    }
    return;
  }

  // ─── FASE 2 CALIFICANDO: portero dijo "yo ayudo" — ¿es decisor? ───────────
  if (stage === 'FASE2_CALIFICANDO') {
    const { is_dm } = await classifyPorteroEsDM(incomingText);

    if (is_dm) {
      await updateProspect(prospect.id, {
        stage: 'FASE3_BIFURCACION',
        dm_jid: fromJid,
        last_reply_at: new Date().toISOString(),
        notes: appendNote(notes, `Portero confirmó ser decisor — enviando pitch directo (MSG 1B)`),
      });
      await sendMessage(fromJid, FASE3_APERTURA_B());
      await updateProspect(prospect.id, { last_message_at: new Date().toISOString() });
    } else {
      await sendMessage(fromJid, FASE2_OBJECIONES.no_es_decisor());
      await updateProspect(prospect.id, {
        stage: 'FASE2_PORTERO',
        last_message_at: new Date().toISOString(),
        last_reply_at: new Date().toISOString(),
        notes: appendNote(notes, `Portero no es decisor — pidiendo contacto del director`),
      });
    }
    return;
  }

  // ─── FASE 3: conversación con el decisor (DM) ─────────────────────────────
  // Regla de handoff: cualquier respuesta del DM, sin excepción, es handoff
  // inmediato a Brian — el bot no le contesta nada al decisor.
  if (stage === 'FASE3_BIFURCACION' || stage === 'FASE3_OBJECION') {
    await updateProspect(prospect.id, {
      stage: 'HANDED_OFF',
      last_reply_at: new Date().toISOString(),
      notes: appendNote(notes, `HANDOFF — decisor respondió: "${incomingText.slice(0, 80)}" — Brian toma la conversación`),
    });
    await sendHandoff({ ...prospect, stage: 'HANDED_OFF' });
    console.log(`[HANDOFF] ${prospect.clinic_name} — handoff a Brian (respuesta del DM)`);
    return;
  }
}
