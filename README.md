# Atölye

Claude Code'u **tarayıcıda, masaüstü uygulamasına benzer bir arayüzle** kullanmanızı sağlayan yerel bir web uygulaması.
[Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) üzerine kuruludur. Claude Code'un ayarlarını
(`~/.claude/settings.json`, `CLAUDE.md`) olduğu gibi kullandığı için **şirket içi gateway / proxy** (ör. `ANTHROPIC_BASE_URL` +
`ANTHROPIC_AUTH_TOKEN`) arkasında da çalışır. claude.ai hesabı gerektirmez.

## Özellikler

- 💬 Akış halinde cevaplar (Markdown, kod blokları, kopyala düğmesi)
- 🧠 Düşünme bloklarını açılır/kapanır gösterme
- 🛠️ Araç kartları: dosya okuma, arama, komutlar, web, alt ajanlar (adımlarıyla birlikte)
- ✏️ Düzenlemeler için **diff görünümü** (+/− satır sayıları)
- 🛡️ **İzin onayı**: İzin ver / Bu oturumda tüm komutlara (ya da düzenlemelere) izin ver / Reddet (sebep yazarak)
- 📋 **Plan modu**: plan onayı ve sonrasında otomatik düzenleme moduna geçiş
- ❓ Claude'un sorduğu sorular için seçenekli cevap kartları
- ✅ Yapılacaklar listesi (TodoWrite) görünümü
- 🔀 İzin modları: *Her işlemde sor*, *Düzenlemeleri kabul et*, *Plan modu*, *İzinleri atla* (Shift+Tab ile geçiş)
- 🤖 Model seçimi (gateway'in sunduğu modeller)
- 📊 **Bağlam ve metrikler**: mesaj kutusunda bağlam doluluk halkası; tıklayınca `/context` dökümü (sistem, araçlar, MCP, CLAUDE.md, mesajlar), oturumun token/süre/maliyet metrikleri ve tek tıkla `/compact`
- 🗂️ Oturum geçmişi: listeleme, devam etme, yeniden adlandırma, silme (Claude CLI oturumlarıyla ortak)
- 🔄 **Arka planda çalışma**: başka oturuma geçmek ya da sayfayı yenilemek işi durdurmaz; geri dönünce kaldığı yerden (bekleyen izinler dahil) görünür. Çalışan oturumlar kenar çubuğunda işaretlenir, işi biten ve bakılmayan oturumlar 30 sn sonra bellekten silinir
- 💬 **Klasörsüz sohbet**: projeye bağlı olmadan soru sorma (ör. ağ/sistem sorunları); oturumlar boş bir klasörde (`~/.atolye/genel`) çalışır, gerekirse izinle komut çalıştırılır
- 🗃️ **Birden fazla proje**: kenar çubuğunda klasörler alt alta, her birinin altında kendi oturumları; farklı projelerde aynı anda çalışma, her projede tek tıkla yeni oturum, daraltma/kaldırma
- 📁 Klasör seçici, `@dosya` önerisi, `/komut` menüsü (`/compact`, `/context`, kendi komutlarınız…)
- 🖼️ Görsel ekleme (yapıştır, sürükle-bırak, dosya seç)
- ⏹️ Durdurma (Esc), açık/koyu tema, mobil uyumlu düzen

## Gereksinimler

- Node.js 18.18 veya üstü
- Claude'a erişim: şirket gateway'i, Anthropic API anahtarı ya da `claude` ile giriş yapılmış bir hesap

> Claude Code CLI'ın ayrıca kurulu olması gerekmez; Agent SDK kendi Claude Code ikili dosyasıyla gelir.

## Kurulum

### Windows: tek komutla (önerilen)

PowerShell'de:

```powershell
git clone https://github.com/mustafaergan/atolye.git $env:LOCALAPPDATA\Atolye
powershell -ExecutionPolicy Bypass -File $env:LOCALAPPDATA\Atolye\atolye.ps1
```

`atolye.ps1` Node.js ve Git'i kontrol eder, paketleri kurar, masaüstüne **Atölye** kısayolu koyar,
Windows açılışında arka planda başlatmayı ayarlar ve tarayıcıyı açar. Yönetici izni gerekmez.
Sonrasında masaüstündeki kısayol yeterlidir; Atölye zaten çalışıyorsa sadece tarayıcıyı açar.

| Komut | İşlev |
|---|---|
| `atolye.ps1` / `atolye.ps1 kur` | Kurulum (yukarıdaki adımlar) |
| `atolye.ps1 baslat` | Arka planda başlat ve tarayıcıyı aç |
| `atolye.ps1 durdur` | Durdur |
| `atolye.ps1 guncelle` | Son sürümü indir, paketleri güncelle, çalışıyorsa yeniden başlat |
| `atolye.ps1 durum` | Kurulum, çalışma ve otomatik başlatma durumu |
| `atolye.ps1 otomatik-ac` / `otomatik-kapat` | Windows açılışında başlatmayı aç / kapat |
| `atolye.ps1 kaldir` | Kısayolları ve otomatik başlatmayı kaldır (dosyalara dokunmaz) |

Atölye arka planda gizli çalışır; çıktısı kurulum klasöründeki `atolye.log` dosyasına yazılır.
Şirket politikası PowerShell script'lerini engelliyorsa komutları `powershell -ExecutionPolicy Bypass -File …`
şeklinde çalıştırın.

### Paket ile dağıtım (Confluence, paylaşılan klasör vb.)

Git ya da GitHub erişimi olmayan kullanıcılar için tek dosyalık zip paketi hazırlanabilir:

```bash
npm run paket            # hafif paket: dist/Atolye-<sürüm>.zip (~0,1 MB; kurulumda npm erişimi gerekir)
npm run paket:tam        # tam paket:     dist/Atolye-<sürüm>-tam.zip (~120 MB; npm erişimi gerekmez, Windows'ta hazırlayın)
```

Kullanıcı zip'i çıkarıp **`Kur.bat`**'a çift tıklar: Atölye `%LOCALAPPDATA%\Atolye` klasörüne kurulur, masaüstü
kısayolu ve Windows açılışında başlatma eklenir (Node.js kurulu olmalıdır; Git gerekmez). Güncellemek için yeni
paket aynı şekilde kurulur; `.env` ayarları korunur. Paketin içindeki `KURULUM.txt` adımları anlatır.

### Elle

```bash
git clone https://github.com/mustafaergan/atolye.git
cd atolye
npm install
npm start
```

### Gateway ayarı

Şirketinizde `claude` CLI zaten çalışıyorsa **genellikle hiçbir şey yapmanız gerekmez**: Atölye, `~/.claude/settings.json`
dosyasındaki `env` ayarlarını okur. Hangi ayarların kullanıldığını görmek için CLI'da `/status` yazın.

Ayarlar sadece terminal ortam değişkenlerinde tanımlıysa `.env.example` dosyasını `.env` olarak kopyalayıp doldurun:

```env
ANTHROPIC_BASE_URL=https://sirket-gateway.example.com
ANTHROPIC_AUTH_TOKEN=...
# HTTPS_PROXY=http://proxy.sirket.com:8080
# NODE_EXTRA_CA_CERTS=C:\\sertifikalar\\sirket-root-ca.pem
```

## Çalıştırma

```bash
npm start
```

Tarayıcı otomatik olarak `http://127.0.0.1:3210` adresinde açılır. Seçenekler:

```bash
node src/cli.js --port 3211 --cwd C:\projeler\uygulamam --no-open
```

| Değişken | Açıklama |
|---|---|
| `ATOLYE_PORT` | Port (varsayılan 3210) |
| `ATOLYE_CWD` | Varsayılan çalışma klasörü |
| `ATOLYE_NO_OPEN=1` | Tarayıcıyı otomatik açma |
| `ATOLYE_DEBUG=1` | Claude Code'un stderr çıktısını konsola yaz |
| `ATOLYE_SPEND=0` | Harcama göstergesini kapat |
| `ATOLYE_SPEND_PATH` | Harcama özeti yolu (varsayılan `/spend-summary`) |

### Harcama göstergesi

Bazı kurumsal gateway'ler, Claude Code token'ıyla çağrılabilen bir harcama özeti sunar:

```
POST <ANTHROPIC_BASE_URL kökü>/spend-summary      Authorization: Bearer <ANTHROPIC_AUTH_TOKEN>
→ { "items": [ { "label": "Monthly Spend", "value": "$82.40" }, ... ] }
```

Atölye bunu **ayar gerektirmeden** dener (adres ve token `.env` ya da `~/.claude/settings.json` içinden okunur).
Gateway destekliyorsa üst çubukta "Bağlı" yazısının yanında `harcanan / bütçe · %yüzde` özeti görünür,
tıklayınca tüm kalemler tablo halinde açılır; desteklemiyorsa gösterge hiç görünmez. Sonuç 1 dakika
önbelleklenir, her turdan sonra ve 5 dakikada bir tazelenir; %75 üzerinde sarı, %90 üzerinde kırmızıdır.

Kurumsal ağlarda TLS denetimi sertifikaları genelde yalnızca işletim sisteminin deposunda olduğundan Atölye
önce Node'u sistem sertifikalarıyla kullanır, bağlanamazsa isteği işletim sisteminin istemcisiyle
(Windows'ta PowerShell, diğerlerinde curl) tekrarlar.

## Klavye kısayolları

| Tuş | İşlev |
|---|---|
| Enter / Shift+Enter | Gönder / yeni satır |
| Esc | Çalışmayı durdur · izin isteğini reddet |
| Enter (izin kartı açıkken) | İzin ver |
| Shift+Tab | İzin modunu değiştir |
| `/` · `@` | Komut menüsü · dosya önerisi |

## Güvenlik

- Sunucu **sadece `127.0.0.1`** adresini dinler; ağdaki başka bilgisayarlar erişemez.
- Başka web sitelerinin yerel sunucuya bağlanmasını engellemek için `Host` ve `Origin` başlıkları kontrol edilir.
- Token tarayıcıya hiçbir zaman gönderilmez; yalnızca Node.js sürecinde kalır.
- Claude dosya düzenleyebilir ve komut çalıştırabilir. *İzinleri atla* modunu yalnızca güvendiğiniz klasörlerde kullanın.

## Mimari

```
Tarayıcı (public/)  ⇄  WebSocket  ⇄  Node.js sunucusu (src/)  →  Claude Agent SDK  →  Gateway  →  Claude
```

- `src/cli.js`: başlangıç, `.env` okuma, tarayıcıyı açma
- `src/server.js`: Express + WebSocket, oturum listesi, klasör ve dosya API'leri
- `src/manager.js`: tarayıcıdan bağımsız çalışan oturumlar, olay tamponu ve boşta kalanları kapatma
- `src/spend.js`: gateway harcama özetini çekme (sistem sertifikaları / PowerShell yedeği) ve özetleme
- `src/session.js`: Agent SDK `query()` akışını açık tutan oturum sınıfı (izinler, durdurma, mod/model değişimi)
- `public/`: derleme gerektirmeyen arayüz (HTML, CSS, JS)

## Lisans

MIT
