package com.localai.workstation.companion;

import org.junit.Test;
import static org.junit.Assert.*;

public class ConnectionRecoveryTest {
    @Test public void failedPageWaitsForVpnThenRecoversWithoutRapidRetries() {
        ConnectionRecovery recovery = new ConnectionRecovery(); recovery.start(1_000);
        assertFalse(recovery.retry(1_000, true, true, false));
        assertTrue(recovery.retry(2_000, true, true, true));
        assertFalse(recovery.retry(3_000, true, true, true));
        assertTrue(recovery.retry(5_000, true, true, true));
        assertTrue(recovery.retry(8_000, true, true, true));
        assertFalse(recovery.retry(11_000, true, true, true));
    }

    @Test public void healthyPagesAndCertificateOrHttpFailuresAreNeverReloaded() {
        ConnectionRecovery recovery = new ConnectionRecovery(); recovery.start(1_000);
        assertFalse(recovery.retry(2_000, false, false, true));
        assertFalse(recovery.retry(3_000, false, true, true));
        assertFalse(recovery.retry(4_000, true, false, true));
        assertTrue(recovery.retry(5_000, true, true, true));
    }

    @Test public void expiresAfterTwentySecondsEvenIfThePhoneWasBackgrounded() {
        ConnectionRecovery recovery = new ConnectionRecovery(); recovery.start(1_000);
        assertTrue(recovery.active(20_999));
        assertFalse(recovery.active(21_000));
        assertFalse(recovery.retry(21_000, true, true, true));
        assertFalse(recovery.retry(60_000, true, true, true));
    }

    @Test public void changingDesktopCancelsRecoveryAndExplicitReturnStartsANewWindow() {
        ConnectionRecovery recovery = new ConnectionRecovery(); recovery.start(1_000);
        recovery.stop();
        assertFalse(recovery.running());
        assertFalse(recovery.retry(2_000, true, true, true));
        recovery.start(100_000);
        assertTrue(recovery.retry(100_000, true, true, true));
    }
}
