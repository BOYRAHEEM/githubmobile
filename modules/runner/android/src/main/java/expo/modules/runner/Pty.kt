package expo.modules.runner

import android.os.ParcelFileDescriptor
import java.io.FileInputStream
import java.io.FileOutputStream

/**
 * A process running on a pseudo-terminal (see src/main/cpp/pty.c).
 * Reading [input] gives the terminal output; writing [output] types keys.
 */
class Pty private constructor(val pid: Int, private val fd: Int) {

  // adoptFd takes ownership: closing pfd closes the PTY master.
  private val pfd: ParcelFileDescriptor = ParcelFileDescriptor.adoptFd(fd)
  val input = FileInputStream(pfd.fileDescriptor)
  val output = FileOutputStream(pfd.fileDescriptor)

  @Volatile private var closed = false

  /** No-op once closed: the fd number may already belong to something else. */
  fun resize(rows: Int, cols: Int) {
    if (!closed) nativeResize(fd, rows, cols)
  }

  /** Blocks until the process exits and returns its exit code. */
  fun waitFor(): Int = nativeWaitFor(pid)

  fun close() {
    closed = true
    try { pfd.close() } catch (_: Exception) {}
  }

  companion object {
    init {
      System.loadLibrary("pty")
    }

    fun spawn(argv: List<String>, env: Map<String, String>, cwd: String, rows: Int, cols: Int): Pty {
      val pid = IntArray(1)
      val envp = env.map { (k, v) -> "$k=$v" }.toTypedArray()
      val fd = nativeSpawn(argv.toTypedArray(), envp, cwd, rows, cols, pid)
      return Pty(pid[0], fd)
    }

    @JvmStatic private external fun nativeSpawn(
      argv: Array<String>, envp: Array<String>, cwd: String, rows: Int, cols: Int, pidOut: IntArray,
    ): Int
    @JvmStatic private external fun nativeResize(fd: Int, rows: Int, cols: Int)
    @JvmStatic private external fun nativeWaitFor(pid: Int): Int
  }
}
