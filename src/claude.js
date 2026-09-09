import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-5';

async function classify(systemPrompt, userMessage, retries = 2) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 256,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });
      const text = response.content[0].text.trim();
      const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
      try {
        return JSON.parse(cleaned);
      } catch {
        console.log(`[CLAUDE] Respuesta no-JSON: ${text}`);
        return { raw: text };
      }
    } catch (err) {
      console.error(`[CLAUDE] Error intento ${attempt}/${retries}: ${err.message}`);
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
}

// Determina si quien responde es portero/recepción o el decisor de la clínica
export async function detectRole(message) {
  const system = `Eres un clasificador para un agente SDR. Analizás mensajes de WhatsApp entrantes de clínicas dentales, estéticas y centros de salud privados.

Devolvé SOLO un JSON con este formato exacto:
{"role": "DM" | "GATEKEEPER" | "BOT" | "UNKNOWN"}

DM: habla como dueño/director/administrador de la clínica ("yo soy el dueño", "soy el director", tono de decisor)
GATEKEEPER: recepcionista o secretaria que pregunta quién sos, te deriva, pide datos
BOT: respuesta automática con menú numerado o mensaje de bienvenida genérico
UNKNOWN: no se puede determinar con certeza`;

  return classify(system, message);
}

// Clasifica la respuesta del portero (recepcionista/secretaria) al Mensaje 2
export async function classifyGatekeeperReply(message) {
  const system = `Eres un clasificador para un agente SDR. Analizás respuestas de recepcionistas o secretarias de clínicas de salud privadas a un mensaje donde se pidió el contacto del director/dueño.

Devolvé SOLO un JSON con este formato exacto:
{
  "action": "GAVE_CONTACT" | "YO_AYUDO" | "QUIERE_INFO" | "MANDAME_INFO" | "NO_CONTACTO" | "PIDE_WEB" | "YA_TIENEN" | "REJECTED" | "UNKNOWN",
  "dm_phone": "<número si lo dieron, o null>",
  "dm_name": "<nombre si lo mencionaron, o null>"
}

GAVE_CONTACT: dieron un número del dueño/director, un nombre para contactar, o dijeron que lo van a derivar internamente (ej. "te paso con él", "esperá que lo llamo").
YO_AYUDO: el portero se ofrece como interlocutor directo ("contame a mí", "podés hablar conmigo", "decime", "yo te ayudo").
QUIERE_INFO: pregunta de qué se trata o qué resultados, antes de derivar ("¿de qué se trata?", "¿qué es esto?").
MANDAME_INFO: pide que se le mande la información para pasarla él/ella ("mandame la info y yo se la paso").
NO_CONTACTO: dice que no tiene el dato o no puede darlo ("no tengo ese contacto", "no puedo darte ese número").
PIDE_WEB: pide la web, redes sociales o más información institucional.
YA_TIENEN: dice que ya tienen ese servicio, que no les interesa o que no lo necesitan ("ya tenemos algo similar", "no nos interesa", "no lo necesitamos").
REJECTED: rechazo duro y definitivo, sin dejar margen ("no contacten más", "no quiero", "dejen de escribir").
UNKNOWN: respuesta ambigua sin ninguna de las anteriores ("hola", "¿cómo estás?", "ok").`;

  return classify(system, message);
}

// Clasifica si el portero, al ofrecerse como interlocutor (3B), es el decisor
export async function classifyPorteroEsDM(message) {
  const system = `Eres un clasificador para un agente SDR. Le preguntaste a quien te respondió si lidera el área de atención al paciente o los procesos de la clínica (es decir, si es el decisor).

Devolvé SOLO un JSON con este formato exacto:
{"is_dm": true | false}

true: confirma que sí lidera el área / toma decisiones / es el dueño o director.
false: dice que no, que es recepción/personal administrativo, o respuesta ambigua sin confirmación clara.`;

  return classify(system, message);
}

// Clasifica la respuesta del decisor (DM) — usado tanto en la primera respuesta
// (MSG 1A/1B) como en respuestas posteriores de seguimiento.
export async function classifyDmReply(message, context) {
  const system = `Eres un clasificador para un agente SDR. El decisor (dueño/director) de una clínica de salud privada está respondiendo en una conversación de ventas por WhatsApp.

${context ? `Contexto de la conversación: ${context}\n` : ''}
Devolvé SOLO un JSON con este formato exacto:
{
  "action": "HANDOFF" | "ASK_NUMBER" | "REJECTED" | "MANDAME_INFO"
}

ASK_NUMBER: pregunta específicamente cómo conseguiste su número.
REJECTED: rechazo explícito y puro — "no me interesa", "no gracias", "ya tenemos herramientas para esto" sin abrir ninguna puerta.
MANDAME_INFO: pide que le mandes la información por WhatsApp o mail en vez de hablar.
HANDOFF: cualquier otra respuesta que no sea un rechazo puro — cuenta su problema, hace una pregunta, muestra interés, confirma disponibilidad, o es neutral/ambigua. Ante la duda, siempre HANDOFF (regla: solo el rechazo puro NO es handoff).`;

  return classify(system, message);
}
