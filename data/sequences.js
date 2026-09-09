// ─────────────────────────────────────────────────────────────────────────────
// SECUENCIAS DE MENSAJES — PulsetrackSDRV2
// Vertical inicial: profesionales de la salud independientes y clínicas estéticas
// (pensado para poder adaptar el mismo esqueleto a otros nichos más adelante)
//
// ⚠️ BORRADOR — este copy NO está aprobado. No lanzar campaña real sin que
// Brian revise y apruebe el texto final de cada mensaje. No modificar el
// posicionamiento (agentes de IA que automatizan atención y ventas, en
// general — no solo "gestión de turnos") sin su aprobación.
// ─────────────────────────────────────────────────────────────────────────────

// FASE 0 — Mensaje 1: apertura para activar humano (rompe bots/auto-respuestas)
export const FASE0_APERTURA = `Buen día 👋 ¿Cómo están? Quería hacer una consulta.`;

// Respuesta vaga si responde un bot con menú automático (para escalar a humano)
export const FASE0_BOT_REPLY = `Quería consultar algo puntual sobre la atención de pacientes/leads del centro`;

// FASE 1 — Mensaje 2: identificación + pedido de contacto al DM
// Se envía SOLO después de que un humano respondió a FASE0
export const FASE1_INICIAL = (pais) => {
  const nombre = process.env.SDR_NAME || 'Brian';
  return `Hola, buen día. 👋
Soy ${nombre}, de Pulsetrack. Ayudamos a profesionales y clínicas de salud a automatizar la atención y el seguimiento de pacientes con agentes de IA por WhatsApp, para que no se pierda ni un paciente interesado por falta de respuesta a tiempo.
En la mayoría de los centros con los que trabajamos, una parte importante de los leads/consultas se pierde por no llegar a responder rápido o no hacer seguimiento.
¿Me podrías conectar con el director o la persona que maneja la operación del centro? Quiero mostrarle algo concreto en 20 minutos.`;
};

// ─────────────────────────────────────────────────────────────────────────────
// FASE 2 — Conversación con recepción/portero
// ─────────────────────────────────────────────────────────────────────────────

// Mensaje 2B — Follow-up (solo si no responde en 24hs al Mensaje 2)
export const FASE2_FOLLOWUP = `Hola, quería saber si pudieron ver mi mensaje de ayer 😊
¿Hay posibilidad de contactar al director o encargado?`;

// Bifurcaciones del portero (3A–3F)
export const FASE2_OBJECIONES = {
  // 3A — "¿De qué se trata?" / "¿Qué resultados?"
  que_se_trata: (pais) =>
`Claro, te comento. Trabajamos con profesionales y clínicas de salud en ${pais} automatizando la atención y las ventas con agentes de IA — para que ninguna consulta ni paciente interesado se pierda por falta de respuesta o seguimiento a tiempo, con atención disponible 24/7.
Para ver si aplica a su operación necesito hablar con quien maneja la clínica o el área de atención. ¿Me podés pasar su contacto?`,

  // 3B — portero se ofrece como interlocutor → calificar si es decisor
  calificar_portero: () =>
`Perfecto, antes de contarte — ¿vos liderás el área de atención al paciente o procesos de la clínica?`,

  // 3B-no — no es decisor
  no_es_decisor: () =>
`Gracias por la disposición. El tema requiere una conversación un poco más estratégica, así que necesito hablarlo con quien toma ese tipo de decisiones. ¿Podrías pasarme el contacto del director o encargado?`,

  // 3C — "mandame la información y yo la paso"
  mandame_info: (pais) =>
`¡Claro, con gusto! 😊
Somos Pulsetrack, ayudamos a profesionales y clínicas de salud en ${pais} a automatizar la atención y las ventas con agentes de IA — el sistema responde, califica y hace el seguimiento de pacientes/leads las 24hs, sin que el equipo tenga que intervenir.
Ya lo están usando centros de la región y lo que más valoran es que dejaron de perder pacientes interesados por no llegar a responder a tiempo.
Si podés comentárselo al director o encargado, sería genial. Y si me podés pasar su contacto directo, mejor todavía así le escribo yo y no te genero trabajo extra. ¿Cómo lo ves? 🙏`,

  // 3D — "no tenemos ese dato" / "no puedo darte ese contacto" (primer pedido: nombre)
  no_contacto: () =>
`Entiendo perfectamente, no hay problema. ¿Sabrías al menos el nombre del director o responsable? Con eso ya me ayudás mucho.`,

  // 3D — segundo pedido: LinkedIn o email
  pide_linkedin_email: () =>
`Gracias. ¿Tienen LinkedIn de la clínica o algún email de contacto donde pueda hacerle llegar el mensaje?`,

  // 3D — fallback final si no dan absolutamente nada
  no_dan_nada: (pais) => {
    const nombre = process.env.SDR_NAME || 'Brian';
    return `Entiendo, gracias igual. Si pudiera hacerle llegar esto de mi parte le agradezco:
"Hola, le escribe ${nombre} de Pulsetrack. Ayudamos a profesionales y clínicas de salud en ${pais} a automatizar la atención y el seguimiento con agentes de IA, para que ningún paciente interesado se pierda. Otros directores de la región nos pidieron 20 minutos y los resultados los sorprendieron. Si le interesa, con gusto lo contacto. ¡Gracias!"`;
  },

  // 3E — piden web o más información
  piden_web: () =>
`¡Claro! Pueden ver más en getpulsetrack.com 👇
Ahí hay casos de uso y cómo funciona el sistema.
Si le cierra la idea al director, con gusto le cuento en detalle. ¿Hay forma de contactarlo directamente?`,

  // 3F — "ya tenemos ese servicio" / "no nos interesa" / "no lo necesitamos"
  ya_tienen: () =>
`Perfecto, con gusto lo tomo en cuenta.
Igual me gustaría comentárselo al director o encargado, porque lo que hacemos tiene bastantes diferencias con lo que hay en el mercado y estoy seguro que notará el valor.
¿Me podrías pasar su contacto? 🙏`,

  // 3F — variante si insisten (segunda vez) → cierre limpio
  ya_tienen_insiste: () =>
`Entendido, no hay problema. Si en algún momento el director quiere revisarlo, pueden escribirnos a getpulsetrack.com. ¡Que tengan buen día! 👋`,

  // Fallback genérico cuando la respuesta es ambigua
  fallback_generico: () =>
`Gracias por responder. Quería saber si me podrías ayudar a contactar con el director, dueño o responsable del centro.`,
};

// Mensaje 4 — Cierre al portero cuando da el contacto del DM
export const FASE2_CIERRE_PORTERO = `Muchísimas gracias, muy amable 🙏 Le escribo directamente entonces.`;

// ─────────────────────────────────────────────────────────────────────────────
// ETAPA 2 — Apertura con el Decision Maker (DM)
// ─────────────────────────────────────────────────────────────────────────────

// MSG 1A — DM contactado con número nuevo (portero dio el contacto)
export const FASE3_APERTURA = (dmName, pais) => {
  const usarNombre = dmName && dmName !== 'hola' && dmName !== 'te';
  const saludo = usarNombre ? `Hola ${dmName}, buen día.` : `Hola, buen día.`;
  return `${saludo}
Me pasaron tu contacto desde el centro. Te cuento en dos líneas:
Ayudamos a profesionales y clínicas de salud a automatizar la atención y las ventas con agentes de IA por WhatsApp — atención 24/7, sin sumar personal.
Los centros con los que trabajamos dejaron de perder pacientes interesados por falta de respuesta o seguimiento a tiempo.
¿Tienes 20 minutos esta semana para que te muestre cómo funciona en concreto?`;
};

// MSG 1B — el portero confirmó ser el DM (bifurcación 3B) — pitch directo en tuteo
export const FASE3_APERTURA_B = () =>
`Buenísimo. Lo que hacemos es básicamente asegurarnos de que ningún paciente o lead interesado se pierda por falta de respuesta o seguimiento a tiempo.
Lo logramos con un sistema de agentes con IA que responde consultas de forma inmediata (24/7), califica qué pacientes están listos para avanzar y hace el seguimiento automático de los que no respondieron — sin que el equipo tenga que intervenir.
Ya lo están usando profesionales independientes y clínicas de estética en la región y el cambio más grande que notaron es que dejaron de perder pacientes en el proceso de atención.
¿Tenés 20 minutos esta semana para verlo aplicado a tu clínica?`;

// Regla de handoff (Fase 3): cualquier respuesta del DM, sin excepción, es
// handoff inmediato a Brian. El bot no le contesta nada al decisor.
