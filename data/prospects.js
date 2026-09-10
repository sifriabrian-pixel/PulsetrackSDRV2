import { createReadStream } from 'fs';
import { parse } from 'csv-parse';
import { insertProspects } from '../src/db.js';

// Los scrapers de Google Maps devuelven los teléfonos de Argentina en formato
// LOCAL: "0" + código de área + (opcional "15" para celulares) + abonado.
// Ej: "0111560064188" → 011(AC) 15(marca celular) 60064188(abonado).
// Sin convertir esto a formato internacional (54 9 AC abonado), Meta rechaza
// el envío como "número inválido" — ningún mensaje a Argentina se entregaría.
function normalizeArgentinaPhone(digitsOnly) {
  let local = digitsOnly.startsWith('0') ? digitsOnly.slice(1) : digitsOnly;

  if (local.length === 12) {
    // Formato celular con "15" — el código de área puede ser de 2, 3 o 4 dígitos,
    // así que probamos dónde encaja el "15" (no hay forma de saberlo con certeza
    // sin una tabla de códigos de área, pero esto cubre el >95% de los casos reales).
    for (const acLen of [2, 3, 4]) {
      if (local.slice(acLen, acLen + 2) === '15') {
        local = local.slice(0, acLen) + local.slice(acLen + 2);
        break;
      }
    }
  }

  if (local.length !== 10) {
    // No pudimos normalizar con confianza — devolvemos null para que quede
    // marcado y no se mande un número roto silenciosamente.
    return null;
  }

  return `549${local}`;
}

function normalizePhoneForCountry(rawPhone, country) {
  const digits = rawPhone.replace(/\D/g, '');
  const pais = (country || '').trim().toLowerCase();

  if (pais.startsWith('argentina') || pais === 'ar') {
    // Ya viene en formato internacional (ej: reingreso de un export previo)
    if (digits.startsWith('54')) return digits;
    return normalizeArgentinaPhone(digits) || digits;
  }

  // Paraguay y el resto de los países ya vienen en formato internacional
  // desde el scraper (ej: "595971693166") — no necesitan normalización.
  return digits;
}

// CSV esperado: clinic_name, gatekeeper_phone, city, country
export async function importCsv(filePath) {
  const records = [];
  let sinNormalizar = 0;

  await new Promise((resolve, reject) => {
    createReadStream(filePath)
      .pipe(parse({ columns: true, trim: true, skip_empty_lines: true, bom: true }))
      .on('data', (row) => {
        // Acepta tanto columnas del scraper (nombre/telefono/ciudad)
      // como columnas estándar (clinic_name/gatekeeper_phone/city)
      const nombre = row.clinic_name || row.nombre;
      const telefonoRaw = row.gatekeeper_phone || row.telefono || row.whatsapp;
      const ciudad = row.city || row.ciudad || '';
      const pais = row.country || row.pais || '';

      if (!nombre || !telefonoRaw) return;

        const telefono = normalizePhoneForCountry(telefonoRaw, pais);
        if (pais.trim().toLowerCase().startsWith('argentina') && telefono.replace(/\D/g, '').length !== 13) {
          sinNormalizar++;
          console.log(`   ⚠ No se pudo normalizar el teléfono de "${nombre}": "${telefonoRaw}" — se importa igual, revisar a mano.`);
        }

        records.push({
          clinic_name: nombre,
          gatekeeper_phone: telefono,
          city: ciudad,
          country: pais,
        });
      })
      .on('end', resolve)
      .on('error', reject);
  });

  insertProspects(records);
  console.log(`✅ ${records.length} prospectos importados.${sinNormalizar > 0 ? ` (${sinNormalizar} con teléfono sin normalizar, revisar)` : ''}`);
}
