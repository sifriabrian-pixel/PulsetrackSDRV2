// Envía handoff a Brian (BRIAN_PHONE) cuando se detecta interés real del decisor.

export async function sendHandoff(prospect) {
  const { sendMessage, sendHandoffNotification } = await import('./transport.js'); // import diferido: evita ciclos
  const brianJid = `${process.env.BRIAN_PHONE}@s.whatsapp.net`;

  const msg = [
    `🔔 *LEAD INTERESADO — PULSETRACK SDR*`,
    ``,
    `*Clínica:* ${prospect.clinic_name}`,
    `*Ciudad/País:* ${prospect.city}, ${prospect.country}`,
    ``,
    `*Recepción:* ${prospect.gatekeeper_phone}`,
    `*Decisor:* ${prospect.dm_name || 'No registrado'} — ${prospect.dm_phone || prospect.dm_jid || 'mismo chat'}`,
    ``,
    `*Resumen:*`,
    prospect.notes || 'Sin notas',
    ``,
    `👆 Tomá la conversación para agendar la demo.`,
  ].join('\n');

  try {
    await sendMessage(brianJid, msg);
  } catch (err) {
    // Si hace más de 24hs que Brian no le escribe al número del agente, el texto libre
    // rebota igual que cualquier mensaje frío — hay que mandarle un template en su lugar.
    console.error(`[HANDOFF] Texto libre falló (${err.message}) — probando con template`);
    await sendHandoffNotification(brianJid);
  }
}
