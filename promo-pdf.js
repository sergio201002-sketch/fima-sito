'use strict';
/* PDF di promo e prezzi netti (pagina "Promo e netti" → Esporta PDF), impaginato come i listini netti FIMA:
   A4, titolo di serie grande, per ogni prodotto nome e punti a sinistra, foto al centro e a destra la tabella
   CONFEZIONE / PREZZO UNITARIO con un filetto sotto ogni riga. Esporta quello che si vede (filtro e ricerca),
   con i prezzi come sul sito (netti 2024 già aumentati) e, sotto i codici in promo, i pezzi per ogni sconto. */
window.PromoPdf = (function () {
  const W = 595.28, H = 841.89;
  const LX = 18, RX = 577;              // margini come il listino netti (filetti quasi da bordo a bordo)
  const IX = 213, IW = 113, IH = 125;   // colonna foto
  const TX = 407, QX = 512, EX = 535;   // tabella: codice, confezione (centro), simbolo €; prezzo allineato a RX
  const TOP = 14, BOTTOM = 800, MIN_H = 154;
  const INK = '#231F20', GREY = '#6B6C6F', RED = '#C0102A';
  const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

  function loadScript(src) {
    return new Promise((res, rej) => {
      if (document.querySelector(`script[data-lib="${src}"]`)) return res();
      const s = document.createElement('script');
      s.src = src; s.dataset.lib = src;
      s.onload = res; s.onerror = () => rej(new Error('Impossibile caricare ' + src));
      document.head.appendChild(s);
    });
  }
  function loadImg(src) {
    return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
  }
  // foto: bianco ritagliato, lato lungo 520 px, JPEG (213 foto restano un PDF leggero)
  async function prepImg(src) {
    const im = await loadImg(src);
    const k = Math.min(1, 520 / Math.max(im.naturalWidth, im.naturalHeight));
    const w = Math.round(im.naturalWidth * k), h = Math.round(im.naturalHeight * k);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    g.imageSmoothingQuality = 'high';
    g.drawImage(im, 0, 0, w, h);
    let d;
    try { d = g.getImageData(0, 0, w, h).data; } catch (e) { throw new Error('blocked'); }
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i] < 238 || d[i + 1] < 238 || d[i + 2] < 238) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
    }
    if (x1 < 0) return null;
    const o = document.createElement('canvas');
    o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
    o.getContext('2d').drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
    return { url: o.toDataURL('image/jpeg', 0.86), w: o.width, h: o.height };
  }

  const today = () => { const d = new Date(); return `${d.getDate()} ${MESI[d.getMonth()]} ${d.getFullYear()}`; };
  const isoToday = () => new Date().toISOString().slice(0, 10);
  const price = v => fmt(v).replace('€ ', '');
  // i font standard del PDF non hanno il segno meno tipografico
  const pdfTxt = s => String(s).replace(/−/g, '-');
  function docTitle(show) {
    const k = new Set(show.map(v => v.g.k));
    return k.size > 1 ? 'Promo e prezzi netti' : k.has('promo') ? 'Promo' : 'Prezzi netti';
  }
  function fileName(show, pre) {
    const clean = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const g = show.length === 1 ? show[0].g : null;
    const t = g ? (g.k === 'promo' ? 'Promo ' : 'Netti ') + prTitle(g) : docTitle(show);
    return `${clean((pre ? pre + ' ' : '') + t)}_FIMA_${isoToday()}.pdf`;
  }

  async function build(show, progress) {
    await Promise.all([loadScript('lib/jspdf.umd.min.js'), loadScript('lib/jost-light.js')]);
    const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait', compress: true });
    doc.addFileToVFS('Jost-Light.ttf', window.JOST_LIGHT_TTF);
    doc.addFont('Jost-Light.ttf', 'Jost-Light', 'normal');

    // foto prima di tutto (6 alla volta), con il conteggio sul pulsante; per le colonne doccia anche soffioni e doccette
    const srcs = [...new Set(show.flatMap(v => v.ii.flatMap(i => {
      const x = v.g.items[i];
      return [x.hi || x.im, ...(x.m || []).flatMap(t => [...t.h.map(h => h.im), ...t.rw.map(w => w.im)])];
    })).filter(Boolean))];
    const pics = new Map();
    let done = 0;
    progress && progress(0, srcs.length);
    const queue = srcs.slice();
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (queue.length) {
        const s = queue.shift();
        try { pics.set(s, await prepImg(IMG(s))); } catch (e) { if (e.message === 'blocked') throw e; pics.set(s, null); }
        progress && progress(++done, srcs.length);
      }
    }));

    const font = (f, st, size, col) => { doc.setFont(f, st); doc.setFontSize(size); doc.setTextColor(col || INK); };
    const hline = (x1, x2, y, w) => { doc.setDrawColor(INK); doc.setLineWidth(w || 0.5); doc.line(x1, y, x2, y); };
    const alias = new Map();
    let page = 1;

    function footer() {
      // logo "fima | CARLO FRATTINI rubinetterie" al centro, numero di pagina sul bordo esterno
      font('Jost-Light', 'normal', 17);
      const fw = doc.getTextWidth('fima');
      font('helvetica', 'normal', 5.6);
      const cw = doc.getTextWidth('CARLO FRATTINI') + 13 * 0.35;
      const x = (W - (fw + 7 + cw)) / 2;
      font('Jost-Light', 'normal', 17); doc.text('fima', x, 830);
      doc.setFillColor(RED); doc.rect(x + fw + 3, 817.5, 0.9, 19, 'F');
      font('helvetica', 'normal', 5.6); doc.text('CARLO FRATTINI', x + fw + 7, 826.5, { charSpace: 0.35 });
      font('helvetica', 'normal', 4.2, RED); doc.text('rubinetterie', x + fw + 7, 831.5, { charSpace: 1.05 });
      font('helvetica', 'normal', 8);
      if (page % 2) doc.text(String(page), RX, 830, { align: 'right' }); else doc.text(String(page), LX, 830);
    }
    function newPage() { doc.addPage('a4', 'portrait'); page++; footer(); }
    function bigTitle(t, x, y, size) {
      font('Jost-Light', 'normal', size, RED);
      doc.text(t[0], x, y);
      const w0 = doc.getTextWidth(t[0]);
      font('Jost-Light', 'normal', size, INK);
      doc.text(t.slice(1), x + w0, y);
    }
    // etichetta PROMO (rossa) / NETTI (nera) come sul sito
    function badgeW(k, size) { font('helvetica', 'bold', size); return doc.getTextWidth(k === 'promo' ? 'PROMO' : 'NETTI') + 4 * size * 0.12 + size * 1.6; }
    function badge(k, x, y, size) {
      const w = badgeW(k, size);
      font('helvetica', 'bold', size, '#FFFFFF');
      doc.setFillColor(k === 'promo' ? RED : INK);
      doc.roundedRect(x, y, w, size * 1.9, 2, 2, 'F');
      doc.text(k === 'promo' ? 'PROMO' : 'NETTI', x + size * 0.8, y + size * 1.32, { charSpace: size * 0.12 });
      return w;
    }

    function addPic(pic, x, y, w, h) {
      if (!alias.has(pic.url)) alias.set(pic.url, 'f' + alias.size);
      doc.addImage(pic.url, 'JPEG', x, y, w, h, alias.get(pic.url));
    }
    // immagine dentro un riquadro: centrata in orizzontale, appoggiata in basso (soffioni) o centrata (doccette)
    function fitPic(src, cx, top, bw, bh, mid) {
      const pic = pics.get(src);
      if (!pic) return;
      const k = Math.min(bw / pic.w, bh / pic.h), w = pic.w * k, h = pic.h * k;
      addPic(pic, cx - w / 2, mid ? top + (bh - h) / 2 : top + bh - h, w, h);
    }
    // colonne doccia, come nel PDF promo FIMA: foto alta a sinistra, nome e punti, poi le tabelle con i soffioni
    // in colonna e le doccette in riga, in ogni casella a bordo rosso il codice sopra e il prezzo sotto.
    // Dalla selezione: solo le righe e le colonne con codici spuntati (le altre caselle restano vuote).
    const MX = 178, CW = 85, CODE_H = 21, HEAD_H = 46, PHOTO_W = 132;
    function matrixBlock(g, x, sel, y) {
      const on = ri => ri >= 0 && (!sel || sel.has(ri));
      const T = x.m.map(t => {
        const cols = t.h.map((h, j) => j).filter(j => t.rw.some(w => on(w.c[j])));
        return { h: t.h, cols, rws: t.rw.filter(w => cols.some(j => on(w.c[j]))) };
      }).filter(t => t.cols.length);
      if (!T.length) return y;
      const tiers = ri => { font('helvetica', 'bold', 6, RED); return on(ri) ? doc.splitTextToSize(pdfTxt(prTierTxt(g, x.r[ri])), CW - 6) : []; };
      T.forEach(t => t.rws.forEach(w => { w._ph = 15 + Math.max(0, ...t.cols.map(j => tiers(w.c[j]).length)) * 7; }));
      const tablesH = T.reduce((a, t) => a + HEAD_H + t.rws.reduce((b, w) => b + CODE_H + w._ph, 0) + 18, 0);
      font('helvetica', 'bold', 9);
      const tl = doc.splitTextToSize(pdfTxt((x.t || x.r[0].c).toUpperCase()), 215);
      font('helvetica', 'normal', 8.5);
      const bl = x.d.flatMap(d => doc.splitTextToSize('• ' + pdfTxt(d), RX - MX));
      const gift = prGift(g, x);
      font('helvetica', 'bold', 7.5);
      const gl = gift ? doc.splitTextToSize(pdfTxt(gift), RX - MX) : [];
      const textH = 20 + (tl.length - 1) * 11 + (bl.length ? 6 + bl.length * 10.5 : 0) + (gl.length ? 6 + gl.length * 9 : 0) + 16;
      const pic = pics.get(x.hi || x.im);
      let pw = 0, ph = 0;
      if (pic) { const k = Math.min(PHOTO_W / pic.w, Math.max(textH + tablesH - 30, 260) / pic.h); pw = pic.w * k; ph = pic.h * k; }
      const h = Math.max(textH + tablesH, ph + 20);
      if (y + h > BOTTOM) { hline(LX, RX, y); newPage(); y = TOP; }
      const y0 = y;
      hline(LX, RX, y0);
      if (pic) addPic(pic, LX + (PHOTO_W - pw) / 2, y0 + 10, pw, ph);
      // nome e punti
      font('helvetica', 'bold', 9);
      doc.text(tl, MX, y0 + 20, { lineHeightFactor: 11 / 9 });
      let ty = y0 + 20 + (tl.length - 1) * 11 + 16;
      font('helvetica', 'normal', 8.5);
      bl.forEach(l => { doc.text(l, MX, ty); ty += 10.5; });
      if (gl.length) { font('helvetica', 'bold', 7.5, RED); ty += 4; gl.forEach(l => { doc.text(l, MX, ty); ty += 9; }); }
      // tabelle
      ty = y0 + textH;
      T.forEach(t => {
        t.cols.forEach((j, k) => {
          const hd = t.h[j], cx = MX + k * CW + CW / 2;
          if (hd.im) fitPic(hd.im, cx, ty, 64, 25);
          font('helvetica', 'normal', 6.3); doc.text(pdfTxt(hd.a), cx, ty + 34, { align: 'center' });
          font('helvetica', 'bold', 6.5); doc.text(pdfTxt(hd.b), cx, ty + 41.5, { align: 'center' });
        });
        let ry = ty + HEAD_H;
        t.rws.forEach(w => {
          if (w.im) fitPic(w.im, MX - 13, ry + 3, 16, CODE_H + w._ph - 6, true);
          t.cols.forEach((j, k) => {
            if (!on(w.c[j])) return;
            const r = x.r[w.c[j]], cx0 = MX + k * CW, cx = cx0 + CW / 2;
            doc.setDrawColor(RED); doc.setLineWidth(0.6);
            doc.rect(cx0, ry, CW, CODE_H); doc.rect(cx0, ry + CODE_H, CW, w._ph);
            font('helvetica', 'normal', 7.5); doc.text(r.c, cx, ry + 13.3, { align: 'center' });
            doc.text('€ ' + price(prPrice(g, r)), cx, ry + CODE_H + 10.5, { align: 'center' });
            const tt = tiers(w.c[j]);
            if (tt.length) { font('helvetica', 'bold', 6, RED); doc.text(tt, cx, ry + CODE_H + 18, { align: 'center', lineHeightFactor: 7 / 6 }); }
          });
          ry += CODE_H + w._ph;
        });
        ty = ry + 18;
      });
      return y0 + h;
    }

    // ── copertina ──
    const title = docTitle(show).toUpperCase();
    const lines = title.length > 14 ? title.replace(' E ', ' E|').split('|') : [title];
    lines.forEach((l, i) => bigTitle(l, 60, 300 + i * 46, 44));
    let cy = 300 + (lines.length - 1) * 46;
    doc.setFillColor(RED); doc.rect(62, cy + 18, 40, 1.4, 'F');
    font('Jost-Light', 'normal', 12, GREY); doc.text('FIMA CARLO FRATTINI', 62, cy + 42, { charSpace: 2 });
    font('helvetica', 'normal', 9, GREY); doc.text('Aggiornato al ' + today(), 62, cy + 60);
    cy += 110;
    [['promo', 'Promo'], ['netti', 'Prezzi netti']].forEach(([k, l]) => {
      const gs = show.filter(v => v.g.k === k);
      if (!gs.length) return;
      badge(k, 62, cy - 10, 7.5);
      font('helvetica', 'normal', 9.5);
      // a capo solo tra un listino e l'altro ("Corpi incasso" non si spezza)
      const txt = [];
      gs.forEach(v => {
        const n = prTitle(v.g), last = txt.length ? txt[txt.length - 1] + '  ·  ' + n : n;
        if (txt.length && doc.getTextWidth(last) <= 400) txt[txt.length - 1] = last; else txt.push(n);
      });
      doc.text(txt, 115, cy);
      cy += txt.length * 13 + 14;
    });
    footer();

    // ── un listino per volta, ognuno da pagina nuova ──
    for (const v of show) {
      const g = v.g;
      newPage();
      bigTitle(prTitle(g).toUpperCase(), 34, 116, 35);
      font('Jost-Light', 'normal', 11, GREY);
      doc.text(g.k === 'promo' ? 'PROMO FIMA ' + g.y : 'PREZZI NETTI', 35, 134, { charSpace: 1.2 });
      badge(g.k, RX - badgeW(g.k, 9), 96, 9);
      const notes = [...g.notes];
      if (prTiersOf(g).length) notes.push(PR_TIER_NOTE);
      let y = 156;
      font('helvetica', 'normal', 8);
      notes.forEach(n => { const t = doc.splitTextToSize(pdfTxt(n), RX - 34); doc.text(t, 35, y); y += t.length * 10.5; });
      y = Math.max(169, y + 8);

      for (const i of v.ii) {
        if (g.items[i].m) { y = matrixBlock(g, g.items[i], v.rows && v.rows[i] ? new Set(v.rows[i]) : null, y); continue; }
        // dalla selezione: solo i codici spuntati della scheda
        const x = v.rows && v.rows[i] ? { ...g.items[i], r: v.rows[i].map(k => g.items[i].r[k]).filter(Boolean) } : g.items[i];
        if (!x.r.length) continue;
        // misure: testo a sinistra, tabella a destra, foto in mezzo alta quanto serve
        font('helvetica', 'bold', 8);
        const tl = doc.splitTextToSize(pdfTxt(x.t || x.r[0].c), 185);
        font('helvetica', 'normal', 8);
        const bl = x.d.flatMap(d => doc.splitTextToSize('• ' + pdfTxt(d), 185));
        const gift = prGift(g, x);
        font('helvetica', 'bold', 7);
        const gl = gift ? doc.splitTextToSize(pdfTxt(gift), 185) : [];
        const textH = 13 + (tl.length - 1) * 9.5 + (bl.length ? 4 + bl.length * 9 : 0) + (gl.length ? 6 + gl.length * 8.5 : 0);
        const hasQ = x.r.some(r => r.q);
        const rows = x.r.map(r => {
          const sub = r.l ? prLabel(r.l) : '', tier = prTierTxt(g, r);
          return { r, sub, tier, h: 11 + (sub ? 7 : 0) + (tier ? 7 : 0) };
        });
        const tableH = 29 + rows.reduce((a, o) => a + o.h, 0);
        const pic = pics.get(x.hi || x.im);
        const maxH = tableH > IH + 15 ? Math.min(tableH - 10, 300) : IH;
        let pw = 0, ph = 0;
        if (pic) { const k = Math.min(IW / pic.w, maxH / pic.h); pw = pic.w * k; ph = pic.h * k; }
        const h = Math.max(MIN_H, textH + 12, ph + 17, tableH + 12);
        if (y + h > BOTTOM) { hline(LX, RX, y); newPage(); y = TOP; }
        const y0 = y;
        hline(LX, RX, y0);
        // testo
        font('helvetica', 'bold', 8);
        doc.text(tl, LX, y0 + 13, { lineHeightFactor: 9.5 / 8 });
        let ty = y0 + 13 + (tl.length - 1) * 9.5 + 12;
        font('helvetica', 'normal', 8);
        bl.forEach(l => { doc.text(l, LX, ty); ty += 9; });
        if (gl.length) { font('helvetica', 'bold', 7, RED); ty += 3; gl.forEach(l => { doc.text(l, LX, ty); ty += 8.5; }); }
        // foto
        if (pic) {
          if (!alias.has(pic.url)) alias.set(pic.url, 'f' + alias.size);
          doc.addImage(pic.url, 'JPEG', IX + (IW - pw) / 2, y0 + 5, pw, ph, alias.get(pic.url));
        }
        // tabella
        if (hasQ) {   // scatolina e CONFEZIONE
          doc.setDrawColor(GREY); doc.setLineWidth(0.6);
          const bx = QX - 6, by = y0 + 9;
          doc.rect(bx, by, 10, 8);
          doc.lines([[3, -3], [10, 0], [-3, 3]], bx, by);
          doc.lines([[3, -3], [0, 8], [-3, 3]], bx + 10, by);
          font('helvetica', 'bold', 6.5); doc.text('CONFEZIONE', QX, y0 + 27, { align: 'center' });
        }
        font('helvetica', 'bold', 6.5);
        doc.text('PREZZO', RX, y0 + 20.5, { align: 'right' });
        doc.text('UNITARIO', RX, y0 + 27, { align: 'right' });
        hline(TX, RX, y0 + 29);
        let ry = y0 + 29;
        rows.forEach(o => {
          font('helvetica', 'bold', 7.5); doc.text(o.r.c, TX, ry + 8);
          font('helvetica', 'normal', 7.5);
          if (o.r.q) { font('helvetica', 'normal', 8); doc.text(String(o.r.q), QX, ry + 8, { align: 'center' }); font('helvetica', 'normal', 7.5); }
          doc.text('€', EX, ry + 8);
          doc.text(price(prPrice(g, o.r)), RX, ry + 8, { align: 'right' });
          let sy = ry + 8;
          if (o.sub) { sy += 7; font('helvetica', 'normal', 6.3, GREY); doc.text(pdfTxt(o.sub), TX, sy); }
          if (o.tier) { sy += 7; font('helvetica', 'bold', 6.3, RED); doc.text(pdfTxt(o.tier), TX, sy); }
          ry += o.h;
          hline(TX, RX, ry);
        });
        y = y0 + h;
      }
      hline(LX, RX, y);
    }
    doc.setProperties({ title: docTitle(show) + ' FIMA', creator: 'Listino FIMA' });
    return doc;
  }

  return { build, fileName };
})();
