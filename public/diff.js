// Basit satır bazlı diff (LCS). Edit aracındaki old_string/new_string gibi
// küçük parçalar için yeterli; çok büyük girdilerde "tümü silindi/eklendi"
// gösterimine düşer.

export function lineDiff(a, b) {
  const A = a === '' ? [] : a.split('\n');
  const B = b === '' ? [] : b.split('\n');

  // Ortak baş ve son satırları ayır, DP tablosunu küçült
  let start = 0;
  while (start < A.length && start < B.length && A[start] === B[start]) start++;
  let endA = A.length, endB = B.length;
  while (endA > start && endB > start && A[endA - 1] === B[endB - 1]) { endA--; endB--; }

  const head = A.slice(0, start).map((s) => ({ t: ' ', s }));
  const tail = A.slice(endA).map((s) => ({ t: ' ', s }));
  const a2 = A.slice(start, endA);
  const b2 = B.slice(start, endB);

  let mid;
  if (a2.length * b2.length > 1_000_000) {
    mid = [...a2.map((s) => ({ t: '-', s })), ...b2.map((s) => ({ t: '+', s }))];
  } else {
    const n = a2.length, m = b2.length;
    const dp = new Uint32Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i * (m + 1) + j] = a2[i] === b2[j]
          ? dp[(i + 1) * (m + 1) + j + 1] + 1
          : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + j + 1]);
    mid = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a2[i] === b2[j]) { mid.push({ t: ' ', s: a2[i] }); i++; j++; }
      else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + j + 1]) mid.push({ t: '-', s: a2[i++] });
      else mid.push({ t: '+', s: b2[j++] });
    }
    while (i < n) mid.push({ t: '-', s: a2[i++] });
    while (j < m) mid.push({ t: '+', s: b2[j++] });
  }
  return [...head, ...mid, ...tail];
}

export function renderDiff(ops, { context = 3, maxLines = 600 } = {}) {
  const root = document.createElement('div');
  root.className = 'diff';
  const keep = new Array(ops.length).fill(context === Infinity);
  if (context !== Infinity) {
    ops.forEach((o, i) => {
      if (o.t === ' ') return;
      for (let k = Math.max(0, i - context); k <= Math.min(ops.length - 1, i + context); k++) keep[k] = true;
    });
  }
  let shown = 0;
  let skipped = 0;
  const flushGap = () => {
    if (!skipped) return;
    const g = document.createElement('div');
    g.className = 'gap';
    g.textContent = `⋯ ${skipped} değişmeyen satır`;
    root.append(g);
    skipped = 0;
  };
  for (let i = 0; i < ops.length; i++) {
    if (!keep[i]) { skipped++; continue; }
    flushGap();
    if (shown++ >= maxLines) {
      const g = document.createElement('div');
      g.className = 'gap';
      g.textContent = `… ${ops.length - i} satır daha`;
      root.append(g);
      break;
    }
    const o = ops[i];
    const ln = document.createElement('div');
    ln.className = `ln ${o.t === '+' ? 'add' : o.t === '-' ? 'del' : ''}`;
    const g = document.createElement('span');
    g.className = 'g';
    g.textContent = o.t === ' ' ? '' : o.t === '-' ? '−' : '+';
    const c = document.createElement('span');
    c.className = 'c';
    c.textContent = o.s || ' ';
    ln.append(g, c);
    root.append(ln);
  }
  flushGap();
  return root;
}
