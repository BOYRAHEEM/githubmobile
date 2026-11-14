package expo.modules.runner

import android.system.Os
import org.apache.commons.compress.archivers.tar.TarArchiveEntry
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.gzip.GzipCompressorInputStream
import org.apache.commons.compress.compressors.xz.XZCompressorInputStream
import java.io.BufferedInputStream
import java.io.File
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Downloads and unpacks the Linux root filesystem, then applies the small
 * tweaks needed for it to work under proot on Android.
 *
 * Progress is reported through [onProgress] as (phase, done, total, message).
 */
class Bootstrapper(
  private val env: Environment,
  private val onProgress: (phase: String, done: Long, total: Long, message: String) -> Unit,
) {

  /** @param sha256 expected hex digest of the archive; checked when given. */
  fun install(url: String, sha256: String?) {
    val archive = File(env.filesDir, "rootfs-download" + archiveSuffix(url))
    try {
      val actual = download(url, archive)
      if (sha256 != null && !actual.equals(sha256, ignoreCase = true)) {
        throw IllegalStateException("The Linux image failed its checksum. Try again on a stable connection.")
      }
      if (env.filesDir.usableSpace < archive.length() * 5) {
        throw IllegalStateException("Not enough free space on the phone (need about ${archive.length() * 5 / 1_000_000} MB).")
      }
      // Start from a clean folder so a failed earlier attempt can't leave junk.
      if (SafeFiles.existsNoFollow(env.rootfsDir)) SafeFiles.deleteTree(env.rootfsDir)
      env.rootfsDir.mkdirs()
      extract(archive, env.rootfsDir)
      configure()
      env.markRootfsReady()
      onProgress("done", 1, 1, "Linux environment ready")
    } finally {
      archive.delete()
    }
  }

  // ---------------------------------------------------------------- download

  /** Downloads [url] to [target] and returns its SHA-256 as hex. */
  private fun download(url: String, target: File): String {
    onProgress("download", 0, -1, "Connecting…")
    fun open(u: String) = (URL(u).openConnection() as HttpURLConnection).apply {
      connectTimeout = 20_000
      readTimeout = 60_000 // a stalled connection fails instead of hanging forever
    }
    var conn = open(url)
    // Follow redirects manually (GitHub release assets redirect across hosts).
    var hops = 0
    while (conn.responseCode in 300..399 && hops++ < 5) {
      val next = conn.getHeaderField("Location")
      conn.disconnect()
      conn = open(next)
    }
    if (conn.responseCode !in 200..299) {
      throw IllegalStateException("Download failed: HTTP ${conn.responseCode}")
    }

    val total = conn.contentLengthLong
    val digest = MessageDigest.getInstance("SHA-256")
    var done = 0L
    var lastReport = 0L
    conn.inputStream.use { input ->
      target.outputStream().use { out ->
        val buf = ByteArray(64 * 1024)
        while (true) {
          val n = input.read(buf)
          if (n < 0) break
          out.write(buf, 0, n)
          digest.update(buf, 0, n)
          done += n
          if (done - lastReport > 512 * 1024) {
            lastReport = done
            onProgress("download", done, total, "Downloading Linux…")
          }
        }
      }
    }
    conn.disconnect()
    return digest.digest().joinToString("") { "%02x".format(it) }
  }

  // ----------------------------------------------------------------- extract

  private fun extract(archive: File, dest: File) {
    val total = archive.length()
    val counting = CountingInputStream(BufferedInputStream(archive.inputStream()))
    val decompressed: InputStream = when {
      archive.name.endsWith(".xz") -> XZCompressorInputStream(counting)
      archive.name.endsWith(".gz") -> GzipCompressorInputStream(counting)
      else -> counting
    }

    // Hard links are created after everything else so their targets exist.
    val hardLinks = mutableListOf<Pair<File, File>>()
    var strip: Int? = null
    var lastReport = 0L

    TarArchiveInputStream(decompressed).use { tar ->
      while (true) {
        val entry: TarArchiveEntry = tar.nextEntry ?: break
        val raw = entry.name.removePrefix("./")
        if (raw.isEmpty()) continue

        // proot-distro tarballs wrap everything in one top-level folder.
        if (strip == null) strip = if (raw.substringBefore('/') in ROOT_DIRS) 0 else 1
        val name = stripComponents(raw, strip!!) ?: continue
        if (name.split('/').any { it == ".." }) continue // path traversal guard

        val out = File(dest, name)
        when {
          entry.isDirectory -> out.mkdirs()
          entry.isSymbolicLink -> {
            out.parentFile?.mkdirs()
            out.delete()
            Os.symlink(entry.linkName, out.absolutePath)
          }
          entry.isLink -> {
            val target = stripComponents(entry.linkName.removePrefix("./"), strip!!)
            if (target != null) hardLinks += File(dest, target) to out
          }
          entry.isFile -> {
            out.parentFile?.mkdirs()
            // Never write *through* an existing symlink to somewhere else.
            if (SafeFiles.isSymlink(out)) out.delete()
            out.outputStream().use { tar.copyTo(it) }
            Os.chmod(out.absolutePath, entry.mode and 0x1FF)
          }
          // Devices and FIFOs can't be created without root; proot binds /dev.
          else -> Unit
        }

        if (counting.count - lastReport > 1024 * 1024) {
          lastReport = counting.count
          onProgress("extract", counting.count, total, "Unpacking…")
        }
      }
    }

    for ((target, link) in hardLinks) {
      link.parentFile?.mkdirs()
      link.delete()
      try {
        Os.link(target.absolutePath, link.absolutePath)
      } catch (e: Exception) {
        // Some storage doesn't allow hard links; a copy behaves the same here.
        if (target.isFile && !SafeFiles.isSymlink(target)) target.copyTo(link, overwrite = true)
      }
    }
  }

  private fun stripComponents(path: String, n: Int): String? {
    if (n == 0) return path.trimEnd('/')
    val parts = path.split('/').filter { it.isNotEmpty() }
    return if (parts.size <= n) null else parts.drop(n).joinToString("/")
  }

  // --------------------------------------------------------------- configure

  /** Small fixes so networking, apt and Node behave inside proot. */
  private fun configure() {
    onProgress("configure", 0, 1, "Configuring…")
    val root = env.rootfsDir

    fun write(path: String, text: String) {
      val f = File(root, path.trimStart('/'))
      f.parentFile?.mkdirs()
      f.delete() // also removes a symlink (e.g. resolv.conf -> /run/...)
      f.writeText(text)
    }

    write("/etc/resolv.conf", "nameserver 8.8.8.8\nnameserver 1.1.1.1\n")
    write("/etc/hosts", "127.0.0.1 localhost\n::1 localhost ip6-localhost\n")
    // apt drops privileges to the _apt user, which proot can't fake.
    write("/etc/apt/apt.conf.d/99runner", "APT::Sandbox::User \"root\";\n")

    // Fake /proc files, bound only when the real ones are unreadable.
    write("/proc/.loadavg", "0.12 0.07 0.02 2/165 765\n")
    write("/proc/.uptime", "124.08 932.80\n")
    write("/proc/.version", "Linux version 6.1.0-runner (proot) #1 SMP PREEMPT\n")
    write("/proc/.vmstat", "nr_free_pages 146031\n")
    val cpus = Runtime.getRuntime().availableProcessors()
    val stat = buildString {
      append("cpu  1957 0 2877 93280 262 342 254 87 0 0\n")
      for (i in 0 until cpus) append("cpu$i 400 0 600 18000 50 70 50 20 0 0\n")
      append("intr 0\nctxt 0\nbtime 0\nprocesses 0\nprocs_running 1\nprocs_blocked 0\n")
    }
    write("/proc/.stat", stat)

    listOf("/root/projects", "/opt/runner/bin", "/opt/runner/hooks", "/opt/runtimes", "/tmp")
      .forEach { File(root, it.trimStart('/')).mkdirs() }
  }

  private fun archiveSuffix(url: String): String = when {
    url.contains(".tar.xz") -> ".tar.xz"
    url.contains(".tar.gz") -> ".tar.gz"
    else -> ".tar"
  }

  /** Wraps a stream so we can report extraction progress by compressed bytes. */
  private class CountingInputStream(private val inner: InputStream) : InputStream() {
    var count = 0L
      private set

    override fun read(): Int = inner.read().also { if (it >= 0) count++ }
    override fun read(b: ByteArray, off: Int, len: Int): Int =
      inner.read(b, off, len).also { if (it > 0) count += it }
    override fun close() = inner.close()
  }

  companion object {
    private val ROOT_DIRS = setOf(
      "bin", "boot", "dev", "etc", "home", "lib", "lib64", "media", "mnt", "opt",
      "proc", "root", "run", "sbin", "srv", "sys", "tmp", "usr", "var",
    )
  }
}
