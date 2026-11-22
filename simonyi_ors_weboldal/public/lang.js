// Nyelvváltó: magyar / angol / német. Kliensoldali, külső szolgáltatás és süti nélkül.
// A fordítások az i18n-data.js-ben vannak (kulcs: a magyar szöveg).
(function () {
  const data = window.ORS_I18N;
  if (!data) return;
  const LANGS = [
    { code: 'hu', label: 'HU', name: 'Magyar' },
    { code: 'en', label: 'EN', name: 'English' },
    { code: 'de', label: 'DE', name: 'Deutsch' },
  ];
  const STORE = 'orsbuilds-lang';
  const ATTRS = ['placeholder', 'alt', 'aria-label', 'title'];
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const originals = new WeakMap(); // text node -> { hu, tr }
  const attrOriginals = new WeakMap(); // element -> { attr: { hu, tr } }
  let lang = 'hu';
  let applying = false;

  const read = () => { try { return localStorage.getItem(STORE); } catch (e) { return null; } };
  const write = (v) => { try { localStorage.setItem(STORE, v); } catch (e) { /* nincs tárolás */ } };

  function translate(text) {
    if (lang === 'hu') return null;
    const key = norm(text);
    const hit = data[lang][key];
    if (hit !== undefined) return hit;
    const booked = key.match(/^(\d\d:\d\d) – foglalt$/);
    if (booked) return `${booked[1]} – ${lang === 'en' ? 'booked' : 'belegt'}`;
    return null;
  }

  function setText(node, hu, tr) {
    const lead = /^\s/.test(hu) && !/^[.,;:!?]/.test(tr) ? ' ' : '';
    const trail = /\s$/.test(hu) && tr !== '' ? ' ' : '';
    const value = tr === '' ? '' : lead + tr + trail;
    node.nodeValue = value;
    originals.set(node, { hu, tr: value });
  }

  function textNodes(root) {
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentElement;
        if (!p || p.closest('script, style, noscript, textarea, [translate="no"], .lang-switch')) return NodeFilter.FILTER_REJECT;
        return /\S/.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    while (walker.nextNode()) out.push(walker.currentNode);
    return out;
  }

  function applyTo(root) {
    applying = true;
    for (const node of textNodes(root)) {
      const known = originals.get(node);
      // ha a script közben új szöveget írt a csomópontba, az az új magyar eredeti
      const hu = known && node.nodeValue === known.tr ? known.hu : node.nodeValue;
      if (lang === 'hu') {
        if (known && node.nodeValue === known.tr) node.nodeValue = known.hu;
        originals.delete(node);
        continue;
      }
      const tr = translate(hu);
      if (tr !== null) setText(node, hu, tr);
    }
    const scope = root.nodeType === 1 ? [root, ...root.querySelectorAll('*')] : [];
    for (const el of scope) {
      if (el.closest('[translate="no"], .lang-switch')) continue;
      for (const attr of ATTRS) {
        if (!el.hasAttribute(attr)) continue;
        const saved = attrOriginals.get(el) || {};
        const cur = el.getAttribute(attr);
        const rec = saved[attr];
        const hu = rec && cur === rec.tr ? rec.hu : cur;
        if (lang === 'hu') { if (rec && cur === rec.tr) el.setAttribute(attr, rec.hu); delete saved[attr]; }
        else {
          const tr = translate(hu);
          if (tr !== null) { el.setAttribute(attr, tr); saved[attr] = { hu, tr }; }
        }
        attrOriginals.set(el, saved);
      }
    }
    applying = false;
  }

  function applyMeta() {
    const title = document.querySelector('title');
    if (title) {
      if (!title.dataset.hu) title.dataset.hu = title.textContent;
      const tr = lang === 'hu' ? null : translate(title.dataset.hu);
      title.textContent = tr !== null ? tr : title.dataset.hu;
    }
    document.querySelectorAll('meta[name="description"], meta[property="og:title"], meta[property="og:description"], meta[name="twitter:title"], meta[name="twitter:description"]').forEach((m) => {
      if (!m.dataset.hu) m.dataset.hu = m.getAttribute('content') || '';
      const tr = lang === 'hu' ? null : translate(m.dataset.hu);
      m.setAttribute('content', tr !== null ? tr : m.dataset.hu);
    });
  }

  // option elemek: az elküldött érték mindig a magyar maradjon
  function pinOptionValues() {
    document.querySelectorAll('option').forEach((o) => {
      if (!o.hasAttribute('value')) o.setAttribute('value', o.textContent.trim());
    });
  }

  function notice() {
    const isLegal = /(^|\/)(aszf|adatkezelesi-tajekoztato)\.html$/.test(location.pathname);
    let bar = document.querySelector('.lang-notice');
    if (!isLegal || lang === 'hu') { if (bar) bar.remove(); return; }
    if (!bar) {
      bar = document.createElement('p');
      bar.className = 'lang-notice';
      bar.setAttribute('role', 'note');
      const main = document.querySelector('main');
      if (main) main.prepend(bar);
    }
    bar.textContent = data.notice[lang];
  }

  function setLang(next, persist) {
    lang = next;
    document.documentElement.lang = next;
    applyTo(document.body);
    applyMeta();
    notice();
    document.querySelectorAll('.lang-menu button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === next)));
    const cur = document.querySelector('.lang-current-flag');
    if (cur) cur.innerHTML = FLAGS[next];
    if (persist) write(next);
  }

  const FLAGS = {
    hu: '<svg viewBox="0 0 24 16" aria-hidden="true" focusable="false"><rect width="24" height="5.34" fill="#cd2a3e"/><rect y="5.33" width="24" height="5.34" fill="#fff"/><rect y="10.66" width="24" height="5.34" fill="#436f4d"/></svg>',
    en: '<svg viewBox="0 0 24 16" aria-hidden="true" focusable="false"><rect width="24" height="16" fill="#012169"/><path d="M0 0l24 16M24 0L0 16" stroke="#fff" stroke-width="3.2"/><path d="M0 0l24 16M24 0L0 16" stroke="#c8102e" stroke-width="1.3"/><path d="M12 0v16M0 8h24" stroke="#fff" stroke-width="5.2"/><path d="M12 0v16M0 8h24" stroke="#c8102e" stroke-width="3"/></svg>',
    de: '<svg viewBox="0 0 24 16" aria-hidden="true" focusable="false"><rect width="24" height="5.34" fill="#000"/><rect y="5.33" width="24" height="5.34" fill="#dd0000"/><rect y="10.66" width="24" height="5.34" fill="#ffce00"/></svg>'
  };

  function buildSwitch() {
    const nav = document.querySelector('.topbar .nav');
    if (!nav) return;
    const box = document.createElement('div');
    box.className = 'lang-switch';
    box.setAttribute('translate', 'no');
    box.innerHTML = '<button class="lang-toggle" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Nyelv / Language / Sprache" title="Nyelv / Language / Sprache">'
      + '<span class="lang-flag lang-current-flag">' + FLAGS[lang] + '</span>'
      + '<span class="lang-caret" aria-hidden="true">⌄</span></button>'
      + '<ul class="lang-menu" hidden></ul>';
    const toggle = box.querySelector('.lang-toggle');
    const menu = box.querySelector('.lang-menu');
    const close = () => { menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); };
    LANGS.forEach((l) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.lang = l.code;
      b.lang = l.code;
      b.setAttribute('aria-pressed', 'false');
      b.innerHTML = `<span class="lang-flag">${FLAGS[l.code]}</span><span>${l.name}</span>`;
      b.addEventListener('click', () => { setLang(l.code, true); close(); toggle.focus(); });
      li.appendChild(b);
      menu.appendChild(li);
    });
    toggle.addEventListener('click', () => {
      const open = menu.hidden;
      menu.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (e) => { if (!box.contains(e.target)) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    nav.appendChild(box);
  }

  function init() {
    pinOptionValues();
    buildSwitch();
    const fromUrl = new URLSearchParams(location.search).get('lang');
    const wanted = [fromUrl, read()].find((c) => LANGS.some((l) => l.code === c)) || 'hu';
    setLang(wanted, Boolean(fromUrl));

    // Később betöltődő tartalom (pl. szabad időpontok, hibaüzenetek) fordítása
    new MutationObserver((records) => {
      if (applying || lang === 'hu') return;
      records.forEach((r) => r.addedNodes.forEach((n) => {
        if (n.nodeType === 3 && n.parentElement) applyTo(n.parentElement);
        else if (n.nodeType === 1) applyTo(n);
      }));
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
