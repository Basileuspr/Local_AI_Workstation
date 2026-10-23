package com.localai.workstation.companion;

import java.net.URI;

/** Automatic launch guard. A VPN transport alone never proves desktop reachability. */
public final class TailscalePolicy {
    public enum VpnState { NONE, ACTIVE, UNKNOWN }
    public static final long COOLDOWN_MS = 60_000;
    private long lastAttempt;
    private boolean attemptedWithoutVpn;

    public TailscalePolicy(long lastAttempt, boolean attemptedWithoutVpn) {
        this.lastAttempt = lastAttempt;
        this.attemptedWithoutVpn = attemptedWithoutVpn;
    }

    public static boolean needsTailscale(String origin) {
        try {
            String host = new URI(CompanionPolicy.origin(origin)).getHost();
            return host.endsWith(".ts.net");
        } catch (Exception error) { return false; }
    }

    public boolean shouldConnect(String origin, boolean enabled, VpnState vpn, long now) {
        if (vpn == VpnState.ACTIVE) attemptedWithoutVpn = false;
        return enabled && needsTailscale(origin) && vpn == VpnState.NONE && !attemptedWithoutVpn
            && (lastAttempt == 0 || now < lastAttempt || now - lastAttempt >= COOLDOWN_MS);
    }

    public void recordAttempt(long now) { lastAttempt = now; attemptedWithoutVpn = true; }
    public boolean attemptedWithoutVpn() { return attemptedWithoutVpn; }
}
