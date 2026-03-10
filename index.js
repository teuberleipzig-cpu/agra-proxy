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

function isUsableImage(url) {
  if (!url) return false;
  if (url.endsWith('.svg')) return false;
  return true;
}

function normalize(s) {
  return s.toLowerCase().replace(/[^a-z0-9äöüß]/g, '').trim();
}

function decodeHtml(s) {
  return s.replace(/&amp;/g, '&').replace(/&#8211;/g, '–').replace(/&#\d+;/g, '');
}

// Scrape Listing-Seite: Titel → Bild (für SVG-Fallback)
async function scrapeListingImages() {
  try {
    const res = await fetch(LISTING, { timeout: 10000 });
    const html = await res.text();
    const map = {};
    const re = /<img[^>]+tribe-events-calendar-list__event-featured-image[^>]*>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const src = (m[0].match(/src="([^"]+)"/) || [])[1];
      const alt = (m[0].match(/alt="([^"]+)"/) || [])[1];
      if (src && alt && isUsableImage(src)) {
        const key = normalize(decodeHtml(alt));
        if (!map[key]) map[key] = src;
      }
    }
    console.log(`Listing: ${Object.keys(map).length} Bilder`);
    return map;
  } catch (err) {
    return {};
  }
}

function findInListing(map, title) {
  const t = normalize(title);
  if (map[t]) return map[t];
  for (const [key, url] of Object.entries(map)) {
    if (key.includes(t) || t.includes(key)) return url;
  }
  return null;
}

// Scrape Event-Unterseite
async function scrapeEventImage(eventUrl) {
  try {
    const res = await fetch(eventUrl, { timeout: 8000 });
    const html = await res.text();

    const blockMatch = html.match(/class="tribe-events-event-image"[^>]*>([\s\S]{0,800}?)<\/div>/);
    if (blockMatch) {
      // srcset: erstes Element = größtes Bild
      const srcsetMatch = blockMatch[1].match(/srcset="([^"]+)"/);
      if (srcsetMatch) {
        const sources = srcsetMatch[1].split(',').map(s => s.trim());
        for (const source of sources) {
          const url = source.split(' ')[0];
          if (isUsableImage(url)) return url;
        }
      }
      const srcMatch = blockMatch[1].match(/src="([^"]+)"/);
      if (srcMatch && isUsableImage(srcMatch[1])) return srcMatch[1];
      // SVG gefunden – merken für Fallback
      if (srcMatch) return '__svg__';
    }
    return null;
  } catch (err) {
    return null;
  }
}

function proxyImg(url) {
  return `${PROXY_BASE}/api/image?url=${encodeURIComponent(url)}`;
}

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
      const imageResults = await Promise.all(
        data.events.map(e => scrapeEventImage(e.url))
      );

      data.events = data.events.map((event, i) => {
        let imgUrl = imageResults[i];

        // SVG auf Unterseite → Listing-Seite als Fallback
        if (imgUrl === '__svg__') {
          imgUrl = findInListing(listingMap, event.title) || null;
        }

        if (imgUrl) {
          const p = proxyImg(imgUrl);
          event.image = { url: p, sizes: { thumbnail: { url: p } } };
          console.log(`✓ ${event.title}`);
        } else {
          event.image = null;
          console.log(`✗ ${event.title}: kein Bild`);
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
