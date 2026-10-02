// Diagrammalar — kutubxonasiz SVG. dataviz qoidalari:
//  • ustun ≤ 24px, 4px yumaloq uch, pastki qismi to'g'ri; chiziq 2px; nuqta r≥4 + 2px sirt halqasi;
//  • grid — 1px ingichka, uzluksiz; bitta seriya — legenda yo'q, sarlavha nomlaydi;
//  • hover/fokusda tooltip (qiymat yirik, nom ikkinchi darajali); har diagrammaning jadval ko'rinishi bor;
//  • matn doim matn ranglarida, seriya rangida emas. Foydalanuvchi matni faqat textContent orqali.
(function () {
  const NS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs = {}) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  }

  function htmlEl(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- Halqa (Apple Fitness uslubida) ----------
  function ring({ size = 96, stroke = 12, value = 0, color = 'var(--chart-good)', label, sublabel }) {
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const pct = Math.max(0, Math.min(100, value || 0));
    const wrap = htmlEl('div', 'ring');
    wrap.style.cssText = `position:relative;width:${size}px;height:${size}px`;
    const svg = svgEl('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, role: 'img', 'aria-label': `${label || ''} ${sublabel || ''}`.trim() });
    const g = svgEl('g', { transform: `rotate(-90 ${size / 2} ${size / 2})` });
    g.append(svgEl('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: 'var(--chart-track)', 'stroke-width': stroke }));
    const arc = svgEl('circle', {
      cx: size / 2, cy: size / 2, r, fill: 'none', stroke: color, 'stroke-width': stroke, 'stroke-linecap': 'round',
      'stroke-dasharray': c, 'stroke-dashoffset': c,
    });
    arc.style.transition = 'stroke-dashoffset 1100ms var(--spring)';
    g.append(arc);
    svg.append(g);
    wrap.append(svg);
    if (label !== undefined) {
      const center = htmlEl('div');
      center.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.05';
      const main = htmlEl('b', '', label);
      main.style.cssText = `font-size:${Math.round(size * 0.24)}px;font-weight:700;letter-spacing:-0.02em`;
      center.append(main);
      if (sublabel) {
        const sub = htmlEl('span', '', sublabel);
        sub.style.cssText = 'font-size:12px;color:var(--label-2);margin-top:3px';
        center.append(sub);
      }
      wrap.append(center);
    }
    const target = c * (1 - pct / 100);
    if (reduceMotion()) arc.setAttribute('stroke-dashoffset', target);
    else requestAnimationFrame(() => requestAnimationFrame(() => arc.setAttribute('stroke-dashoffset', target)));
    return wrap;
  }

  // ---------- Tooltip ----------
  function makeTooltip(container) {
    const tip = htmlEl('div', 'tooltip');
    tip.setAttribute('role', 'status');
    container.append(tip);
    return {
      show(x, y, value, caption) {
        tip.replaceChildren(htmlEl('b', '', value), htmlEl('span', '', caption));
        const w = container.clientWidth;
        tip.style.left = `${Math.max(60, Math.min(w - 60, x))}px`;
        tip.style.top = `${y}px`;
        tip.classList.add('show');
      },
      hide() { tip.classList.remove('show'); },
    };
  }

  function niceMax(v) {
    if (v <= 4) return 4;
    const step = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * step >= v) return m * step;
    return 10 * step;
  }

  // Ustun: yuqori burchaklari 4px yumaloq, pasti to'g'ri.
  function barPath(x, y, w, h) {
    const r = Math.min(4, w / 2, h);
    if (h <= 0) return '';
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  // ---------- Ustunli diagramma (faollik) ----------
  function barChart(container, data, { unit = 'ta', labelEvery = 1, caption = (d) => d.full_label || d.label } = {}) {
    container.replaceChildren();
    const width = Math.max(260, container.clientWidth || 320);
    const plotH = 140; const axisH = 22; const leftPad = 26; const topPad = 8;
    const max = niceMax(Math.max(1, ...data.map((d) => d.value)));
    const band = (width - leftPad) / data.length;
    const barW = Math.max(3, Math.min(24, band * 0.62));
    const y = (v) => topPad + plotH - (v / max) * plotH;

    const svg = svgEl('svg', { width, height: topPad + plotH + axisH, role: 'img', 'aria-label': 'Faollik diagrammasi' });
    for (const t of [0, max / 2, max]) {
      svg.append(svgEl('line', { class: 'grid', x1: leftPad, x2: width, y1: Math.round(y(t)) + 0.5, y2: Math.round(y(t)) + 0.5 }));
      const lbl = svgEl('text', { x: leftPad - 6, y: y(t) + 4, 'text-anchor': 'end' });
      lbl.textContent = Number.isInteger(t) ? t : t.toFixed(1);
      svg.append(lbl);
    }
    const tooltip = makeTooltip(container);
    data.forEach((d, i) => {
      const cx = leftPad + band * i + band / 2;
      const hit = svgEl('rect', { class: 'bar-hit', x: leftPad + band * i, y: topPad, width: band, height: plotH, tabindex: d.future ? -1 : 0 });
      hit.setAttribute('aria-label', `${caption(d)}: ${d.value} ${unit}`);
      const h = (d.value / max) * plotH;
      const bar = svgEl('path', { class: 'bar', d: barPath(cx - barW / 2, y(d.value), barW, h) });
      bar.style.animationDelay = `${Math.min(i * 18, 400)}ms`;
      const show = () => tooltip.show(cx, y(d.value) - 2, `${d.value} ${unit}`, caption(d));
      hit.addEventListener('pointerenter', show);
      hit.addEventListener('focus', show);
      hit.addEventListener('pointerleave', tooltip.hide);
      hit.addEventListener('blur', tooltip.hide);
      svg.append(hit, bar);
      if (i % labelEvery === 0 || i === data.length - 1) {
        const lbl = svgEl('text', { x: cx, y: topPad + plotH + 16, 'text-anchor': 'middle', class: d.future ? 'future-label' : '' });
        lbl.textContent = d.label;
        svg.append(lbl);
      }
    });
    container.append(svg);
  }

  // ---------- Chiziqli diagramma (o'sish dinamikasi, 0–100%) ----------
  function lineChart(container, points) {
    container.replaceChildren();
    const width = Math.max(260, container.clientWidth || 320);
    const plotH = 130; const axisH = 22; const leftPad = 34; const rightPad = 14; const topPad = 12;
    const n = points.length;
    const x = (i) => leftPad + (n === 1 ? (width - leftPad - rightPad) / 2 : (i / (n - 1)) * (width - leftPad - rightPad));
    const y = (v) => topPad + plotH - (v / 100) * plotH;

    const svg = svgEl('svg', { width, height: topPad + plotH + axisH, role: 'img', 'aria-label': "O'sish dinamikasi diagrammasi" });
    for (const t of [0, 50, 100]) {
      svg.append(svgEl('line', { class: 'grid', x1: leftPad, x2: width - rightPad, y1: Math.round(y(t)) + 0.5, y2: Math.round(y(t)) + 0.5 }));
      const lbl = svgEl('text', { x: leftPad - 6, y: y(t) + 4, 'text-anchor': 'end' });
      lbl.textContent = `${t}%`;
      svg.append(lbl);
    }

    // Reja bo'lmagan davrlar (rate = null) chiziqni uzadi — yo'q ma'lumot 0% deb ko'rsatilmaydi.
    const segments = [];
    let cur = [];
    points.forEach((p, i) => {
      if (p.rate === null) { if (cur.length) segments.push(cur); cur = []; } else cur.push([x(i), y(p.rate)]);
    });
    if (cur.length) segments.push(cur);

    for (const seg of segments) {
      if (seg.length > 1) {
        const area = `M${seg[0][0]},${y(0)}L${seg.map((p) => p.join(',')).join('L')}L${seg[seg.length - 1][0]},${y(0)}Z`;
        svg.append(svgEl('path', { class: 'area', d: area }));
      }
      const line = svgEl('path', { class: 'line', d: `M${seg.map((p) => p.join(',')).join('L')}` });
      svg.append(line);
      requestAnimationFrame(() => {
        const len = line.getTotalLength ? line.getTotalLength() : 0;
        if (len && !reduceMotion()) {
          line.style.strokeDasharray = len;
          line.style.setProperty('--len', len);
          line.classList.add('draw');
        }
      });
    }

    points.forEach((p, i) => {
      if (p.rate !== null) {
        svg.append(svgEl('circle', { class: `dot${p.current ? ' current' : ''}`, cx: x(i), cy: y(p.rate), r: p.current ? 6 : 4 }));
      }
      const every = n > 10 ? 2 : 1;
      if (i % every === 0 || i === n - 1) {
        const lbl = svgEl('text', { x: x(i), y: topPad + plotH + 16, 'text-anchor': 'middle' });
        lbl.textContent = p.label;
        svg.append(lbl);
      }
    });

    // Oxirgi qiymatga to'g'ridan-to'g'ri yorliq (faqat bitta — "raqam har nuqtada" emas)
    const last = points[n - 1];
    if (last && last.rate !== null) {
      const t = svgEl('text', { x: x(n - 1) - 8, y: y(last.rate) - 10, 'text-anchor': 'end' });
      // Sirt rangidagi "halo" — yorliq chiziq ustida ham o'qiladi.
      t.style.cssText = 'fill:var(--label);font-weight:600;font-size:12px;paint-order:stroke;stroke:var(--cell);stroke-width:4px;stroke-linejoin:round';
      t.textContent = `${last.rate}%`;
      svg.append(t);
    }

    // Crosshair: ko'rsatkich eng yaqin nuqtaga "yopishadi"
    const tooltip = makeTooltip(container);
    const cross = svgEl('line', { class: 'crosshair', y1: topPad, y2: topPad + plotH, x1: leftPad, x2: leftPad, opacity: 0 });
    const overlay = svgEl('rect', { x: leftPad, y: topPad, width: width - leftPad - rightPad, height: plotH, fill: 'transparent', tabindex: 0 });
    overlay.setAttribute('aria-label', "Davrlar bo'yicha qiymatlar: chap va o'ng strelkalar bilan ko'ring");
    svg.append(cross, overlay);
    let focusIdx = n - 1;
    const showAt = (i) => {
      const p = points[i];
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('opacity', 1);
      tooltip.show(x(i), p.rate === null ? y(50) : y(p.rate) - 4,
        p.rate === null ? "reja yo'q" : `${p.rate}%`,
        `${p.full_label} · ${p.done}/${p.expected}`);
    };
    const hide = () => { cross.setAttribute('opacity', 0); tooltip.hide(); };
    overlay.addEventListener('pointermove', (e) => {
      const rect = svg.getBoundingClientRect();
      const px = e.clientX - rect.left;
      let best = 0;
      points.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i; });
      showAt(best);
    });
    overlay.addEventListener('pointerleave', hide);
    overlay.addEventListener('focus', () => showAt(focusIdx));
    overlay.addEventListener('blur', hide);
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') focusIdx = Math.max(0, focusIdx - 1);
      else if (e.key === 'ArrowRight') focusIdx = Math.min(n - 1, focusIdx + 1);
      else return;
      e.preventDefault();
      showAt(focusIdx);
    });
    container.append(svg);
  }

  // ---------- Meter qatorlari (turlar / muhimlik bo'yicha) ----------
  function meterList(rows) {
    const wrap = htmlEl('div');
    for (const r of rows) {
      const row = htmlEl('div', 'meter-row');
      const head = htmlEl('div', 'meter-head');
      head.append(htmlEl('span', '', r.label), htmlEl('span', '', r.expected ? `${r.done}/${r.expected} · ${r.rate}%` : "reja yo'q"));
      row.append(head);
      const meter = htmlEl('div', 'meter');
      meter.setAttribute('role', 'progressbar');
      meter.setAttribute('aria-label', r.label);
      meter.setAttribute('aria-valuemin', '0');
      meter.setAttribute('aria-valuemax', '100');
      meter.setAttribute('aria-valuenow', String(r.rate || 0));
      const fill = htmlEl('i');
      meter.append(fill);
      row.append(meter);
      wrap.append(row);
      requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = `${r.rate || 0}%`; }));
    }
    return wrap;
  }

  // ---------- Jadval ko'rinishi (har diagrammaning egizagi) ----------
  function tableView(headers, rows) {
    const details = htmlEl('details', 'table-view');
    const summary = htmlEl('summary');
    summary.innerHTML = '<svg class="ic"><use href="#i-table"/></svg>';
    summary.append(htmlEl('span', '', "Jadval ko'rinishi"));
    details.append(summary);
    const table = htmlEl('table');
    const thead = htmlEl('tr');
    headers.forEach((h) => thead.append(htmlEl('th', '', h)));
    table.append(thead);
    rows.forEach((cells) => {
      const tr = htmlEl('tr');
      cells.forEach((c) => tr.append(htmlEl('td', '', String(c))));
      table.append(tr);
    });
    details.append(table);
    return details;
  }

  window.Charts = { ring, barChart, lineChart, meterList, tableView };
}());
