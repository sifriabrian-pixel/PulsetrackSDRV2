import { updateProspect, logMessage, getMessages } from './db.js';
import { sendMessage, sendFase3Apertura } from './transport.js';
import { sendHandoff } from './notifier.js';
import {
  detectRole,
  gatekeeperTurn,
  dmTurn,
} from './claude.js';
import {
  FASE0_BOT_REPLY,
  FASE1_INICIAL,
  FASE2_CIERRE_PORTERO,
  FASE3_APERTURA,
  FASE3_APERTURA_B,
} from '../data/sequences.js';

function appendNote(existing, note) {
  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
  return `${existing || ''}\n[${ts}] ${note}`.trim();
}

// Manda el mensaje y lo deja registrado en `messages` para que el dashboard
// pueda mostrar la conversación completa (no solo el resumen de `notes`).
async function send(prospect, jid, text) {
  if (!text) return;
  await sendMessage(jid, text);
  logMessage(prospect.id, 'out', text);
}

export async function handleMessage(prospect, incomingText, fromJid) {
  // Historial ANTES de este turno — se lo pasamos a Claude para que no se
  // repita y reaccione a lo que ya se dijo. Se loguea el turno actual después.
  const history = getMessages(prospect.id);
  logMessage(prospect.id, 'in', incomingText);

  const { stage, country, dm_name, notes } = prospect;
  const pais = country || '[país]';

  // ─── FASE 0: esperando que un humano responda al saludo de apertura ───────
  if (stage === 'FASE0_SENT') {
    const { role } = await detectRole(incomingText);

    if (role === 'BOT') {
      await send(prospect, fromJid, FASE0_BOT_REPLY);
      return;
    }

    if (role === 'DM') {
      // Quien respondió ya se identifica como decisora → pitch directo (MSG 1B, con disclosure de IA)
      await updateProspect(prospect.id, {
        stage: 'FASE3_BIFURCACION_B',
        dm_jid: fromJid,
        gatekeeper_jid: fromJid,
        last_reply_at: new Date().toISOString(),
        notes: appendNote(notes, `Decisora detectada directamente en Fase 0`),
      });
      await send(prospect, fromJid, FASE3_APERTURA_B());
      await updateProspect(prospect.id, { last_message_at: new Date().toISOString() });
      return;
    }

    // Humano respondió (recepción o unknown) → Mensaje 2: identificación + pedido a la DM
    await updateProspect(prospect.id, {
      stage: 'FASE2_PORTERO',
      gatekeeper_jid: fromJid,
      last_reply_at: new Date().toISOString(),
      notes: appendNote(notes, `Humano respondió apertura (rol: ${role})`),
    });
    await send(prospect, fromJid, FASE1_INICIAL(pais));
    await updateProspect(prospect.id, { last_message_at: new Date().toISOString() });
    return;
  }

  // ─── FASE 2: conversación con recepción/atención al cliente ──────────────
  // Valentina lee el historial completo y redacta la respuesta en el momento
  // (en vez de elegir entre mensajes fijos) — así no se repite y reacciona a
  // lo que realmente dijeron (ej: "soy psicólogo, no tengo clínica").
  if (['FASE2_PORTERO', 'FASE2_OBJECION', 'FASE2_YA_TIENEN'].includes(stage)) {
    const result = await gatekeeperTurn({ clinicName: prospect.clinic_name, pais, history, incomingText });

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
        await send(prospect, fromJid, result.reply || FASE2_CIERRE_PORTERO);
        // Número nuevo, sin conversación previa → mensaje frío, necesita template aprobado
        await sendFase3Apertura(dmJid, dmName, pais);
        logMessage(prospect.id, 'out', FASE3_APERTURA(dmName, pais));
        await updateProspect(prospect.id, { last_message_at: new Date().toISOString() });
      } else {
        // Derivación interna — sigue siendo el mismo chat, dentro de la ventana de 24hs.
        // Este es el momento del disclosure de IA, así que se mantiene el texto
        // aprobado en vez de generarlo libremente.
        await updateProspect(prospect.id, {
          stage: 'FASE3_BIFURCACION',
          dm_name: result.dm_name || null,
          dm_jid: fromJid,
          last_reply_at: new Date().toISOString(),
          notes: appendNote(notes, `Recepción deriva internamente a la decisora`),
        });
        await send(prospect, fromJid, FASE3_APERTURA(dmName, pais));
        await updateProspect(prospect.id, { last_message_at: new Date().toISOString() });
      }
      return;
    }

    if (result.action === 'IS_INDEPENDENT') {
      // Es un profesional independiente — es la persona correcta, saltamos
      // directo a la apertura de Etapa 2 (con disclosure de IA) en este chat.
      await send(prospect, fromJid, result.reply);
      await updateProspect(prospect.id, {
        stage: 'FASE3_BIFURCACION_B',
        dm_jid: fromJid,
        last_reply_at: new Date().toISOString(),
        last_message_at: new Date().toISOString(),
        notes: appendNote(notes, `Profesional independiente identificado — pitch de Etapa 2 enviado`),
      });
      return;
    }

    if (result.action === 'REJECTED') {
      const rejections = (prospect.rejection_count || 0) + 1;
      await send(prospect, fromJid, result.reply);
      if (rejections >= 2) {
        await updateProspect(prospect.id, {
          stage: 'DISCARDED',
          rejection_count: rejections,
          notes: appendNote(notes, `Descartado: recepción rechazó ${rejections} veces`),
        });
        console.log(`[DISCARDED] ${prospect.clinic_name} — rechazó ${rejections} veces`);
      } else {
        await updateProspect(prospect.id, {
          stage: 'FASE2_OBJECION',
          rejection_count: rejections,
          last_message_at: new Date().toISOString(),
          last_reply_at: new Date().toISOString(),
        });
      }
      return;
    }

    // CONTINUE — seguimos en la conversación con recepción
    await send(prospect, fromJid, result.reply);
    await updateProspect(prospect.id, {
      stage: 'FASE2_OBJECION',
      last_message_at: new Date().toISOString(),
      last_reply_at: new Date().toISOString(),
    });
    return;
  }

  // ─── FASE 3: conversación con la directora/DM ─────────────────────────────
  // Regla de handoff: cualquier respuesta que no sea un rechazo puro (2C) es
  // handoff inmediato a Brian. 2C es la ÚNICA bifurcación donde Valentina
  // responde y sigue sin pasarle la conversación a Brian.
  if (['FASE3_BIFURCACION', 'FASE3_BIFURCACION_B', 'FASE3_OBJECION'].includes(stage)) {
    const result = await dmTurn({ dmName: dm_name, pais, history, incomingText });

    if (result.action === 'REJECTED') {
      await send(prospect, fromJid, result.reply);
      await updateProspect(prospect.id, {
        stage: 'DISCARDED',
        last_reply_at: new Date().toISOString(),
        notes: appendNote(notes, `Descartado: DM rechazó ("no me interesa"/"ya tenemos")`),
      });
      console.log(`[DISCARDED] ${prospect.clinic_name} — DM rechazó`);
      return;
    }

    if (result.action === 'ASK_NUMBER') {
      await send(prospect, fromJid, result.reply);
      await updateProspect(prospect.id, {
        stage: 'FASE3_OBJECION',
        last_reply_at: new Date().toISOString(),
        last_message_at: new Date().toISOString(),
        notes: appendNote(notes, `DM preguntó cómo conseguimos su número`),
      });
      return;
    }

    if (result.action === 'MANDAME_INFO') {
      await send(prospect, fromJid, result.reply);
      await updateProspect(prospect.id, {
        stage: 'FASE3_OBJECION',
        last_reply_at: new Date().toISOString(),
        last_message_at: new Date().toISOString(),
        notes: appendNote(notes, `DM pidió que le mandemos info por WhatsApp — se la redirigió a la llamada`),
      });
      return;
    }

    if (result.action === 'ASKED_IF_BOT') {
      await send(prospect, fromJid, result.reply);
      await updateProspect(prospect.id, {
        stage: 'FASE3_OBJECION',
        last_reply_at: new Date().toISOString(),
        last_message_at: new Date().toISOString(),
        notes: appendNote(notes, `DM preguntó si es un bot/IA — se confirmó con honestidad`),
      });
      return;
    }

    // HANDOFF (2A): interés, pregunta, confirmación de disponibilidad, o cualquier
    // respuesta que no sea las tres excepciones anteriores → Brian toma la conversación
    await updateProspect(prospect.id, {
      stage: 'HANDED_OFF',
      last_reply_at: new Date().toISOString(),
      notes: appendNote(notes, `HANDOFF — DM respondió: "${incomingText.slice(0, 80)}" — Brian toma la conversación`),
    });
    await sendHandoff({ ...prospect, stage: 'HANDED_OFF' });
    console.log(`[HANDOFF] ${prospect.clinic_name} — handoff a Brian (respuesta del DM)`);
    return;
  }
}
