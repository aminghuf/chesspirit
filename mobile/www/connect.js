// Chesspirit for Android is a shell: it asks which server, remembers it, and
// loads that server's own web app in the WebView. So the app always matches
// the server's version, and login, the coach stream and live games work
// exactly as in a browser, because they are same-origin.
//
// Back from the server's first page lands here again — that is the "change
// server" screen, so it must not bounce straight back (OPENED, below).

(function () {
  var SERVER_KEY = 'chesspirit.server';
  var OPENED_KEY = 'chesspirit.opened'; // sessionStorage: already sent there this run
  var TIMEOUT_MS = 8000;

  var form = document.getElementById('form');
  var input = document.getElementById('server');
  var msg = document.getElementById('msg');
  var connectBtn = document.getElementById('connect');
  var anywayBtn = document.getElementById('anyway');
  var pending = null; // the URL "Open it anyway" would open

  // What the user typed → candidate base URLs, most likely first. With no
  // scheme, a public name gets https first; an IP address, a port or a
  // one-word host (a home server) gets http first.
  function candidates(raw) {
    var s = raw.trim().replace(/\s+/g, '');
    if (!s) return [];
    var explicit = /^https?:\/\//i.test(s);
    var rest = s.replace(/^https?:\/\//i, '').replace(/[/?#].*$/, '');
    if (!rest) return [];
    if (explicit) return [s.match(/^https?/i)[0].toLowerCase() + '://' + rest];
    var host = rest.replace(/:\d+$/, '');
    var local = /:\d+$/.test(rest) || /^[\d.]+$/.test(host) || host.indexOf('.') < 0 || /\.(local|lan|home|internal)$/i.test(host);
    return local ? ['http://' + rest, 'https://' + rest] : ['https://' + rest, 'http://' + rest];
  }

  // A Chesspirit server answers GET /api/health with {"ok":true}.
  function probe(base) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);
    return fetch(base + '/api/health', { signal: ctrl.signal, cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return !!(j && j.ok === true); })
      .catch(function () { return false; })
      .then(function (ok) { clearTimeout(timer); return ok; });
  }

  function say(text, ok) {
    msg.textContent = text;
    msg.className = ok ? 'msg ok' : 'msg';
  }

  function open(base) {
    try {
      localStorage.setItem(SERVER_KEY, base);
      sessionStorage.setItem(OPENED_KEY, '1');
    } catch (e) { /* storage off: still open it, just not remembered */ }
    window.location.href = base + '/';
  }

  function connect() {
    var list = candidates(input.value);
    anywayBtn.hidden = true;
    if (list.length === 0) { say('Enter the address of your server.'); return; }
    connectBtn.disabled = true;
    say('Connecting…', true);
    var i = 0;
    (function next() {
      if (i >= list.length) {
        connectBtn.disabled = false;
        pending = list[0];
        say('No Chesspirit server answered at ' + list[0].replace(/^https?:\/\//, '') + '. Check the address and that this phone can reach it.');
        anywayBtn.hidden = false;
        return;
      }
      var base = list[i++];
      probe(base).then(function (ok) { if (ok) open(base); else next(); });
    })();
  }

  form.addEventListener('submit', function (e) { e.preventDefault(); connect(); });
  anywayBtn.addEventListener('click', function () { if (pending) open(pending); });

  var saved = null, opened = false;
  try {
    saved = localStorage.getItem(SERVER_KEY);
    opened = sessionStorage.getItem(OPENED_KEY) === '1';
  } catch (e) { /* ignore */ }
  if (saved) input.value = saved.replace(/^https:\/\//, '');
  // First screen of a run with a remembered server: go straight there.
  if (saved && !opened) open(saved);
})();
