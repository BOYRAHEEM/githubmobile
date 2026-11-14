/*
 * Minimal pseudo-terminal support for Repo Runner.
 *
 * A pipe isn't a terminal, so programs like vim, htop, npm's progress bars and
 * interactive prompts misbehave without one. This file opens a PTY pair,
 * forks, and runs the given program with the PTY as its stdin/stdout/stderr.
 * Kotlin reads and writes the master side (see Pty.kt).
 */
#include <jni.h>
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/wait.h>
#include <termios.h>
#include <unistd.h>

/* Copies a Java String[] into a NULL-terminated char* array (caller frees). */
static char **to_c_array(JNIEnv *env, jobjectArray arr) {
  if (arr == NULL) return NULL;
  jsize n = (*env)->GetArrayLength(env, arr);
  char **out = calloc((size_t)n + 1, sizeof(char *));
  for (jsize i = 0; i < n; i++) {
    jstring s = (jstring)(*env)->GetObjectArrayElement(env, arr, i);
    const char *utf = (*env)->GetStringUTFChars(env, s, NULL);
    out[i] = strdup(utf);
    (*env)->ReleaseStringUTFChars(env, s, utf);
    (*env)->DeleteLocalRef(env, s);
  }
  return out;
}

static void free_c_array(char **arr) {
  if (arr == NULL) return;
  for (char **p = arr; *p; p++) free(*p);
  free(arr);
}

static int throw_io(JNIEnv *env, const char *msg) {
  jclass cls = (*env)->FindClass(env, "java/io/IOException");
  (*env)->ThrowNew(env, cls, msg);
  return -1;
}

/*
 * Starts argv[0] on a new PTY. Returns the master fd and writes the child pid
 * into pidOut[0].
 */
JNIEXPORT jint JNICALL
Java_expo_modules_runner_Pty_nativeSpawn(JNIEnv *env, jclass clazz, jobjectArray jargv, jobjectArray jenvp,
                                         jstring jcwd, jint rows, jint cols, jintArray pidOut) {
  int ptm = open("/dev/ptmx", O_RDWR | O_CLOEXEC);
  if (ptm < 0) return throw_io(env, "Cannot open /dev/ptmx");

  char pts_name[64];
  if (grantpt(ptm) || unlockpt(ptm) || ptsname_r(ptm, pts_name, sizeof(pts_name))) {
    close(ptm);
    return throw_io(env, "Cannot set up PTY");
  }

  /* UTF-8 aware line editing, backspace = DEL like most terminals. */
  struct termios tios;
  tcgetattr(ptm, &tios);
  tios.c_iflag |= IUTF8;
  tios.c_iflag &= ~(IXON | IXOFF);
  tios.c_cc[VERASE] = 0x7f;
  tcsetattr(ptm, TCSANOW, &tios);

  struct winsize sz = {.ws_row = (unsigned short)rows, .ws_col = (unsigned short)cols};
  ioctl(ptm, TIOCSWINSZ, &sz);

  /* All JNI work must happen before fork(). */
  char **argv = to_c_array(env, jargv);
  char **envp = to_c_array(env, jenvp);
  const char *cwd_utf = (*env)->GetStringUTFChars(env, jcwd, NULL);
  char *cwd = strdup(cwd_utf);
  (*env)->ReleaseStringUTFChars(env, jcwd, cwd_utf);

  pid_t pid = fork();
  if (pid < 0) {
    free_c_array(argv);
    free_c_array(envp);
    free(cwd);
    close(ptm);
    return throw_io(env, "fork() failed");
  }

  if (pid == 0) {
    /* ---- child ---- */
    sigset_t all;
    sigemptyset(&all);
    sigprocmask(SIG_SETMASK, &all, NULL); /* Android's VM blocks some signals */

    close(ptm);
    setsid(); /* new session so the PTY becomes our controlling terminal */

    int pts = open(pts_name, O_RDWR);
    if (pts < 0) _exit(127);
    ioctl(pts, TIOCSCTTY, 0);
    dup2(pts, 0);
    dup2(pts, 1);
    dup2(pts, 2);

    /* Don't leak the app's other file descriptors into the child. */
    long max_fd = sysconf(_SC_OPEN_MAX);
    for (int fd = 3; fd < max_fd; fd++) close(fd);

    if (chdir(cwd) != 0) chdir("/");
    execve(argv[0], argv, envp);
    _exit(127);
  }

  /* ---- parent ---- */
  free_c_array(argv);
  free_c_array(envp);
  free(cwd);

  jint p = (jint)pid;
  (*env)->SetIntArrayRegion(env, pidOut, 0, 1, &p);
  return ptm;
}

/* Tells the program the terminal changed size (sends SIGWINCH). */
JNIEXPORT void JNICALL
Java_expo_modules_runner_Pty_nativeResize(JNIEnv *env, jclass clazz, jint fd, jint rows, jint cols) {
  struct winsize sz = {.ws_row = (unsigned short)rows, .ws_col = (unsigned short)cols};
  ioctl(fd, TIOCSWINSZ, &sz);
}

/* Blocks until the child exits; returns its exit code (or 128+signal). */
JNIEXPORT jint JNICALL
Java_expo_modules_runner_Pty_nativeWaitFor(JNIEnv *env, jclass clazz, jint pid) {
  int status = 0;
  while (waitpid(pid, &status, 0) < 0) {
    if (errno != EINTR) return -1;
  }
  if (WIFEXITED(status)) return WEXITSTATUS(status);
  if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
  return 0;
}
