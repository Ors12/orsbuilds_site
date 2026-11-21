/* Világos / sötét téma – a választás a böngésző localStorage-ában marad. */
(function () {
  var KEY = 'orsbuilds-theme';
  var root = document.documentElement;
  function read() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function write(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  function apply(t) {
    root.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t === 'dark' ? '#0b1512' : '#14302b');
  }
  apply(read() === 'dark' ? 'dark' : 'light');

  var L = {
    hu: ['Váltás sötét módra', 'Váltás világos módra'],
    en: ['Switch to dark mode', 'Switch to light mode'],
    de: ['Zum dunklen Modus wechseln', 'Zum hellen Modus wechseln']
  };
  function lang() {
    var l = 'hu';
    try { l = localStorage.getItem('orsbuilds-lang') || root.lang || 'hu'; } catch (e) {}
    return L[l] ? l : 'hu';
  }
  function build() {
    var nav = document.querySelector('.topbar .nav');
    if (!nav || nav.querySelector('.theme-toggle')) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'theme-toggle';
    b.setAttribute('translate', 'no');
    b.innerHTML = '<svg class="ti-moon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>'
      + '<svg class="ti-sun" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg>';
    function label() {
      var dark = root.getAttribute('data-theme') === 'dark';
      var t = L[lang()][dark ? 1 : 0];
      b.setAttribute('aria-label', t);
      b.setAttribute('title', t);
      b.setAttribute('aria-pressed', dark ? 'true' : 'false');
    }
    b.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      apply(next); write(next); label();
    });
    var sw = nav.querySelector('.lang-switch');
    if (sw) nav.insertBefore(b, sw); else nav.appendChild(b);
    label();
    document.addEventListener('click', function () { setTimeout(label, 50); });
  }
  if (document.readyState === 'complete') build();
  else window.addEventListener('load', build);
})();
