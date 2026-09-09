// ─────────────────────────────────────────────────────────────────────────────
// Pulsetrack SDR — Scraper de Google Maps
// Uso: node scripts/scrape.js
// Genera: data/prospectos_raw.csv
// ─────────────────────────────────────────────────────────────────────────────

import { chromium } from 'playwright';
import { createWriteStream } from 'fs';
import { mkdirSync } from 'fs';
import path from 'path';

// ── Configuración de búsquedas ────────────────────────────────────────────────
const SEARCHES = [
  // Buenos Aires — objetivo: 70
  { query: 'clínica estética Palermo Buenos Aires',        ciudad: 'Buenos Aires', target: 8 },
  { query: 'clínica estética Belgrano Buenos Aires',       ciudad: 'Buenos Aires', target: 8 },
  { query: 'clínica estética Recoleta Buenos Aires',       ciudad: 'Buenos Aires', target: 8 },
  { query: 'medicina estética Caballito Buenos Aires',     ciudad: 'Buenos Aires', target: 7 },
  { query: 'centro de estética San Isidro Buenos Aires',   ciudad: 'Buenos Aires', target: 7 },
  { query: 'medicina estética Vicente López Buenos Aires', ciudad: 'Buenos Aires', target: 7 },
  { query: 'clínica estética Flores Buenos Aires',         ciudad: 'Buenos Aires', target: 7 },
  { query: 'centro estético Villa Urquiza Buenos Aires',   ciudad: 'Buenos Aires', target: 7 },
  { query: 'clínica de belleza Microcentro CABA',          ciudad: 'Buenos Aires', target: 6 },
  { query: 'tratamientos estéticos Martínez Buenos Aires', ciudad: 'Buenos Aires', target: 5 },

  // Asunción Paraguay — objetivo: 70
  { query: 'clínica estética Villa Morra Asunción',        ciudad: 'Asunción', target: 12 },
  { query: 'medicina estética Carmelitas Asunción',        ciudad: 'Asunción', target: 12 },
  { query: 'centro de estética Mariscal López Asunción',   ciudad: 'Asunción', target: 12 },
  { query: 'clínica de belleza Las Mercedes Asunción',     ciudad: 'Asunción', target: 12 },
  { query: 'spa estético Asunción Paraguay',               ciudad: 'Asunción', target: 12 },
  { query: 'tratamientos estéticos Asunción Paraguay',     ciudad: 'Asunción', target: 10 },

  // Ciudad de México — objetivo: 60
  { query: 'clínica estética Polanco CDMX',                ciudad: 'Ciudad de México', target: 10 },
  { query: 'medicina estética Condesa Ciudad de México',   ciudad: 'Ciudad de México', target: 8 },
  { query: 'clínica estética Roma Norte CDMX',             ciudad: 'Ciudad de México', target: 8 },
  { query: 'medicina estética Santa Fe CDMX',              ciudad: 'Ciudad de México', target: 8 },
  { query: 'clínica estética Lomas de Chapultepec CDMX',   ciudad: 'Ciudad de México', target: 8 },
  { query: 'spa médico Narvarte Ciudad de México',         ciudad: 'Ciudad de México', target: 7 },
  { query: 'tratamientos estéticos Interlomas CDMX',       ciudad: 'Ciudad de México', target: 7 },
  { query: 'medicina estética Pedregal Ciudad de México',  ciudad: 'Ciudad de México', target: 4 },
];

const OUTPUT_DIR  = './data';
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'prospectos_raw.csv');
const SCROLL_TIMES = 8;   // cuántas veces baja el panel de resultados
const DELAY_MS     = 2000; // pausa entre acciones (ms)

// ── Utilidades ────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function cleanPhone(raw) {
  if (!raw) return '';
  return raw.replace(/[\s\-().+]/g, '').replace(/^00/, '');
}

function csvRow(fields) {
  return fields.map(f => {
    const s = String(f ?? '').replace(/"/g, '""');
    return `"${s}"`;
  }).join(',');
}

// ── Scraper principal ─────────────────────────────────────────────────────────
async function scrapeQuery(page, query, ciudad, target, seen) {
  const results = [];
  const url = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;

  console.log(`\n🔍 Buscando: ${query}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(DELAY_MS);

  // Scroll para cargar más resultados
  const panelSel = '[role="feed"]';
  try {
    await page.waitForSelector(panelSel, { timeout: 8000 });
    for (let i = 0; i < SCROLL_TIMES; i++) {
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) el.scrollTop += 1200;
      }, panelSel);
      await sleep(1200);
    }
  } catch {
    console.log('   ⚠ Panel de resultados no encontrado, continuando...');
    return results;
  }

  // Obtener todos los links de negocios
  const links = await page.$$eval('a[href*="/maps/place/"]', els =>
    [...new Set(els.map(e => e.href).filter(h => h.includes('/maps/place/')))]
  );

  console.log(`   📍 ${links.length} lugares encontrados — visitando hasta ${target}...`);

  for (const link of links) {
    if (results.length >= target) break;

    try {
      await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await sleep(DELAY_MS);

      // Nombre
      const nombre = await page.$eval('h1', el => el.textContent.trim()).catch(() => '');
      if (!nombre) continue;

      // Teléfono
      const telefonoRaw = await page.$eval(
        'button[data-item-id^="phone"] .fontBodyMedium, [data-tooltip="Copiar número de teléfono"]',
        el => el.textContent.trim()
      ).catch(() => '');
      const telefono = cleanPhone(telefonoRaw);

      // Saltar si no tiene teléfono o ya está en la lista
      if (!telefono) continue;
      if (seen.has(telefono)) {
        console.log(`   ↩ Duplicado: ${nombre}`);
        continue;
      }

      // Dirección
      const direccion = await page.$eval(
        'button[data-item-id="address"] .fontBodyMedium',
        el => el.textContent.trim()
      ).catch(() => '');

      // Web
      const web = await page.$eval(
        'a[data-item-id="authority"]',
        el => el.href
      ).catch(() => '');

      // URL Google Maps (canónica)
      const mapsUrl = page.url();

      seen.add(telefono);
      results.push({
        nombre,
        ciudad,
        direccion,
        telefono,
        whatsapp: telefono, // se verifica en WhatsApp durante el launch
        web,
        google_maps_url: mapsUrl,
        estado: 'PENDING',
      });

      console.log(`   ✅ ${nombre} — ${telefono}`);

    } catch (err) {
      // Lugar sin datos útiles, continuar
    }
  }

  return results;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ['--lang=es-AR'],
  });
  const context = await browser.newContext({
    locale: 'es-AR',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  // Aceptar cookies de Google si aparece el banner
  await page.goto('https://www.google.com/maps', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await sleep(2000);
  try {
    await page.click('button:has-text("Aceptar todo")', { timeout: 4000 });
    await sleep(1000);
  } catch { /* no apareció el banner */ }

  const allResults = [];
  const seen = new Set(); // deduplicar por teléfono

  for (const { query, ciudad, target } of SEARCHES) {
    const rows = await scrapeQuery(page, query, ciudad, target, seen);
    allResults.push(...rows);
    console.log(`   → Acumulado: ${allResults.length} registros`);
    await sleep(1500);
  }

  await browser.close();

  // ── Escribir CSV ────────────────────────────────────────────────────────────
  const header = 'nombre,ciudad,direccion,telefono,whatsapp,web,google_maps_url,estado';
  const stream = createWriteStream(OUTPUT_FILE, { encoding: 'utf8' });
  stream.write('﻿'); // BOM para que Excel abra bien el UTF-8
  stream.write(header + '\n');

  for (const r of allResults) {
    stream.write(csvRow([
      r.nombre, r.ciudad, r.direccion, r.telefono,
      r.whatsapp, r.web, r.google_maps_url, r.estado,
    ]) + '\n');
  }
  stream.end();

  console.log(`\n✅ Scraping terminado.`);
  console.log(`📄 Archivo: ${OUTPUT_FILE}`);
  console.log(`📊 Total registros: ${allResults.length}`);
  console.log(`\nPróximo paso: node index.js import data/prospectos_raw.csv`);
}

main().catch(err => {
  console.error('❌ Error fatal:', err.message);
  process.exit(1);
});
