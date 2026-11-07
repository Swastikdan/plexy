import app.plexy.mobile.PlexyLanTrust;
import app.plexy.mobile.PlexyLanTrustFactory;
import android.content.Context;
import android.content.SharedPreferences;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.security.cert.X509Certificate;
import java.util.*;
import javax.net.ssl.*;
import okhttp3.*;

/** Runs the actual compiled Kotlin trust classes against independent OkHttp
 * clients and real local TLS sockets. Android storage is adapted in memory. */
public class LanTlsIntegration {
  static class MemoryPreferences implements SharedPreferences, SharedPreferences.Editor {
    final Map<String,String> values = new HashMap<>();
    public String getString(String key, String fallback) { return values.getOrDefault(key, fallback); }
    public Map<String, ?> getAll() { return values; }
    public Editor edit() { return this; }
    public Editor putString(String key, String value) { values.put(key, value); return this; }
    public Editor remove(String key) { values.remove(key); return this; }
    public boolean commit() { return true; }
  }
  static class TestContext extends Context {
    final MemoryPreferences prefs = new MemoryPreferences();
    public SharedPreferences getSharedPreferences(String name, int mode) { return prefs; }
  }
  static class LocalServer implements AutoCloseable {
    final SSLServerSocket server;
    final X509Certificate certificate;
    final Thread thread;
    volatile boolean closed;
    LocalServer(Path keyStoreFile) throws Exception {
      KeyStore keys = KeyStore.getInstance("PKCS12");
      try (InputStream file = Files.newInputStream(keyStoreFile)) { keys.load(file, "local-test-only".toCharArray()); }
      certificate = (X509Certificate) keys.getCertificate("server");
      KeyManagerFactory keyManagers = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
      keyManagers.init(keys, "local-test-only".toCharArray());
      SSLContext tls = SSLContext.getInstance("TLS"); tls.init(keyManagers.getKeyManagers(), null, null);
      server = (SSLServerSocket) tls.getServerSocketFactory().createServerSocket(0, 20, InetAddress.getByName("127.0.0.1"));
      thread = new Thread(() -> {
        while (!closed) {
          try (SSLSocket socket = (SSLSocket)server.accept()) {
            socket.setSoTimeout(3000); socket.startHandshake();
            BufferedReader in = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.US_ASCII));
            String line; while ((line = in.readLine()) != null && !line.isEmpty()) {}
            socket.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok".getBytes(StandardCharsets.US_ASCII));
          } catch (Exception expectedRejectedHandshake) {}
        }
      }); thread.setDaemon(true); thread.start();
    }
    String url(String host) { return "https://" + host + ":" + server.getLocalPort() + "/"; }
    public void close() throws Exception { closed = true; server.close(); thread.join(1000); }
  }
  static boolean request(OkHttpClient client, String url) {
    try (Response response = client.newCall(new Request.Builder().url(url).header("Connection", "close").build()).execute()) { return response.code() == 200 && "ok".equals(response.body().string()); }
    catch (IOException rejected) { return false; }
  }
  static void check(boolean value, String description) { if (!value) throw new AssertionError(description); System.out.println("PASS " + description); }
  public static void main(String[] args) throws Exception {
    try (LocalServer local = new LocalServer(Path.of(args[0])); LocalServer replacement = new LocalServer(Path.of(args[1]))) {
      // Platform roots still delegate normally. Add an unrelated fixture root
      // to the test platform store, while the local Plexy leaf stays untrusted.
      KeyStore roots = KeyStore.getInstance(KeyStore.getDefaultType()); roots.load(null);
      roots.setCertificateEntry("platform-fixture", replacement.certificate);
      TrustManagerFactory platform = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()); platform.init(roots);
      PlexyLanTrust.INSTANCE.setSystem((X509TrustManager)platform.getTrustManagers()[0]);
      var field = PlexyLanTrust.class.getDeclaredField("context"); field.setAccessible(true); field.set(null, new TestContext());
      Provider provider = new Provider("PlexyLanIntegration", 1.0, "Test the production Kotlin factory") {};
      provider.put("TrustManagerFactory.PKIX", PlexyLanTrustFactory.class.getName());
      provider.put("TrustManagerFactory.X509", PlexyLanTrustFactory.class.getName());
      Security.insertProviderAt(provider, 1);
      OkHttpClient beforeApproval = new OkHttpClient.Builder().connectTimeout(java.time.Duration.ofSeconds(3)).readTimeout(java.time.Duration.ofSeconds(3)).build();
      check(!request(beforeApproval, local.url("localhost")), "unapproved self-signed certificate is rejected");
      PlexyLanTrust.INSTANCE.approve(local.certificate);
      check(request(beforeApproval, local.url("localhost")), "existing API/image client accepts the explicitly approved certificate");
      OkHttpClient independent = new OkHttpClient.Builder().build();
      check(request(independent, local.url("localhost")), "independent video/download-style client uses the same approved trust");
      check(request(independent, replacement.url("localhost")), "ordinary platform certificate trust is preserved");
      check(!request(independent, local.url("127.0.0.1")), "hostname verification remains enabled after certificate approval");
      PlexyLanTrust.INSTANCE.forget(PlexyLanTrust.INSTANCE.fingerprint(local.certificate));
      check(!request(new OkHttpClient.Builder().build(), local.url("localhost")), "forgetting approval rejects the local certificate again");
      Security.removeProvider(provider.getName());
    }
  }
}
