// Eklenti simgesine tıklayınca açılan pencere: bağlantı durumu, bu sekmeyi paylaşma, duraklatma ve son işlemler.
const $ = (id) => document.getElementById(id);
const gonder = (m) => chrome.runtime.sendMessage(m);
const ISLEM_ADI = { tabs: 'sekmeler', open: 'aç', read: 'oku', fill: 'doldur', click: 'tıkla', press: 'tuş', screenshot: 'ekran' };
const DURUM = {
  bagli: ['Bağlı', 'iyi'],
  baglaniyor: ['Bağlanıyor…', ''],
  kodsuz: ['Eşleştirilmedi', 'kotu'],
  hata: ['Bağlı değil', 'kotu'],
  kapali: ['Bağlı değil', 'kotu'],
};
let son = null;

async function yenile() {
  const d = await gonder({ tip: 'durum' });
  if (!d) return;
  son = d;
  const [yazi, sinif] = d.durum === 'bagli' && d.etkin === false ? ['Atölye\'de kapalı', 'kotu'] : DURUM[d.durum] || DURUM.kapali;
  $('durum').textContent = d.duraklat && d.durum === 'bagli' ? 'Duraklatıldı' : yazi;
  $('durum').className = `durum ${d.duraklat ? '' : sinif}`;
  let hata = d.hata;
  if (d.durum === 'kodsuz') hata = 'Atölye\'de Bağlantılar > Chrome bölümündeki eşleştirme kodunu aşağıya yapıştırın.';
  else if (d.durum === 'bagli' && d.etkin === false) hata = 'Eklenti bağlı ama Chrome bağlantısı Atölye\'de kapalı. Atölye > Bağlantılar > Chrome bölümünden etkinleştirin.';
  $('hata').hidden = !hata;
  $('hata').textContent = hata || '';
  if (!$('kurulum').dataset.dokunuldu) $('kurulum').open = d.durum === 'kodsuz' || d.durum === 'hata';
  if (document.activeElement !== $('adres')) $('adres').value = d.adres || '';
  $('kod').placeholder = d.kodVar ? 'Kayıtlı (değiştirmek için yeni kodu yapıştırın)' : 'Atölye > Bağlantılar > Chrome';
  $('duraklat').checked = d.duraklat;
  $('tumSekmeler').checked = d.tumSekmeler;

  const s = d.sekme;
  $('sekmeBolum').hidden = !s;
  if (s) {
    $('sekmeAd').textContent = s.baslik || '';
    $('sekmeAd').title = s.baslik || '';
    const btn = $('paylas');
    const tam = s.paylasilan && s.izinli;
    btn.disabled = !s.web || d.tumSekmeler;
    btn.textContent = tam ? 'Paylaşmayı bırak' : s.paylasilan ? 'İzin ver' : 'Bu sekmeyi paylaş';
    btn.className = tam ? 'ikincil-aktif' : 'birincil';
    $('sekmeNot').textContent = !s.web ? 'Bu sekmede bir web sayfası yok.'
      : d.tumSekmeler ? 'Bütün sekmelere izin verildi: yapay zekâ bu sekmeyi de kullanabilir.'
        : tam ? 'Yapay zekâ bu sekmeyi okuyabilir, alanları doldurabilir ve tıklayabilir. Parola alanlarına yazmaz.'
          : s.paylasilan ? `Sekme paylaşıldı ama ${s.kaynak} için izin yok. "İzin ver"e basıp tarayıcının sorusunu onaylayın.`
            : `Yapay zekâ yalnızca paylaştığınız sekmeleri kullanır (${d.paylasilanSayisi} sekme paylaşılıyor). Paylaşınca tarayıcı bu site için izin ister.`;
  }

  // Verilen site izinleri: kullanıcı buradan kaldırabilir
  $('sitelerBolum').hidden = !d.siteler.length;
  $('siteler').replaceChildren(...d.siteler.map((o) => {
    const li = document.createElement('li');
    const ad = document.createElement('span');
    ad.textContent = o === '<all_urls>' ? 'Bütün siteler' : o.replace(/\/\*$/, '');
    const sil = document.createElement('button');
    sil.type = 'button';
    sil.textContent = 'Kaldır';
    sil.onclick = async () => {
      await chrome.permissions.remove({ origins: [o] }).catch(() => {});
      if (o === '<all_urls>') await gonder({ tip: 'secenek', tumSekmeler: false });
      yenile();
    };
    li.append(ad, sil);
    return li;
  }));

  const liste = $('gunluk');
  liste.replaceChildren(...(d.gunluk.length ? d.gunluk.map((g) => {
    const li = document.createElement('li');
    if (!g.ok) li.className = 'kotu';
    const z = document.createElement('span'); z.className = 'zaman'; z.textContent = new Date(g.zaman).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const o = document.createElement('span'); o.className = 'op'; o.textContent = ISLEM_ADI[g.op] || g.op;
    const t = document.createElement('span'); t.className = 'ozet'; t.textContent = g.ozet; t.title = g.ozet;
    li.append(z, o, t);
    return li;
  }) : [Object.assign(document.createElement('li'), { className: 'bos', textContent: 'Henüz işlem yok.' })]));
}

// Paylaşma: önce sekme paylaşılanlara eklenir, sonra tarayıcı o site için izin ister. (İzin penceresi bazı sürümlerde
// açılır pencereyi kapatabilir; bu sıra sayesinde paylaşma yine kaydedilir, izin verilmezse eklenti bunu bildirir.)
$('paylas').onclick = async () => {
  const s = son?.sekme;
  if (!s) return;
  if (s.paylasilan && s.izinli) { await gonder({ tip: 'paylas', tabId: s.id, acik: false }); return yenile(); }
  await gonder({ tip: 'paylas', tabId: s.id, acik: true });
  if (s.kaynak && !s.izinli) {
    const ok = await chrome.permissions.request({ origins: [`${s.kaynak}/*`] }).catch(() => false);
    if (!ok) { $('hata').hidden = false; $('hata').textContent = `${s.kaynak} için izin verilmedi; yapay zekâ bu sekmeyi kullanamaz.`; }
  }
  yenile();
};
$('duraklat').onchange = async (e) => { await gonder({ tip: 'secenek', duraklat: e.target.checked }); yenile(); };
$('tumSekmeler').onchange = async (e) => {
  if (e.target.checked) {
    if (!confirm('Yapay zekâ Chrome\'daki BÜTÜN sekmelerinizi (açık oturumlarınız dahil) görebilecek ve kullanabilecek. Emin misiniz?')) { e.target.checked = false; return; }
    const ok = await chrome.permissions.request({ origins: ['<all_urls>'] }).catch(() => false);
    if (!ok) { e.target.checked = false; return; }
  } else {
    await chrome.permissions.remove({ origins: ['<all_urls>'] }).catch(() => {});
  }
  await gonder({ tip: 'secenek', tumSekmeler: e.target.checked });
  yenile();
};
$('kurulum').addEventListener('toggle', () => { $('kurulum').dataset.dokunuldu = '1'; });
$('kaydet').onclick = async () => {
  const r = await gonder({ tip: 'ayarKaydet', adres: $('adres').value, kod: $('kod').value });
  $('kod').value = '';
  if (r && !r.ok) { $('hata').hidden = false; $('hata').textContent = r.hata; return; }
  yenile();
};
$('kod').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('kaydet').click(); });
$('yeniden').onclick = async () => { await gonder({ tip: 'yenidenBaglan' }); yenile(); };
chrome.runtime.onMessage.addListener((m) => { if (m?.tip === 'durumDegisti') yenile(); });
yenile();
