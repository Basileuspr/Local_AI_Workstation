package com.localai.workstation.companion;

import java.net.URI;
import java.util.Locale;

/** Pure Java so malformed addresses and credential boundaries are testable without a phone. */
public final class CompanionPolicy {
    private CompanionPolicy() {}

    public static String origin(String value) {
        try {
            URI uri = new URI(value.trim());
            String host = uri.getHost();
            if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null
                    || !host.matches("[A-Za-z0-9][A-Za-z0-9.-]*") || host.endsWith(".")
                    || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null
                    || !(uri.getRawPath().isEmpty() || "/".equals(uri.getRawPath()))
                    || uri.getPort() == 0 || uri.getPort() > 65535) {
                throw new IllegalArgumentException();
            }
            return "https://" + host.toLowerCase(Locale.ROOT) + (uri.getPort() == -1 || uri.getPort() == 443 ? "" : ":" + uri.getPort());
        } catch (Exception error) {
            throw new IllegalArgumentException("Enter the desktop HTTPS address without a path, pairing code or password.");
        }
    }

    /** A QR handoff is data, never an arbitrary WebView navigation or script. */
    public static String pairingUrl(String value) {
        try {
            URI uri = new URI(value);
            if (!"lawcompanion".equals(uri.getScheme()) || !"pair".equals(uri.getRawAuthority())
                    || uri.getRawQuery() != null || uri.getRawFragment() != null || value.length() > 500) throw new IllegalArgumentException();
            String[] parts = uri.getRawPath().split("/", -1);
            if (parts.length != 3 || !parts[2].matches("[A-Za-z0-9_-]{32}")) throw new IllegalArgumentException();
            String desktop = origin(java.net.URLDecoder.decode(parts[1], "UTF-8"));
            return desktop + "/#pair=" + parts[2];
        } catch (Exception error) { throw new IllegalArgumentException("Invalid pairing link. Scan a fresh invitation from your desktop."); }
    }

    public static boolean sameOrigin(String origin, String address) {
        try {
            URI uri = new URI(address);
            if (uri.getRawUserInfo() != null || uri.getHost() == null) return false;
            String candidate = uri.getScheme() + "://" + uri.getRawAuthority();
            return origin.equals(origin(candidate));
        } catch (Exception error) { return false; }
    }

    public static String mediaPath(String path) {
        String id = "[A-Za-z0-9_-]{1,100}";
        if (path == null || !path.matches("/api/media/(library/" + id + "|session/" + id + "/" + id + "/" + id + ")(\\?download=true)?")) {
            throw new IllegalArgumentException("Only original companion images can be saved or shared.");
        }
        return path.split("\\?", 2)[0] + "?download=true";
    }

    public static String safeName(String name, String mime) {
        String extension = switch (mime) {
            case "image/png" -> ".png";
            case "image/jpeg" -> ".jpg";
            case "image/webp" -> ".webp";
            case "image/gif" -> ".gif";
            default -> throw new IllegalArgumentException("Unsupported image format.");
        };
        String result = name == null ? "workstation-image" : name.replaceAll("[^A-Za-z0-9 _.-]", "_").replaceAll("^\\.+", "");
        if (result.trim().isEmpty()) result = "workstation-image";
        result = result.substring(0, Math.min(result.length(), 100));
        if (!result.toLowerCase(Locale.ROOT).endsWith(extension)) result += extension;
        return result;
    }
}
