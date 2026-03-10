# agra-proxy

CORS-Proxy für die agra Messepark Flutter Web App.

## Deployment auf Railway (kostenlos)

1. Gehe zu https://railway.app und melde dich an (GitHub-Login reicht)
2. Klicke „New Project" → „Deploy from GitHub repo"
3. Lade diesen Ordner als GitHub-Repository hoch, oder:
   - Klicke „Deploy from local" und wähle diesen Ordner
4. Railway erkennt automatisch Node.js und startet den Server
5. Unter „Settings" → „Domains" eine öffentliche URL generieren
   (z.B. `https://agra-proxy-production.up.railway.app`)

## Flutter-App anpassen

In `api_service.dart` die Proxy-URL eintragen:

```dart
static const String _proxyBase = 'https://DEINE-URL.up.railway.app';

// Statt direkt zur WP API:
final uri = Uri.parse('$_proxyBase/api/events?per_page=12&start_date=$today&status=publish');

// Statt direkt zur Listing-Seite:
final htmlRes = await http.get(Uri.parse('$_proxyBase/api/listing'));
```

## Lokaler Test

```bash
npm install
npm start
# → http://localhost:3000/api/events
# → http://localhost:3000/api/listing
```
