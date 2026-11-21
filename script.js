package com.gojo.voidplayer.assets;

import org.springframework.core.io.Resource;
import org.springframework.core.io.UrlResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.MediaTypeFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.net.MalformedURLException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@RestController
@RequestMapping("/api/quick-edit")
@CrossOrigin(origins = "*")
public class QuickEditorController {

    private static final Path CONFIG_FILE = Paths.get("data", "player-assets.json");
    private static final Path ASSETS_DIR = Paths.get("assets");

    private final Map<String, Object> state = new ConcurrentHashMap<>();

    public QuickEditorController() {
        loadFromDiskOrInitDefault();
    }

    @GetMapping
    public Map<String, Object> getConfig() {
        return new LinkedHashMap<>(state);
    }

    @GetMapping("/assets/{slot}")
    public ResponseEntity<Resource> serveAssetBySlot(@PathVariable String slot) {
        String cleanSlot = slot == null ? "" : slot.trim();
        if (!cleanSlot.matches("[a-zA-Z0-9_-]+")) {
            return ResponseEntity.badRequest().build();
        }

        try {
            Files.createDirectories(ASSETS_DIR);
            Path resolved = resolveSlotFile(cleanSlot);
            if (resolved == null || !Files.exists(resolved) || !Files.isRegularFile(resolved)) {
                return ResponseEntity.notFound().build();
            }

            Resource resource = new UrlResource(resolved.toUri());
            if (!resource.exists() || !resource.isReadable()) {
                return ResponseEntity.notFound().build();
            }

            MediaType mediaType = MediaTypeFactory.getMediaType(resource)
                    .orElse(MediaType.APPLICATION_OCTET_STREAM);

            return ResponseEntity.ok()
                    .contentType(mediaType)
                    .header(HttpHeaders.CACHE_CONTROL, "no-cache, must-revalidate")
                    .body(resource);
        } catch (MalformedURLException e) {
            return ResponseEntity.badRequest().build();
        } catch (IOException e) {
            return ResponseEntity.internalServerError().build();
        }
    }

    private Path resolveSlotFile(String slot) throws IOException {
        Path exact = ASSETS_DIR.resolve(slot).normalize();
        if (exact.startsWith(ASSETS_DIR.normalize()) && Files.exists(exact) && Files.isRegularFile(exact)) {
            return exact;
        }

        try (var stream = Files.list(ASSETS_DIR)) {
            Optional<Path> match = stream
                    .filter(Files::isRegularFile)
                    .filter(p -> {
                        String name = p.getFileName().toString();
                        int dotIdx = name.indexOf('.');
                        String base = dotIdx > 0 ? name.substring(0, dotIdx) : name;
                        return base.equals(slot);
                    })
                    .sorted()
                    .findFirst();
            return match.orElse(null);
        }
    }

    @PutMapping("/images")
    public ResponseEntity<Map<String, Object>> updateImages(@RequestBody Map<String, String> images) {
        @SuppressWarnings("unchecked")
        Map<String, String> currentImages = (Map<String, String>) state.computeIfAbsent(
                "images", k -> new LinkedHashMap<String, String>()
        );

        images.forEach((key, url) -> {
            if (url != null && !url.trim().isEmpty()) {
                currentImages.put(key.trim(), url.trim());
            }
        });

        saveToDisk();
        return ResponseEntity.ok(getConfig());
    }

    @PutMapping("/tracks")
    public ResponseEntity<Map<String, Object>> updateTracks(@RequestBody List<Map<String, Object>> tracks) {
        if (tracks == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "La lista de canciones no puede ser nula"));
        }

        List<Map<String, Object>> normalizedTracks = new ArrayList<>();
        for (int i = 0; i < tracks.size(); i++) {
            Map<String, Object> raw = tracks.get(i);
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("index", i);
            item.put("title", Objects.toString(raw.getOrDefault("title", "Track " + (i + 1)), "Track " + (i + 1)));
            item.put("artist", Objects.toString(raw.getOrDefault("artist", "Unknown Artist"), "Unknown Artist"));
            String defaultAudio = "/api/quick-edit/assets/" + i;
            item.put("audioUrl", Objects.toString(raw.getOrDefault("audioUrl", defaultAudio), defaultAudio));
            item.put("coverUrl", Objects.toString(raw.getOrDefault("coverUrl", ""), ""));
            item.put("duration", raw.getOrDefault("duration", 180));
            normalizedTracks.add(item);
        }

        state.put("tracks", normalizedTracks);
        saveToDisk();
        return ResponseEntity.ok(getConfig());
    }

    @PostMapping("/tracks")
    public ResponseEntity<Map<String, Object>> addTrack(@RequestBody Map<String, Object> raw) {
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> tracks = (List<Map<String, Object>>) state.computeIfAbsent(
                "tracks", k -> new ArrayList<Map<String, Object>>()
        );

        int idx = tracks.size();
        String defaultAudio = "/api/quick-edit/assets/" + idx;

        Map<String, Object> item = new LinkedHashMap<>();
        item.put("index", idx);
        item.put("title", Objects.toString(raw.getOrDefault("title", "Nueva Pista"), "Nueva Pista"));
        item.put("artist", Objects.toString(raw.getOrDefault("artist", "Gojo Void"), "Gojo Void"));
        item.put("audioUrl", Objects.toString(raw.getOrDefault("audioUrl", defaultAudio), defaultAudio));
        item.put("coverUrl", Objects.toString(raw.getOrDefault("coverUrl", ""), ""));
        item.put("duration", raw.getOrDefault("duration", 180));

        tracks.add(item);
        saveToDisk();
        return ResponseEntity.ok(getConfig());
    }

    @DeleteMapping("/tracks/{index}")
    public ResponseEntity<Map<String, Object>> deleteTrack(@PathVariable int index) {
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> tracks = (List<Map<String, Object>>) state.computeIfAbsent(
                "tracks", k -> new ArrayList<Map<String, Object>>()
        );

        if (index < 0 || index >= tracks.size()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Índice fuera de rango"));
        }

        tracks.remove(index);
        for (int i = 0; i < tracks.size(); i++) {
            tracks.get(i).put("index", i);
        }

        saveToDisk();
        return ResponseEntity.ok(getConfig());
    }

    @PutMapping("/all")
    public ResponseEntity<Map<String, Object>> updateAll(@RequestBody Map<String, Object> payload) {
        if (payload.containsKey("images") && payload.get("images") instanceof Map<?, ?> imgMap) {
            Map<String, String> cleanImages = new LinkedHashMap<>();
            imgMap.forEach((k, v) -> {
                if (k != null && v != null && !v.toString().trim().isEmpty()) {
                    cleanImages.put(k.toString().trim(), v.toString().trim());
                }
            });
            state.put("images", cleanImages);
        }

        if (payload.containsKey("tracks") && payload.get("tracks") instanceof List<?> trackList) {
            List<Map<String, Object>> normalized = new ArrayList<>();
            for (int i = 0; i < trackList.size(); i++) {
                if (trackList.get(i) instanceof Map<?, ?> rawMap) {
                    Map<String, Object> item = new LinkedHashMap<>();
                    item.put("index", i);
                    item.put("title", Objects.toString(rawMap.get("title"), "Track " + (i + 1)));
                    item.put("artist", Objects.toString(rawMap.get("artist"), "Unknown Artist"));
                    String defaultAudio = "/api/quick-edit/assets/" + i;
                    item.put("audioUrl", Objects.toString(rawMap.get("audioUrl"), defaultAudio));
                    item.put("coverUrl", Objects.toString(rawMap.get("coverUrl"), ""));
                    item.put("duration", rawMap.get("duration") != null ? rawMap.get("duration") : 180);
                    normalized.add(item);
                }
            }
            state.put("tracks", normalized);
        }

        saveToDisk();
        return ResponseEntity.ok(getConfig());
    }

    private synchronized void saveToDisk() {
        try {
            if (CONFIG_FILE.getParent() != null) {
                Files.createDirectories(CONFIG_FILE.getParent());
            }
            String json = toJson(state);
            Files.writeString(CONFIG_FILE, json, StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
        } catch (IOException e) {
            System.err.println("Error guardando player-assets.json: " + e.getMessage());
        }
    }

    private void loadFromDiskOrInitDefault() {
        Map<String, String> defaultImages = new LinkedHashMap<>();
        defaultImages.put("wallpaper", "https://i.imgur.com/MwXsvOP.png");
        defaultImages.put("cup", "/api/quick-edit/assets/0");
        defaultImages.put("cup3dTexture", "https://i.imgur.com/Qf2Xh7l.png");
        defaultImages.put("phoneGif", "https://i.imgur.com/3NF8Slr.gif");
        defaultImages.put("chibi1", "/api/quick-edit/assets/0");
        defaultImages.put("chibi2", "/api/quick-edit/assets/1");
        defaultImages.put("chibi3", "/api/quick-edit/assets/2");
        defaultImages.put("lockWallpaper", "https://i.imgur.com/9qWNX8m.jpeg");
        defaultImages.put("homeWallpaper", "https://i.imgur.com/J1YOGul.jpeg");
        defaultImages.put("avatar", "https://i.imgur.com/7yF12zA.jpeg");

        List<Map<String, Object>> defaultTracks = new ArrayList<>();
        defaultTracks.add(Map.of(
                "index", 0,
                "title", "Kaikai Kitan",
                "artist", "Eve",
                "audioUrl", "/api/quick-edit/assets/0",
                "coverUrl", "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=400&q=80",
                "duration", 232
        ));
        defaultTracks.add(Map.of(
                "index", 1,
                "title", "SPECIALZ",
                "artist", "King Gnu",
                "audioUrl", "/api/quick-edit/assets/1",
                "coverUrl", "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=400&q=80",
                "duration", 238
        ));
        defaultTracks.add(Map.of(
                "index", 2,
                "title", "Ao no Sumika",
                "artist", "Tatsuya Kitani",
                "audioUrl", "/api/quick-edit/assets/2",
                "coverUrl", "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=400&q=80",
                "duration", 195
        ));

        state.put("images", defaultImages);
        state.put("tracks", defaultTracks);

        if (Files.exists(CONFIG_FILE)) {
            try {
                String content = Files.readString(CONFIG_FILE, StandardCharsets.UTF_8);
                parseJsonIntoState(content);
            } catch (Exception e) {
                System.err.println("No se pudo leer player-assets.json, usando valores por defecto: " + e.getMessage());
            }
        } else {
            saveToDisk();
        }
    }

    @SuppressWarnings("unchecked")
    private void parseJsonIntoState(String json) {
        int imgStart = json.indexOf("\"images\"");
        if (imgStart != -1) {
            int braceOpen = json.indexOf('{', imgStart);
            int braceClose = findMatchingBrace(json, braceOpen);
            if (braceOpen != -1 && braceClose != -1) {
                String imgBlock = json.substring(braceOpen + 1, braceClose);
                Map<String, String> parsedImgs = (Map<String, String>) state.get("images");
                for (String entry : splitTopLevel(imgBlock, ',')) {
                    String[] kv = splitKeyValue(entry);
                    if (kv != null) {
                        parsedImgs.put(unescapeJson(kv[0]), unescapeJson(kv[1]));
                    }
                }
            }
        }

        int trStart = json.indexOf("\"tracks\"");
        if (trStart != -1) {
            int arrOpen = json.indexOf('[', trStart);
            int arrClose = findMatchingBracket(json, arrOpen);
            if (arrOpen != -1 && arrClose != -1) {
                String arrBlock = json.substring(arrOpen + 1, arrClose);
                List<Map<String, Object>> parsedTracks = new ArrayList<>();
                int idx = 0;
                for (String objStr : splitTopLevel(arrBlock, ',')) {
                    String trimmed = objStr.trim();
                    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
                        Map<String, Object> track = new LinkedHashMap<>();
                        track.put("index", idx++);
                        track.put("title", "Track " + idx);
                        track.put("artist", "Unknown Artist");
                        track.put("audioUrl", "/api/quick-edit/assets/" + (idx - 1));
                        track.put("coverUrl", "");
                        track.put("duration", 180);

                        String inner = trimmed.substring(1, trimmed.length() - 1);
                        for (String field : splitTopLevel(inner, ',')) {
                            String[] kv = splitKeyValue(field);
                            if (kv != null) {
                                String key = unescapeJson(kv[0]);
                                String val = unescapeJson(kv[1]);
                                if ("duration".equals(key) || "index".equals(key)) {
                                    try {
                                        track.put(key, Integer.parseInt(val));
                                    } catch (NumberFormatException ignored) {
                                        track.put(key, val);
                                    }
                                } else {
                                    track.put(key, val);
                                }
                            }
                        }
                        parsedTracks.add(track);
                    }
                }
                if (!parsedTracks.isEmpty()) {
                    state.put("tracks", parsedTracks);
                }
            }
        }
    }

    private int findMatchingBrace(String s, int openIdx) {
        if (openIdx < 0) return -1;
        int depth = 0;
        boolean inQuotes = false;
        for (int i = openIdx; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '\\' && inQuotes) { i++; continue; }
            if (c == '"') inQuotes = !inQuotes;
            if (!inQuotes) {
                if (c == '{') depth++;
                else if (c == '}') {
                    depth--;
                    if (depth == 0) return i;
                }
            }
        }
        return -1;
    }

    private int findMatchingBracket(String s, int openIdx) {
        if (openIdx < 0) return -1;
        int depth = 0;
        boolean inQuotes = false;
        for (int i = openIdx; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '\\' && inQuotes) { i++; continue; }
            if (c == '"') inQuotes = !inQuotes;
            if (!inQuotes) {
                if (c == '[') depth++;
                else if (c == ']') {
                    depth--;
                    if (depth == 0) return i;
                }
            }
        }
        return -1;
    }

    private List<String> splitTopLevel(String s, char delimiter) {
        List<String> parts = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        int braceDepth = 0;
        int bracketDepth = 0;
        boolean inQuotes = false;

        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '\\' && inQuotes) {
                current.append(c);
                if (i + 1 < s.length()) current.append(s.charAt(++i));
                continue;
            }
            if (c == '"') inQuotes = !inQuotes;
            if (!inQuotes) {
                if (c == '{') braceDepth++;
                else if (c == '}') braceDepth--;
                else if (c == '[') bracketDepth++;
                else if (c == ']') bracketDepth--;
                else if (c == delimiter && braceDepth == 0 && bracketDepth == 0) {
                    parts.add(current.toString());
                    current.setLength(0);
                    continue;
                }
            }
            current.append(c);
        }
        if (current.length() > 0) {
            parts.add(current.toString());
        }
        return parts;
    }

    private String[] splitKeyValue(String entry) {
        boolean inQuotes = false;
        int colonIdx = -1;
        for (int i = 0; i < entry.length(); i++) {
            char c = entry.charAt(i);
            if (c == '\\' && inQuotes) { i++; continue; }
            if (c == '"') inQuotes = !inQuotes;
            if (!inQuotes && c == ':') {
                colonIdx = i;
                break;
            }
        }
        if (colonIdx == -1) return null;
        String k = entry.substring(0, colonIdx).trim();
        String v = entry.substring(colonIdx + 1).trim();
        return new String[]{k, v};
    }

    private String unescapeJson(String raw) {
        String s = raw.trim();
        if (s.startsWith("\"") && s.endsWith("\"") && s.length() >= 2) {
            s = s.substring(1, s.length() - 1);
        }
        return s.replace("\\\"", "\"")
                .replace("\\\\", "\\")
                .replace("\\n", "\n")
                .replace("\\r", "\r");
    }

    private String escapeJson(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r");
    }

    @SuppressWarnings("unchecked")
    private String toJson(Map<String, Object> map) {
        StringBuilder sb = new StringBuilder();
        sb.append("{\n");

        Map<String, String> imgs = (Map<String, String>) map.getOrDefault("images", Map.of());
        sb.append("  \"images\": {\n");
        List<Map.Entry<String, String>> imgEntries = new ArrayList<>(imgs.entrySet());
        for (int i = 0; i < imgEntries.size(); i++) {
            var e = imgEntries.get(i);
            sb.append("    \"").append(escapeJson(e.getKey())).append("\": \"")
              .append(escapeJson(e.getValue())).append("\"");
            if (i < imgEntries.size() - 1) sb.append(",");
            sb.append("\n");
        }
        sb.append("  },\n");

        List<Map<String, Object>> tracks = (List<Map<String, Object>>) map.getOrDefault("tracks", List.of());
        sb.append("  \"tracks\": [\n");
        for (int i = 0; i < tracks.size(); i++) {
            Map<String, Object> t = tracks.get(i);
            sb.append("    {\n");
            sb.append("      \"index\": ").append(t.getOrDefault("index", i)).append(",\n");
            sb.append("      \"title\": \"").append(escapeJson(String.valueOf(t.getOrDefault("title", "")))).append("\",\n");
            sb.append("      \"artist\": \"").append(escapeJson(String.valueOf(t.getOrDefault("artist", "")))).append("\",\n");
            sb.append("      \"audioUrl\": \"").append(escapeJson(String.valueOf(t.getOrDefault("audioUrl", "")))).append("\",\n");
            sb.append("      \"coverUrl\": \"").append(escapeJson(String.valueOf(t.getOrDefault("coverUrl", "")))).append("\",\n");
            sb.append("      \"duration\": ").append(t.getOrDefault("duration", 180)).append("\n");
            sb.append("    }");
            if (i < tracks.size() - 1) sb.append(",");
            sb.append("\n");
        }
        sb.append("  ]\n");
        sb.append("}\n");
        return sb.toString();
    }
}
