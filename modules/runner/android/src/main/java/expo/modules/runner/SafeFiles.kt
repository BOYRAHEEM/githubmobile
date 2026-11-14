package expo.modules.runner

import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import java.io.File

/**
 * File helpers that never follow symbolic links.
 *
 * Repos are untrusted: one can contain a link like `evil -> ../../..`.
 * Kotlin's File.deleteRecursively() follows links into directories, so
 * deleting such a project would wipe files outside it. These don't.
 */
object SafeFiles {

  fun isSymlink(f: File): Boolean = try {
    OsConstants.S_ISLNK(Os.lstat(f.path).st_mode)
  } catch (_: ErrnoException) {
    false
  }

  /** True if something (file, dir or dangling link) exists at this path. */
  fun existsNoFollow(f: File): Boolean = try {
    Os.lstat(f.path)
    true
  } catch (_: ErrnoException) {
    false
  }

  /** Deletes a file or folder tree. Links are removed, never followed. */
  fun deleteTree(f: File): Boolean {
    if (!isSymlink(f) && f.isDirectory) {
      f.listFiles()?.forEach { deleteTree(it) }
    }
    return f.delete() || !existsNoFollow(f)
  }
}
