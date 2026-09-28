// Utilidad de recuperación: re-procesa un mensaje entrante a mano contra la máquina de
// estados, para los casos en que el webhook lo ignoró (ej: tipo de mensaje no soportado
// en su momento, como una tarjeta de contacto) y no queremos perder lo que ya respondió
// el prospecto. Uso: node scripts/replay-message.js <prospect_id> "<texto del mensaje>"
import { initDb, getProspectById } from '../src/db.js';
import { handleMessage } from '../src/stateMachine.js';

const [, , idArg, text] = process.argv;
if (!idArg || !text) {
  console.error('Uso: node scripts/replay-message.js <prospect_id> "<texto>"');
  process.exit(1);
}

initDb();
const prospect = getProspectById(idArg);
if (!prospect) {
  console.error(`No existe el prospecto ${idArg}`);
  process.exit(1);
}

const fromJid = prospect.dm_jid || prospect.gatekeeper_jid;
if (!fromJid) {
  console.error(`El prospecto ${idArg} no tiene un JID asociado todavía`);
  process.exit(1);
}

console.log(`Reprocesando para "${prospect.clinic_name}" (stage actual: ${prospect.stage})...`);
await handleMessage(prospect, text, fromJid);
console.log('Listo.');
