package expo.modules.runner

import android.os.Build
import android.system.Os
import android.system.OsConstants
import java.io.File

/**
 * Stops a process together with everything it started.
 *
 * Killing only proot is not enough: with SIGKILL it can't clean up, and the
 * programs it was running (a dev server, say) are detached and keep going.
 * proot doesn't hide PIDs, so the guest programs are ordinary child processes
 * of our app and we can find them through /proc.
 */
object ProcessTree {

  /** All descendants of [root], children before grandchildren. */
  fun descendants(root: Int): List<Int> {
    val childrenOf = HashMap<Int, MutableList<Int>>()
    File("/proc").listFiles()?.forEach { dir ->
      val pid = dir.name.toIntOrNull() ?: return@forEach
      val ppid = readStat(pid)?.ppid ?: return@forEach
      childrenOf.getOrPut(ppid) { mutableListOf() } += pid
    }
    val out = ArrayList<Int>()
    val queue = ArrayDeque(listOf(root))
    while (queue.isNotEmpty()) {
      childrenOf[queue.removeFirst()]?.forEach {
        out += it
        queue += it
      }
    }
    return out
  }

  /** Running (not exited or zombie). */
  fun isAlive(pid: Int): Boolean = readStat(pid)?.let { it.state != 'Z' && it.state != 'X' } ?: false

  /**
   * [firstSignal] (SIGTERM; SIGHUP for terminals, since interactive bash
   * ignores SIGTERM) to the whole tree, deepest first, so programs can shut down
   * cleanly, then SIGKILL anything still alive after [graceMs]. The root
   * (proot) goes last so it doesn't detach its children while dying.
   * Blocks for up to [graceMs]; call it off the main thread.
   */
  fun killTree(root: Int, graceMs: Long = 2500, firstSignal: Int = OsConstants.SIGTERM) {
    // If proot already exited, its PID may now belong to something else.
    if (!isOurChild(root)) return
    descendants(root).asReversed().forEach { signal(it, firstSignal) }

    val deadline = System.currentTimeMillis() + graceMs
    while (System.currentTimeMillis() < deadline) {
      if (descendants(root).none { isAlive(it) }) break
      Thread.sleep(100)
    }

    // Scan again: programs may have started new children meanwhile.
    if (!isOurChild(root)) return
    descendants(root).asReversed().forEach { signal(it, OsConstants.SIGKILL) }
    if (isOurChild(root)) signal(root, OsConstants.SIGKILL)
  }

  /** proot is always started directly by the app, so it is our child while it lives. */
  private fun isOurChild(pid: Int): Boolean = readStat(pid)?.let { it.ppid == Os.getpid() && it.state != 'Z' } ?: false

  /** PID of a java.lang.Process (public API only from Android 13). */
  fun pidOf(p: Process): Int? {
    if (Build.VERSION.SDK_INT >= 33) return p.pid().toInt()
    return try {
      p.javaClass.getDeclaredField("pid").apply { isAccessible = true }.getInt(p)
    } catch (_: Exception) {
      null
    }
  }

  private fun signal(pid: Int, sig: Int) {
    try { Os.kill(pid, sig) } catch (_: Exception) {}
  }

  private class Stat(val state: Char, val ppid: Int)

  /** /proc/<pid>/stat; the name field may contain spaces, so parse after the last ')'. */
  private fun readStat(pid: Int): Stat? = try {
    val rest = File("/proc/$pid/stat").readText().substringAfterLast(')').trim().split(' ')
    Stat(rest[0].first(), rest[1].toInt())
  } catch (_: Exception) {
    null
  }
}
