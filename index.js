const express = require('express');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

const WP_BASE = 'https://agramessepark.de/wp-json/tribe/events/v1/events';
const PROXY_BASE = 'https://agra-proxy.onrender.com';

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Prüft ob eine URL ein brauchbares Foto ist (kein SVG, kein Logo)
function isUsableImage(url) {
  if (!url) return false;
  if (url.endsWith('.svg')) return false;
  if (url.toLowerCase().includes('logo')) return false;
  return true;
}

// Scrape das Bild von einer Event-Unterseite
async function scrapeEventImage(eventUrl) {
  try {
    const res = await fetch(eventUrl, { timeout: 8000 });
    const html = await res.text();

    // 1. og:image Meta-Tag (zuverlässigste Quelle, vom CMS gesetzt)
    const ogMatch = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/);
    if (ogMatch && isUsableImage(ogMatch[1])) return ogMatch[1];

    // og:image kann auch andersrum stehen
    const ogMatch2 = html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/);
    if (ogMatch2 && isUsableImage(ogMatch2[1])) return ogMatch2[1];

    // 2. Alle img-Tags im tribe-events-event-image Block
    const blockMatch = html.match(/class="tribe-events-event-image"[^>]*>([\s\S]{0,800}?)<\/div>/);
    if (blockMatch) {
      const imgRe = /src="([^"]+)"/g;
      let m;
      while ((m = imgRe.exec(blockMatch[1])) !== null) {
        if (isUsableImage(m[1])) return m[1];
      }
    }

    // 3. wp-post-image Klasse
    const wpRe = /<img[^>]+class="[^"]*wp-post-image[^"]*"[^>]*>/g;
    let wpM;
    while ((wpM = wpRe.exec(html)) !== null) {
      const src = (wpM[0].match(/src="([^"]+)"/) || [])[1];
      if (isUsableImage(src)) return src;
    }

    // 4. Beliebiges Bild aus wp-content/uploads als letzter Fallback
    const uploadsRe = /src="(https:\/\/agramessepark\.de\/wp-content\/uploads\/[^"]+\.(jpg|jpeg|png|webp))"/gi;
    let uM;
    while ((uM = uploadsRe.exec(html)) !== null) {
      if (isUsableImage(uM[1])) return uM[1];
    }

    return null;
  } catch (err) {
    console.error(`Scrape error for ${eventUrl}:`, err.message);
    return null;
  }
}

function proxyImg(url) {
  return `${PROXY_BASE}/api/image?url=${encodeURIComponent(url)}`;
}

// GET /api/events → Events mit Bildern von den Unterseiten
app.get('/api/events', async (req, res) => {
  try {
    const params = new URLSearchParams(req.query).toString();
    const url = params ? `${WP_BASE}?${params}` : WP_BASE;

    const wpRes = await fetch(url, { headers: { 'Accept': 'application/json' }, timeout: 10000 });
    if (!wpRes.ok) return res.status(wpRes.status).json({ error: `Upstream HTTP ${wpRes.status}` });

    const data = await wpRes.json();

    if (data.events) {
      console.log(`Scraping images for ${data.events.length} events...`);
      const imageUrls = await Promise.all(
        data.events.map(e => scrapeEventImage(e.url))
      );

      data.events = data.events.map((event, i) => {
        const imgUrl = imageUrls[i];
        if (imgUrl) {
          const p = proxyImg(imgUrl);
          event.image = { url: p, sizes: { thumbnail: { url: p } } };
          console.log(`✓ ${event.title}: ${imgUrl}`);
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
