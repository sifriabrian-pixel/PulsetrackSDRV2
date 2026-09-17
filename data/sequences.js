// ─────────────────────────────────────────────────────────────────────────────
// SECUENCIAS DE MENSAJES — PulsetrackSDRV2 · AI SDR "Valentina"
// Vertical: Clínicas Estéticas LATAM (Argentina, Paraguay, México)
// Basado en: Pulsetrack_AI_SDR_Clinicas_Esteticas_v1.md (documento aprobado)
//
// REGLA DE ORO: la recepción/atención al cliente (Etapa 1) NUNCA se entera de
// que Valentina es un agente de IA — se posiciona como servicio que le saca
// carga de encima, no que la reemplaza. El disclosure de IA es EXCLUSIVO de
// la directora/DM en Etapa 2. No mezclar el copy de una etapa con la otra.
//
// ⚠️ Este archivo refleja el documento aprobado por Brian. Cualquier cambio
// de copy tiene que actualizarse primero ahí, y si afecta al Mensaje 1
// (FASE0_APERTURA) hay que re-aprobar el template en Meta.
// ─────────────────────────────────────────────────────────────────────────────

const AGENTE_NOMBRE = 'Valentina';
const WEB_PULSETRACK = 'getpulsetrack.com';

// ─────────────────────────────────────────────────────────────────────────────
// ETAPA 1 — Recepción / Atención al Cliente (número público de la clínica)
// ─────────────────────────────────────────────────────────────────────────────

// Mensaje 1 — apertura para activar humano (rompe bots/auto-respuestas)
// ⚠️ Tiene que coincidir EXACTO con el template aprobado en Meta (KAPSO_TEMPLATE_NAME)
export const FASE0_APERTURA = `Hola! Buen día ¿cómo estás? Quería hacer una consulta rápida`;

// Respuesta vaga si contesta un bot con menú automático (para escalar a humano)
export const FASE0_BOT_REPLY = `Quería consultar algo puntual sobre la atención de pacientes de la clínica`;

// Mensaje 2 — identificación + pedido a la DM (SIN mención de IA/automatización)
export const FASE1_INICIAL = (pais) =>
`Un gusto! Mi nombre es ${AGENTE_NOMBRE}, soy del equipo de Pulsetrack. Trabajamos con clínicas de todo tipo y profesionales independientes de la región ayudando a reducir las inasistencias y mejorar la atención a pacientes por WhatsApp. Quería comunicarme con la directora o encargada para contarle brevemente sobre los resultados que estamos viendo con otras clínicas en ${pais}. ¿Me podrías ayudar a contactarla?`;

// Mensaje 2B — Follow-up (solo si no responde en 24hs al Mensaje 2, se envía una sola vez)
export const FASE2_FOLLOWUP = `Hola, quería saber si pudiste ver mi mensaje de ayer 😊 ¿Hay posibilidad de contactar a la directora o encargada?`;

// Las bifurcaciones de recepción (3A–3F) ya no son mensajes fijos — Valentina las
// redacta en el momento según el historial de la conversación (ver gatekeeperTurn
// en src/claude.js). Este archivo documenta la intención/tono de referencia; el
// texto real que se manda es siempre generado, para no repetirse y reaccionar a
// lo que realmente dicen (ej: "soy psicólogo, no tengo clínica").

// Mensaje 4 — cierre a recepción cuando da el contacto de la DM
export const FASE2_CIERRE_PORTERO = `Muchísimas gracias, muy amable! 🙏 Le escribo directamente entonces.`;

// ─────────────────────────────────────────────────────────────────────────────
// ETAPA 2 — Apertura con la Directora / DM
//
// El disclosure de IA se dice SOLO si preguntan directamente ("¿sos un bot?",
// "¿hablo con una persona?") — no en la apertura. Ver ASKED_IF_BOT en dmTurn
// (src/claude.js). Cambio de criterio de Brian sobre el documento original.
// ─────────────────────────────────────────────────────────────────────────────

// MSG 1A — DM contactada con número nuevo (recepción dio el contacto)
export const FASE3_APERTURA = (dmName, pais) => {
  const usarNombre = dmName && dmName !== 'hola' && dmName !== 'te';
  const saludo = usarNombre ? `Buen día ${dmName}! 👋` : `Buen día! 👋`;
  return `${saludo} Te escribo de parte de Pulsetrack, ${AGENTE_NOMBRE} es mi nombre. Me contacté con tu clínica porque trabajamos con clínicas y profesionales independientes en ${pais} ayudando a reducir inasistencias y a que las pacientes reciban atención por WhatsApp sin que dependa de que alguien del equipo esté disponible 24/7. ¿Te cuento brevemente cómo lo hacemos?`;
};

// MSG 1B — la recepcionista confirmó ser la DM (bifurcación 3B) — sigue la misma conversación
export const FASE3_APERTURA_B = () =>
`Buenísimo. Te cuento: básicamente nos aseguramos de que ninguna paciente se pierda por falta de seguimiento — recordatorios automáticos antes del turno, atención 24/7 por WhatsApp y reactivación de pacientes que dejaron de responder. Ya lo están usando varias clínicas y profesionales de la región, y lo que más valoran es que bajaron mucho las inasistencias sin sumar personal. ¿Tenés 20 minutos esta semana para verlo aplicado a tu clínica?`;

// Las bifurcaciones de la DM (2A–2D) ya no son mensajes fijos — ver dmTurn en
// src/claude.js, que redacta la respuesta en el momento con el historial completo.
