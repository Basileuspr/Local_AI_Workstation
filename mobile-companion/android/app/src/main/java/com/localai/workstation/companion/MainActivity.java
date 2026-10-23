package com.localai.workstation.companion;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ComponentName;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.MediaStore;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.URLUtil;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.net.ssl.HttpsURLConnection;

public final class MainActivity extends Activity {
    private static final int BACKGROUND = Color.rgb(16, 28, 38);
    private static final int ACCENT = Color.rgb(124, 228, 208);
    private static final long MAX_IMAGE_BYTES = 64L * 1024 * 1024;
    private static final String TAILSCALE_PACKAGE = "com.tailscale.ipn";
    private static final ComponentName TAILSCALE_RECEIVER = new ComponentName(TAILSCALE_PACKAGE, TAILSCALE_PACKAGE + ".IPNReceiver");
    private final ExecutorService transfers = Executors.newSingleThreadExecutor();
    private final AtomicBoolean transferring = new AtomicBoolean(false);
    private LinearLayout root;
    private WebView web;
    private ProgressBar progress;
    private TextView connection;
    private String origin;
    private String adapter;
    private String launchFragment = "";
    private boolean pageFailed;
    private AlertDialog connectionDialog;
    private final Handler connectionHandler = new Handler(Looper.getMainLooper());
    private TailscalePolicy tailscalePolicy;
    private boolean resumed;
    private boolean returningFromTailscale;
    private boolean retryablePageFailure;
    private String pendingPageUrl;
    private String connectionError = "Cannot reach the desktop. Check Tailscale and the desktop mobile connection.";
    private final ConnectionRecovery recovery = new ConnectionRecovery();
    private final Runnable recoverConnection = this::recoverConnection;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        tailscalePolicy = new TailscalePolicy(getPreferences(MODE_PRIVATE).getLong("tailscaleLastAttempt", 0),
            state != null && state.getBoolean("tailscaleAttempted"));
        returningFromTailscale = state != null && state.getBoolean("tailscaleReturn");
        WebView.setWebContentsDebuggingEnabled(false);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BACKGROUND);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets edges = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(edges.left, edges.top, edges.right, edges.bottom);
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        setContentView(root);
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(0, this::handleBack);
        try (InputStream input = getAssets().open("native-companion.js")) {
            ByteArrayOutputStream script = new ByteArrayOutputStream();
            copy(input, script);
            adapter = script.toString(StandardCharsets.UTF_8.name());
        } catch (Exception failure) { adapter = ""; }
        clearOldShares();
        String saved = getPreferences(MODE_PRIVATE).getString("origin", "");
        if (saved.isEmpty()) showSetup("");
        else {
            try { origin = CompanionPolicy.origin(saved); openCompanion(); }
            catch (IllegalArgumentException error) { showSetup(error.getMessage()); }
        }
        handlePairingIntent(getIntent());
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent); setIntent(intent); handlePairingIntent(intent);
    }
    private void handlePairingIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction()) || intent.getData() == null) return;
        String raw = intent.getDataString(); intent.setData(null);
        try {
            String link = CompanionPolicy.pairingUrl(raw);
            String desktop = link.substring(0, link.indexOf("/#pair="));
            boolean changing = origin != null && !origin.equals(desktop);
            new AlertDialog.Builder(this).setTitle("Pair with this desktop?")
                .setMessage(desktop + "\n\n" + (changing ? "This replaces the saved desktop and clears its local pairing. " : "")
                    + "Unsent text in the current screen will be lost. Continue only if this is the address shown on your desktop.")
                .setNegativeButton("Cancel", null).setPositiveButton("Continue", (dialog, which) -> {
                    launchFragment = link.substring(link.indexOf('#'));
                    if (changing) clearAndConnect(desktop); else connect(desktop);
                }).show();
        } catch (IllegalArgumentException error) { toast(error.getMessage()); }
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private TextView text(String value, int size, int color) {
        TextView result = new TextView(this);
        result.setText(value); result.setTextSize(size); result.setTextColor(color);
        result.setPadding(0, dp(8), 0, dp(8));
        return result;
    }
    private Button button(String label, Runnable action) {
        Button result = new Button(this);
        result.setText(label); result.setAllCaps(false); result.setMinHeight(dp(48));
        result.setOnClickListener(view -> action.run());
        return result;
    }
    private void disposeWeb() {
        connectionHandler.removeCallbacks(recoverConnection); recovery.stop();
        dismissConnectionError();
        if (web != null) { root.removeView(web); web.stopLoading(); web.destroy(); web = null; }
    }

    private void showSetup(String error) {
        disposeWeb(); root.removeAllViews();
        ScrollView scroll = new ScrollView(this);
        LinearLayout form = new LinearLayout(this); form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(28), dp(36), dp(28), dp(24));
        scroll.setFillViewport(true); scroll.addView(form);
        root.addView(scroll, new LinearLayout.LayoutParams(-1, -1));
        form.addView(text("LOCAL AI WORKSTATION", 12, ACCENT));
        form.addView(text("Your desktop.\nIn your pocket.", 32, Color.WHITE));
        form.addView(text("Chat, create images and browse your gallery. Your desktop runs the models and keeps your work.", 16, Color.LTGRAY));
        form.addView(text("Desktop HTTPS address", 14, ACCENT));
        EditText address = new EditText(this);
        address.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        address.setSingleLine(true); address.setTextSize(16);
        address.setHint("https://desktop.your-tailnet.ts.net");
        address.setText(origin == null ? "" : origin);
        address.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
        form.addView(address, new LinearLayout.LayoutParams(-1, -2));
        TextView issue = text(error, 14, Color.rgb(255, 181, 171)); form.addView(issue);
        form.addView(button("Connect to workstation", () -> {
            try {
                String selected = CompanionPolicy.origin(address.getText().toString());
                if (origin != null && !origin.equals(selected)) {
                    new AlertDialog.Builder(this).setTitle("Change desktop?")
                        .setMessage("The saved pairing on this phone will be cleared. Use a new pairing invitation for the selected desktop.")
                        .setNegativeButton("Cancel", null).setPositiveButton("Change desktop", (dialog, which) -> clearAndConnect(selected)).show();
                } else connect(selected);
            } catch (IllegalArgumentException failure) { issue.setText(failure.getMessage()); }
        }));
        CheckBox automatic = new CheckBox(this);
        automatic.setText(R.string.connect_tailscale_automatically); automatic.setTextColor(Color.WHITE);
        automatic.setMinHeight(dp(48)); automatic.setChecked(automaticTailscale());
        automatic.setOnCheckedChangeListener((view, checked) -> getPreferences(MODE_PRIVATE).edit().putBoolean("automaticTailscale", checked).apply());
        form.addView(automatic);
        form.addView(text("For a saved .ts.net desktop, opening Companion requests a Tailscale connection if no VPN is active. Return here after Tailscale opens. Sign-in and Android VPN approval may be required. This setting is saved on this phone.", 14, Color.LTGRAY));
        form.addView(button("Connect Tailscale", () -> openTailscale(false)));
        form.addView(text("1. Install Tailscale and sign in on the phone and desktop.\n\n2. Open Dashboard → Mobile companion on the desktop and start the mobile connection. Copy its HTTPS address above.\n\n3. Create a fresh invitation. Scan its QR with your phone camera and tap Open Android app to pair. You can also paste the invitation code here. Browser pairing is separate.", 14, Color.LTGRAY));
        form.addView(text("Keep the desktop awake for jobs. This app does not run models on the phone. Version 0.3.0 · Android 10+", 12, Color.LTGRAY));
        if (origin != null) form.addView(button("Return to companion", this::openCompanion));
    }
    private void connect(String selected) {
        origin = selected;
        getPreferences(MODE_PRIVATE).edit().putString("origin", origin).apply();
        openCompanion();
    }
    private void clearAndConnect(String selected) {
        disposeWeb(); WebStorage.getInstance().deleteAllData();
        CookieManager.getInstance().removeAllCookies(done -> {
            CookieManager.getInstance().flush(); connect(selected);
        });
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void openCompanion() {
        disposeWeb(); root.removeAllViews();
        LinearLayout bar = new LinearLayout(this); bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(12), 0, dp(8), 0);
        connection = text("Private desktop", 12, ACCENT);
        connection.setMaxLines(1);
        bar.addView(connection, new LinearLayout.LayoutParams(0, dp(48), 1));
        Button menu = button("⋮", () -> {}); menu.setContentDescription("Connection options");
        menu.setOnClickListener(view -> showMenu(menu)); bar.addView(menu, new LinearLayout.LayoutParams(dp(52), dp(48)));
        root.addView(bar);
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        root.addView(progress, new LinearLayout.LayoutParams(-1, dp(2)));
        web = new WebView(this); web.setBackgroundColor(BACKGROUND);
        web.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false); settings.setGeolocationEnabled(false);
        settings.setMediaPlaybackRequiresUserGesture(true); settings.setSafeBrowsingEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "LawAndroid", Collections.singleton(origin), (view, message, sourceOrigin, mainFrame, reply) -> {
                if (!mainFrame || !CompanionPolicy.sameOrigin(origin, sourceOrigin.toString()) || !CompanionPolicy.sameOrigin(origin, view.getUrl())) return;
                try {
                    String data = message.getData();
                    if (data == null || data.length() > 1500) return;
                    JSONObject request = new JSONObject(data);
                    String action = request.getString("action");
                    if (!action.equals("save") && !action.equals("share")) return;
                    transfer(request.getString("path"), action.equals("share"));
                } catch (Exception error) { toast("This image cannot be transferred."); }
            });
        }
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int value) {
                if (view != web) return;
                progress.setProgress(value); progress.setVisibility(value == 100 ? View.GONE : View.VISIBLE);
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (CompanionPolicy.sameOrigin(origin, request.getUrl().toString())) return false;
                if (request.isForMainFrame() && request.hasGesture() && "https".equals(request.getUrl().getScheme())) {
                    new AlertDialog.Builder(MainActivity.this).setTitle("Open external link?").setMessage("This link opens in your browser.")
                        .setNegativeButton("Cancel", null).setPositiveButton("Open browser", (dialog, which) -> openBrowser(request.getUrl())).show();
                }
                return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (CompanionPolicy.sameOrigin(origin, request.getUrl().toString())) return null;
                return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                if (view != web) return;
                pageFailed = false; retryablePageFailure = false; connection.setText("Connecting…");
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (view != web) return;
                if (CompanionPolicy.sameOrigin(origin, url) && !pageFailed) {
                    view.evaluateJavascript(adapter, null);
                    pendingPageUrl = origin + "/"; // Never retain a consumed invitation for a later retry.
                    dismissConnectionError();
                    connection.setText("Private desktop"); CookieManager.getInstance().flush();
                }
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
                if (view != web) return;
                pageFailed = true;
                retryablePageFailure = false;
                showConnectionError("The desktop certificate is not trusted. Check its HTTPS setup. Certificate checks cannot be bypassed.");
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (view != web) return;
                if (request.isForMainFrame()) {
                    pageFailed = true;
                    int code = error.getErrorCode();
                    retryablePageFailure = code == ERROR_HOST_LOOKUP || code == ERROR_CONNECT || code == ERROR_TIMEOUT || code == ERROR_IO;
                    showConnectionError("Cannot reach the desktop. Use Connect Tailscale, then return here. The desktop must be awake with Mobile companion started.");
                }
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (view != web) return;
                if (request.isForMainFrame() && response.getStatusCode() >= 400) {
                    pageFailed = true; retryablePageFailure = false;
                    showConnectionError("Desktop returned " + response.getStatusCode() + ". Check that Mobile companion is running.");
                }
            }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                if (view != web) return true;
                disposeWeb(); showSetup("The Android web renderer stopped. Reconnect to recover your desktop jobs."); return true;
            }
        });
        web.setDownloadListener((url, agent, disposition, mime, length) -> {
            try {
                if (!CompanionPolicy.sameOrigin(origin, url)) throw new IllegalArgumentException();
                URI parsed = new URI(url);
                transfer(parsed.getRawPath() + (parsed.getRawQuery() == null ? "" : "?" + parsed.getRawQuery()), false);
            } catch (Exception failure) { toast("Only companion gallery images can be downloaded here."); }
        });
        root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        pageFailed = false; retryablePageFailure = false;
        pendingPageUrl = origin + "/" + launchFragment;
        web.loadUrl(pendingPageUrl);
        launchFragment = "";
        root.post(this::maybeConnectTailscale);
    }

    private void dismissConnectionError() {
        if (connectionDialog != null) { connectionDialog.dismiss(); connectionDialog = null; }
    }
    private void showConnectionError(String message) {
        connectionError = message;
        connection.setText("Desktop unavailable"); progress.setVisibility(View.GONE);
        if (!resumed || returningFromTailscale || recovery.active(SystemClock.elapsedRealtime())) return;
        if (connectionDialog != null && connectionDialog.isShowing()) return;
        connectionDialog = new AlertDialog.Builder(this).setTitle("Connection unavailable").setMessage(message)
            .setNegativeButton("Connection settings", (dialog, which) -> showSetup(""))
            .setNeutralButton("Connect Tailscale", (dialog, which) -> openTailscale(false))
            .setPositiveButton("Retry", (dialog, which) -> retryMainPage()).show();
    }
    private void showMenu(View anchor) {
        PopupMenu menu = new PopupMenu(this, anchor);
        menu.getMenu().add("Connect Tailscale");
        menu.getMenu().add("Connect Tailscale automatically").setCheckable(true).setChecked(automaticTailscale());
        menu.getMenu().add("Connection settings"); menu.getMenu().add("Reload companion");
        menu.getMenu().add("Open in browser"); menu.getMenu().add("Forget this desktop");
        menu.setOnMenuItemClickListener(item -> {
            switch (item.getTitle().toString()) {
                case "Connect Tailscale" -> openTailscale(false);
                case "Connect Tailscale automatically" -> {
                    boolean enabled = !item.isChecked(); item.setChecked(enabled);
                    getPreferences(MODE_PRIVATE).edit().putBoolean("automaticTailscale", enabled).apply();
                    if (enabled) maybeConnectTailscale();
                }
                case "Connection settings" -> showSetup("");
                case "Reload companion" -> new AlertDialog.Builder(this).setTitle("Reload companion?")
                    .setMessage("Unsent text will be lost. Accepted desktop jobs keep running.").setNegativeButton("Cancel", null)
                    .setPositiveButton("Reload", (dialog, which) -> { if (web != null) web.reload(); }).show();
                case "Open in browser" -> openBrowser(Uri.parse(origin));
                case "Forget this desktop" -> new AlertDialog.Builder(this).setTitle("Forget this desktop?")
                    .setMessage("This clears the saved address and local pairing. Revoke this device in the desktop panel to remove its server authorization. Downloaded images remain on your phone.")
                    .setNegativeButton("Cancel", null).setPositiveButton("Forget", (dialog, which) -> {
                        disposeWeb(); WebStorage.getInstance().deleteAllData();
                        CookieManager.getInstance().removeAllCookies(done -> {
                            CookieManager.getInstance().flush(); getPreferences(MODE_PRIVATE).edit().clear().apply(); origin = null; showSetup("");
                        });
                    }).show();
                default -> { return false; }
            }
            return true;
        }); menu.show();
    }
    private void openBrowser(Uri uri) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
        catch (android.content.ActivityNotFoundException error) { toast("No browser is available."); }
    }
    private void toast(String value) { Toast.makeText(this, value, Toast.LENGTH_LONG).show(); }

    private boolean automaticTailscale() { return getPreferences(MODE_PRIVATE).getBoolean("automaticTailscale", true); }

    private TailscalePolicy.VpnState vpnState() {
        try {
            ConnectivityManager manager = getSystemService(ConnectivityManager.class);
            if (manager == null) return TailscalePolicy.VpnState.UNKNOWN;
            // Tailscale can be split-tunnel; checking only the default network is insufficient.
            for (Network network : manager.getAllNetworks()) {
                NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
                if (capabilities != null && capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) return TailscalePolicy.VpnState.ACTIVE;
            }
            return TailscalePolicy.VpnState.NONE;
        } catch (RuntimeException error) { return TailscalePolicy.VpnState.UNKNOWN; }
    }

    private void maybeConnectTailscale() {
        if (!resumed || web == null || returningFromTailscale || isFinishing() || isDestroyed()) return;
        if (tailscalePolicy.shouldConnect(origin, automaticTailscale(), vpnState(), SystemClock.elapsedRealtime())) openTailscale(true);
    }

    private void openTailscale(boolean automatic) {
        if (!resumed || returningFromTailscale) return;
        long now = SystemClock.elapsedRealtime();
        tailscalePolicy.recordAttempt(now);
        getPreferences(MODE_PRIVATE).edit().putLong("tailscaleLastAttempt", now).apply();
        Intent launch = getPackageManager().getLaunchIntentForPackage(TAILSCALE_PACKAGE);
        dismissConnectionError();
        if (launch == null) {
            new AlertDialog.Builder(this).setTitle("Tailscale is needed")
                .setMessage("Install Tailscale and sign in with your desktop account, then return to Companion. You can turn off automatic connection in Connection options.")
                .setNegativeButton("Later", null)
                .setPositiveButton("Installation help", (dialog, which) -> openBrowser(Uri.parse("https://tailscale.com/docs/install/android"))).show();
            return;
        }
        TailscalePolicy.VpnState vpn = vpnState();
        // Android does not identify another app's VPN owner. Never automatically replace an active VPN.
        if (automatic && vpn != TailscalePolicy.VpnState.NONE) return;
        boolean canRequest = false;
        try {
            android.content.pm.ActivityInfo receiver = getPackageManager().getReceiverInfo(TAILSCALE_RECEIVER, 0);
            canRequest = receiver.enabled && receiver.exported && vpn == TailscalePolicy.VpnState.NONE;
        } catch (android.content.pm.PackageManager.NameNotFoundException ignored) { /* Older app: open its own controls. */ }
        try {
            returningFromTailscale = true;
            startActivity(launch);
            if (canRequest) {
                // Official Tailscale receiver; no address, credentials or pairing token leave Companion.
                sendBroadcast(new Intent("com.tailscale.ipn.CONNECT_VPN").setComponent(TAILSCALE_RECEIVER));
                toast("Tailscale connection requested. Return to Companion after it connects.");
            } else toast("Check the connection in Tailscale, then return to Companion.");
        } catch (RuntimeException error) {
            returningFromTailscale = false;
            toast("Open Tailscale from your phone's app list, connect, then return here.");
        }
    }

    private void retryMainPage() {
        if (web == null || origin == null) return;
        dismissConnectionError();
        pageFailed = false; retryablePageFailure = false;
        web.loadUrl(pendingPageUrl != null && CompanionPolicy.sameOrigin(origin, pendingPageUrl) ? pendingPageUrl : origin + "/");
    }

    private void recoverConnection() {
        if (!resumed || web == null || isDestroyed()) return;
        long now = SystemClock.elapsedRealtime();
        TailscalePolicy.VpnState vpn = vpnState();
        tailscalePolicy.shouldConnect(origin, false, vpn, now); // Observe VPN recovery without issuing another request.
        if (!recovery.active(now)) {
            recovery.stop();
            if (pageFailed) showConnectionError(connectionError);
            return;
        }
        if (recovery.retry(now, pageFailed, retryablePageFailure, vpn == TailscalePolicy.VpnState.ACTIVE)) {
            retryMainPage();
        }
        // Only a failed main document is reloaded; a live page keeps drafts and refreshes through pageshow.
        connectionHandler.postDelayed(recoverConnection, 1_000);
    }

    private void transfer(String requestedPath, boolean share) {
        final String path;
        try { path = CompanionPolicy.mediaPath(requestedPath); }
        catch (IllegalArgumentException error) { toast(error.getMessage()); return; }
        if (!transferring.compareAndSet(false, true)) { toast("An image transfer is already in progress."); return; }
        final String transferOrigin = origin;
        final String cookie = CookieManager.getInstance().getCookie(origin + path);
        if (cookie == null || cookie.isEmpty()) { transferring.set(false); toast("Pair this app with the desktop first."); return; }
        toast(share ? "Preparing original image…" : "Saving original image…");
        transfers.execute(() -> {
            HttpsURLConnection request = null; File file = null;
            try {
                request = (HttpsURLConnection) new URI(transferOrigin + path).toURL().openConnection();
                request.setInstanceFollowRedirects(false); request.setUseCaches(false);
                request.setConnectTimeout(15000); request.setReadTimeout(30000);
                request.setRequestProperty("Cookie", cookie); request.setRequestProperty("Origin", transferOrigin);
                request.setRequestProperty("X-LAW-Mobile", "1");
                if (request.getResponseCode() != 200) throw new IllegalStateException("Image unavailable. Reconnect or pair again, then retry.");
                String mime = request.getContentType();
                if (mime == null) throw new IllegalStateException("The desktop returned an unknown image type.");
                mime = mime.split(";", 2)[0].trim().toLowerCase(java.util.Locale.ROOT);
                String name = CompanionPolicy.safeName(URLUtil.guessFileName(transferOrigin + path, request.getHeaderField("Content-Disposition"), mime), mime);
                if (request.getContentLengthLong() > MAX_IMAGE_BYTES) throw new IllegalStateException("This image exceeds the app's 64 MB transfer limit.");
                File folder = new File(getCacheDir(), "shared-images");
                if (!folder.isDirectory() && !folder.mkdirs()) throw new IllegalStateException("Cannot create image cache.");
                file = new File(folder, UUID.randomUUID() + "-" + name);
                long deadline = System.nanoTime() + 180_000_000_000L;
                try (InputStream input = request.getInputStream(); OutputStream output = new FileOutputStream(file)) {
                    byte[] buffer = new byte[65536]; long total = 0; int count;
                    while ((count = input.read(buffer)) != -1) {
                        total += count;
                        if (total > MAX_IMAGE_BYTES || Thread.currentThread().isInterrupted() || System.nanoTime() > deadline) throw new IllegalStateException("Transfer limit reached. Try again.");
                        output.write(buffer, 0, count);
                    }
                    if (total == 0) throw new IllegalStateException("The desktop returned an empty image.");
                }
                if (share) {
                    File shared = file; String type = mime;
                    runOnUiThread(() -> {
                        if (isDestroyed() || isFinishing() || !transferOrigin.equals(origin)) return;
                        Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".files", shared);
                        Intent intent = new Intent(Intent.ACTION_SEND).setType(type).putExtra(Intent.EXTRA_STREAM, uri);
                        intent.setClipData(ClipData.newRawUri("Original image", uri));
                        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        try { startActivity(Intent.createChooser(intent, "Share original image")); }
                        catch (android.content.ActivityNotFoundException error) { toast("No sharing app is available. Use Download original."); }
                    });
                    file = null; // Retain briefly for the receiving app; cleanup is bounded to this cache folder.
                } else {
                    saveDownload(file, name, mime);
                    runOnUiThread(() -> { if (!isDestroyed()) toast("Saved to Downloads / Workstation."); });
                }
            } catch (Exception error) {
                String message = error instanceof IllegalStateException || error instanceof IllegalArgumentException ? error.getMessage() : "Image transfer failed. Check the private connection and try again.";
                runOnUiThread(() -> { if (!isDestroyed()) toast(message); });
            } finally {
                if (request != null) request.disconnect();
                if (file != null) file.delete();
                transferring.set(false);
            }
        });
    }

    private void saveDownload(File file, String name, String mime) throws Exception {
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, name); values.put(MediaStore.Downloads.MIME_TYPE, mime);
        values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Workstation");
        values.put(MediaStore.Downloads.IS_PENDING, 1);
        Uri target = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (target == null) throw new IllegalStateException("Could not create the download.");
        try {
            try (InputStream input = new FileInputStream(file); OutputStream output = getContentResolver().openOutputStream(target)) {
                if (output == null) throw new IllegalStateException("Could not write the download.");
                copy(input, output);
            }
            ContentValues ready = new ContentValues(); ready.put(MediaStore.Downloads.IS_PENDING, 0);
            getContentResolver().update(target, ready, null, null);
        } catch (Exception error) { getContentResolver().delete(target, null, null); throw error; }
    }
    private void clearOldShares() {
        File[] files = new File(getCacheDir(), "shared-images").listFiles();
        if (files != null) for (File file : files) if (file.isFile() && file.lastModified() < System.currentTimeMillis() - 86400000L) file.delete();
    }
    private static void copy(InputStream input, OutputStream output) throws java.io.IOException {
        byte[] buffer = new byte[65536]; int count;
        while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
    }
    private void handleBack() {
        if (web == null) { if (origin != null) openCompanion(); else moveTaskToBack(true); return; }
        web.evaluateJavascript("(()=>{const d=document.querySelector('dialog[open]');if(!d)return false;d.dispatchEvent(new Event('cancel',{cancelable:true}));return true})()", result -> {
            if (!"true".equals(result)) { if (web != null && web.canGoBack()) web.goBack(); else moveTaskToBack(true); }
        });
    }
    // Android 13+ uses the registered OnBackInvokedCallback in onCreate.
    // This override is the fallback for Android 10-12 only.
    @SuppressLint("GestureBackNavigation")
    @Override public void onBackPressed() { handleBack(); }
    @Override protected void onSaveInstanceState(Bundle state) {
        state.putBoolean("tailscaleAttempted", tailscalePolicy.attemptedWithoutVpn());
        state.putBoolean("tailscaleReturn", returningFromTailscale);
        super.onSaveInstanceState(state);
    }
    @Override public void onPause() {
        resumed = false; connectionHandler.removeCallbacks(recoverConnection);
        if (web != null) { web.evaluateJavascript("window.dispatchEvent(new Event('law-background'))", null); web.onPause(); }
        CookieManager.getInstance().flush(); super.onPause();
    }
    @Override public void onResume() {
        super.onResume(); resumed = true;
        if (web != null) { web.onResume(); web.evaluateJavascript("window.dispatchEvent(new Event('pageshow'))", null); }
        if (returningFromTailscale) {
            returningFromTailscale = false;
            recovery.start(SystemClock.elapsedRealtime());
        } else {
            root.post(this::maybeConnectTailscale);
            if (pageFailed && web != null) {
                if (retryablePageFailure) recovery.start(SystemClock.elapsedRealtime());
                else showConnectionError(connectionError);
            }
        }
        if (recovery.running()) connectionHandler.post(recoverConnection);
    }
    @Override public void onDestroy() { connectionHandler.removeCallbacksAndMessages(null); disposeWeb(); transfers.shutdownNow(); super.onDestroy(); }
}
