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

// Scrape das Bild von einer Event-Unterseite
// Sucht zuerst im tribe-events-event-image Block, dann og:image
async function scrapeEventImage(eventUrl) {
  try {
    const res = await fetch(eventUrl, { timeout: 8000 });
    const html = await res.text();

    // 1. Bild aus div.tribe-events-event-image > img
    const blockMatch = html.match(/class="tribe-events-event-image"[^>]*>[\s\S]{0,300}?<img[^>]+src="([^"]+)"/);
    if (blockMatch && blockMatch[1]) return blockMatch[1];

    // 2. og:image Meta-Tag
    const ogMatch = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/);
    if (ogMatch && ogMatch[1]) return ogMatch[1];

    // 3. wp-post-image
    const wpMatch = html.match(/<img[^>]+class="[^"]*wp-post-image[^"]*"[^>]*src="([^"]+)"/);
    if (wpMatch && wpMatch[1]) return wpMatch[1];

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
      // Alle Event-Unterseiten parallel scrapen für hochauflösende Bilder
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
