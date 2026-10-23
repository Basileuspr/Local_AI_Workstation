package com.localai.workstation.companion;

import org.junit.Test;
import static org.junit.Assert.*;

public class CompanionPolicyTest {
    @Test public void normalizesHttpsOrigin() {
        assertEquals("https://desktop.example.ts.net", CompanionPolicy.origin(" https://DESKTOP.example.ts.net:443/ "));
        assertEquals("https://192.168.1.20:8766", CompanionPolicy.origin("https://192.168.1.20:8766"));
    }
    @Test public void rejectsUnsafeAddresses() {
        for (String value : new String[]{"http://desktop", "file:///test", "javascript:alert(1)", "https://user:password@desktop", "https://desktop/?code=secret", "https://desktop/#code", "https://desktop/path", "https://desktop:0", "https://desktop:65536", "https://desktop.", "https://[::1]", "https://desktop\\@other"}) {
            assertThrows(value, IllegalArgumentException.class, () -> CompanionPolicy.origin(value));
        }
    }
    @Test public void validatesPairingHandoffWithoutForwardingArbitraryUrls() {
        String code = "a".repeat(32);
        String prefix = "lawcompanion://pair/";
        assertEquals("https://desktop.example.ts.net/#pair=" + code, CompanionPolicy.pairingUrl(prefix + "https%3A%2F%2Fdesktop.example.ts.net/" + code));
        for (String value : new String[]{prefix + "http%3A%2F%2Fdesktop/" + code, prefix + "https%3A%2F%2Fuser%40desktop/" + code,
                prefix + "https%3A%2F%2Fdesktop%2Fapi%2Fstate/" + code, prefix + "https%253A%252F%252Fdesktop/" + code,
                prefix + "https%3A%2F%2Fdesktop/" + code + "?token=x", prefix + "https%3A%2F%2Fdesktop/" + code + "#extra",
                prefix + "https%3A%2F%2Fdesktop/short", "lawcompanion://other/https%3A%2F%2Fdesktop/" + code,
                "https://pair/https%3A%2F%2Fdesktop/" + code}) assertThrows(IllegalArgumentException.class, () -> CompanionPolicy.pairingUrl(value));
    }

    @Test public void credentialsStayOnExactOrigin() {
        String origin = "https://desktop.example.ts.net";
        assertTrue(CompanionPolicy.sameOrigin(origin, origin + "/api/state"));
        assertTrue(CompanionPolicy.sameOrigin(origin, origin + ":443/"));
        for (String target : new String[]{"https://desktop.example.ts.net.attacker.test/", "https://attacker.test/", "http://desktop.example.ts.net", "https://desktop.example.ts.net:8766/", "https://x@desktop.example.ts.net/"}) assertFalse(target, CompanionPolicy.sameOrigin(origin, target));
    }
    @Test public void onlyMappedOriginalsCanLeaveTheApp() {
        assertEquals("/api/media/library/image-1?download=true", CompanionPolicy.mediaPath("/api/media/library/image-1"));
        assertEquals("/api/media/session/s/m/i?download=true", CompanionPolicy.mediaPath("/api/media/session/s/m/i?download=true"));
        for (String path : new String[]{"/api/state", "https://evil.test/api/media/library/id", "//evil.test", "/api/media/library/../state", "/api/media/library/%2e%2e", "/api/media/library/a/b", "/api/media/library/id?token=secret", "/api/media/library/id?thumbnail=true", "/api/media/session/s/m", "/api/media/library/a#b"}) assertThrows(path, IllegalArgumentException.class, () -> CompanionPolicy.mediaPath(path));
    }
    @Test public void filesystemNamesAndTypesAreBounded() {
        assertEquals("_secret.png", CompanionPolicy.safeName("../secret", "image/png"));
        assertEquals("workstation-image.jpg", CompanionPolicy.safeName("", "image/jpeg"));
        assertThrows(IllegalArgumentException.class, () -> CompanionPolicy.safeName("file.html", "text/html"));
        assertTrue(CompanionPolicy.safeName("x".repeat(500), "image/webp").length() <= 105);
    }
}
