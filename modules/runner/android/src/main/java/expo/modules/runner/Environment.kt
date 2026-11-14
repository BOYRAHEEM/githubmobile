package expo.modules.runner

import android.content.Context
import java.io.File

/**
 * Knows where everything lives on disk and how to build a proot command line.
 *
 * Layout inside the app's private storage:
 *   files/rootfs          – the Debian root filesystem (guest "/")
 *   files/tmp             – bound to guest /tmp (proot also keeps its own state here)
 *   nativeLibraryDir      – libproot.so, libproot-loader.so, libtalloc.so (executable)
 */
class Environment(private val context: Context) {

  val filesDir: File get() = context.filesDir
  val rootfsDir: File get() = File(filesDir, "rootfs")
  val tmpDir: File get() = File(filesDir, "tmp").apply { mkdirs() }
  val nativeLibDir: File get() = File(context.applicationInfo.nativeLibraryDir)

  val prootBinary: File get() = File(nativeLibDir, "libproot.so")
  val prootLoader: File get() = File(nativeLibDir, "libproot-loader.so")

  /** Marker written once the rootfs is fully unpacked and configured. */
  private val readyMarker: File get() = File(rootfsDir, ".runner-ready")

  fun hasProot(): Boolean = prootBinary.exists() && prootLoader.exists()

  fun isRootfsReady(): Boolean = readyMarker.exists()

  fun markRootfsReady() {
    readyMarker.writeText(System.currentTimeMillis().toString())
  }

  /**
   * Maps a guest path ("/root/projects/x") to the real path on the phone.
   * Rejects ".." so a path can never point outside the Linux folder.
   */
  fun hostPath(guestPath: String): File {
    val parts = guestPath.split('/').filter { it.isNotEmpty() && it != "." }
    require(parts.none { it == ".." }) { "Invalid path: $guestPath" }
    return File(rootfsDir, parts.joinToString("/"))
  }

  /**
   * Builds the full command that runs [script] with bash inside the rootfs.
   *
   * @param cwd   guest working directory
   * @param env   extra variables layered over the defaults below
   * @param mode  how bash is started (see [Mode])
   */
  fun buildCommand(script: String, cwd: String, env: Map<String, String>, mode: Mode): List<String> {
    val rootfs = rootfsDir.absolutePath

    val cmd = mutableListOf(
      prootBinary.absolutePath,
      "--kill-on-exit",
      "--link2symlink",         // emulate hard links (needed by apt, npm, git)
      "-0",                     // pretend to be root
      "-r", rootfs,
      "-b", "/dev",
      "-b", "/proc",
      "-b", "/sys",
      "-b", "/proc/self/fd:/dev/fd",
      "-b", "${tmpDir.absolutePath}:/tmp",
      "-b", "${tmpDir.absolutePath}:/dev/shm",
      "-w", cwd,
    )

    // Android hides some /proc files from apps. Tools like Node's os.cpus()
    // read them, so we bind small fake copies (written by the bootstrapper).
    for (name in FAKE_PROC_FILES) {
      val fake = File(rootfsDir, "proc/.$name")
      if (fake.exists() && !canReallyRead(File("/proc/$name"))) {
        cmd += listOf("-b", "${fake.absolutePath}:/proc/$name")
      }
    }

    val vars = linkedMapOf(
      "HOME" to "/root",
      "USER" to "root",
      "LANG" to "C.UTF-8",
      "TERM" to "xterm-256color",
      "TMPDIR" to "/tmp",
      "PATH" to "/opt/runner/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    )
    vars.putAll(env)

    cmd += "/usr/bin/env"
    cmd += "-i"
    vars.forEach { (k, v) -> cmd += "$k=$v" }
    cmd += "/bin/bash"
    cmd += when (mode) {
      Mode.SCRIPT -> listOf("-lc", script)
      Mode.PTY_SHELL -> listOf("-l")
    }
    return cmd
  }

  /** canRead() only checks file modes; SELinux can still refuse the read. */
  private fun canReallyRead(f: File): Boolean = try {
    f.inputStream().use { it.read() }
    true
  } catch (_: Exception) {
    false
  }

  /** SCRIPT runs one script over pipes; PTY_SHELL is an interactive terminal. */
  enum class Mode { SCRIPT, PTY_SHELL }

  /** Host-side variables proot itself needs (not visible to the guest). */
  fun prootEnv(): Map<String, String> = mapOf(
    "PROOT_LOADER" to prootLoader.absolutePath,
    "PROOT_TMP_DIR" to tmpDir.absolutePath,
    "LD_LIBRARY_PATH" to nativeLibDir.absolutePath,
  )

  companion object {
    val FAKE_PROC_FILES = listOf("loadavg", "stat", "uptime", "version", "vmstat")
  }
}
