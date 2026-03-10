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

// GET /api/events  →  WordPress REST API weiterleiten
app.get('/api/events', async (req, res) => {
  try {
    const params = new URLSearchParams(req.query).toString();
    const url = params ? `${WP_BASE}?${params}` : WP_BASE;

    const wpRes = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      timeout: 10000,
    });

    if (!wpRes.ok) {
      return res.status(wpRes.status).json({ error: `Upstream HTTP ${wpRes.status}` });
    }

    const data = await wpRes.json();
    res.json(data);
  } catch (err) {
    console.error('Events fetch error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// GET /api/listing  →  HTML-Übersichtsseite für Bild-Scraping
app.get('/api/listing', async (req, res) => {
  try {
    const htmlRes = await fetch(LISTING, { timeout: 10000 });

    if (!htmlRes.ok) {
      return res.status(htmlRes.status).json({ error: `Upstream HTTP ${htmlRes.status}` });
    }

    const html = await htmlRes.text();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('Listing fetch error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// Health-check
app.get('/', (req, res) => res.send('agra proxy ok'));

app.listen(PORT, () => console.log(`agra-proxy läuft auf Port ${PORT}`));
