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
`Un gusto! Mi nombre es ${AGENTE_NOMBRE}, soy del equipo de Pulsetrack. Trabajamos con clínicas estéticas de la región ayudando a reducir las inasistencias y mejorar la atención a pacientes por WhatsApp. Quería comunicarme con la directora o encargada de la clínica para contarle brevemente sobre los resultados que estamos viendo con otras clínicas en ${pais}. ¿Me podrías ayudar a contactarla?`;

// Mensaje 2B — Follow-up (solo si no responde en 24hs al Mensaje 2, se envía una sola vez)
export const FASE2_FOLLOWUP = `Hola, quería saber si pudiste ver mi mensaje de ayer 😊 ¿Hay posibilidad de contactar a la directora o encargada?`;

// Bifurcaciones de recepción (3A–3F)
export const FASE2_OBJECIONES = {
  // 3A — "¿de qué se trata?" / "¿qué resultados?"
  que_se_trata: (pais) =>
`Claro, te cuento! Trabajamos con clínicas estéticas en ${pais} y lo que más logran es que las pacientes reciban seguimiento automático antes de su turno, así bajan mucho las inasistencias de último momento. Para ver si aplica a la clínica necesito hablarlo con quien maneja la dirección o administración. ¿Me podés pasar su contacto?`,

  // 3B — se ofrece como interlocutora → calificar si tiene poder de decisión
  calificar_portero: () =>
`Perfecto! Antes de contarte, ¿vos estás a cargo de la dirección de la clínica o de las decisiones sobre las herramientas que usan para atención a pacientes?`,

  // 3B → confirma que SÍ es decisora: transición corta antes de arrancar Etapa 2 (MSG 1B)
  confirma_es_dm: () => `Perfecto, entonces te cuento directamente a vos 👇`,

  // 3B → NO es decisora
  no_es_decisor: () =>
`Gracias por la buena onda! El tema es un poco más de gestión/estratégico, así que necesito hablarlo con la directora o encargada. ¿Me podrías pasar su contacto?`,

  // 3C — "mandame la info y yo la paso"
  mandame_info: (pais) =>
`¡Buenísimo! Somos Pulsetrack, trabajamos con clínicas estéticas en ${pais} para que las pacientes tengan seguimiento automático y no se pierdan turnos por falta de recordatorio o de respuesta a tiempo. Ya lo están usando varias clínicas de la región, y lo que más valoran es que bajaron mucho las inasistencias. Si le podés comentar esto a la directora, estaría buenísimo. Y si me podés pasar su contacto directo, mejor todavía así no te genero trabajo extra a vos. ¿Cómo lo ves? 🙏`,

  // 3D — "no tenemos ese dato" / "no puedo darte ese contacto" (primer pedido: nombre)
  no_contacto: () =>
`Entiendo perfecto, no hay problema. ¿Sabrías al menos el nombre de la directora o encargada? Con eso ya me ayudás muchísimo.`,

  // 3D — segundo pedido: Instagram o email (canal preferente en este ICP)
  pide_instagram_email: () =>
`Gracias! ¿Tenés el Instagram de la clínica o algún mail de contacto donde pueda hacerle llegar el mensaje?`,

  // 3D — fallback final si no dan absolutamente nada
  no_dan_nada: (pais) =>
`Entiendo, gracias igual. Si pudieras hacerle llegar esto de mi parte te agradezco: "Hola, te escribe ${AGENTE_NOMBRE} de Pulsetrack. Trabajamos con clínicas estéticas en ${pais} para reducir inasistencias y mejorar el seguimiento a pacientes. Otras directoras de la región nos dieron 20 minutos y les sorprendió el resultado. Si te interesa, con gusto te cuento. Gracias!"`,

  // 3E — piden web, información o redes sociales
  piden_web: () =>
`Claro! Podés ver más en ${WEB_PULSETRACK} 👇 Ahí tenés casos de otras clínicas y cómo trabajamos. Si le llega a interesar a la directora, con gusto le cuento en detalle. ¿Hay forma de contactarla directamente?`,

  // 3F — "ya tenemos algo así" / "no nos interesa" / "no lo necesitamos"
  ya_tienen: () =>
`Perfecto, lo tengo en cuenta. Igual me gustaría comentárselo a la directora, porque lo que hacemos tiene bastantes diferencias con lo que suele haber en el mercado y seguro le interesa comparar. ¿Me podrías pasar su contacto? 🙏`,

  // 3F — variante si insisten (segunda vez) → cierre limpio
  ya_tienen_insiste: () =>
`Entendido, no hay problema. Si en algún momento la directora quiere revisarlo, puede escribirnos a ${WEB_PULSETRACK}. Que tengas buen día 👋`,

  // Fallback genérico cuando la respuesta es ambigua (no está en el documento explícitamente,
  // mantiene el mismo tono neutral de Etapa 1 sin mencionar IA)
  fallback_generico: () =>
`Gracias por responder! ¿Me podrías ayudar a contactar con la directora o encargada de la clínica?`,
};

// Mensaje 4 — cierre a recepción cuando da el contacto de la DM
export const FASE2_CIERRE_PORTERO = `Muchísimas gracias, muy amable! 🙏 Le escribo directamente entonces.`;

// ─────────────────────────────────────────────────────────────────────────────
// ETAPA 2 — Apertura con la Directora / DM (acá SÍ hay disclosure completo de IA)
// ─────────────────────────────────────────────────────────────────────────────

// MSG 1A — DM contactada con número nuevo (recepción dio el contacto)
export const FASE3_APERTURA = (dmName, pais) => {
  const usarNombre = dmName && dmName !== 'hola' && dmName !== 'te';
  const saludo = usarNombre ? `Buen día ${dmName}! 👋` : `Buen día! 👋`;
  return `${saludo} Te escribo de parte de Pulsetrack, ${AGENTE_NOMBRE} es mi nombre — de hecho soy un agente de IA, je. Me contacté con tu clínica porque trabajamos con clínicas estéticas en ${pais} ayudando a reducir inasistencias y a que las pacientes reciban atención por WhatsApp sin que dependa de que alguien del equipo esté disponible 24/7. ¿Te cuento brevemente cómo lo hacemos?`;
};

// MSG 1B — la recepcionista confirmó ser la DM (bifurcación 3B) — sigue la misma conversación
export const FASE3_APERTURA_B = () =>
`Buenísimo. Ah, y de paso te cuento: soy un agente de IA — literal la herramienta que te estoy por explicar 😊 Lo que hacemos es básicamente asegurarnos de que ninguna paciente se pierda por falta de seguimiento: recordatorios automáticos antes del turno, atención 24/7 por WhatsApp y reactivación de pacientes que dejaron de responder. Ya lo están usando varias clínicas de la región y lo que más valoran es que bajaron mucho las inasistencias sin sumar personal. ¿Tenés 20 minutos esta semana para verlo aplicado a tu clínica?`;

// Bifurcaciones de la DM (2A–2D)
// 2A (HANDOFF): cualquier interés, pregunta o disponibilidad → handoff inmediato a Brian, sin texto propio.
export const FASE3_OBJECIONES = {
  // 2B — "¿cómo conseguiste mi número?"
  como_conseguiste_numero: () =>
`Me lo facilitaron desde tu clínica cuando me contacté al número principal. Trabajo con clínicas estéticas de la región y prefiero siempre llegar directo a quien puede evaluar este tipo de soluciones.`,

  // 2C — "no me interesa" / "ya tenemos herramientas" → ÚNICA bifurcación sin handoff
  no_interesa: (dmName) => {
    const nombre = dmName && dmName !== 'hola' && dmName !== 'te' ? `, ${dmName}` : '';
    return `Totalmente válido${nombre}. No es para todas las clínicas. Solo te comento que lo que más resolvemos no es la falta de herramientas, sino las pacientes que ya agendaron y terminan faltando porque nadie llega a confirmar o reprogramar a tiempo. Si en algún momento querés revisarlo, quedo a disposición. 👋`;
  },

  // 2D — "mandame información por acá" → nunca se manda precio/propuesta por WhatsApp
  mandame_info: () =>
`Con gusto! Aunque te soy sincera, funciona mucho mejor verlo en una llamada corta porque depende de cómo tenés organizada la atención hoy. ¿Tenés 20 minutos esta semana? Si no encaja ahora, me avisás cuando sea mejor momento y coordinamos sin drama.`,
};
