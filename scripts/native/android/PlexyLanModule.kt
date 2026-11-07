package __PACKAGE__

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager
import java.net.Inet4Address
import java.net.InetAddress
import java.net.URI
import java.security.KeyStore
import java.security.MessageDigest
import java.security.Provider
import java.security.Security
import java.security.cert.CertificateException
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.util.concurrent.Executors
import javax.net.ssl.*

/** Installed before networking modules initialize. Covers RN/Fresco, Expo Video
 * and Expo FileSystem, including clients they construct independently. */
object PlexyLanTrust {
  private lateinit var context: Context
  lateinit var system: X509TrustManager
  private val pins get() = context.getSharedPreferences("plexy.lan.certificates", Context.MODE_PRIVATE)
  fun fingerprint(cert: X509Certificate): String = MessageDigest.getInstance("SHA-256").digest(cert.encoded).joinToString(":") { "%02X".format(it.toInt() and 255) }
  @Synchronized fun install(app: Context) {
    if (::context.isInitialized) return
    context = app.applicationContext
    val factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
    // Build an explicit system-root store. Android's per-domain network-security
    // RootTrustManager requires a hostname for its two-argument method; passing
    // that manager through an independent OkHttp client would break normal TLS.
    val androidRoots = KeyStore.getInstance("AndroidCAStore").apply { load(null) }
    val roots = KeyStore.getInstance(KeyStore.getDefaultType()).apply { load(null) }
    for (alias in java.util.Collections.list(androidRoots.aliases())) {
      if (!alias.startsWith("user:")) roots.setCertificateEntry(alias, androidRoots.getCertificate(alias))
    }
    factory.init(roots)
    system = factory.trustManagers.filterIsInstance<X509TrustManager>().first()
    val provider = object : Provider("PlexyLanTrust", 1.0, "System roots plus explicitly approved Plexy LAN certificates") {}
    val spi = PlexyLanTrustFactory::class.java.name
    provider.put("TrustManagerFactory.PKIX", spi)
    provider.put("TrustManagerFactory.X509", spi)
    provider.put("Alg.Alias.TrustManagerFactory.X.509", "X509")
    Security.insertProviderAt(provider, 1)
  }
  fun trusted(cert: X509Certificate): Boolean = pins.getString(fingerprint(cert), null) == Base64.encodeToString(cert.encoded, Base64.NO_WRAP)
  fun approve(cert: X509Certificate) {
    cert.checkValidity()
    if (!pins.edit().putString(fingerprint(cert), Base64.encodeToString(cert.encoded, Base64.NO_WRAP)).commit()) throw IllegalStateException("Could not save certificate trust")
  }
  fun forget(fingerprint: String) { pins.edit().remove(fingerprint).commit() }
  fun certificates(): Array<X509Certificate> = pins.all.values.mapNotNull { value ->
    try { CertificateFactory.getInstance("X.509").generateCertificate(Base64.decode(value as String, Base64.NO_WRAP).inputStream()) as X509Certificate } catch (_: Exception) { null }
  }.toTypedArray()
}

class PlexyLanTrustFactory : TrustManagerFactorySpi() {
  override fun engineInit(store: KeyStore?) {}
  override fun engineInit(parameters: ManagerFactoryParameters?) {}
  override fun engineGetTrustManagers(): Array<TrustManager> = arrayOf(PlexyLanTrustManager())
}
class PlexyLanTrustManager : X509TrustManager {
  override fun getAcceptedIssuers(): Array<X509Certificate> = PlexyLanTrust.system.acceptedIssuers + PlexyLanTrust.certificates()
  override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) = PlexyLanTrust.system.checkClientTrusted(chain, authType)
  override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
    // Only the exact explicitly approved leaf bypasses public-CA validation.
    val pinned = chain.firstOrNull()?.let { PlexyLanTrust.trusted(it) } == true
    if (pinned) { chain[0].checkValidity(); return }
    PlexyLanTrust.system.checkServerTrusted(chain, authType)
  }
}

class PlexyLanPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(PlexyLanModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}

class PlexyLanModule(private val app: ReactApplicationContext) : ReactContextBaseJavaModule(app) {
  private val worker = Executors.newCachedThreadPool()
  private val handler = Handler(Looper.getMainLooper())
  private var stopDiscovery: (() -> Unit)? = null
  // Inspection never sends an HTTP request, cookies, password, or Bearer token.
  private val inspected = java.util.concurrent.ConcurrentHashMap<String, X509Certificate>()
  override fun getName() = "PlexyLan"
  private fun local(host: String): Boolean {
    if (host.equals("localhost", true)) return true
    return try {
      val addresses = InetAddress.getAllByName(host.removeSurrounding("[", "]"))
      addresses.isNotEmpty() && addresses.all { it.isLoopbackAddress || it.isSiteLocalAddress || it.isLinkLocalAddress }
    } catch (_: Exception) { false }
  }
  private fun matches(cert: X509Certificate, host: String): Boolean {
    val name = host.removeSurrounding("[", "]").lowercase()
    val ip = name.contains(':') || name.matches(Regex("[0-9.]+"))
    return cert.subjectAlternativeNames?.any { san ->
      val type = san[0] as? Int
      val value = (san[1] as? String)?.lowercase() ?: return@any false
      if (ip && type == 7) try { InetAddress.getByName(value) == InetAddress.getByName(name) } catch (_: Exception) { false }
      else !ip && type == 2 && (value == name || (value.startsWith("*.") && name.substringAfter('.') == value.substring(2)))
    } == true
  }
  private fun inspect(value: String): WritableMap {
    val uri = URI(value)
    val host = uri.host ?: throw IllegalArgumentException("Enter a server hostname or IP address.")
    require(uri.scheme == "https" && uri.userInfo == null && uri.rawQuery == null && uri.fragment == null) { "Use an HTTPS server address without credentials." }
    require(local(host)) { "Local certificate approval is only available for servers on a private network. Use a trusted HTTPS certificate for remote servers." }
    val port = if (uri.port > 0) uri.port else 443
    val capture = object : X509TrustManager {
      override fun getAcceptedIssuers() = emptyArray<X509Certificate>()
      override fun checkClientTrusted(chain: Array<X509Certificate>, auth: String) { throw CertificateException("Inspection only") }
      override fun checkServerTrusted(chain: Array<X509Certificate>, auth: String) {}
    }
    val ssl = SSLContext.getInstance("TLS").apply { init(null, arrayOf<TrustManager>(capture), null) }
    val socket = ssl.socketFactory.createSocket() as SSLSocket
    try {
      socket.soTimeout = 3500
      socket.connect(java.net.InetSocketAddress(host, port), 3500)
      socket.startHandshake()
      val chain = socket.session.peerCertificates.map { it as X509Certificate }.toTypedArray()
      val cert = chain.first(); cert.checkValidity()
      require(matches(cert, host)) { "The server certificate does not match this address. Restart Plexy Server to refresh its LAN certificate, or use the hostname on the certificate." }
      val base = "https://${if (host.contains(':') && !host.startsWith('[')) "[$host]" else host}:$port"
      inspected[base] = cert
      var trusted = PlexyLanTrust.trusted(cert)
      if (!trusted) try { PlexyLanTrust.system.checkServerTrusted(chain, cert.publicKey.algorithm); trusted = true } catch (_: Exception) {}
      return Arguments.createMap().apply {
        putString("url", base); putString("fingerprint", PlexyLanTrust.fingerprint(cert))
        putString("subject", cert.subjectX500Principal.name); putString("validTo", cert.notAfter.toInstant().toString())
        putBoolean("trusted", trusted)
      }
    } finally { socket.close() }
  }
  @ReactMethod fun inspectServer(value: String, promise: Promise) {
    worker.execute {
      try {
        val input = URI(value)
        if (input.scheme == "https") { promise.resolve(inspect(value)); return@execute }
        require(input.scheme == "http" && input.userInfo == null && input.rawQuery == null && input.fragment == null && input.host != null && local(input.host)) { "Use HTTPS for remote servers." }
        // The loopback HTTP listener and LAN HTTPS listener use adjacent ports.
        // Try the entered port first, then the normal server HTTPS port. Never
        // send credentials or downgrade to LAN cleartext.
        val port = if (input.port > 0) input.port else 80
        var last: Exception? = null
        for (candidate in listOf(port, port + 1).filter { it in 1..65535 }) {
          try { promise.resolve(inspect(URI("https", null, input.host, candidate, null, null, null).toString())); return@execute }
          catch (e: Exception) { last = e }
        }
        throw IllegalStateException("Could not find HTTPS on this address. Enable LAN access on Plexy Server and use its HTTPS port (normally the local port + 1).", last)
      } catch (e: Exception) { promise.reject("LAN_TLS", e.message ?: "Could not inspect this local server.") }
    }
  }
  @ReactMethod fun trustServer(value: String, fingerprint: String, promise: Promise) {
    worker.execute {
      try {
        val cert = inspected[value] ?: throw IllegalStateException("Inspect this server again before approving it.")
        require(PlexyLanTrust.fingerprint(cert) == fingerprint) { "The certificate changed. Inspect it again." }
        // Re-inspect before persisting to catch a replacement during confirmation.
        val fresh = inspect(value)
        require(fresh.getString("fingerprint") == fingerprint) { "The server certificate changed. Compare its fingerprint again." }
        PlexyLanTrust.approve(cert)
        promise.resolve(null)
      } catch (e: Exception) { promise.reject("LAN_TRUST", e.message) }
    }
  }
  @ReactMethod fun forgetCertificate(fingerprint: String, promise: Promise) { PlexyLanTrust.forget(fingerprint); promise.resolve(null) }

  @ReactMethod fun cancelDiscovery() { handler.post { stopDiscovery?.invoke() } }
  @Suppress("DEPRECATION")
  @ReactMethod fun discoverServers(promise: Promise) { handler.post {
    stopDiscovery?.invoke()
    val manager = app.getSystemService(Context.NSD_SERVICE) as? NsdManager
    if (manager == null) { promise.reject("LAN_DISCOVERY", "Network discovery is unavailable on this device. Enter the server address manually."); return@post }
    val wifi = app.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
    val lock = try { wifi?.createMulticastLock("plexy-discovery")?.apply { setReferenceCounted(false); acquire() } } catch (_: SecurityException) { null }
    val found = linkedMapOf<String, WritableMap>()
    val queue = java.util.ArrayDeque<NsdServiceInfo>()
    val queued = hashSetOf<String>()
    var resolving = false; var stopped = false; var started = false
    lateinit var listener: NsdManager.DiscoveryListener
    fun finish(error: String? = null) {
      if (stopped) return
      stopped = true
      if (started) try { manager.stopServiceDiscovery(listener) } catch (_: Exception) {}
      if (lock?.isHeld == true) lock.release()
      stopDiscovery = null
      if (error != null) promise.reject("LAN_DISCOVERY", error)
      else promise.resolve(Arguments.createArray().apply { found.values.forEach { pushMap(it) } })
    }
    fun resolveNext() {
      if (stopped || resolving || queue.isEmpty()) return
      resolving = true
      val service = queue.removeFirst()
      try { manager.resolveService(service, object : NsdManager.ResolveListener {
        override fun onResolveFailed(info: NsdServiceInfo, code: Int) { handler.post { resolving = false; resolveNext() } }
        override fun onServiceResolved(info: NsdServiceInfo) { handler.post {
          if (stopped) return@post
          val addresses = if (Build.VERSION.SDK_INT >= 34) info.hostAddresses else listOfNotNull(info.host)
          val ipv4 = addresses.filterIsInstance<Inet4Address>()
          val host = (ipv4.firstOrNull { it.isSiteLocalAddress || it.isLinkLocalAddress } ?: ipv4.firstOrNull())?.hostAddress
          if (host != null && info.port > 0) {
            val txt = info.attributes
            val id = txt["id"]?.toString(Charsets.UTF_8) ?: "${info.serviceName}:$host:${info.port}"
            val secure = txt["tls"]?.toString(Charsets.UTF_8) != "0"
            found[id] = Arguments.createMap().apply {
              putString("id", id); putString("name", info.serviceName)
              putString("url", "${if (secure) "https" else "http"}://$host:${info.port}")
            }
          }
          resolving = false; resolveNext()
        } }
      }) } catch (_: Exception) { resolving = false; resolveNext() }
    }
    listener = object : NsdManager.DiscoveryListener {
      override fun onDiscoveryStarted(type: String) { handler.post { started = true; if (stopped) try { manager.stopServiceDiscovery(this) } catch (_: Exception) {} } }
      override fun onServiceFound(info: NsdServiceInfo) { handler.post {
        if (!stopped && info.serviceType.trimEnd('.') == "_plexy._tcp" && queued.add(info.serviceName)) { queue.add(info); resolveNext() }
      } }
      override fun onServiceLost(info: NsdServiceInfo) {}
      override fun onDiscoveryStopped(type: String) {}
      override fun onStartDiscoveryFailed(type: String, code: Int) { handler.post { finish("Could not search this network ($code). Check Wi-Fi and LAN access on Plexy Server.") } }
      override fun onStopDiscoveryFailed(type: String, code: Int) {}
    }
    stopDiscovery = { finish() }
    try { manager.discoverServices("_plexy._tcp.", NsdManager.PROTOCOL_DNS_SD, listener); handler.postDelayed({ finish() }, 8000) }
    catch (_: Exception) { finish("Network discovery is unavailable. Enter your server address manually.") }
  } }
  override fun invalidate() { handler.post { stopDiscovery?.invoke() }; worker.shutdownNow(); super.invalidate() }
}
