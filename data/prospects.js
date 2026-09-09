import { createReadStream } from 'fs';
import { parse } from 'csv-parse';
import { insertProspects } from '../src/db.js';

// CSV esperado: clinic_name, gatekeeper_phone, city, country
export async function importCsv(filePath) {
  const records = [];

  await new Promise((resolve, reject) => {
    createReadStream(filePath)
      .pipe(parse({ columns: true, trim: true, skip_empty_lines: true, bom: true }))
      .on('data', (row) => {
        // Acepta tanto columnas del scraper (nombre/telefono/ciudad)
      // como columnas estándar (clinic_name/gatekeeper_phone/city)
      const nombre = row.clinic_name || row.nombre;
      const telefono = row.gatekeeper_phone || row.telefono || row.whatsapp;
      const ciudad = row.city || row.ciudad || '';
      const pais = row.country || row.pais || '';

      if (!nombre || !telefono) return;
        records.push({
          clinic_name: nombre,
          gatekeeper_phone: telefono.replace(/\D/g, ''),
          city: ciudad,
          country: pais,
        });
      })
      .on('end', resolve)
      .on('error', reject);
  });

  insertProspects(records);
  console.log(`✅ ${records.length} prospectos importados.`);
}
