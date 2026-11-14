import { colors } from '../ui/palette';
import { XTERM_CSS, XTERM_FIT_JS, XTERM_JS } from './xtermAssets.generated';

/**
 * The page inside the terminal WebView. xterm.js draws the terminal; the page
 * talks to React Native with small JSON messages:
 *
 *   page → app   { type: 'ready' | 'resize', rows, cols }   { type: 'input', data }
 *   app → page   window.termWrite(text)  termFocus()  termFontSize(n)  termReset()
 */
export function buildTerminalHtml(fontSize = 13) {
  return `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>${XTERM_CSS}</style>
<style>
  html, body { margin: 0; height: 100%; background: ${colors.bg}; overflow: hidden; }
  #term { position: absolute; inset: 6px 4px 4px 8px; }
  .xterm-viewport::-webkit-scrollbar { display: none; }
</style>
</head>
<body>
<div id="term"></div>
<script>${XTERM_JS}</script>
<script>${XTERM_FIT_JS}</script>
<script>
(function () {
  var post = function (msg) { window.ReactNativeWebView.postMessage(JSON.stringify(msg)); };

  var term = new Terminal({
    fontFamily: 'monospace',
    fontSize: ${fontSize},
    cursorBlink: true,
    scrollback: 5000,
    allowProposedApi: true,
    theme: {
      background: '${colors.bg}',
      foreground: '${colors.text}',
      cursor: '${colors.accent}',
      selectionBackground: '#2A3A4C',
      green: '${colors.accent}',
      brightGreen: '${colors.accent}',
      cyan: '${colors.info}',
      red: '${colors.danger}',
      yellow: '${colors.warn}'
    }
  });
  var fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(document.getElementById('term'));

  var last = '';
  function refit() {
    try { fit.fit(); } catch (e) {}
    var key = term.rows + 'x' + term.cols;
    if (key !== last) {
      post({ type: last ? 'resize' : 'ready', rows: term.rows, cols: term.cols });
      last = key;
    }
  }

  term.onData(function (data) { post({ type: 'input', data: data }); });
  window.addEventListener('resize', refit);

  window.termWrite = function (text) { term.write(text); };
  window.termFocus = function () { term.focus(); };
  window.termFontSize = function (n) { term.options.fontSize = n; refit(); };
  /* Clears the screen and re-sends 'ready' so the app starts a fresh shell. */
  window.termReset = function () { term.reset(); last = ''; refit(); term.focus(); };

  setTimeout(function () { refit(); term.focus(); }, 50);
})();
true;
</script>
</body>
</html>`;
}
