'use strict';
/* Proposte commerciali in PDF (Impostazioni → Proposte).
   Un solo motore di impaginazione (layoutPage) disegna sia l'anteprima SVG sia il PDF (jsPDF),
   con le misure del modello: A4 verticale, margini 50 pt, Jost Light, testo #6E6E6E, righe #C8272E,
   un prodotto per pagina. I prezzi si cambiano solo nella proposta, mai nel listino. */
window.Proposte = (function () {
  const PG = { w: 595.2756, h: 841.8898, m: 50 };
  PG.r = PG.w - PG.m;
  PG.cx = PG.w / 2;
  const RED = '#C8272E';
  const KEY = 'fima_proposte_v1';
  const PREFIX = 'PROPOSTA PER LAVORO ';
  const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

  let LIST = loadAll();
  let cur = null;       // proposta aperta nell'editor
  let view = 'form';    // da telefono: 'form' o 'prev'

  // ── salvataggio (localStorage, sempre con try/catch) ──
  function loadAll() {
    try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function saveAll() {
    try { localStorage.setItem(KEY, JSON.stringify(LIST)); return true; } catch (e) {
      toast('', 'Spazio del browser esaurito: elimina qualche proposta vecchia o carica foto più leggere.');
      return false;
    }
  }
  let saveT = null;
  function touch() {
    cur.updated = Date.now();
    const k = LIST.findIndex(x => x.id === cur.id);
    if (k >= 0) LIST[k] = cur; else LIST.unshift(cur);
    clearTimeout(saveT);
    saveT = setTimeout(() => { const ok = saveAll(); setSaved(ok ? 'Salvata' : 'Non salvata'); }, 350);
    setSaved('…');
  }
  function setSaved(t) { const el = document.getElementById('peSaved'); if (el) el.textContent = t; }

  // ── utilità ──
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const pad = n => String(n).padStart(2, '0');
  function todayISO() { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function dateIt(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? `${+m[3]} ${MESI[+m[2] - 1]} ${m[1]}` : '';
  }
  function parsePrice(s) {
    s = String(s == null ? '' : s).replace(/[€\s]/g, '');
    if (!s) return null;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const v = parseFloat(s);
    return isNaN(v) ? null : Math.round(v * 100) / 100;
  }
  const priceIt = v => fmt(v).replace('€ ', '');            // 1.234,50
  const titleText = pr => (pr.title || '').trim().toUpperCase();
  function caption(it) {
    const parts = [];
    if ((it.name || '').trim()) parts.push(it.name.trim());
    if (it.price != null) parts.push('€ ' + priceIt(it.price));
    return parts.join('   ·   ');
  }
  function fileName(pr) {
    const clean = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'e').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const t = clean(titleText(pr).replace(/^PROPOSTA(\s+PER\s+LAVORO)?\s*/, '')) || 'Proposta';
    return `Proposta_${t}_${clean(dateIt(pr.date)) || 'senza_data'}.pdf`;
  }
  function loadScript(src) {
    return new Promise((res, rej) => {
      if (document.querySelector(`script[data-lib="${src}"]`)) return res();
      const s = document.createElement('script');
      s.src = src; s.dataset.lib = src;
      s.onload = res; s.onerror = () => rej(new Error('Impossibile caricare ' + src));
      document.head.appendChild(s);
    });
  }

  // ── font: lo stesso file Jost Light per anteprima e PDF ──
  let fontP = null;
  function ensureFont() {
    if (!fontP) fontP = loadScript('lib/jost-light.js').then(() => {
      const bin = atob(window.JOST_LIGHT_TTF);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const ff = new FontFace('JostPDF', buf.buffer, { weight: '300' });
      document.fonts.add(ff);
      return ff.load();
    });
    return fontP;
  }
  let mctx = null;
  function measurePreview(s, size) {
    if (!mctx) { mctx = document.createElement('canvas').getContext('2d'); }
    mctx.font = `300 ${size}px JostPDF`;
    if ('fontKerning' in mctx) mctx.fontKerning = 'none';
    return mctx.measureText(s).width;
  }

  // ── immagini: ritaglio automatico del bianco, JPEG di buona qualità ──
  const IMGC = new Map();
  function loadImg(src) {
    return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
  }
  function trimBox(d) {
    const { data, width: w, height: h } = d;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      const row = y * w * 4;
      for (let x = 0; x < w; x++) {
        const i = row + x * 4;
        if (data[i] < 236 || data[i + 1] < 236 || data[i + 2] < 236) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          y1 = y;
        }
      }
    }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  function dataUrlToObjectUrl(u) {
    const [head, b64] = u.split(',');
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([buf], { type: head.slice(5).split(';')[0] }));
  }
  function prep(src) {
    if (!src) return Promise.resolve(null);
    if (IMGC.has(src)) return IMGC.get(src);
    const pr = loadImg(src).then(im => {
      const k = Math.min(1, 2400 / Math.max(im.naturalWidth, im.naturalHeight));
      const w = Math.round(im.naturalWidth * k), h = Math.round(im.naturalHeight * k);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
      g.drawImage(im, 0, 0, w, h);
      let box;
      // aperto come file (doppio clic) il browser non lascia leggere i pixel: niente ritaglio, e niente PDF
      try { box = trimBox(g.getImageData(0, 0, w, h)); } catch (e) { return { purl: src, w, h, blocked: true }; }
      if (!box) return null;
      const o = document.createElement('canvas');
      o.width = box.w; o.height = box.h;
      o.getContext('2d').drawImage(c, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
      const url = o.toDataURL('image/jpeg', 0.92);
      return { url, purl: dataUrlToObjectUrl(url), w: box.w, h: box.h };
    }).catch(() => null);
    IMGC.set(src, pr);
    return pr;
  }
  async function prepItem(it) {
    const [photo, tech] = await Promise.all([prep(it.photo), it.showTech ? prep(it.tech) : null]);
    return { photo, tech };
  }
  function readUpload(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => loadImg(fr.result).then(im => {
        const k = Math.min(1, 1800 / Math.max(im.naturalWidth, im.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
        const g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(im, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', 0.88));
      }, rej);
      fr.onerror = rej;
      fr.readAsDataURL(file);
    });
  }

  // ── impaginazione (misure del modello, in punti, y dall'alto) ──
  function fit(img, x, y, w, h) {
    const s = Math.min(w / img.w, h / img.h);
    const dw = img.w * s, dh = img.h * s;
    return { x: x + (w - dw) / 2, y: y + (h - dh) / 2, w: dw, h: dh };
  }
  function layoutPage(pr, it, im, measure) {
    const ops = [];
    const T = (s, x, y, size, align) => ops.push({ k: 't', s, x, y, size, align: align || 'left' });
    const L = (x1, x2, y, w) => ops.push({ k: 'l', x1, x2, y, w });
    // intestazione: titolo 24 pt a sinistra, data 10,5 pt a destra, riga rossa 0,8 pt
    T(titleText(pr), PG.m, 70, 24);
    T(dateIt(pr.date), PG.r, 67, 10.5, 'right');
    L(PG.m, PG.r, 84, 0.8);
    // foto centrata, alta al massimo 245 pt
    if (im.photo) ops.push(Object.assign({ k: 'i', img: im.photo }, fit(im.photo, PG.m, 110, PG.r - PG.m, 245)));
    // didascalia 17 pt con righe rosse 1,1 pt fino ai margini, a 18 pt dal testo
    const cap = caption(it);
    if (cap) {
      const tw = measure(cap, 17);
      const a = PG.cx - tw / 2 - 18, b = PG.cx + tw / 2 + 18;
      T(cap, PG.cx, 391, 17, 'center');
      if (a > PG.m) L(PG.m, a, 385, 1.1);
      if (b < PG.r) L(b, PG.r, 385, 1.1);
    }
    if ((it.code || '').trim()) T('Cod. ' + it.code.trim(), PG.cx, 410, 11, 'center');
    // scheda tecnica: disegno fino a 40 pt dal fondo
    if (it.showTech && im.tech) {
      T('SCHEDA TECNICA', PG.m, 433, 10);
      T('Quote in mm', PG.r, 433, 10, 'right');
      L(PG.m, PG.r, 439, 0.8);
      ops.push(Object.assign({ k: 'i', img: im.tech }, fit(im.tech, PG.m, 451, PG.r - PG.m, PG.h - 40 - 451)));
    }
    return ops;
  }
  function svgPage(ops) {
    let s = `<svg viewBox="0 0 ${PG.w} ${PG.h}" xmlns="http://www.w3.org/2000/svg">`;
    for (const o of ops) {
      if (o.k === 't') {
        const a = o.align === 'center' ? 'middle' : o.align === 'right' ? 'end' : 'start';
        s += `<text x="${o.x}" y="${o.y}" font-size="${o.size}" text-anchor="${a}" xml:space="preserve">${esc(o.s)}</text>`;
      } else if (o.k === 'l') {
        s += `<line x1="${o.x1}" y1="${o.y}" x2="${o.x2}" y2="${o.y}" stroke="${RED}" stroke-width="${o.w}"/>`;
      } else {
        s += `<image href="${esc(o.img.purl)}" x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" preserveAspectRatio="none"/>`;
      }
    }
    return s + '</svg>';
  }

  // ── elenco proposte (dentro Impostazioni) ──
  function listHTML() {
    LIST = loadAll();
    const rows = LIST.map(p => `<div class="saved-item"><div class="si"><b>${esc(titleText(p) || 'Senza titolo')}</b>
      <span>${esc(dateIt(p.date))} · ${p.items.length} ${p.items.length === 1 ? 'prodotto' : 'prodotti'} · modificata ${new Date(p.updated).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}</span></div>
      <div class="si-act"><button data-pact="open" data-id="${p.id}">Apri</button><button data-pact="dup" data-id="${p.id}">Duplica</button><button class="del" data-pact="del" data-id="${p.id}">Elimina</button></div></div>`).join('');
    return `<h2>Proposte</h2><p class="h">Proposte commerciali in PDF da mandare ai clienti: un prodotto per pagina con foto, prezzo e scheda tecnica. I prezzi che scrivi qui valgono solo per la proposta. Restano salvate in questo browser.</p>
      <button class="btn btn-red" data-pact="new">+ Nuova proposta</button>
      <div class="saved-list" style="margin-top:10px">${rows || '<p class="h" style="margin:14px 0 0">Nessuna proposta salvata.</p>'}</div>`;
  }
  document.getElementById('sModalBody').addEventListener('click', e => {
    const b = e.target.closest('[data-pact]');
    if (!b) return;
    const id = b.dataset.id, p = LIST.find(x => x.id === id);
    if (b.dataset.pact === 'new') open(null);
    else if (b.dataset.pact === 'open' && p) open(id);
    else if (b.dataset.pact === 'dup' && p) {
      const c = JSON.parse(JSON.stringify(p));
      c.id = uid(); c.title = (p.title || '').trim() + ' (copia)'; c.updated = Date.now();
      c.items.forEach(it => { it.id = uid(); });
      LIST.unshift(c);
      if (saveAll()) toast('', 'Proposta duplicata');
      openSettings('proposte');
    } else if (b.dataset.pact === 'del' && p) {
      if (!confirm('Eliminare la proposta “' + (titleText(p) || 'Senza titolo') + '”?')) return;
      LIST = LIST.filter(x => x.id !== id);
      saveAll();
      openSettings('proposte');
    }
  });

  // ── editor ──
  const root = document.createElement('div');
  root.className = 'pe';
  root.id = 'pe';
  root.innerHTML = `<div class="pe-bar">
      <button class="pe-back" data-act="back"><svg viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg><span>Proposte</span></button>
      <div class="pe-ttl"><b>Proposta</b><span id="peSaved"></span></div>
      <div class="pe-tabs"><button data-view="form">Modifica</button><button data-view="prev">Anteprima</button></div>
      <button class="btn btn-red pe-dl" data-act="pdf"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg><span>Scarica PDF</span></button>
    </div>
    <div class="pe-body"><div class="pe-form" id="peForm"></div><div class="pe-prev" id="pePrev"></div></div>`;
  document.body.appendChild(root);
  const form = root.querySelector('#peForm'), prevBox = root.querySelector('#pePrev');

  function open(id) {
    const src = id ? LIST.find(x => x.id === id) : null;
    cur = src ? JSON.parse(JSON.stringify(src)) : { id: uid(), title: PREFIX, date: todayISO(), items: [], updated: Date.now() };
    closeSettings();
    view = 'form';
    root.classList.add('open');
    document.body.style.overflow = 'hidden';
    setSaved(src ? 'Salvata' : '');
    renderForm();
    renderPreview();
  }
  function back() {
    clearTimeout(saveT);
    if (cur && LIST.some(x => x.id === cur.id)) saveAll();
    root.classList.remove('open');
    document.body.style.overflow = '';
    cur = null;
    openSettings('proposte');
  }
  const isOpen = () => root.classList.contains('open');

  function setView(v) {
    view = v;
    root.dataset.view = v;
    root.querySelectorAll('.pe-tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  }

  function itemHTML(it, i, n) {
    const ph = it.photo ? `<img src="${esc(it.photo)}" alt="">` : '<span>Nessuna foto</span>';
    const tc = it.tech ? `<img src="${esc(it.tech)}" alt="">` : '<span>Nessun disegno</span>';
    return `<section class="pe-card pe-item" data-i="${i}">
      <div class="pe-ihead"><b>Pagina ${i + 1}</b><span class="sp"></span>
        <button class="pe-ib" data-act="up" title="Sposta su" ${i ? '' : 'disabled'}><svg viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round"><path d="M6 15l6-6 6 6"/></svg></button>
        <button class="pe-ib" data-act="down" title="Sposta giù" ${i < n - 1 ? '' : 'disabled'}><svg viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg></button>
        <button class="pe-ib del" data-act="del" title="Elimina"><svg viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button></div>
      <div class="pe-igrid">
        <div class="pe-media"><div class="pe-thumb">${ph}</div>
          <div class="pe-mbtn"><label class="pe-up">${it.photo ? 'Cambia' : 'Carica'} foto<input type="file" accept="image/*" data-up="photo"></label>${it.photo ? '<button data-act="rmphoto">Togli</button>' : ''}</div></div>
        <div class="pe-fields">
          <label class="pe-f"><span>Nome</span><input class="pe-in" data-k="name" value="${esc(it.name)}" placeholder="es. MAST"></label>
          <label class="pe-f"><span>Codice</span><input class="pe-in" data-k="code" value="${esc(it.code)}" placeholder="es. F3131"></label>
          <label class="pe-f"><span>Prezzo €</span><input class="pe-in" data-k="price" inputmode="decimal" value="${it.price == null ? '' : esc(priceIt(it.price))}" placeholder="0,00"></label>
          ${it.list != null ? `<small class="pe-hint">Listino ${esc(fmt(it.list))} · il prezzo cambia solo nella proposta</small>` : ''}
        </div>
      </div>
      <div class="pe-tech">
        <div class="pe-thumb sm">${tc}</div>
        <div class="pe-tinfo">
          <label class="pe-sw"><input type="checkbox" data-k="showTech" ${it.showTech ? 'checked' : ''}><span></span>Mostra scheda tecnica</label>
          ${it.showTech && !it.tech ? '<small class="pe-warn">Manca il disegno tecnico: caricalo per mostrarlo</small>' : ''}
          <div class="pe-mbtn"><label class="pe-up">${it.tech ? 'Cambia' : 'Carica'} disegno<input type="file" accept="image/*" data-up="tech"></label>${it.tech ? '<button data-act="rmtech">Togli</button>' : ''}</div>
        </div>
      </div>
    </section>`;
  }
  function renderForm() {
    const nCart = CART.length;
    form.innerHTML = `<section class="pe-card">
        <h3>Intestazione</h3>
        <label class="pe-f"><span>Titolo</span><input class="pe-in pe-up-txt" data-f="title" value="${esc(cur.title)}" placeholder="PROPOSTA PER LAVORO ___"></label>
        <label class="pe-f"><span>Data</span><input class="pe-in" type="date" data-f="date" value="${esc(cur.date)}"></label>
        <small class="pe-hint" id="peDateTxt">Nel PDF: ${esc(dateIt(cur.date))}</small>
      </section>
      <section class="pe-card">
        <h3>Aggiungi prodotto</h3>
        <div class="pe-search"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
          <input class="pe-in" id="peQ" type="search" placeholder="Cerca nel catalogo: nome o codice" autocomplete="off"></div>
        <div class="pe-res" id="peRes"></div>
        <div class="pe-addrow"><button class="btn btn-ghost" data-act="manual">+ A mano</button>
          <button class="btn btn-ghost" data-act="cart" ${nCart ? '' : 'disabled'}>+ Dal carrello${nCart ? ` (${nCart})` : ''}</button></div>
      </section>
      <div id="peItems">${cur.items.map((it, i) => itemHTML(it, i, cur.items.length)).join('') ||
        '<div class="pe-empty">Nessun prodotto: cercane uno nel catalogo o aggiungilo a mano. Ogni prodotto occupa una pagina del PDF.</div>'}</div>`;
    setView(view);
  }

  // anteprima dal vivo (stesso motore del PDF)
  let prevT = null, prevTok = 0;
  function renderPreview() {
    clearTimeout(prevT);
    prevT = setTimeout(async () => {
      const tok = ++prevTok;
      await ensureFont().catch(() => {});
      const pages = [];
      const items = cur.items.length ? cur.items : [null];
      for (const it of items) {
        const im = it ? await prepItem(it) : {};
        pages.push(layoutPage(cur, it || { name: '', code: '', price: null }, im, measurePreview));
      }
      if (tok !== prevTok || !cur) return;
      prevBox.innerHTML = pages.map((ops, i) => `<div class="pe-plabel">${cur.items.length ? `Pagina ${i + 1} di ${pages.length}` : 'Anteprima'}</div>
        <div class="pe-page">${svgPage(ops)}${cur.items.length ? '' : '<div class="pe-phint">Aggiungi un prodotto per vedere la pagina</div>'}</div>`).join('');
      root.querySelector('.pe-tabs [data-view="prev"]').textContent = `Anteprima (${cur.items.length})`;
    }, 120);
  }

  function changed(structure) {
    touch();
    if (structure) renderForm();
    renderPreview();
  }

  function addProduct(p) {
    cur.items.push({ id: uid(), name: p.s.toUpperCase(), code: p.c, price: Math.round(net(p.min) * 100) / 100, list: p.min,
      photo: p.im ? IMG(p.im) : '', tech: p.tc ? IMG(p.tc) : '', showTech: !!p.tc });
    changed(true);
    toast(p.im, `<b>${esc(p.c)}</b> aggiunto alla proposta`);
  }
  function searchCatalog(q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const nq = norm(q), seen = new Set(), out = [];
    for (const p of P) {
      if (seen.has(p.c)) continue;
      if (words.every(w => p.sl.includes(w) || p.s_.includes(norm(w)))) { seen.add(p.c); out.push(p); }
    }
    // prima il codice esatto, poi i codici che iniziano così, poi serie/nome (non le descrizioni)
    const head = p => (p.c + ' ' + p.s + ' ' + p.n).toLowerCase();
    const rank = p => (norm(p.c) === nq ? 0 : norm(p.c).startsWith(nq) ? 1 : words.every(w => head(p).includes(w)) ? 2 : 3);
    return out.sort((a, b) => rank(a) - rank(b)).slice(0, 12);
  }

  // ── eventi (delegati: niente nomi o codici dentro onclick) ──
  root.addEventListener('click', async e => {
    const tabB = e.target.closest('.pe-tabs button');
    if (tabB) { setView(tabB.dataset.view); return; }
    const res = e.target.closest('[data-add]');
    if (res) {
      addProduct(P[+res.dataset.add]);
      const q = form.querySelector('#peQ'); q.value = ''; form.querySelector('#peRes').innerHTML = '';
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const card = b.closest('.pe-item'), i = card ? +card.dataset.i : -1;
    switch (b.dataset.act) {
      case 'back': back(); break;
      case 'pdf': downloadPdf(b); break;
      case 'manual':
        cur.items.push({ id: uid(), name: '', code: '', price: null, list: null, photo: '', tech: '', showTech: true });
        changed(true);
        setTimeout(() => { const c = form.querySelector(`.pe-item[data-i="${cur.items.length - 1}"] [data-k="name"]`); if (c) { c.scrollIntoView({ block: 'center' }); c.focus(); } }, 50);
        break;
      case 'cart':
        CART.forEach(c => {
          const p = BY_CODE[c.pc];
          const unit = c.price * discMul(S.disc) * (1 - (parseFloat(c.disc) || 0) / 100);
          cur.items.push({ id: uid(), name: (c.coll || '').toUpperCase(), code: c.code, price: Math.round(unit * 100) / 100, list: c.price,
            photo: c.im ? IMG(c.im) : '', tech: p && p.tc ? IMG(p.tc) : '', showTech: !!(p && p.tc) });
        });
        changed(true);
        toast('', `${CART.length} prodotti dal carrello aggiunti`);
        break;
      case 'up': if (i > 0) { [cur.items[i - 1], cur.items[i]] = [cur.items[i], cur.items[i - 1]]; changed(true); } break;
      case 'down': if (i < cur.items.length - 1) { [cur.items[i + 1], cur.items[i]] = [cur.items[i], cur.items[i + 1]]; changed(true); } break;
      case 'del': if (confirm('Togliere “' + (cur.items[i].code || cur.items[i].name || 'prodotto') + '” dalla proposta?')) { cur.items.splice(i, 1); changed(true); } break;
      case 'rmphoto': cur.items[i].photo = ''; changed(true); break;
      case 'rmtech': cur.items[i].tech = ''; changed(true); break;
    }
  });
  root.addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'peQ') {
      const q = t.value.trim();
      const box = form.querySelector('#peRes');
      if (q.length < 2) { box.innerHTML = ''; return; }
      const r = searchCatalog(q);
      box.innerHTML = r.length ? r.map(p => `<button class="pe-ri" data-add="${p.i}">${p.im ? `<img src="${IMG(p.im)}" alt="">` : '<span class="noimg"></span>'}
          <span class="pe-rt"><b>${esc(p.c)}</b><small>${esc(p.s)} · ${esc(p.n)}</small></span><span class="pe-rp">${esc(fmt(p.min))}</span><span class="pe-plus">+</span></button>`).join('')
        : '<div class="pe-none">Nessun prodotto trovato: puoi aggiungerlo a mano.</div>';
      return;
    }
    if (t.dataset.f) {
      cur[t.dataset.f] = t.value;
      if (t.dataset.f === 'date') form.querySelector('#peDateTxt').textContent = 'Nel PDF: ' + dateIt(t.value);
      changed(false);
      return;
    }
    const card = t.closest('.pe-item');
    if (!card || !t.dataset.k) return;
    const it = cur.items[+card.dataset.i];
    if (t.dataset.k === 'price') it.price = parsePrice(t.value);
    else if (t.dataset.k === 'showTech') { it.showTech = t.checked; changed(true); return; }
    else it[t.dataset.k] = t.value;
    changed(false);
  });
  root.addEventListener('change', async e => {
    const t = e.target;
    if (t.dataset.k === 'price') { const it = cur.items[+t.closest('.pe-item').dataset.i]; t.value = it.price == null ? '' : priceIt(it.price); return; }
    if (!t.dataset.up || !t.files || !t.files[0]) return;
    const it = cur.items[+t.closest('.pe-item').dataset.i];
    try {
      it[t.dataset.up] = await readUpload(t.files[0]);
      if (t.dataset.up === 'tech') it.showTech = true;
      changed(true);
    } catch (err) { toast('', 'Immagine non leggibile: prova con un JPG o PNG'); }
  });

  // ── PDF ──
  async function buildPdf(pr) {
    await Promise.all([loadScript('lib/jspdf.umd.min.js'), ensureFont()]);
    const doc = new window.jspdf.jsPDF({ unit: 'pt', format: [PG.w, PG.h], orientation: 'portrait', compress: true });
    doc.addFileToVFS('Jost-Light.ttf', window.JOST_LIGHT_TTF);
    doc.addFont('Jost-Light.ttf', 'Jost-Light', 'normal');
    doc.setFont('Jost-Light', 'normal');
    doc.setTextColor(110, 110, 110);
    doc.setDrawColor(200, 39, 46);
    const measure = (s, size) => { doc.setFontSize(size); return doc.getTextWidth(s); };
    const alias = new Map();
    for (let n = 0; n < pr.items.length; n++) {
      if (n) doc.addPage([PG.w, PG.h], 'portrait');
      // rosso #C8272E esatto: setDrawColor di jsPDF arrotonda a 2 decimali (#C7262E)
      doc.internal.write('0.7843 0.1529 0.1804 RG');
      const im = await prepItem(pr.items[n]);
      if ((im.photo && im.photo.blocked) || (im.tech && im.tech.blocked)) throw new Error('blocked');
      for (const o of layoutPage(pr, pr.items[n], im, measure)) {
        if (o.k === 't') { doc.setFontSize(o.size); doc.text(o.s, o.x, o.y, o.align === 'left' ? undefined : { align: o.align }); }
        else if (o.k === 'l') { doc.setLineWidth(o.w); doc.line(o.x1, o.y, o.x2, o.y); }
        else {
          if (!alias.has(o.img.url)) alias.set(o.img.url, 'im' + alias.size);
          doc.addImage(o.img.url, 'JPEG', o.x, o.y, o.w, o.h, alias.get(o.img.url));
        }
      }
    }
    doc.setProperties({ title: titleText(pr), creator: 'Listino FIMA' });
    return doc;
  }
  async function downloadPdf(btn) {
    if (!cur.items.length) { toast('', 'Aggiungi almeno un prodotto alla proposta'); return; }
    const lbl = btn.querySelector('span'), old = lbl.textContent;
    btn.disabled = true; lbl.textContent = 'Creo il PDF…';
    try {
      const doc = await buildPdf(cur);
      doc.save(fileName(cur));
      toast('', 'PDF scaricato: ' + esc(fileName(cur)));
    } catch (err) {
      console.error(err);
      toast('', err.message === 'blocked'
        ? 'Aperto come file il browser blocca le foto nel PDF: usa il sito online per scaricarlo.'
        : 'Non sono riuscito a creare il PDF: ' + esc(err.message || err));
    } finally {
      btn.disabled = false; lbl.textContent = old;
    }
  }

  return { listHTML, open, back, isOpen, buildPdf, fileName, _state: () => cur };
})();
