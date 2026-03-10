const express = require('express');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

const WP_BASE = 'https://agramessepark.de/wp-json/tribe/events/v1/events';
const LISTING = 'https://agramessepark.de/events/kategorie/alle/';

// CORS-Header für alle Anfragen
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Scrape alle Event-Bilder von der Übersichtsseite
async function scrapeImages() {
  try {
    const res = await fetch(LISTING, { timeout: 10000 });
    const html = await res.text();
    const map = {};

    // Alle img-Tags mit featured-image Klasse finden
    const re = /<img[^>]+tribe-events-calendar-list__event-featured-image[^>]*>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const tag = m[0];
      const srcMatch = tag.match(/src="([^"]+)"/);
      const altMatch = tag.match(/alt="([^"]+)"/);
      if (srcMatch && altMatch) {
        const key = normalize(decodeHtml(altMatch[1]));
        if (!map[key]) map[key] = srcMatch[1];
      }
    }

    console.log(`Scraped ${Object.keys(map).length} images:`, Object.keys(map));
    return map;
  } catch (err) {
    console.error('Scrape error:', err.message);
    return {};
  }
}

function normalize(s) {
  return s.toLowerCase().replace(/[^a-z0-9äöüß]/g, '').trim();
}

function decodeHtml(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, '');
}

function findImage(map, title) {
  const t = normalize(title);
  if (map[t]) return map[t];
  for (const [key, url] of Object.entries(map)) {
    if (key.includes(t) || t.includes(key)) return url;
  }
  return null;
}

function isDefaultLogo(url) {
  return !url || url.includes('logo-mittel') || url.includes('logo_');
}

// GET /api/events → Events + Bilder kombiniert
app.get('/api/events', async (req, res) => {
  try {
    const params = new URLSearchParams(req.query).toString();
    const url = params ? `${WP_BASE}?${params}` : WP_BASE;

    // Parallel: API + Bilderscraping
    const [wpRes, imageMap] = await Promise.all([
      fetch(url, { headers: { 'Accept': 'application/json' }, timeout: 10000 }),
      scrapeImages(),
    ]);

    if (!wpRes.ok) {
      return res.status(wpRes.status).json({ error: `Upstream HTTP ${wpRes.status}` });
    }

    const data = await wpRes.json();

    // Bilder einsetzen wo Standard-Logo
    if (data.events) {
      data.events = data.events.map(event => {
        const apiImg = event.image?.url;
        if (isDefaultLogo(apiImg)) {
          const scraped = findImage(imageMap, event.title);
          if (scraped) {
            event.image = { url: scraped, sizes: { thumbnail: { url: scraped } } };
          }
        }
        return event;
      });
    }

    res.json(data);
  } catch (err) {
    console.error('Events fetch error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// Health-check
app.get('/', (req, res) => res.send('agra proxy ok'));

app.listen(PORT, () => console.log(`agra-proxy läuft auf Port ${PORT}`));
