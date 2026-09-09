// Selector de transporte: Kapso (API Oficial, default) o Baileys (legacy, no usar en este proyecto).
// El resto del código (router, stateMachine, launch) importa de acá en vez de kapso.js/whatsapp.js directo.

import { FASE3_APERTURA } from '../data/sequences.js';

const isKapso = process.env.TRANSPORT !== 'baileys';
const impl = isKapso ? await import('./kapso.js') : await import('./whatsapp.js');

export const sendMessage = impl.sendMessage;
export const resolveJid = impl.resolveJid;
export const chatExists = impl.chatExists;
export const getSock = impl.getSock;

// Primer contacto en frío (Mensaje 1 / FASE0) — sin conversación previa, tiene que
// ser un template aprobado cuando se usa la API Oficial. Con Baileys sigue siendo texto libre.
export async function sendFase0Apertura(jid) {
  if (isKapso) {
    const templateName = process.env.KAPSO_TEMPLATE_NAME;
    if (!templateName) {
      console.log('[KAPSO] Apertura sin template aprobado configurado (KAPSO_TEMPLATE_NAME) — no se envía.');
      return null;
    }
    return impl.sendTemplateMessage(jid, templateName);
  }
  const { FASE0_APERTURA } = await import('../data/sequences.js');
  return impl.sendMessage(jid, FASE0_APERTURA);
}

// Apertura al DM cuando la recepción da un número NUEVO (no es el mismo chat que
// ya teníamos abierto) — también es fuera de ventana, necesita template propio.
export async function sendFase3Apertura(jid, dmName, pais) {
  if (isKapso) {
    const templateName = process.env.KAPSO_DM_TEMPLATE_NAME;
    if (!templateName) {
      console.log('[KAPSO] Apertura a DM sin template aprobado configurado (KAPSO_DM_TEMPLATE_NAME) — no se envía.');
      return null;
    }
    return impl.sendTemplateMessage(jid, templateName);
  }
  return impl.sendMessage(jid, FASE3_APERTURA(dmName, pais));
}

// Aviso a Brian de que hay un lead interesado. Se intenta primero como texto libre
// (funciona si Brian le escribió al número hace menos de 24hs); si eso falla, hay
// que usar un template aprobado — igual que le pasa a cualquier mensaje frío.
export async function sendHandoffNotification(jid) {
  if (isKapso) {
    const templateName = process.env.KAPSO_HANDOFF_TEMPLATE_NAME;
    if (!templateName) {
      console.log('[KAPSO] Aviso de handoff sin template aprobado configurado (KAPSO_HANDOFF_TEMPLATE_NAME) — no se pudo avisar a Brian.');
      return null;
    }
    return impl.sendTemplateMessage(jid, templateName);
  }
  return impl.sendMessage(jid, 'Che, tenés un lead nuevo esperando respuesta — revisá WhatsApp 👀');
}

// El follow-up de 24hs también se manda fuera de la ventana de conversación,
// así que con la API Oficial también necesita template propio.
export async function sendFollowup(jid, freeText) {
  if (isKapso) {
    const templateName = process.env.KAPSO_FOLLOWUP_TEMPLATE_NAME;
    if (!templateName) {
      console.log('[KAPSO] Follow-up sin template aprobado configurado (KAPSO_FOLLOWUP_TEMPLATE_NAME) — no se envía.');
      return null;
    }
    return impl.sendTemplateMessage(jid, templateName);
  }
  return impl.sendMessage(jid, freeText);
}
