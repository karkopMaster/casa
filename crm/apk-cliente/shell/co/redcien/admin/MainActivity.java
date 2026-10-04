package co.redcien.admin;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.DownloadListener;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/**
 * Armazón de la app del CLIENTE: una sola pantalla con el portal, sin barras ni menús propios
 * (el portal trae su propio menú). La dirección sale de assets/url.txt, que escribe gen-apk.sh.
 * Se llama co.redcien.admin.MainActivity para que el manifiesto del cliente no cambie.
 */
public class MainActivity extends Activity {
    private WebView web;
    private String inicio = "";
    private String host = "";

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        try { if (getActionBar() != null) getActionBar().hide(); } catch (Throwable t) { /* sin barra */ }
        try {
            InputStream in = getAssets().open("url.txt");
            ByteArrayOutputStream o = new ByteArrayOutputStream();
            byte[] buf = new byte[256];
            int n;
            while ((n = in.read(buf)) > 0) o.write(buf, 0, n);
            in.close();
            inicio = o.toString("UTF-8").trim();
            host = Uri.parse(inicio).getHost();
        } catch (Exception e) { inicio = ""; }

        web = new WebView(this);
        web.setLayoutParams(new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        web.setBackgroundColor(0xFFF2FBF5);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if ("https".equals(u.getScheme()) && u.getHost() != null && u.getHost().equals(host)) return false;
                try {
                    Intent i = new Intent(Intent.ACTION_VIEW, u);
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i);
                } catch (Exception e) { /* nadie lo abre */ }
                return true;
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (!r.isForMainFrame()) return;
                v.loadDataWithBaseURL(null,
                    "<html><body style='font-family:sans-serif;text-align:center;padding:48px 24px;background:#f2fbf5;color:#14532d'>"
                    + "<h2>Sin conexión</h2><p>Revisa tu internet e intenta de nuevo.</p>"
                    + "<p><a href='" + inicio + "' style='display:inline-block;padding:12px 24px;border-radius:12px;background:#16a34a;color:#fff;text-decoration:none'>Reintentar</a></p>"
                    + "</body></html>", "text/html", "UTF-8", null);
            }
        });
        web.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String ua, String cd, String mime, long len) {
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception e) { /* sin app */ }
            }
        });
        setContentView(web);
        if (b != null) web.restoreState(b); else if (inicio.length() > 0) web.loadUrl(inicio);
    }

    @Override
    protected void onSaveInstanceState(Bundle b) {
        super.onSaveInstanceState(b);
        if (web != null) web.saveState(b);
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
}
