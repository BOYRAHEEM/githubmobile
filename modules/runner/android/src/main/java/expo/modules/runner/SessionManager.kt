package expo.modules.runner

import android.content.Context
import android.system.OsConstants
import java.io.InputStream
import java.io.InputStreamReader
import java.io.OutputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * Starts and tracks processes running inside the Linux environment.
 *
 * Two kinds of session:
 *  - script: runs once over plain pipes (installs, dev servers)
 *  - terminal: an interactive login shell on a real PTY
 *
 * Each session has a JS-chosen id. Output is streamed back through [emit] as
 * "onOutput" events and the exit code as "onExit". While anything runs, the
 * [KeepAliveService] keeps the app alive in the background.
 *
 * This is an app-wide singleton: processes outlive a JS reload, and the
 * notification's "Stop all" button needs to reach it.
 */
class SessionManager private constructor(private val appContext: Context) {

  /** Set by the module; replaced when JS reloads. */
  @Volatile var emit: (event: String, payload: Map<String, Any?>) -> Unit = { _, _ -> }

  private val env = Environment(appContext)

  private class Session(
    val label: String,
    val stdin: OutputStream,
    val stop: () -> Unit,
    val isAlive: () -> Boolean,
    val pty: Pty? = null,
  )

  private val sessions = ConcurrentHashMap<String, Session>()

  // ---------------------------------------------------------------- start

  fun startScript(id: String, label: String, script: String, cwd: String, extraEnv: Map<String, String>) {
    checkReady()
    stop(id) // one process per id

    val builder = ProcessBuilder(env.buildCommand(script, cwd, extraEnv, Environment.Mode.SCRIPT))
    builder.directory(env.filesDir)
    builder.environment().putAll(env.prootEnv())
    val process = builder.start()

    val pid = ProcessTree.pidOf(process)
    val session = Session(
      label = label,
      stdin = process.outputStream,
      // Stop proot *and* everything it started (dev servers, watchers…).
      stop = {
        thread(isDaemon = true) {
          if (pid != null) ProcessTree.killTree(pid) else process.destroy()
          if (isAlive(process)) process.destroyForcibly()
        }
      },
      isAlive = { isAlive(process) },
    )
    register(id, session)

    pump(id, "stdout", process.inputStream)
    pump(id, "stderr", process.errorStream)
    thread(name = "runner-wait-$id", isDaemon = true) { finish(id, session, process.waitFor()) }
  }

  fun startTerminal(id: String, cwd: String, extraEnv: Map<String, String>, rows: Int, cols: Int) {
    checkReady()
    stop(id)

    val argv = env.buildCommand("", cwd, extraEnv, Environment.Mode.PTY_SHELL)
    // The PTY child gets a fresh environment, so pass the app's own plus proot's.
    val hostEnv = System.getenv() + env.prootEnv()
    val pty = Pty.spawn(argv, hostEnv, env.filesDir.absolutePath, rows, cols)

    val alive = AtomicBoolean(true)
    val session = Session(
      label = "Terminal",
      stdin = pty.output,
      // SIGHUP first: bash passes it on to its jobs and exits cleanly.
      stop = { thread(isDaemon = true) { ProcessTree.killTree(pty.pid, firstSignal = OsConstants.SIGHUP) } },
      isAlive = { alive.get() },
      pty = pty,
    )
    register(id, session)

    pump(id, "stdout", pty.input)
    thread(name = "runner-wait-$id", isDaemon = true) {
      val code = pty.waitFor()
      alive.set(false)
      pty.close()
      finish(id, session, code)
    }
  }

  // -------------------------------------------------------------- control

  /** Sends text to the process (keystrokes for terminals). */
  fun write(id: String, data: String) {
    val session = sessions[id] ?: throw IllegalStateException("No session $id")
    session.stdin.write(data.toByteArray(Charsets.UTF_8))
    session.stdin.flush()
  }

  fun resize(id: String, rows: Int, cols: Int) {
    sessions[id]?.pty?.resize(rows, cols)
  }

  fun stop(id: String) {
    val session = sessions.remove(id) ?: return
    // Closing a PTY's input would close the master too; only close pipes.
    if (session.pty == null) try { session.stdin.close() } catch (_: Exception) {}
    session.stop()
    updateKeepAlive()
  }

  fun stopAll() = sessions.keys.toList().forEach { stop(it) }

  fun isRunning(id: String): Boolean = sessions[id]?.isAlive?.invoke() ?: false

  /** Labels of everything running, e.g. for the notification. */
  fun runningLabels(): List<String> = sessions.values.filter { it.isAlive() }.map { it.label }

  // -------------------------------------------------------------- helpers

  private fun checkReady() {
    check(env.isRootfsReady()) { "Linux environment is not installed yet" }
    check(env.hasProot()) { "proot binaries are missing – run `npm run fetch-binaries` and rebuild" }
  }

  private fun register(id: String, session: Session) {
    sessions[id] = session
    updateKeepAlive()
  }

  private fun finish(id: String, session: Session, code: Int) {
    // Only clear the slot if it still belongs to this process.
    sessions.remove(id, session)
    updateKeepAlive()
    emit("onExit", mapOf("id" to id, "code" to code))
  }

  private fun updateKeepAlive() = KeepAliveService.update(appContext, runningLabels())

  private fun isAlive(p: Process): Boolean = try { p.exitValue(); false } catch (_: IllegalThreadStateException) { true }

  /** Reads a stream on a background thread and forwards text chunks. */
  private fun pump(id: String, stream: String, input: InputStream) {
    thread(name = "runner-$stream-$id", isDaemon = true) {
      // InputStreamReader handles UTF-8 characters split across reads.
      val reader = InputStreamReader(input, Charsets.UTF_8)
      val buf = CharArray(8192)
      try {
        while (true) {
          val n = reader.read(buf)
          if (n < 0) break
          emit("onOutput", mapOf("id" to id, "stream" to stream, "chunk" to String(buf, 0, n)))
        }
      } catch (_: Exception) {
        // Stream closed because the process was stopped (PTYs end with EIO).
      }
    }
  }

  companion object {
    @Volatile private var instance: SessionManager? = null

    fun get(context: Context): SessionManager =
      instance ?: synchronized(this) {
        instance ?: SessionManager(context.applicationContext).also { instance = it }
      }

    /** For the notification's "Stop all" button; null if nothing ever ran. */
    fun peek(): SessionManager? = instance
  }
}
