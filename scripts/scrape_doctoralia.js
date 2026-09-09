// ─────────────────────────────────────────────────────────────────────────────
// Pulsetrack SDR — Scraper de Doctoralia (clínicas dentales)
// Uso: node scripts/scrape_doctoralia.js
// Genera: data/prospectos_doctoralia.csv
// ─────────────────────────────────────────────────────────────────────────────

import { chromium } from 'playwright';
import { createWriteStream, mkdirSync } from 'fs';
import path from 'path';

// ── Configuración ───────────────────────────────────────────────────────────
const LISTING_BASE = 'https://www.doctoralia.com.mx/clinicas/odontologia/ciudad-de-mexico';
const CIUDAD = 'Ciudad de México';
const TARGET_CLINICS = 70;   // tope recomendado para la primera corrida
const MAX_PAGES = 10;        // suficiente para llegar a ~70 con ~13 clínicas/página
const DELAY_MS = 2500;       // pausa entre requests (listado y perfiles)

const OUTPUT_DIR = './data';
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'prospectos_doctoralia.csv');

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function csvRow(fields) {
  return fields.map(f => {
    const s = String(f ?? '').replace(/"/g, '""');
    return `"${s}"`;
  }).join(',');
}

function cleanPhone(raw) {
  if (!raw) return '';
  return raw.replace(/\D/g, '').replace(/^00/, '');
}

// ── Paso 1: recolectar links de clínicas desde el listado ──────────────────
async function collectClinicLinks(page, target) {
  const links = new Set();

  for (let pageNum = 1; pageNum <= MAX_PAGES && links.size < target; pageNum++) {
    const url = pageNum === 1 ? LISTING_BASE : `${LISTING_BASE}?page=${pageNum}`;
    console.log(`\n📄 Listado página ${pageNum}: ${url}`);

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(DELAY_MS);

    const pageLinks = await page.$$eval('a[href*="/clinicas/"]', els =>
      els.map(e => e.getAttribute('href'))
    );

    const cleaned = pageLinks
      .map(h => h.split('#')[0].split('?')[0])
      .filter(h =>
        h &&
        h.startsWith('https://www.doctoralia.com.mx/clinicas/') &&
        !h.endsWith('/ciudad-de-mexico') &&
        !h.includes('social-connect') &&
        h.split('/clinicas/')[1].split('/').length === 1
      );

    let added = 0;
    for (const link of cleaned) {
      if (!links.has(link)) {
        links.add(link);
        added++;
      }
    }
    console.log(`   ✅ ${added} clínicas nuevas — acumulado: ${links.size}`);

    if (added === 0) {
      console.log('   ⚠ Sin clínicas nuevas en esta página, deteniendo paginación.');
      break;
    }
  }

  return [...links].slice(0, target);
}

// ── Paso 2: visitar cada clínica y extraer datos ────────────────────────────
async function scrapeClinic(page, url, seen) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await sleep(DELAY_MS);

  const nombre = await page.$eval('h1', el => el.textContent.trim()).catch(() => '');
  if (!nombre) return null;

  // Cada "card" de consultorio trae dirección + teléfono(s) juntos en el DOM
  const cards = await page.$$eval(
    'div.d-flex.flex-column.flex-grow-1.mr-md-4.gap-2',
    els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim())
  ).catch(() => []);

  if (cards.length === 0) return null;

  // Tomamos la primera card como dirección principal
  const firstCard = cards[0];
  const direccion = firstCard.split('Teléfono')[0].replace(nombre, '').trim();

  // Extraer todos los teléfonos únicos (formato +52X XXXXXXXXX)
  const allPhones = new Set();
  for (const card of cards) {
    const matches = card.match(/\+\d{3}\s*\d{9,10}/g) || [];
    for (const m of matches) allPhones.add(cleanPhone(m));
  }

  const telefono = [...allPhones][0] || '';
  if (!telefono) return null;
  if (seen.has(telefono)) {
    console.log(`   ↩ Duplicado: ${nombre}`);
    return null;
  }
  seen.add(telefono);

  return {
    nombre,
    ciudad: CIUDAD,
    direccion,
    telefono,
    whatsapp: telefono,
    google_maps_url: '',
    web: url,
    estado: 'PENDING',
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ['--lang=es-MX'],
  });
  const context = await browser.newContext({
    locale: 'es-MX',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  console.log(`🎯 Objetivo: ${TARGET_CLINICS} clínicas en ${CIUDAD}`);

  const links = await collectClinicLinks(page, TARGET_CLINICS);
  console.log(`\n📋 Total de links recolectados: ${links.length}`);

  const results = [];
  const seen = new Set();

  for (const link of links) {
    try {
      console.log(`\n🔍 Visitando: ${link}`);
      const data = await scrapeClinic(page, link, seen);
      if (data) {
        results.push(data);
        console.log(`   ✅ ${data.nombre} — ${data.telefono}`);
      } else {
        console.log('   ⚠ Sin datos útiles, omitida.');
      }
    } catch (err) {
      console.log(`   ❌ Error en ${link}: ${err.message}`);
    }
  }

  await browser.close();

  // ── Escribir CSV ────────────────────────────────────────────────────────
  const header = 'nombre,ciudad,direccion,telefono,whatsapp,web,google_maps_url,estado';
  const stream = createWriteStream(OUTPUT_FILE, { encoding: 'utf8' });
  stream.write('﻿');
  stream.write(header + '\n');

  for (const r of results) {
    stream.write(csvRow([
      r.nombre, r.ciudad, r.direccion, r.telefono,
      r.whatsapp, r.web, r.google_maps_url, r.estado,
    ]) + '\n');
  }
  stream.end();

  console.log(`\n✅ Scraping terminado.`);
  console.log(`📄 Archivo: ${OUTPUT_FILE}`);
  console.log(`📊 Total registros: ${results.length}`);
  console.log(`\nPróximo paso: node index.js import ${OUTPUT_FILE}`);
}

main().catch(err => {
  console.error('❌ Error fatal:', err.message);
  process.exit(1);
});
