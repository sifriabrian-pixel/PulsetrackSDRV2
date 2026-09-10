// ─────────────────────────────────────────────────────────────────────────────
// Pulsetrack SDR — Scraper de Google Maps: profesionales de salud independientes
// (nutricionistas, odontólogos, psicólogos) en Argentina y Paraguay
// Uso: node scripts/scrape_profesionales.js
// Genera: data/prospectos_profesionales_salud.csv
// ─────────────────────────────────────────────────────────────────────────────

import { chromium } from 'playwright';
import { createWriteStream, mkdirSync } from 'fs';
import path from 'path';

// ── Configuración de búsquedas ────────────────────────────────────────────────
const PROFESIONES = ['nutricionista', 'odontólogo', 'psicólogo'];

const ZONAS = [
  // Buenos Aires (CABA) — objetivo ~72
  { zona: 'Palermo Buenos Aires', ciudad: 'Buenos Aires', pais: 'Argentina', target: 6 },
  { zona: 'Recoleta Buenos Aires', ciudad: 'Buenos Aires', pais: 'Argentina', target: 6 },
  { zona: 'Belgrano Buenos Aires', ciudad: 'Buenos Aires', pais: 'Argentina', target: 6 },
  { zona: 'Caballito Buenos Aires', ciudad: 'Buenos Aires', pais: 'Argentina', target: 6 },

  // Córdoba — objetivo ~45
  { zona: 'Nueva Córdoba', ciudad: 'Córdoba', pais: 'Argentina', target: 5 },
  { zona: 'Cerro de las Rosas Córdoba', ciudad: 'Córdoba', pais: 'Argentina', target: 5 },
  { zona: 'Centro Córdoba Capital', ciudad: 'Córdoba', pais: 'Argentina', target: 5 },

  // Asunción — objetivo ~45
  { zona: 'Recoleta Asunción', ciudad: 'Asunción', pais: 'Paraguay', target: 5 },
  { zona: 'Villa Morra Asunción', ciudad: 'Asunción', pais: 'Paraguay', target: 5 },
  { zona: 'Carmelitas Asunción', ciudad: 'Asunción', pais: 'Paraguay', target: 5 },

  // Ciudad del Este — objetivo ~18
  { zona: 'Ciudad del Este Paraguay', ciudad: 'Ciudad del Este', pais: 'Paraguay', target: 6 },
];

// Genera una búsqueda por cada combinación profesión × zona
const SEARCHES = ZONAS.flatMap(({ zona, ciudad, pais, target }) =>
  PROFESIONES.map((profesion) => ({
    query: `${profesion} ${zona}`,
    ciudad,
    pais,
    target,
  }))
);

const OUTPUT_DIR = './data';
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'prospectos_profesionales_salud.csv');
const SCROLL_TIMES = 8;
const DELAY_MS = 2000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function cleanPhone(raw) {
  if (!raw) return '';
  return raw.replace(/[\s\-().+]/g, '').replace(/^00/, '');
}

function csvRow(fields) {
  return fields
    .map((f) => {
      const s = String(f ?? '').replace(/"/g, '""');
      return `"${s}"`;
    })
    .join(',');
}

// ── Scraper principal ─────────────────────────────────────────────────────────
async function scrapeQuery(page, query, ciudad, pais, target, seen) {
  const results = [];
  const url = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;

  console.log(`\n🔍 Buscando: ${query}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(DELAY_MS);

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

  const links = await page.$$eval('a[href*="/maps/place/"]', (els) =>
    [...new Set(els.map((e) => e.href).filter((h) => h.includes('/maps/place/')))]
  );

  console.log(`   📍 ${links.length} lugares encontrados — visitando hasta ${target}...`);

  for (const link of links) {
    if (results.length >= target) break;

    try {
      await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await sleep(DELAY_MS);

      const nombre = await page.$eval('h1', (el) => el.textContent.trim()).catch(() => '');
      if (!nombre) continue;

      const telefonoRaw = await page
        .$eval(
          'button[data-item-id^="phone"] .fontBodyMedium, [data-tooltip="Copiar número de teléfono"]',
          (el) => el.textContent.trim()
        )
        .catch(() => '');
      const telefono = cleanPhone(telefonoRaw);

      if (!telefono) continue;
      if (seen.has(telefono)) {
        console.log(`   ↩ Duplicado: ${nombre}`);
        continue;
      }

      const direccion = await page
        .$eval('button[data-item-id="address"] .fontBodyMedium', (el) => el.textContent.trim())
        .catch(() => '');

      const web = await page.$eval('a[data-item-id="authority"]', (el) => el.href).catch(() => '');

      const mapsUrl = page.url();

      seen.add(telefono);
      results.push({
        nombre,
        ciudad,
        pais,
        direccion,
        telefono,
        whatsapp: telefono,
        web,
        google_maps_url: mapsUrl,
        estado: 'PENDING',
      });

      console.log(`   ✅ ${nombre} — ${telefono}`);
    } catch {
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
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  await page.goto('https://www.google.com/maps', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await sleep(2000);
  try {
    await page.click('button:has-text("Aceptar todo")', { timeout: 4000 });
    await sleep(1000);
  } catch {
    /* no apareció el banner */
  }

  const allResults = [];
  const seen = new Set();

  console.log(`🎯 Objetivo total aproximado: ${ZONAS.reduce((a, z) => a + z.target * PROFESIONES.length, 0)} contactos en ${SEARCHES.length} búsquedas\n`);

  for (const { query, ciudad, pais, target } of SEARCHES) {
    const rows = await scrapeQuery(page, query, ciudad, pais, target, seen);
    allResults.push(...rows);
    console.log(`   → Acumulado: ${allResults.length} registros`);
    await sleep(1500);
  }

  await browser.close();

  const header = 'nombre,ciudad,pais,direccion,telefono,whatsapp,web,google_maps_url,estado';
  const stream = createWriteStream(OUTPUT_FILE, { encoding: 'utf8' });
  stream.write('﻿');
  stream.write(header + '\n');

  for (const r of allResults) {
    stream.write(
      csvRow([r.nombre, r.ciudad, r.pais, r.direccion, r.telefono, r.whatsapp, r.web, r.google_maps_url, r.estado]) + '\n'
    );
  }
  stream.end();

  console.log(`\n✅ Scraping terminado.`);
  console.log(`📄 Archivo: ${OUTPUT_FILE}`);
  console.log(`📊 Total registros: ${allResults.length}`);
  console.log(`\nPróximo paso: node index.js import ${OUTPUT_FILE}`);
}

main().catch((err) => {
  console.error('❌ Error fatal:', err.message);
  process.exit(1);
});
