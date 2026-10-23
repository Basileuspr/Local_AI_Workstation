package com.localai.workstation.companion;

import org.junit.Test;
import static org.junit.Assert.*;
import static com.localai.workstation.companion.TailscalePolicy.VpnState.*;

public class TailscalePolicyTest {
    private static final String DESKTOP = "https://desktop.example.ts.net";

    @Test public void targetsOnlyValidatedTailnetOrigins() {
        assertTrue(TailscalePolicy.needsTailscale(DESKTOP));
        assertTrue(TailscalePolicy.needsTailscale("https://DESKTOP.example.ts.net:443/"));
        for (String other : new String[]{null, "", "http://desktop.example.ts.net", "https://ts.net",
                "https://evilts.net", "https://desktop.ts.net.attacker.test", "https://192.168.1.20:8766",
                "https://password@desktop.example.ts.net", DESKTOP + "/#pair=secret"}) {
            assertFalse(String.valueOf(other), TailscalePolicy.needsTailscale(other));
        }
    }

    @Test public void respectsOptOutAndExistingOrUnknownVpn() {
        TailscalePolicy policy = new TailscalePolicy(0, false);
        assertTrue(policy.shouldConnect(DESKTOP, true, NONE, 100_000));
        assertFalse(policy.shouldConnect(DESKTOP, false, NONE, 100_000));
        assertFalse(policy.shouldConnect(DESKTOP, true, ACTIVE, 100_000));
        assertFalse(policy.shouldConnect(DESKTOP, true, UNKNOWN, 100_000));
        assertFalse(policy.shouldConnect("https://192.168.1.20", true, NONE, 100_000));
    }

    @Test public void returningWithoutConnectingDoesNotReopenTailscale() {
        TailscalePolicy policy = new TailscalePolicy(0, false);
        policy.recordAttempt(100_000);
        assertFalse(policy.shouldConnect(DESKTOP, true, NONE, 101_000));
        assertFalse(policy.shouldConnect(DESKTOP, true, NONE, 900_000));
        TailscalePolicy restored = new TailscalePolicy(100_000, policy.attemptedWithoutVpn());
        assertFalse(restored.shouldConnect(DESKTOP, true, NONE, 900_000));
    }

    @Test public void reconnectsAfterAnObservedVpnLaterDisconnects() {
        TailscalePolicy policy = new TailscalePolicy(0, false);
        policy.recordAttempt(100_000);
        assertFalse(policy.shouldConnect(DESKTOP, true, ACTIVE, 110_000));
        assertFalse(policy.shouldConnect(DESKTOP, true, NONE, 120_000));
        assertTrue(policy.shouldConnect(DESKTOP, true, NONE, 160_000));
    }

    @Test public void processRestartHonorsCooldownAndDeviceRebootResetsIt() {
        TailscalePolicy restarted = new TailscalePolicy(100_000, false);
        assertFalse(restarted.shouldConnect(DESKTOP, true, NONE, 110_000));
        assertTrue(restarted.shouldConnect(DESKTOP, true, NONE, 160_000));
        assertTrue(restarted.shouldConnect(DESKTOP, true, NONE, 5_000));
    }
}
