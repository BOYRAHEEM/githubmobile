package expo.modules.runner

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Queues
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/**
 * The JavaScript-facing API. Kept thin on purpose: the real work lives in
 * [Environment], [Bootstrapper] and [SessionManager] so each can grow alone.
 */
class RunnerModule : Module() {

  private val context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
  private val env by lazy { Environment(context) }
  // Our own emitter, so OnDestroy only unhooks it if a newer module hasn't replaced it.
  private val emitter: (String, Map<String, Any?>) -> Unit = { name, payload -> sendEvent(name, payload) }
  private val sessions by lazy { SessionManager.get(context).also { it.emit = emitter } }

  override fun definition() = ModuleDefinition {
    Name("Runner")

    Events("onOutput", "onExit", "onBootstrapProgress")

    // ---- environment ------------------------------------------------------

    Function("getInfo") {
      mapOf(
        "rootfs" to env.rootfsDir.absolutePath,
        "nativeLibDir" to env.nativeLibDir.absolutePath,
        "hasProot" to env.hasProot(),
        "rootfsReady" to env.isRootfsReady(),
        "abi" to (android.os.Build.SUPPORTED_ABIS.firstOrNull() ?: "unknown"),
      )
    }

    AsyncFunction("installRootfs") Coroutine { url: String, sha256: String? ->
      withContext(Dispatchers.IO) {
        Bootstrapper(env) { phase, done, total, message ->
          sendEvent(
            "onBootstrapProgress",
            mapOf("phase" to phase, "done" to done.toDouble(), "total" to total.toDouble(), "message" to message),
          )
        }.install(url, sha256)
      }
    }

    // ---- processes --------------------------------------------------------

    /** Runs a script once over pipes. `label` is shown in the notification. */
    AsyncFunction("start") { id: String, label: String, script: String, cwd: String, extraEnv: Map<String, String> ->
      sessions.startScript(id, label, script, cwd, extraEnv)
    }

    /** Starts an interactive login shell on a real terminal (PTY). */
    AsyncFunction("startTerminal") { id: String, cwd: String, extraEnv: Map<String, String>, rows: Int, cols: Int ->
      sessions.startTerminal(id, cwd, extraEnv, rows, cols)
    }

    AsyncFunction("resize") { id: String, rows: Int, cols: Int ->
      sessions.resize(id, rows, cols)
    }

    AsyncFunction("write") { id: String, data: String ->
      sessions.write(id, data)
    }

    AsyncFunction("stop") { id: String ->
      sessions.stop(id)
    }

    Function("isRunning") { id: String ->
      sessions.isRunning(id)
    }

    /** JS calls this on start-up: after a reload it can't reattach to old processes. */
    AsyncFunction("stopAll") {
      sessions.stopAll()
    }

    // ---- files (guest paths, e.g. "/root/projects/app/package.json") -----

    AsyncFunction("readText") Coroutine { guestPath: String ->
      withContext(Dispatchers.IO) {
        val f = env.hostPath(guestPath)
        if (f.isFile) f.readText() else null
      }
    }

    AsyncFunction("writeText") Coroutine { guestPath: String, content: String ->
      withContext(Dispatchers.IO) {
        val f = env.hostPath(guestPath)
        f.parentFile?.mkdirs()
        f.writeText(content)
      }
    }

    AsyncFunction("listDir") Coroutine { guestPath: String ->
      withContext(Dispatchers.IO) {
        val dir = env.hostPath(guestPath)
        (dir.listFiles() ?: emptyArray<File>()).map {
          mapOf("name" to it.name, "isDir" to it.isDirectory, "size" to it.length().toDouble())
        }
      }
    }

    /** Deletes a project or app-data folder. Never follows symlinks. */
    AsyncFunction("remove") Coroutine { guestPath: String ->
      // Only something *inside* /root/projects or /root/.repo-runner, never those folders themselves.
      val parts = guestPath.split('/').filter { it.isNotEmpty() && it != "." }
      require(parts.size >= 3 && parts[0] == "root" && parts[1] in REMOVABLE_DIRS) { "Refusing to delete $guestPath" }
      withContext(Dispatchers.IO) { SafeFiles.deleteTree(env.hostPath(guestPath)) }
    }

    // ---- notifications (Android 13+ asks before showing the keep-alive one)

    AsyncFunction("requestNotificationPermission") {
      if (Build.VERSION.SDK_INT < 33) return@AsyncFunction true
      val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
        PackageManager.PERMISSION_GRANTED
      if (!granted) {
        appContext.currentActivity?.let {
          ActivityCompat.requestPermissions(it, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 4211)
        }
      }
      return@AsyncFunction granted
    }.runOnQueue(Queues.MAIN)

    // Processes keep running across JS reloads; just stop sending events.
    OnDestroy {
      SessionManager.peek()?.let { if (it.emit === emitter) it.emit = { _, _ -> } }
    }
  }

  companion object {
    /** The only folders (under /root) that JS may delete things from. */
    private val REMOVABLE_DIRS = setOf("projects", ".repo-runner")
  }
}
