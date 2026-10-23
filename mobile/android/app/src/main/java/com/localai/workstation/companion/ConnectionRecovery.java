package com.localai.workstation.companion;

/** Bounded recovery of a failed navigation, never a replay of application requests. */
public final class ConnectionRecovery {
    private long deadline;
    private long nextAttempt;
    private int attempts;

    public void start(long now) { deadline = now + 20_000; nextAttempt = now; attempts = 0; }
    public void stop() { deadline = 0; }
    public boolean running() { return deadline != 0; }
    public boolean active(long now) { return running() && now < deadline; }

    public boolean retry(long now, boolean failed, boolean networkFailure, boolean vpnPresent) {
        if (!active(now) || !failed || !networkFailure || !vpnPresent || attempts >= 3 || now < nextAttempt) return false;
        attempts++; nextAttempt = now + 3_000;
        return true;
    }
}
