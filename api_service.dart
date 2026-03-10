import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/event_model.dart';

enum ApiStatus { loading, ok, error }

class ApiService {
  // Proxy-URL nach Railway-Deployment hier eintragen:
  static const String _proxy = 'https://DEINE-URL.up.railway.app';

  static Future<List<EventModel>> fetchEvents() async {
    final today = DateTime.now().toIso8601String().substring(0, 10);

    // Beide Requests parallel über den Proxy
    final results = await Future.wait([
      http.get(
        Uri.parse('$_proxy/api/events?per_page=12&start_date=$today&status=publish'),
        headers: {'Accept': 'application/json'},
      ).timeout(const Duration(seconds: 10)),
      http.get(
        Uri.parse('$_proxy/api/listing'),
      ).timeout(const Duration(seconds: 10)),
    ]);

    final apiResponse = results[0];
    final htmlResponse = results[1];

    if (apiResponse.statusCode != 200) {
      throw Exception('HTTP ${apiResponse.statusCode}');
    }

    final imageMap = _scrapeImages(htmlResponse.body);

    final body = json.decode(apiResponse.body) as Map<String, dynamic>;
    final events = body['events'] as List<dynamic>? ?? [];
    return events.map((e) {
      final event = EventModel.fromJson(e as Map<String, dynamic>);
      if (_isDefaultLogo(event.imageUrl)) {
        final scraped = _findImage(imageMap, event.title);
        if (scraped != null) {
          return event.copyWith(imageUrl: scraped, thumbUrl: scraped);
        }
      }
      return event;
    }).toList();
  }

  static Map<String, String> _scrapeImages(String html) {
    final result = <String, String>{};
    final imgRegex = RegExp(
      r'tribe-events-calendar-list__event-featured-image[^>]*\s+src="([^"]+)"[^>]*alt="([^"]+)"',
      dotAll: true,
    );
    final imgRegex2 = RegExp(
      r'tribe-events-calendar-list__event-featured-image[^>]*\s+alt="([^"]+)"[^>]*src="([^"]+)"',
      dotAll: true,
    );
    for (final m in imgRegex.allMatches(html)) {
      result[_normalize(m.group(2)!)] = m.group(1)!;
    }
    for (final m in imgRegex2.allMatches(html)) {
      result.putIfAbsent(_normalize(m.group(1)!), () => m.group(2)!);
    }
    return result;
  }

  static String? _findImage(Map<String, String> map, String title) {
    final t = _normalize(title);
    if (map.containsKey(t)) return map[t];
    for (final entry in map.entries) {
      if (entry.key.contains(t) || t.contains(entry.key)) return entry.value;
    }
    return null;
  }

  static String _normalize(String s) =>
      s.toLowerCase().replaceAll(RegExp(r'[^a-z0-9äöüß]'), '').trim();

  static bool _isDefaultLogo(String? url) =>
      url == null || url.contains('logo-mittel') || url.contains('logo_');
}
