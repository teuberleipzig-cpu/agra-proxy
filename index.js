const express = require('express');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

const WP_BASE = 'https://agramessepark.de/wp-json/tribe/events/v1/events';
const LISTING = 'https://agramessepark.de/events/kategorie/alle/';
const PROXY_BASE = 'https://agra-proxy.onrender.com';

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Scrape Bilder von der Listing-Seite: Titel → URL
async function scrapeListingImages() {
  try {
    const res = await fetch(LISTING, { timeout: 10000 });
    const html = await res.text();
    const map = {};
    const re = /<img[^>]+tribe-events-calendar-list__event-featured-image[^>]*>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const tag = m[0];
      const src = (tag.match(/src="([^"]+)"/) || [])[1];
      const alt = (tag.match(/alt="([^"]+)"/) || [])[1];
      if (src && alt) {
        const key = normalize(decodeHtml(alt));
        if (!map[key]) map[key] = src;
      }
    }
    console.log(`Listing: ${Object.keys(map).length} Bilder gefunden`);
    return map;
  } catch (err) {
    console.error('Listing scrape error:', err.message);
    return {};
  }
}

// Scrape Bild von einer einzelnen Event-Unterseite
async function scrapeEventImage(url) {
  try {
    const res = await fetch(url, { timeout: 8000 });
    const html = await res.text();
    // Featured image im Event-Header
    const patterns = [
      /class="tribe-events-single-section[^"]*"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"/,
      /<meta property="og:image" content="([^"]+)"/,
      /<img[^>]+class="[^"]*wp-post-image[^"]*"[^>]*src="([^"]+)"/,
      /<img[^>]+src="(https:\/\/agramessepark\.de\/wp-content\/uploads\/[^"]+\.(jpg|jpeg|png|webp))"/i,
    ];
    for (const p of patterns) {
      const m = html.match(p);
      if (m && m[1] && !m[1].includes('logo')) return m[1];
    }
    return null;
  } catch (err) {
    return null;
  }
}

function normalize(s) {
  return s.toLowerCase().replace(/[^a-z0-9äöüß]/g, '').trim();
}

function decodeHtml(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#8211;/g, '–').replace(/&#8212;/g, '—')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
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
  return !url || url.includes('logo-mittel') || url.includes('logo_') || url.includes('logo.');
}

function proxyImg(url) {
  return `${PROXY_BASE}/api/image?url=${encodeURIComponent(url)}`;
}

// GET /api/events
app.get('/api/events', async (req, res) => {
  try {
    const params = new URLSearchParams(req.query).toString();
    const url = params ? `${WP_BASE}?${params}` : WP_BASE;

    const [wpRes, listingMap] = await Promise.all([
      fetch(url, { headers: { 'Accept': 'application/json' }, timeout: 10000 }),
      scrapeListingImages(),
    ]);

    if (!wpRes.ok) return res.status(wpRes.status).json({ error: `Upstream HTTP ${wpRes.status}` });

    const data = await wpRes.json();

    if (data.events) {
      // Events ohne Bild: Unterseiten parallel scrapen
      const needsScrape = data.events.filter(e => isDefaultLogo(e.image?.url));
      const scraped = await Promise.all(
        needsScrape.map(e => scrapeEventImage(e.url))
      );
      const eventScrapeMap = {};
      needsScrape.forEach((e, i) => { if (scraped[i]) eventScrapeMap[e.id] = scraped[i]; });

      data.events = data.events.map(event => {
        const apiImg = event.image?.url;
        let imgUrl = isDefaultLogo(apiImg) ? null : apiImg;

        // 1. Listing-Seite
        if (!imgUrl) imgUrl = findImage(listingMap, event.title);
        // 2. Event-Unterseite
        if (!imgUrl) imgUrl = eventScrapeMap[event.id] || null;

        if (imgUrl) {
          const p = proxyImg(imgUrl);
          event.image = { url: p, sizes: { thumbnail: { url: p } } };
        } else {
          event.image = null;
        }

        return event;
      });
    }

    res.json(data);
  } catch (err) {
    console.error('Events error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// GET /api/image?url=... → Bild-Proxy mit CORS
app.get('/api/image', async (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl) return res.status(400).send('Missing url');
  if (!imageUrl.startsWith('https://agramessepark.de/')) return res.status(403).send('Forbidden');

  try {
    const imgRes = await fetch(imageUrl, { timeout: 10000 });
    if (!imgRes.ok) return res.status(imgRes.status).send('Failed');
    res.setHeader('Content-Type', imgRes.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    imgRes.body.pipe(res);
  } catch (err) {
    res.status(502).send('Image proxy error');
  }
});

app.get('/', (req, res) => res.send('agra proxy ok'));

app.listen(PORT, () => console.log(`agra-proxy läuft auf Port ${PORT}`));
