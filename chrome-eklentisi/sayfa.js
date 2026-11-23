// Sayfanın içinde (eklentinin yalıtılmış dünyasında) çalışan yardımcılar. Arka plan betiği bu dosyayı sekmeye yükler,
// sonra globalThis.__atolye üzerindeki işlevleri çağırır. Sayfanın kendi betikleri bu nesneyi göremez.
// Öğelere verilen kimlikler (data-atolye-ref="r12") sayfa yeniden yüklenene kadar aynı kalır.
(() => {
  if (globalThis.__atolye?.surum === 1) return;
  const REF = 'data-atolye-ref';
  const SECICI = [
    'input', 'textarea', 'select', 'button', 'a[href]', 'summary',
    '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]', '[role="switch"]', '[role="tab"]',
    '[role="menuitem"]', '[role="option"]', '[role="combobox"]', '[role="textbox"]',
    '[contenteditable=""]', '[contenteditable="true"]',
  ].join(',');
  const ALAN = (el) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable || ['textbox', 'combobox', 'checkbox', 'radio', 'switch'].includes(el.getAttribute('role'));
  const TURLER = {
    text: 'metin', email: 'e-posta', tel: 'telefon', number: 'sayı', date: 'tarih (yyyy-aa-gg)', 'datetime-local': 'tarih-saat (yyyy-aa-ggTss:dd)',
    time: 'saat (ss:dd)', month: 'ay (yyyy-aa)', week: 'hafta', url: 'adres', search: 'arama', password: 'parola', checkbox: 'onay kutusu',
    radio: 'seçenek', range: 'kaydırıcı', color: 'renk', file: 'dosya', submit: 'düğme', button: 'düğme', reset: 'düğme', image: 'düğme',
  };
  let sira = 0;

  const temiz = (s, n = 120) => {
    const t = String(s ?? '').replace(/\s+/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
  };
  const kucuk = (s) => temiz(s, 500).toLocaleLowerCase('tr');

  function gorunur(el) {
    if (el.type === 'hidden' || el.closest('[hidden],[aria-hidden="true"]')) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    if (r.width > 0 || r.height > 0) return true;
    // Özel görünümlü onay kutuları: kutunun kendisi gizli, etiketi görünür
    return Boolean(el.labels?.length && [...el.labels].some((l) => l.getBoundingClientRect().width > 0));
  }

  function etiket(el) {
    const ids = el.getAttribute('aria-labelledby');
    if (ids) {
      const t = ids.split(/\s+/).map((id) => document.getElementById(id)?.innerText || '').join(' ');
      if (temiz(t)) return temiz(t);
    }
    if (el.getAttribute('aria-label')) return temiz(el.getAttribute('aria-label'));
    if (ALAN(el) && el.labels?.length) {
      const t = [...el.labels].map((l) => l.innerText).join(' ');
      if (temiz(t)) return temiz(t);
    }
    if (!ALAN(el) || el.type === 'submit' || el.type === 'button') {
      const t = el.innerText || el.value || el.querySelector?.('img[alt]')?.alt || '';
      if (temiz(t)) return temiz(t);
    }
    return temiz(el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name') || el.id || '');
  }

  function tur(el) {
    const role = el.getAttribute('role');
    if (el.tagName === 'SELECT') return el.multiple ? 'çoklu liste' : 'liste';
    if (el.tagName === 'TEXTAREA') return 'çok satırlı metin';
    if (el.tagName === 'INPUT') return TURLER[(el.type || 'text').toLowerCase()] || el.type;
    if (el.tagName === 'BUTTON' || role === 'button') return 'düğme';
    if (el.tagName === 'A' || role === 'link') return 'bağlantı';
    if (el.isContentEditable || role === 'textbox') return 'düzenlenebilir alan';
    return { checkbox: 'onay kutusu', radio: 'seçenek', switch: 'anahtar', tab: 'sekme', menuitem: 'menü öğesi', option: 'seçenek', combobox: 'liste' }[role] || el.tagName.toLowerCase();
  }

  function kimlik(el) {
    let r = el.getAttribute(REF);
    if (!r) {
      // Sayfada daha önce verilmiş kimliklerle çakışmasın
      do { r = `r${++sira}`; } while (document.querySelector(`[${REF}="${r}"]`));
      el.setAttribute(REF, r);
    }
    return r;
  }

  const parola = (el) => el.tagName === 'INPUT' && el.type === 'password';
  const isaretli = (el) => (el.tagName === 'INPUT' ? el.checked : el.getAttribute('aria-checked') === 'true');

  function deger(el) {
    if (parola(el)) return el.value ? '(dolu, gizli)' : '(boş)';
    if (el.tagName === 'SELECT') {
      const secili = [...el.selectedOptions].map((o) => temiz(o.text, 60)).join(', ');
      const ops = [...el.options].slice(0, 25).map((o) => temiz(o.text, 40)).filter(Boolean);
      return `= "${secili}"  seçenekler: ${ops.join(' | ')}${el.options.length > 25 ? ` | … (${el.options.length} seçenek)` : ''}`;
    }
    if (el.tagName === 'INPUT' && ['checkbox', 'radio'].includes(el.type)) return isaretli(el) ? '[x]' : '[ ]';
    if (['checkbox', 'radio', 'switch'].includes(el.getAttribute('role'))) return isaretli(el) ? '[x]' : '[ ]';
    if (el.tagName === 'INPUT' && el.type === 'file') return el.files?.length ? `(${el.files.length} dosya seçili)` : '(dosya seçilmemiş)';
    if (['INPUT', 'TEXTAREA'].includes(el.tagName)) return el.value ? `= "${temiz(el.value, 200)}"` : '(boş)';
    if (el.isContentEditable) return el.innerText.trim() ? `= "${temiz(el.innerText, 200)}"` : '(boş)';
    return '';
  }

  function satir(el) {
    const r = kimlik(el);
    const ek = [];
    if (el.required || el.getAttribute('aria-required') === 'true') ek.push('zorunlu');
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') ek.push('pasif');
    if (el.readOnly) ek.push('salt okunur');
    if (parola(el)) ek.push('yapay zekâ doldurmaz');
    if (el.name && ALAN(el)) ek.push(`name=${temiz(el.name, 40)}`);
    if (el.tagName === 'A' && el.href) ek.push(temiz(el.href, 100));
    if (el.validationMessage && ALAN(el) && el.value && !['checkbox', 'radio'].includes(el.type)) ek.push(`uyarı: ${temiz(el.validationMessage, 80)}`);
    return `[${r}] ${tur(el)} "${etiket(el)}"${ek.length ? ` (${ek.join(', ')})` : ''} ${deger(el)}`.trimEnd();
  }

  function oku({ text = true, maxText = 4000, maxItems = 300 } = {}) {
    const hepsi = [...document.querySelectorAll(SECICI)].filter(gorunur);
    const alanlar = hepsi.filter(ALAN);
    const dugmeler = hepsi.filter((el) => !ALAN(el) && el.tagName !== 'A' && el.getAttribute('role') !== 'link');
    const baglantilar = hepsi.filter((el) => el.tagName === 'A' || el.getAttribute('role') === 'link');
    const sinir = Math.max(20, Math.min(Number(maxItems) || 300, 600));
    const bolum = (ad, liste, n) => (liste.length ? [`\n## ${ad} (${liste.length})`, ...liste.slice(0, n).map(satir), ...(liste.length > n ? [`… ${liste.length - n} tane daha gösterilmedi`] : [])] : []);
    const out = [`Başlık: ${document.title}`, `Adres: ${location.href}`];
    const formlar = document.forms.length;
    if (formlar) out.push(`Formlar: ${formlar}`);
    const cerceve = document.querySelectorAll('iframe').length;
    if (cerceve) out.push(`Not: sayfada ${cerceve} çerçeve (iframe) var; içleri okunmadı.`);
    out.push(...bolum('Form alanları', alanlar, sinir), ...bolum('Düğmeler', dugmeler, Math.min(sinir, 120)), ...bolum('Bağlantılar', baglantilar, Math.min(sinir, 80)));
    if (text !== false) {
      const n = Math.max(200, Math.min(Number(maxText) || 4000, 20000));
      const metin = (document.body?.innerText || '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
      out.push('\n## Sayfa metni', metin.length > n ? `${metin.slice(0, n)}\n… (${metin.length - n} karakter daha; maxText ile artırılabilir)` : metin);
    }
    return out.join('\n');
  }

  function bul(h = {}, { yalnizAlan = false, yalnizTiklanir = false } = {}) {
    if (h.ref) {
      const r = String(h.ref).trim().replace(/^\[|\]$/g, '');
      const el = document.querySelector(`[${REF}="${CSS.escape(/^\d+$/.test(r) ? `r${r}` : r)}"]`);
      if (!el) throw new Error(`${r} kimlikli öğe yok (sayfa değişmiş olabilir; chrome_read ile yeniden okuyun)`);
      return el;
    }
    if (h.selector) {
      let el;
      try { el = document.querySelector(String(h.selector)); } catch { throw new Error(`geçersiz seçici: ${h.selector}`); }
      if (!el) throw new Error(`seçiciyle öğe bulunamadı: ${h.selector}`);
      return el;
    }
    const aranan = kucuk(h.label ?? h.text ?? '');
    if (!aranan) throw new Error('ref, selector ya da label/text verilmeli');
    let adaylar = [...document.querySelectorAll(SECICI)].filter(gorunur);
    if (yalnizAlan) adaylar = adaylar.filter(ALAN);
    if (yalnizTiklanir) adaylar = adaylar.filter((el) => !ALAN(el) || ['checkbox', 'radio'].includes(el.type) || ['checkbox', 'radio', 'switch'].includes(el.getAttribute('role')));
    const adlar = adaylar.map((el) => [el, kucuk(etiket(el))]);
    const el = adlar.find(([, a]) => a === aranan)?.[0] || adlar.find(([, a]) => a.includes(aranan))?.[0];
    if (!el) throw new Error(`"${h.label ?? h.text}" adlı ${yalnizAlan ? 'alan' : 'öğe'} bulunamadı`);
    return el;
  }

  function vurgula(el) {
    try {
      const eski = el.style.outline;
      const eskiOffset = el.style.outlineOffset;
      el.style.outline = '2px solid #e8833a';
      el.style.outlineOffset = '2px';
      setTimeout(() => { el.style.outline = eski; el.style.outlineOffset = eskiOffset; }, 1200);
    } catch { /* stil verilemeyen öğe */ }
  }

  const evet = (v) => (typeof v === 'boolean' ? v : ['true', '1', 'evet', 'on', 'yes', 'x', 'checked', 'seçili', 'işaretli'].includes(kucuk(v)));
  const olay = (el, ad) => el.dispatchEvent(new Event(ad, { bubbles: true }));

  function yaz(el, v) {
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') throw new Error('alan pasif');
    if (el.readOnly) throw new Error('alan salt okunur');
    if (parola(el)) throw new Error('parola alanı: kullanıcı kendisi doldurmalı');
    if (el.tagName === 'INPUT' && el.type === 'file') throw new Error('dosya alanı: kullanıcı kendisi seçmeli');
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    vurgula(el);
    if (el.tagName === 'SELECT') {
      const want = kucuk(v);
      const ops = [...el.options];
      const op = ops.find((o) => o.value === String(v)) || ops.find((o) => kucuk(o.text) === want) || ops.find((o) => kucuk(o.text).includes(want));
      if (!op) throw new Error(`"${v}" seçeneği yok; seçenekler: ${ops.slice(0, 15).map((o) => temiz(o.text, 30)).join(' | ')}`);
      el.focus();
      el.value = op.value;
      op.selected = true;
      olay(el, 'input');
      olay(el, 'change');
      el.blur();
      return `"${temiz(op.text, 60)}"`;
    }
    const kutu = (el.tagName === 'INPUT' && ['checkbox', 'radio'].includes(el.type)) || ['checkbox', 'radio', 'switch'].includes(el.getAttribute('role'));
    if (kutu) {
      const want = evet(v);
      if (isaretli(el) !== want) {
        if (!want && (el.type === 'radio' || el.getAttribute('role') === 'radio')) throw new Error('seçenek düğmesinin işareti kaldırılamaz; başka bir seçeneği seçin');
        el.click();
      }
      return isaretli(el) ? '[x]' : '[ ]';
    }
    const metin = String(v ?? '');
    if (['INPUT', 'TEXTAREA'].includes(el.tagName)) {
      el.focus();
      // Sayfanın kendi değer izleyicisini (React vb.) atlamak için yerleşik ayarlayıcı kullanılır; ardından gelen
      // input/change olayları çerçevenin değeri görmesini sağlar
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, metin);
      olay(el, 'input');
      olay(el, 'change');
      el.blur();
      if (metin && !el.value) throw new Error(`değer kabul edilmedi (alan türü: ${tur(el)}; biçimi denetleyin)`);
      return `"${temiz(el.value, 80)}"`;
    }
    if (el.isContentEditable || el.getAttribute('role') === 'textbox') {
      el.focus();
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, metin);
      if (el.innerText.trim() !== metin.trim()) { el.textContent = metin; olay(el, 'input'); }
      el.blur();
      return `"${temiz(metin, 80)}"`;
    }
    throw new Error(`bu öğeye yazılamaz (${tur(el)})`);
  }

  function doldur({ fields } = {}) {
    if (!Array.isArray(fields) || !fields.length) throw new Error('fields boş');
    let ok = 0;
    const satirlar = fields.slice(0, 200).map((f) => {
      const ad = f?.ref || f?.selector || f?.label || '?';
      try {
        const el = bul(f || {}, { yalnizAlan: !f?.ref && !f?.selector });
        const sonuc = yaz(el, f.value);
        ok += 1;
        return `✓ [${kimlik(el)}] ${tur(el)} "${etiket(el)}" ${sonuc}`;
      } catch (err) {
        return `✗ ${ad}: ${err.message}`;
      }
    });
    return `${ok}/${satirlar.length} alan dolduruldu. Form gönderilmedi.\n${satirlar.join('\n')}`;
  }

  function tikla(h = {}) {
    const el = bul(h, { yalnizTiklanir: !h.ref && !h.selector });
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') throw new Error(`[${kimlik(el)}] "${etiket(el)}" pasif; tıklanamaz`);
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    vurgula(el);
    const yazi = `[${kimlik(el)}] ${tur(el)} "${etiket(el)}"`;
    el.focus?.();
    el.click();
    return `Tıklandı: ${yazi}`;
  }

  function bas({ key, ref } = {}) {
    const tus = String(key || '').trim();
    if (!tus) throw new Error('key gerekli');
    const el = ref ? bul({ ref }) : (document.activeElement || document.body);
    if (ref) { el.focus?.(); vurgula(el); }
    const ayar = { key: tus, code: tus.length === 1 ? `Key${tus.toUpperCase()}` : tus, bubbles: true, cancelable: true };
    const devam = el.dispatchEvent(new KeyboardEvent('keydown', ayar));
    if (tus.length === 1) el.dispatchEvent(new KeyboardEvent('keypress', ayar));
    // Yapay klavye olayları formu kendiliğinden göndermez; tarayıcının Enter davranışı burada yapılır
    let ek = '';
    if (devam && tus === 'Enter' && el.tagName === 'INPUT' && el.form) { el.form.requestSubmit(); ek = ' (form gönderildi)'; }
    el.dispatchEvent(new KeyboardEvent('keyup', ayar));
    return `${tus} basıldı: ${el === document.body ? 'sayfa' : `[${kimlik(el)}] ${tur(el)} "${etiket(el)}"`}${ek}`;
  }

  globalThis.__atolye = { surum: 1, oku, doldur, tikla, bas };
})();
