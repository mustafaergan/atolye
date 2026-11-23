// Atölye eklentisinin arka plan betiği: bu bilgisayardaki Atölye'ye WebSocket ile bağlanır, Atölye'den gelen işlemleri
// (sekmeleri listele, aç, oku, doldur, tıkla, tuşa bas, ekran görüntüsü) yapar ve sonucu geri gönderir.
//
// Güvenlik:
//   - Yalnızca bu bilgisayardaki Atölye'ye (127.0.0.1 / localhost) bağlanılır; Atölye'nin verdiği eşleştirme kodu gerekir.
//   - Varsayılan olarak yalnızca kullanıcının paylaştığı sekmeler ve yapay zekânın kendi açtığı sekmeler kullanılır.
//   - Parola ve dosya alanlarına yazılmaz (bkz. sayfa.js). Kullanıcı eklentiyi her an duraklatabilir.
const VARSAYILAN = { adres: 'http://127.0.0.1:3210', kod: '', tumSekmeler: false, duraklat: false };
const PING_MS = 20_000; // açık WebSocket trafiği arka plan betiğini uyanık tutar (Chrome 116+)
const YUKLEME_MS = 30_000;
const GUNLUK = 25;

let ws = null;
let durum = 'kapali'; // kapali | kodsuz | baglaniyor | bagli | hata
let hata = '';
let etkin = null; // Atölye'de Chrome bağlantısı açık mı (Atölye bildirir)
let ping = null;
let tekrar = null;
let bekleme = 2000;
let reddedilenKod = '';

const ayarlar = async () => ({ ...VARSAYILAN, ...(await chrome.storage.local.get(Object.keys(VARSAYILAN))) });
const paylasilan = async () => (await chrome.storage.session.get('paylasilan')).paylasilan || [];

function tarayiciAdi() {
  const brands = navigator.userAgentData?.brands || [];
  const b = brands.find((x) => /edge/i.test(x.brand)) || brands.find((x) => /chrome/i.test(x.brand) && !/chromium/i.test(x.brand)) || brands[0];
  return b ? `${b.brand} ${b.version}` : 'Chrome';
}

function durumAyarla(d, h = '') {
  durum = d;
  hata = h;
  rozetleriGuncelle();
  chrome.runtime.sendMessage({ tip: 'durumDegisti' }).catch(() => {});
}

async function rozetleriGuncelle() {
  const sorun = ['hata', 'kodsuz'].includes(durum) || (durum === 'bagli' && etkin === false);
  const { duraklat } = await ayarlar();
  await chrome.action.setBadgeBackgroundColor({ color: sorun ? '#c0392b' : duraklat ? '#7f8c8d' : '#e8833a' });
  await chrome.action.setBadgeText({ text: sorun ? '!' : duraklat ? '❚❚' : '' });
  if (sorun || duraklat) return;
  // Paylaşılan sekmelerde "AI" rozeti: kullanıcı yapay zekânın hangi sekmeye erişebildiğini görür
  for (const id of await paylasilan()) await chrome.action.setBadgeText({ tabId: id, text: 'AI' }).catch(() => {});
}

async function tercihler() {
  const a = await ayarlar();
  return { paylasilan: (await paylasilan()).length, tumSekmeler: a.tumSekmeler, duraklat: a.duraklat };
}
async function tercihleriGonder() {
  if (ws?.readyState === WebSocket.OPEN && durum === 'bagli') ws.send(JSON.stringify({ type: 'prefs', ...(await tercihler()) }));
}

async function paylas(tabId, acik) {
  const liste = new Set(await paylasilan());
  if (acik) liste.add(tabId); else liste.delete(tabId);
  await chrome.storage.session.set({ paylasilan: [...liste] });
  if (!acik) await chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
  await rozetleriGuncelle();
  await tercihleriGonder();
}

// ---------- Bağlantı ----------
function atolyeAdresi(adres) {
  const u = new URL(adres);
  if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) throw new Error('adres');
  return `ws://${u.host}/chrome`;
}

async function baglan() {
  if (ws && ws.readyState <= WebSocket.OPEN) return;
  clearTimeout(tekrar);
  const a = await ayarlar();
  if (!a.kod) return durumAyarla('kodsuz');
  if (a.kod === reddedilenKod) return; // yanlış kodla tekrar tekrar denenmez; kullanıcı kodu değiştirince denenir
  let url;
  try { url = atolyeAdresi(a.adres); } catch { return durumAyarla('hata', 'Atölye adresi geçersiz. Yalnızca bu bilgisayardaki Atölye\'ye bağlanılır: http://127.0.0.1:PORT'); }
  durumAyarla('baglaniyor');
  let s;
  try { s = new WebSocket(url); } catch (err) { durumAyarla('hata', String(err.message || err)); return yenidenDene(); }
  ws = s;
  s.onopen = async () => { s.send(JSON.stringify({ type: 'hello', kod: a.kod, surum: chrome.runtime.getManifest().version, tarayici: tarayiciAdi(), ...(await tercihler()) })); };
  s.onmessage = (e) => { if (ws === s) mesaj(s, e.data); };
  s.onerror = () => {};
  s.onclose = () => {
    if (ws !== s) return;
    ws = null;
    clearInterval(ping);
    if (durum === 'bagli' || durum === 'baglaniyor') durumAyarla('hata', 'Atölye\'ye ulaşılamıyor. Atölye çalışıyor mu? Adres doğru mu?');
    if (!reddedilenKod || reddedilenKod !== a.kod) yenidenDene();
  };
}

function yenidenDene() {
  clearTimeout(tekrar);
  tekrar = setTimeout(baglan, bekleme);
  bekleme = Math.min(bekleme * 2, 30_000);
}

async function mesaj(s, raw) {
  let m;
  try { m = JSON.parse(raw); } catch { return; }
  if (m.type === 'hello-ok') {
    bekleme = 2000;
    reddedilenKod = '';
    etkin = m.enabled;
    durumAyarla('bagli');
    clearInterval(ping);
    ping = setInterval(() => { if (s.readyState === WebSocket.OPEN) s.send(JSON.stringify({ type: 'ping' })); }, PING_MS);
    return;
  }
  if (m.type === 'hello-error') {
    reddedilenKod = (await ayarlar()).kod;
    return durumAyarla('hata', m.error || 'Atölye bağlantıyı reddetti');
  }
  if (m.type === 'pong') {
    if (etkin !== m.enabled) { etkin = m.enabled; durumAyarla(durum); }
    return;
  }
  if (m.type === 'call') {
    const yanit = (x) => { if (s.readyState === WebSocket.OPEN) s.send(JSON.stringify({ type: 'result', id: m.id, ...x })); };
    try {
      const a = await ayarlar();
      if (a.duraklat) throw new Error('Kullanıcı Atölye eklentisini duraklattı; Chrome\'da işlem yapılamıyor. Kullanıcıdan eklenti simgesinden duraklatmayı kaldırmasını isteyin.');
      const islem = ISLEMLER[m.op];
      if (!islem) throw new Error(`Bilinmeyen işlem: ${m.op}`);
      const sonuc = await islem(m.args || {}, a);
      gunlugeYaz(m.op, sonuc.ozet || '', true);
      yanit({ ok: true, result: { text: sonuc.text, ...(sonuc.image ? { image: sonuc.image } : {}) } });
    } catch (err) {
      gunlugeYaz(m.op, err.message, false);
      yanit({ ok: false, error: err.message });
    }
  }
}

async function gunlugeYaz(op, ozet, ok) {
  const { gunluk = [] } = await chrome.storage.session.get('gunluk');
  gunluk.unshift({ zaman: Date.now(), op, ozet: String(ozet).slice(0, 140), ok });
  await chrome.storage.session.set({ gunluk: gunluk.slice(0, GUNLUK) });
  chrome.runtime.sendMessage({ tip: 'durumDegisti' }).catch(() => {});
}

// ---------- Sekmeler ----------
const webSayfasi = (tab) => /^https?:\/\//i.test(tab?.url || '');

async function izinliMi(tab, a) {
  return a.tumSekmeler || (await paylasilan()).includes(tab.id);
}

async function sekmeBul(args, a) {
  let tab;
  if (args.tab !== undefined && args.tab !== null && args.tab !== '') {
    tab = await chrome.tabs.get(Number(args.tab)).catch(() => null);
    if (!tab) throw new Error(`${args.tab} numaralı sekme yok (chrome_tabs ile sekmelere bakın).`);
    if (!(await izinliMi(tab, a))) throw new Error(`${tab.id} numaralı sekme Atölye ile paylaşılmamış.`);
  } else {
    [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab || !(await izinliMi(tab, a))) {
      // Öndeki sekme paylaşılmamış ama tek bir paylaşılan sekme varsa o kullanılır
      const liste = (await Promise.all((await paylasilan()).map((id) => chrome.tabs.get(id).catch(() => null)))).filter(Boolean);
      if (liste.length === 1) tab = liste[0];
      else if (!tab) throw new Error('Önde bir sekme yok.');
      else throw new Error(`Öndeki sekme${tab.title ? ` ("${tab.title}")` : ''} Atölye ile paylaşılmamış. Kullanıcıdan o sekmede Atölye eklentisi simgesine tıklayıp "Bu sekmeyi paylaş" demesini isteyin${liste.length ? ' ya da chrome_tabs ile paylaşılan sekmelerden birinin numarasını verin' : ''}.`);
    }
  }
  // Eklentinin "tabs" izni yok: sekmenin adresi yalnızca site izni verilmişse görünür. Adres yoksa site izni de yoktur
  // (kullanıcı izni vermedi, kaldırdı ya da sekme izin verilmemiş başka bir siteye geçti).
  if (!tab.url) throw new Error(IZIN_YOK);
  if (!webSayfasi(tab)) throw new Error('Bu sekmede bir web sayfası yok (yalnızca http/https sayfalarında çalışılır).');
  return tab;
}
const IZIN_YOK = 'Bu sekme paylaşılmış ama bulunduğu site için eklentiye izin verilmemiş (ya da sekme izin verilmemiş başka bir siteye geçti). Kullanıcıdan o sekmede Atölye eklentisi simgesine tıklayıp "Bu sekmeyi paylaş" demesini ve tarayıcının sorduğu izni onaylamasını isteyin.';

function yuklenmeyiBekle(tabId, ms = YUKLEME_MS) {
  return new Promise((resolve) => {
    let bitti = false;
    const son = (tab) => { if (bitti) return; bitti = true; chrome.tabs.onUpdated.removeListener(dinle); clearTimeout(t); resolve(tab); };
    const dinle = (id, bilgi, tab) => { if (id === tabId && bilgi.status === 'complete') son(tab); };
    const t = setTimeout(async () => son(await chrome.tabs.get(tabId).catch(() => null)), ms);
    chrome.tabs.onUpdated.addListener(dinle);
    chrome.tabs.get(tabId).then((tab) => { if (tab.status === 'complete' && tab.url && tab.url !== 'about:blank') son(tab); }).catch(() => son(null));
  });
}

const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

/** Sayfada yardımcıları yükler ve bir işlevini çağırır (bkz. sayfa.js) */
async function sayfada(tab, ad, arg) {
  const target = { tabId: tab.id };
  try {
    await chrome.scripting.executeScript({ target, files: ['sayfa.js'] });
  } catch (err) {
    throw new Error(`Bu sayfaya erişilemedi (${err.message}). Tarayıcının kendi sayfalarında, Chrome Web Mağazası'nda ya da kuruluş politikasının kapattığı sitelerde çalışılamaz.`);
  }
  const [r] = await chrome.scripting.executeScript({
    target,
    func: (ad, arg) => {
      try { return { ok: true, value: globalThis.__atolye[ad](arg) }; } catch (e) { return { ok: false, error: String(e?.message || e) }; }
    },
    args: [ad, arg ?? {}],
  });
  if (!r?.result) throw new Error('Sayfadan yanıt alınamadı.');
  if (!r.result.ok) throw new Error(r.result.error);
  return r.result.value;
}

const sekmeYazisi = (tab) => `Sekme ${tab.id}: ${tab.title || ''} — ${tab.url || ''}`;

/** Tıklama ya da tuştan sonra sayfa değiştiyse yüklenmesini bekler ve bildirir */
async function sonrasi(tab) {
  await bekle(400);
  let t = await chrome.tabs.get(tab.id).catch(() => null);
  if (t?.status === 'loading') t = await yuklenmeyiBekle(tab.id, 15_000);
  if (t && t.url !== tab.url) return `\nSayfa değişti: ${t.title || ''} — ${t.url}`;
  return '';
}

const ISLEMLER = {
  async tabs(_args, a) {
    const hepsi = await chrome.tabs.query({});
    const izinli = [];
    for (const t of hepsi) if (webSayfasi(t) && (await izinliMi(t, a))) izinli.push(t);
    const [onde] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const satirlar = izinli.map((t) => `${t.id}${t.id === onde?.id ? ' [önde]' : ''}: ${t.title || ''} — ${t.url}`);
    const kalan = hepsi.length - izinli.length;
    const not = a.tumSekmeler ? '' : `\n(Kullanıcı yalnızca paylaştığı sekmelere izin veriyor${kalan ? `; ${kalan} sekme daha açık ama paylaşılmamış` : ''}. Başka bir sekme gerekiyorsa kullanıcıdan o sekmede eklenti simgesinden "Bu sekmeyi paylaş" demesini isteyin.)`;
    return { text: `${satirlar.length ? satirlar.join('\n') : 'Atölye\'nin kullanabileceği sekme yok.'}${not}`, ozet: `${satirlar.length} sekme` };
  },

  async open(args, a) {
    let url;
    try { url = new URL(String(args.url || '')); } catch { throw new Error('Geçersiz adres'); }
    if (!/^https?:$/.test(url.protocol)) throw new Error('Yalnızca http ve https adresleri açılır.');
    let tab;
    if (args.tab !== undefined && args.tab !== null && args.tab !== '') {
      tab = await sekmeBul(args, a);
      await chrome.tabs.update(tab.id, { url: url.href });
    } else {
      tab = await chrome.tabs.create({ url: url.href, active: args.background !== true });
      await paylas(tab.id, true); // yapay zekânın açtığı sekme onun kullanabileceği sekmelere eklenir
    }
    const son = (await yuklenmeyiBekle(tab.id)) || tab;
    // Site izni yoksa sekme açılır ama okunamaz; izni yalnızca kullanıcı verebilir
    if (!son.url) return { text: `Sekme ${tab.id} açıldı (${url.host}) ama eklentinin bu siteye izni yok; okunamaz ve doldurulamaz. Kullanıcıdan o sekmede Atölye eklentisi simgesine tıklayıp "Bu sekmeyi paylaş" demesini ve tarayıcının sorduğu izni onaylamasını isteyin.`, ozet: `${url.host} (izin yok)` };
    return { text: `Açıldı. ${sekmeYazisi(son)}${son.status !== 'complete' ? ' (sayfa hâlâ yükleniyor)' : ''}`, ozet: url.host };
  },

  async read(args, a) {
    const tab = await sekmeBul(args, a);
    const metin = await sayfada(tab, 'oku', { text: args.text !== false, maxText: args.maxText });
    return { text: `Sekme ${tab.id}\n${metin}`, ozet: `${tab.title || tab.url}` };
  },

  async fill(args, a) {
    const tab = await sekmeBul(args, a);
    const sonuc = await sayfada(tab, 'doldur', { fields: args.fields });
    return { text: `Sekme ${tab.id}: ${sonuc}`, ozet: sonuc.split('\n')[0] };
  },

  async click(args, a) {
    const tab = await sekmeBul(args, a);
    const sonuc = await sayfada(tab, 'tikla', { ref: args.ref, selector: args.selector, text: args.text });
    return { text: `${sonuc}${await sonrasi(tab)}`, ozet: sonuc };
  },

  async press(args, a) {
    const tab = await sekmeBul(args, a);
    const sonuc = await sayfada(tab, 'bas', { key: args.key, ref: args.ref });
    return { text: `${sonuc}${await sonrasi(tab)}`, ozet: sonuc };
  },

  async screenshot(args, a) {
    const tab = await sekmeBul(args, a);
    if (!tab.active) { await chrome.tabs.update(tab.id, { active: true }); await bekle(350); }
    await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    // Chrome, ekran görüntüsü için site izni yetmez: ya bütün siteler izni ya da kullanıcının o sekmede eklenti simgesine
    // tıklamasıyla gelen geçici izin (activeTab; sayfa değişene kadar sürer) gerekir
    let dataUrl;
    try {
      dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 70 });
    } catch (err) {
      if (/all_urls|activeTab/i.test(err.message)) throw new Error('Bu sekmenin ekran görüntüsü için izin yok. Kullanıcı o sekmede Atölye eklentisi simgesine tıklarsa (sayfa değişene kadar) ekran görüntüsü alınabilir. Sayfanın içeriği için chrome_read yeterlidir.');
      throw err;
    }
    const data = dataUrl.slice(dataUrl.indexOf(',') + 1);
    return { text: `Ekran görüntüsü: ${sekmeYazisi(tab)}`, image: { data, mimeType: 'image/jpeg' }, ozet: tab.title || tab.url };
  },
};

// ---------- Açılır pencere ile konuşma ----------
chrome.runtime.onMessage.addListener((m, _gonderen, yanitla) => {
  (async () => {
    if (m?.tip === 'durum') {
      const a = await ayarlar();
      // Açılır pencere simgeye tıklanarak açıldığı için (activeTab) öndeki sekmenin adresi burada görünür
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const { gunluk = [] } = await chrome.storage.session.get('gunluk');
      const liste = await paylasilan();
      const kaynak = webSayfasi(tab) ? new URL(tab.url).origin : '';
      const izinler = (await chrome.permissions.getAll()).origins || [];
      return {
        durum, hata, etkin, adres: a.adres, kodVar: Boolean(a.kod), tumSekmeler: a.tumSekmeler, duraklat: a.duraklat, gunluk,
        sekme: tab ? {
          id: tab.id, baslik: tab.title, web: webSayfasi(tab), kaynak, paylasilan: liste.includes(tab.id),
          izinli: kaynak ? await chrome.permissions.contains({ origins: [`${kaynak}/*`] }) : false,
        } : null,
        paylasilanSayisi: liste.length,
        // Kullanıcının sonradan verdiği site izinleri (manifest'teki yerel adresler hariç); açılır pencerede kaldırılabilir
        siteler: izinler.filter((o) => !/^http:\/\/(127\.0\.0\.1|localhost)\/\*$/.test(o)),
      };
    }
    if (m?.tip === 'ayarKaydet') {
      const yeni = {};
      if (typeof m.adres === 'string' && m.adres.trim()) {
        try { atolyeAdresi(m.adres.trim()); } catch { return { ok: false, hata: 'Adres http://127.0.0.1:PORT biçiminde olmalı (yalnızca bu bilgisayardaki Atölye).' }; }
        yeni.adres = m.adres.trim().replace(/\/+$/, '');
      }
      if (typeof m.kod === 'string' && m.kod.trim()) yeni.kod = m.kod.trim().toLowerCase();
      await chrome.storage.local.set(yeni);
      reddedilenKod = '';
      bekleme = 2000;
      try { ws?.close(); } catch { /* */ }
      ws = null;
      await baglan();
      return { ok: true };
    }
    if (m?.tip === 'paylas') { await paylas(m.tabId, Boolean(m.acik)); return { ok: true }; }
    if (m?.tip === 'secenek') {
      const yeni = {};
      if (typeof m.tumSekmeler === 'boolean') yeni.tumSekmeler = m.tumSekmeler;
      if (typeof m.duraklat === 'boolean') yeni.duraklat = m.duraklat;
      await chrome.storage.local.set(yeni);
      await rozetleriGuncelle();
      await tercihleriGonder();
      return { ok: true };
    }
    if (m?.tip === 'yenidenBaglan') { reddedilenKod = ''; bekleme = 2000; await baglan(); return { ok: true }; }
    return null;
  })().then(yanitla, (err) => yanitla({ ok: false, hata: err.message }));
  return true;
});

// ---------- Yaşam döngüsü ----------
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const liste = await paylasilan();
  if (liste.includes(tabId)) { await chrome.storage.session.set({ paylasilan: liste.filter((id) => id !== tabId) }); tercihleriGonder(); }
});
// Sayfa yenilenince sekme rozeti silinir; yeniden konur
chrome.tabs.onUpdated.addListener((tabId, bilgi) => { if (bilgi.status === 'loading') paylasilan().then((l) => { if (l.includes(tabId)) rozetleriGuncelle(); }); });
// Kullanıcı bir site iznini kaldırır ya da verirse rozetler ve Atölye'deki durum güncellenir
chrome.permissions.onRemoved.addListener(() => { rozetleriGuncelle(); tercihleriGonder(); chrome.runtime.sendMessage({ tip: 'durumDegisti' }).catch(() => {}); });
chrome.permissions.onAdded.addListener(() => { rozetleriGuncelle(); tercihleriGonder(); });
chrome.runtime.onStartup.addListener(baglan);
chrome.runtime.onInstalled.addListener(() => { chrome.alarms.create('yokla', { periodInMinutes: 0.5 }); baglan(); });
chrome.alarms.onAlarm.addListener((al) => { if (al.name === 'yokla') baglan(); });
chrome.alarms.get('yokla').then((al) => { if (!al) chrome.alarms.create('yokla', { periodInMinutes: 0.5 }); });
baglan();
