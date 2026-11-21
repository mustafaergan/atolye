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
- 🔁 **İki motor**: sağ üstteki seçiciyle oturumlar Claude Code ya da GitHub Copilot CLI ile çalışır (aşağıya bakın) Copilot CLI kurulu değilse Atölye onu arayüzden kurmayı önerir (onayla `npm install -g @github/copilot`), GitHub girişi de arayüzden yapılır Copilot'ta yeni oturumlar listedeki en güncel GPT modeliyle açılır (`.env` içinde `ATOLYE_COPILOT_MODEL=copilot` ile Copilot'un kendi varsayılanına, ya da bir model kimliğiyle o modele dönülür).
- 🌐 **Türkçe / İngilizce arayüz**: kenar çubuğundaki TR / EN seçici; ilk açılışta tarayıcının diline göre seçilir
- 💬 **Klasörsüz sohbet**: projeye bağlı olmadan soru sorma (ör. ağ/sistem sorunları); oturumlar boş bir klasörde (`~/.atolye/genel`) çalışır, gerekirse izinle komut çalıştırılır
- 🗃️ **Birden fazla proje**: kenar çubuğunda klasörler alt alta, her birinin altında kendi oturumları; farklı projelerde aynı anda çalışma, her projede tek tıkla yeni oturum, daraltma/kaldırma; liste diskte (`~/.atolye/durum.json`) tutulur, tarayıcı verileri silinse, port değişse ya da bilgisayar yeniden başlasa da korunur
- 📁 Klasör seçici, `@dosya` önerisi, `/komut` menüsü (`/compact`, `/context`, kendi komutlarınız…)
- 🖼️ Görsel ve dosya ekleme (yapıştır, sürükle-bırak, dosya seç): CSV, Excel (`.xlsx`, sayfa sayfa CSV'ye çevrilir), metin, JSON, PDF… Dosyalar bu bilgisayarda `~/.atolye/ekler` altına kaydedilir (30 gün sonra silinir); içeriğin başı mesaja eklenir, tamamını yapay zekâ verilen yoldan okur
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
| `atolye.ps1 kaldir` | Kaldır: durdurur, kısayolları ve otomatik başlatmayı siler; paketle kurulduysa klasörü de siler (onay ister). Git deposuna ve `~/.claude` sohbet geçmişine dokunmaz. Kişisel veriler (`~/.atolye`: öğretilen komutlar, yerel modeller, klasörsüz sohbet dosyaları) yalnızca sorulduğunda "evet" denirse ya da `-Veriler` verilirse silinir; `-Evet` tek başına silmez |

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
paket aynı şekilde kurulur; `.env` ayarları korunur. Kaldırmak için **`Kaldir.bat`** (paket klasöründe ya da
kurulum klasöründe) çalıştırılır. Paketin içindeki `KURULUM.txt` adımları anlatır.

`Kur.bat` bir **kurulum sihirbazı** açar (İleri > İleri > Kur; komut penceresi görünmez): kullanım koşulları, açılış
biçimi, masaüstü kısayolu, Windows açılışında başlatma, kurulum sırasında güncelleme ve Copilot CLI kurulumu
seçilir. Komut penceresinden kurmak için `Kur-konsol.bat` (ya da `atolye.ps1 kur`) kullanılır. Claude Code ya da
Copilot hazır olmasa da kurulum tamamlanır.

**Masaüstü uygulaması (isteğe bağlı):** Atölye tarayıcı sekmesi yerine kendi penceresinde açılabilir. Pencere,
Windows'un kendi WebView2 bileşenini (Microsoft Edge altyapısı) kullanan küçük bir programdır (`src/masaustu/Atolye.cs`,
yaklaşık 20 KB + WebView2 SDK dosyaları); ayrı bir tarayıcı ya da çalışma ortamı taşımaz. Kurulum sırasında o
bilgisayarda Windows'la gelen .NET Framework derleyicisiyle derlenir, `masaustu-app` klasörüne konur ve Başlat
menüsüne eklenir. Kendi simgesi olduğu için **görev çubuğuna sabitlenebilir** (pencere açıkken simgesine sağ tıklayıp
"Görev çubuğuna sabitle"); sabitlenen simge Atölye çalışmıyorsa önce onu başlatır. Derlenemezse ya da WebView2 yoksa
Atölye tarayıcıda açılır. Sonradan açıp kapatmak için: `atolye.ps1 masaustu-ac` / `masaustu-kapat`
(kısayol için `kisayol-ac` / `kisayol-kapat`).

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

### Node.js kurulamayan bilgisayarlar

`npm run paket:tam` ile hazırlanan **tam paket**, kütüphanelerle birlikte Node.js'in kendisini de (`runtime` klasöründe
`node.exe` ve npm) içerir. Hedef bilgisayarda Node.js kurulu olması, yönetici izni ya da bir kurulum programı gerekmez:
`Kur.bat` paketteki Node'u kullanır ve Atölye onunla çalışır. Bilgisayarda ayrıca Node.js kurulu olsa bile paketteki
kullanılır. Kuruluşunuz kurulumsuz çalışan programları da kısıtlıyorsa (uygulama denetimi) BT ekibinize danışın.

### Kurulumda yapılan denetimler

`atolye.ps1` (ve paketteki `Kur.bat`) kurulum sırasında şunlara bakar; eksik olanı Türkçe adımlarla anlatır, istenirse
kurar ve kurulumu her durumda tamamlar:

- **Kullanım koşulları**: Atölye yalnızca bir arayüzdür ve lisans içermez. Kurulum başında, şirketinizin Claude Code,
  GitHub Copilot ve (bağlanacaksa) Atlassian ürünleri için lisansa sahip olduğunu `evet` yazarak kabul etmeniz istenir;
  kabul edilmezse kurulum yapılmaz. Koşullar ayrıca getirilen verilerin yapay zekâ hizmetine gönderildiğini ve tüm
  sorumluluğun kurulumu yapana ait olduğunu belirtir. Kabul `~/.atolye/kullanim-kosullari-kabul.txt` dosyasına kaydedilir;
  koşullar değişmedikçe yeniden sorulmaz. Etkileşimsiz kurulumda `-Kabul` parametresi ya da `ATOLYE_KABUL=1` kullanılır.
- **Claude Code**: Atölye'nin kendi motoru yerinde mi, `claude` komutu kurulu mu (değilse `npm install -g @anthropic-ai/claude-code`
  önerilir), bağlantı ayarı (gateway adresi ve token ya da claude.ai girişi) var mı.
- **GitHub Copilot CLI** (isteğe bağlı): kurulu mu (değilse `npm install -g @github/copilot` ile kurmayı önerir), giriş
  yapılmış mı (değilse `copilot login` adımlarını anlatır ve istenirse o pencerede başlatır).

`atolye.ps1 durum` aynı bilgileri sonradan gösterir. Arayüzde yeni oturumlar varsayılan olarak **GitHub Copilot** ile açılır
(kurulu değilse Claude Code ile); sağ üstten yapılan seçim yalnızca sayfa açıkken geçerlidir, bir sonraki açılışta yine Copilot gelir. Model listesi seçili motora göre gelir. Oturum listesi de varsayılan olarak yalnızca seçili motorun oturumlarını gösterir; motor seçicisinin menüsündeki onay kutularıyla birden çok motorun (Claude Code, GitHub Copilot, her yerel model ayrı ayrı; **Tümünün oturumlarını listele** ile hepsinin) oturumları aynı anda listelenir. Birden çok motor listelenirken her oturumun başında hangi motora ait olduğunu gösteren küçük bir simge çıkar (yerel modellerde modelin adının baş harfi); tek motor listelenirken simge çıkmaz. Menüde ada tıklamak o motorla yeni oturum açar, onay kutusu yalnızca listeyi etkiler; bu seçim tarayıcıda saklanır. Yerel modelle açılmış bir oturum, listeden yeniden açıldığında kendi modeliyle sürer.
Bir konuşma sürerken başka bir motora geçilirse Atölye sorar: **yeni oturum** mu, **bu konuşmayla devam** mı. Devamda o anki yapay zekâ konuşmanın özetini yazar, özet düzenlenebilir bir kutuda gösterilir ve onaylanan metin hedef motorda açılan yeni oturumun ilk mesajıyla birlikte (ekranda görünmeyen bağlam olarak) gönderilir. Konuşmanın kendisi taşınmaz: motorlar birbirinin kaydını okuyamaz ve yerel modelin gördüğü içerik (Outlook, Teams, veritabanı) onayınız olmadan buluta gitmez; yerel modelden Claude Code ya da Copilot'a geçerken bu açıkça uyarılır. Eski konuşma listede kalır, istenince ona dönülür.
Atölye günde bir kez depoya bakar; daha yeni bir sürüm varsa sağ üstte **Güncelleme var** düğmesi belirir (güncelleme yoksa düğme hiç görünmez). Düğmedeki **Şimdi güncelle** (Windows) son sürümü indirir, gerekiyorsa kütüphaneleri kurar ve Atölye'yi yeniden başlatır: git ile indirilmiş kurulumda `git pull` ile, paketten (zip) kurulumda son sürümü GitHub'dan zip olarak indirerek. İndirme ya da kütüphane kurulumu başarısız olursa çalışan sürüme dokunulmaz. Yeni sürüm, Atölye çalışmaya devam ederken indirilip hazırlanır; Atölye yalnızca klasörlerin yeniden adlandırıldığı birkaç saniyelik değişim adımında durur ve eski klasörler ancak yenisi yerine geçtikten sonra silinir. Değişim sırasında bir hata olursa adlar geri alınır ve Atölye önceki sürümle yeniden başlatılır; değişim tam o anda kesilirse (elektrik, zorla kapatma) bir sonraki başlatılışta kendini onarır. Git ile kurulumda da önce indirilir, kütüphaneler kurulamazsa önceki sürüme dönülür; arayüzden başlatılan güncellemenin çıktısı kurulum klasöründeki `atolye-guncelle.log` dosyasına yazılır. Kenar çubuğunun altındaki **Kayıtlar** bağlantısı ayrı bir sayfa (`/log.html`) açar: oturum açılışları, süreler, bağlantı ve güncelleme denetimleri ile hatalar (anahtarlar gizlenir, konuşma içeriği yer almaz). **Teams için kopyala** son satırları bir Teams mesajına sığacak uzunlukta, kod bloğu olarak panoya alır.

**Güncellemenin güvenceleri (paket kurulumu):** yeni sürüm yerine konduktan sonra gerçekten açılıp cevap verdiği denetlenir; eski klasörler ancak bundan sonra silinir. Yeni sürüm açılırken çöküyorsa önceki sürüm geri yüklenir ve Atölye onunla yeniden başlatılır. Sunucu süreci hiç çalıştırılamadıysa (ör. güvenlik yazılımı gizli pencereden başlatmayı engellediyse) yeni sürüm yerinde kalır ve bunu kayıt söyler. Güncelleme sürerken kurulum klasöründe `.guncelleniyor` dosyası durur: bu sırada başka bir başlatma ya da ikinci bir güncelleme araya girmez. Atölye kendi penceresinde açıksa pencere sunucuyu izler: sunucu yaklaşık 20 saniye cevap vermezse (güncelleme onu başlatamadıysa, süreç kapandıysa) onu kendisi yeniden başlatır; pencereyi kapatıp açmak gerekmez. Tarayıcıda kullanılıyorsa sayfa, sunucu uzun süre dönmezse masaüstü kısayoluyla başlatılmasını söyler.

Günlük denetimi beklemeden bakmak için kenar çubuğunun altındaki **Güncellemeleri denetle** kullanılır. Güncelleme kendiliğinden yapılmaz, siz başlatırsınız (`ATOLYE_UPDATE_CHECK=0` denetimi kapatır). Tek istisna kurulumdur: `Kur.bat` / `atolye.ps1 kur` depoda daha yeni bir sürüm görürse Atölye'yi başlatmadan önce günceller. Sürüm okunamaz, indirilemez ya da kütüphaneler kurulamazsa (ör. şirket ağı engelliyorsa) uyarı yazıp kurulan sürümle devam eder; kurulum bu yüzden durmaz.

### Kullanım modu (rol)

Sol üstteki **Mod** seçicisi arayüzü kullanan kişiye göre düzenler:

| Mod | Görünen bağlantılar | Öneriler ve anlatım |
|---|---|---|
| **Analist** (varsayılan) | Jira, Confluence, Bitbucket, Graylog Test, Graylog Prod, ReportPortal, İlk repom, Proxy | Projeyi sade dille anlatma, iş kurallarını çıkarma, değişiklik etkisi; Claude teknik olmayan dille anlatır ve istenmedikçe bir şeyi değiştirmez |
| **Proje Sahibi** (Project Owner) | Analistle aynı | Analistle aynı; birden fazla bağlantıyı birlikte ele alma yönergesiyle (ör. Jira + Bitbucket + Confluence) ve yapay zekâ hepsinden veri toplayıp tek bir özet çıkarır; toplu değişikliklerden önce onay ister |
| **Test** | Analistle aynı | Analistle aynı öneriler; yapay zekâ test edilebilir davranışa odaklanır: test senaryoları, beklenen/gerçekleşen sonuç, yeniden üretme adımları, değişikliğin riskli alanları; hatayı doğrudan kayıt açılabilecek biçimde yazar ve istenmedikçe bir şeyi değiştirmez |
| **Geliştirici** | Analistteki bağlantılar + Jenkins, Fortify, SonarQube, WebLogic, Oracle, PostgreSQL | Test çalıştırma, kod inceleme; Claude kısa ve teknik yanıt verir |

Mesaj kutusunun başındaki **Agent / Ask / Plan** seçicisi yapay zekânın çalışma kipini belirler (Shift+Tab ile değişir):
**Agent** dosya değiştirebilir ve komut çalıştırabilir (yanındaki izin ayarına göre), **Ask** yalnızca yanıtlar, **Plan**
hiçbir şeyi değiştirmeden plan çıkarır. Ask ve Plan'da dosya değiştiren araçları Atölye reddeder. Varsayılan: Analist,
Proje Sahibi ve Test'te Ask, Geliştirici'de Agent; seçim mod başına saklanır.

Bütün modlarda mesaj kutusunun altındaki bağlantı seçicisinden aynı soru için **en fazla 4 bağlantı** birlikte seçilebilir
(ör. Jira + Bitbucket + Confluence); yapay zekâ hepsinden veri toplayıp tek bir özet çıkarır.

### Ayarlar

Sol üstteki dişli **Ayarlar** penceresini açar:

- **Uygulama:** masaüstü uygulaması (kendi penceresi), masaüstü kısayolu ve Windows açılışında başlatma açılıp
  kapatılır; Atölye gerekeni kendisi yapar (Windows kurulumunda).
- **Claude Code:** gateway adresi ve token (kurulum klasöründeki `.env` dosyasına yazılır; boşsa Claude Code'un kendi
  ayarları kullanılır).
- **GitHub Copilot:** CLI kurulumu, GitHub girişi ve yeni oturumların varsayılan modeli.
- **Yerel LLM:** bu bilgisayarda, yerel ağda ya da kurum içinde çalışan modeller (Ollama, LM Studio, llama.cpp,
  OpenAI uyumlu gateway vb.). **+** ile birden fazla model eklenir; her biri üstteki motor seçicisinde "Yerel: …"
  olarak çıkar. Yerel model Claude Code motoruyla kullanılır ve iki tür sunucu desteklenir:
  - **Anthropic uyumlu** (`/v1/messages`; Ollama 0.14+, LM Studio 0.4.1+): Claude Code doğrudan sunucuya bağlanır.
  - **OpenAI uyumlu** (`/chat/completions`; vLLM, LiteLLM, kurum içi gateway'ler): araya Atölye'nin köprüsü girer
    (`src/kopru.js`); istek OpenAI biçimine, yanıt (akış ve araç çağrıları dahil) Anthropic biçimine çevrilir.
    Adres `/chat/completions` ile biten tam hâliyle (ör. `https://gateway.sirket.com/chat/completions`) ya da kök
    olarak (`http://localhost:8000`, sonuna `/v1/chat/completions` eklenir) yazılabilir. API anahtarı `Authorization:
    Bearer` başlığıyla gönderilir ve Claude Code sürecine verilmez.

  Tür, adres `/chat/completions` ile bitiyorsa kendiliğinden seçilir; emin değilseniz **Bağlantıyı dene** hangisinin
  çalıştığını bulur. Liste `~/.atolye/yerel-llm.json` dosyasında durur. Küçük modeller araç kullanımında (dosya
  okuma, komut çalıştırma) zayıf kalabilir; modelin araç çağrısını (function calling) desteklemesi gerekir.

  **Dışa aktar / İçe aktar:** model listesi `atolye-yerel-llm.json` dosyasına yazılır ve başka bir bilgisayarda içe
  aktarılır. API anahtarları dosyada açık durmaz; şifreleme anahtarıyla (değiştirilmezse `atolye`) AES-256-GCM ile
  şifrelenir ve içe aktarırken aynı anahtar sorulur; yanlış anahtarda hiçbir şey eklenmez. Varsayılan anahtar herkesçe
  bilindiği için dosyayı paylaşacaksanız dışa aktarırken kendi anahtarınızı yazın.
- **Skill'ler:** içinde `SKILL.md` bulunan bir klasör (ya da birden fazla skill içeren üst klasör) eklenir; skill
  `~/.claude/skills` (Claude Code ve yerel LLM oturumları) ve `~/.copilot/skills` (GitHub Copilot; Copilot, Claude'un
  klasörüne bakmaz) altına kopyalanır ve yeni oturumlarda `/` komut listesinde çıkar. **Bilgisayardaki her skill her
  oturum türünde çalışır**, Atölye ile eklenmemiş olsa da: `~/.claude/skills`, projenin `.claude/skills` klasörü ve
  `~/.copilot/skills` altındaki skill'ler bütün oturumların `/` listesinde görünür. Oturumun motoru skill'i kendisi
  tanımıyorsa (Copilot'ta Claude klasöründeki, Claude Code ve yerel LLM'de yalnızca Copilot klasöründeki skill) Atölye
  `/skill-adı istek` mesajını düz isteğe çevirir ve skill'in yerini bildirir; dosyalar kopyalanmaz, yerinden okunur.
  Ayarlar'da Atölye ile eklenmemiş skill'ler ayrı bir listede gösterilir; yalnızca Atölye'nin eklediği skill'ler buradan kaldırılabilir. Klasör yolu elle yazılabilir ya da **Klasör seç…** ile bilgisayardan seçilebilir. Eski sürümle eklenmiş skill'ler Atölye
  açılırken Copilot klasörüne de kopyalanır.
- **Oturumlar:** "N gündür kullanılmayan" ya da "şu tarihten önce son kez kullanılan" oturumlar toplu silinir. Önce kaç
  oturumun silineceği ve ne kadar yer açılacağı gösterilir. Claude oturumları Claude Code ile ortaktır; silinen geri
  gelmez. Sekmenin başındaki **Disk kullanımı** özeti oturum kayıtlarının toplam boyutunu (motorlara göre), sohbete
  eklenen dosyaların (`~/.atolye/ekler`) ve klasörsüz sohbet dosyalarının (`~/.atolye/genel`) boyutunu ve en çok yer
  tutan oturumları gösterir; Atölye'nin kurulum klasörü bu sayılara dahil değildir.

**Klasör seçimi:** proje klasörü eklerken ya da skill klasörü seçerken pencerenin üstünde kısayollar bulunur: Ev klasörü,
Masaüstü, Belgeler, İndirilenler, Bu bilgisayar (sürücüler) ve Atölye'deki proje klasörleri. Masaüstü ve Belgeler OneDrive'a ya da
başka bir sürücüye taşınmışsa gerçek yerleri açılır.

**Sohbetlerde arama:** kenar çubuğundaki arama kutusu bütün proje klasörlerindeki sohbetlerin (Claude, Copilot, yerel)
başlıklarında ve mesaj metinlerinde arar; sonuçta eşleşen bölüm vurgulanır, tıklayınca sohbet açılır. Araç çıktıları
aranmaz. **Sıralama:** kenar çubuğunda proje klasörleri ve bir klasörün içindeki sohbetler sürüklenip bırakılarak
sıralanır (klasörsüz sohbet hep en üstte kalır).

**Soru işaretleri:** konuşmanın sağ kenarında her sorunuz için küçük bir çizgi durur; üzerine gelince sorunun başı
görünür, tıklayınca o soruya gidilir. Ekranda okunan bölümün sorusu vurgulanır (tek soruluk konuşmada gösterilmez).

**Güncelleme denetimi:** Atölye açılır açılmaz ve her sabah 9'da depoya bakar; bilgisayar o saatte kapalı ya da
uykudaysa açıldığında bakar (`ATOLYE_UPDATE_HOUR` saati değiştirir).

**Komut öğretme:** boş oturum ekranındaki mavi **+ Komut öğret** düğmesine basıp ne yapılmasını istediğinizi kendi
cümlelerinizle anlatın ("önce Jira kaydını okusun, sonra Bitbucket'a baksın…"). Seçili yapay zekâ anlattıklarınızı adı,
adım adım yönergesi ve kullanacağı bağlantılarla bir komuta derler; kaydetmeden önce görür ve düzeltirsiniz. Öğretilen
komutlar boş oturum ekranında renkli düğme olarak görünür. Üst çubuktaki **Komutlar** düğmesinden içerikleri,
bağlantıları ve renkleri değiştirilebilir ya da komut silinebilir; Atölye ile gelen hazır komutlar da aynı yerden
düzenlenebilir, renklendirilebilir, gizlenebilir ve istenince ilk hâline döndürülebilir. Komutlar `~/.atolye/komutlar.json` dosyasında saklanır (en fazla
30 komut, komut başına en fazla 4 bağlantı). Yapay zekâya ulaşılamazsa anlattığınız metin olduğu gibi alınır.

Seçim saklanır. Mod değişince yeni bir oturum açılır (anlatım biçimi oturum açılırken belirlenir; Copilot'ta sistem
yönergesi değiştirilemediği için orada yalnızca görünen bağlantılar ve öneriler değişir). Yeni bir mod (ör. yönetici,
testçi) eklemek için `public/app.js` içindeki `ROLES` tanımına bir kayıt, `src/session.js` içindeki `ROLE_PROMPTS`'a
bir satır eklemek yeterlidir.

### Jira, Confluence ve Bitbucket bağlantıları

Üst çubuktaki **Bağlantılar** düğmesi, her servis için adım adım tarifli bir pencere açar: adresi ve API anahtarını
(şirket içi kurulumda kişisel erişim belirteci; Cloud'da e-posta + API belirteci) girip **Kaydet ve sına** demeniz yeterli.
Bağlandıktan sonra yeni açılan oturumlarda şunlar sorulabilir: "bana atanmış açık kayıtları listele", "ABC-123'ü oku",
"Confluence'ta kurulum dokümanını bul", "şu deponun açık çekme isteklerini incele".

- **Proxy** sekmesi, şirket ağı internete proxy üzerinden çıkıyorsa GitHub Copilot için kullanılır: adres, kullanıcı adı,
  parola ve proxy kullanılmayacak adresler girilir; **Kaydet ve sına** proxy üzerinden GitHub'a ulaşılabildiğini denetler.
  Ayar yalnızca Atölye'nin başlattığı Copilot süreçlerine verilir (Claude Code ve diğer programlar etkilenmez) ve `.env`
  dosyasında `COPILOT_PROXY` / `COPILOT_NO_PROXY` olarak saklanır.
- Bağlantı kurulduktan sonra mesaj kutusunun altında bir **Bağlantı** seçicisi belirir. Bir bağlantı (ör. Jira) seçiliyken
  yazdığınız soruya, yapay zekânın o bağlantının araçlarını kullanması için kısa bir not eklenir.
- Copilot oturumunda bir bağlantı seçiliyken görünen **Veri getir** düğmesi, veriyi yapay zekâya bırakmadan Atölye'nin kendisine çektirir:
  kayıtlı bağlantıyla doğrudan servisin REST arayüzüne gidilir (yalnızca okuma) ve sonuç mesajınıza eklenir. MCP
  araçlarının kullanılamadığı oturumlarda da (ör. kuruluş politikasıyla kısıtlı Copilot) bu yol çalışır; getirilen metin
  mesajın parçası olarak seçili yapay zekâya gider.
- Copilot oturumunda (her modda) bir bağlantı seçiliyken soru sorulduğunda akış şöyledir: yapay zekâ soruyu yorumlar
  ve hangi veriye ihtiyacı olduğunu yazar → Atölye isteği gösterir ve onayınızla kayıtlı bağlantı üzerinden REST ile
  getirir → veri yapay zekâya geri gönderilir ve soru yanıtlanır. Yalnızca okuma işlemleri vardır; her istek için onay
  sorulur (oturum boyunca izin verilebilir). Claude Code'da aynı iş MCP araçlarıyla doğrudan yapılır.
- **Tarayıcı** sekmesi, yapay zekânın bir tarayıcıyı sürmesini sağlar (sayfa açma, tıklama, form doldurma, ekran
  görüntüsü). Hangi tarayıcının açılacağı seçilir: bilgisayarda kurulu Chrome ya da Edge, ya da Playwright'ın kendi
  Chromium / Firefox / WebKit tarayıcıları. Bunun için Microsoft'un Playwright MCP paketi (`@playwright/mcp`) gerekir:
  paket Atölye ile birlikte gelir, bu yüzden npm erişimi olmayan ağlarda da ek kurulum gerekmez ve sekmede "kurulu" görünür
  (eksikse ne indirileceği bildirilir ve yalnızca onay verilirse `npm install -g` ile kurulur). Kurulu Chrome ya da Edge
  seçildiğinde tarayıcı da indirilmez. Ayar CLI dosyalarına `tarayici` adıyla yazılır. Açılan tarayıcı ayrı ve boş bir
  profildir; yapay zekâ açtığı sayfalardaki metinlerden etkilenebileceği için gerçek sistemlerde dikkatli kullanılmalıdır.
- **Fikirhane** sekmesi (bütün modlarda), tarayıcı testlerini kısaltmak ve ucuzlatmak içindir.
  [Fikirhane](https://github.com/mustafaergan/fikirhane) bu bilgisayarda çalışan ayrı bir uygulamadır: bir web
  uygulamasını bir kez gezer; ekranlarını, alan ve düğmelerin Playwright seçicilerini, ekranlara gidiş yollarını ve
  kaydedilen senaryoları saklar. Bağlantı açıkken yapay zekâ ekranı her seferinde sayfa dökümüyle baştan keşfetmek
  yerine Fikirhane'ye sorar; birden çok adımlı işi senaryo olarak kaydeder ve sonraki seferlerde tek bir araç çağrısıyla
  çalıştırır (sonuç birkaç satırdır: geçti / hangi adımda kaldı / ekran kayıtlı hâline göre değişmiş mi).
  - Adres ya da anahtar gerekmez: **Etkinleştir** demek yeterli. Fikirhane 0.7.0 ya da yenisi çalışıyor olmalıdır;
    sekme çalışıp çalışmadığını ve gezilmiş siteleri gösterir. Tarayıcı bağlantısı seçildiğinde yönerge mesaja
    kendiliğinden eklenir; Fikirhane tek başına da seçilebilir ("üye ekleme hangi ekranda yapılıyor?").
  - Araçlar: `fikirhane_site`, `fikirhane_find`, `fikirhane_screen`, `fikirhane_scenario` (okuma),
    `fikirhane_save_scenario`, `fikirhane_run_scenario` (izin sorulur). Senaryo, Tarayıcı bağlantısıyla gelen Playwright
    ve orada seçilen tarayıcıyla çalışır; bu yüzden senaryo çalıştırmak için Tarayıcı bağlantısı da kurulu olmalıdır.
  - Giriş gerektiren uygulamalarda yapay zekâ aracı `login` ile çağırır: tarayıcı açılır, girişi **siz** yaparsınız ve
    pencereyi kapatırsınız. Oturum `~/.atolye/fikirhane/profil-<site>` altındaki ayrı bir tarayıcı profilinde saklanır;
    parolanızı yapay zekâya yazmanız gerekmez. Senaryolara parola sabit değer olarak kaydedilemez.
  - Güven: Fikirhane yalnızca `127.0.0.1` üzerinde dinler. Atölye onu Fikirhane'nin kendi klasörüne yazdığı kapı
    dosyasından (`~/.fikirhane/kapi.json`) bulur ve her yanıtın oradaki anahtarla imzalandığını denetler; aynı porta
    oturmuş başka bir programın yanıtı kullanılmaz, betiği çalıştırılmaz. Betiğe Atölye'nin bağlantı anahtarları ve
    yapay zekâ sağlayıcısının bilgileri (ortam değişkenleri) verilmez. Fikirhane'den gelen metinler gezilen sayfalardan
    alınmıştır: yapay zekâya veri olarak verilir, yönerge olarak değil.
  - Fikirhane çalışmıyorsa ya da uygulama gezilmemişse araç bunu söyler ve tarayıcı işi eskisi gibi sürer. Copilot
    oturumunda araçlar kuruluş politikasıyla kapalıysa okuma işlemleri **Veri getir** ile yapılır.
- **İlk repom** sekmesi, ilk kez depo indirecekler içindir: depo adreslerini yapıştırıp (Bitbucket bağlıysa listeden
  işaretleyip) **Depoları indir** demek yeterli; birden fazla depo aynı anda seçilebilir. Depolar `~/repos` altına iner ve ayrı ayrı proje
  olarak eklenir; aynı klasörde birden fazla depo olunca o kök klasör de proje olarak eklenir (depoların tümü hakkında oradan soru sorulur).
- Her sekmede **Yapay zekâdan yardım al** düğmesi, hazır bir soruyla klasörsüz sohbet açar; bir hata çıktığında
  **Bu hatayı yapay zekâya sor** düğmesi hatayı soruya ekler.
- Araçlar: `jira_search`, `jira_get_issue`, `jira_add_comment`, `confluence_search`, `confluence_get_page`,
  `bitbucket_list_repos`, `bitbucket_my_review_prs` (reviewer olduğunuz açık PR'lar), `bitbucket_list_pull_requests`, `bitbucket_get_pull_request`, `bitbucket_pr_build_status`, `bitbucket_get_file`,
  `graylog_search`, `graylog_list_streams` (Graylog Test; erişim belirteciyle log arama), `graylog_prod_search`,
  `graylog_prod_list_streams` (Graylog Prod: canlı ortam, ayrı adres ve belirteçle; yalnızca okuma).
- **Test Otomasyonu** (bütün modlarda): test otomasyon deposunun klasörü ve çalıştırma komutu kaydedilir (depo buradan
  indirilebilir, komut proje türüne göre önerilir: Maven/Cucumber, Gradle, Playwright, Cypress, pytest, .NET). Bitbucket bağlıysa
  depo oradaki listeden seçilir. İsteğe bağlı bir release dalı kaydedilebilir; kaydedilmezse yapay zekâ çalıştırmadan
  önce hangi release dalında çalışacağını sorar. Mesaj
  kutusunda bu bağlantı seçiliyken yapay zekâ testleri sizin izninizle çalıştırır ve sonucu özetler. Ayar
  `~/.atolye/test-otomasyon.json` dosyasında tutulur.
- **ReportPortal** (API anahtarı; bütün modlarda, yalnızca okuma): `reportportal_list_projects`, `reportportal_list_launches`,
  `reportportal_get_launch`, `reportportal_list_items` (başarısız testler), `reportportal_get_logs` (hata kayıtları).
- **Outlook** (yalnızca **yerel LLM** oturumlarında; bütün modlarda, yalnızca okuma): bilgisayardaki klasik Outlook'tan
  e-posta ve takvim okur: `outlook_list_folders`, `outlook_search_mail`, `outlook_get_mail`, `outlook_list_events`.
  Hesap, parola ya da adres gerekmez; Bağlantılar penceresindeki Outlook sekmesinden etkinleştirilir. E-postalar gizli
  bilgi içerebildiği için sekme de araçlar da yalnızca motor seçicisinde bir yerel model seçiliyken vardır: okunan
  içerik yalnızca o modele gider, Claude Code ve GitHub Copilot oturumlarına Outlook araçları hiç sunulmaz ("Veri
  getir" de kullanamaz). Erişim PowerShell üzerinden Outlook'un kendi arayüzüyle (COM) yapılır; "Yeni Outlook" ve
  Outlook web desteklenmez, güvenlik yazılımı PowerShell'i engelliyorsa bağlantı çalışmaz.
- **Teams** (yalnızca **yerel LLM** oturumlarında; bütün modlarda, yalnızca okuma): Microsoft Graph üzerinden Teams
  sohbetlerini ve kanal gönderilerini okur: `teams_list_chats`, `teams_get_messages`, `teams_list_channels`,
  `teams_get_channel_messages`. Uygulama kaydı gerekmez: Microsoft'un
  [Graph Explorer](https://developer.microsoft.com/graph/graph-explorer) aracında iş hesabınızla giriş yapıp
  "Access token" sekmesindeki erişim anahtarını Bağlantılar penceresindeki Teams sekmesine yapıştırırsınız (sohbetler
  için `Chat.Read`, kanal gönderileri için `ChannelMessage.Read.All` ya da `Group.Read.All` izni gerekir). Anahtar
  kuruluşun ayarına göre bir saat ile bir gün arasında geçerlidir; süresi dolunca yenisi yapıştırılır, yeni oturum açmak
  gerekmez. Anahtar **yalnızca Atölye'nin belleğinde** tutulur: diske, ayar dosyalarına ya da kayıtlara yazılmaz, arayüze
  ve yapay zekâya geri verilmez, Atölye kapanınca silinir; Graph'in reddettiği anahtar saklanmaz. Araçlar Graph'e
  kendileri gitmez; isteği Atölye sunucusuna iletirler ve bunu yalnızca yerel LLM oturumlarına verilen iç anahtarla
  yapabilirler, bu yüzden Claude Code ve GitHub Copilot oturumları Teams'e ulaşamaz. İnternete proxy üzerinden çıkılıyorsa
  Bağlantılar > Proxy'deki ayar kullanılır. Anahtar hesabınıza erişim sağlar: başka hiçbir yere yapıştırmayın ve
  kuruluşunuzun kurallarına uyun.
- Yerel LLM oturumlarında bağlantı araçları modele doğrudan tanımlanır (Claude Code'un araçları sonradan yükleyen
  "araç araması" kapatılır; yerel modeller ertelenmiş araçları çağıramaz).
- Geliştirici modundaki bağlantılar:
  - **Jenkins** (kullanıcı adı + API belirteci): `jenkins_list_jobs`, `jenkins_get_build`, `jenkins_get_console`,
    `jenkins_trigger_build` (derleme başlatır; diğer yazan araçlar gibi önce izin sorar).
  - **OpenText Fortify SSC** (erişim belirteci, ya da kullanıcı adı + parola; ikincisinde her oturumda geçici belirteç alınır): `fortify_list_versions`, `fortify_list_issues`, `fortify_get_issue`.
  - **SonarQube** (kullanıcı belirteci; yalnızca okuma): `sonarqube_list_projects`, `sonarqube_quality_gate`,
    `sonarqube_measures`, `sonarqube_list_issues`, `sonarqube_list_hotspots`.
  - **Oracle** ve **PostgreSQL** (adres + kullanıcı adı + parola; yalnızca okuma): `oracle_query`, `oracle_list_tables`,
    `oracle_describe_table`, `postgres_query`, `postgres_list_tables`, `postgres_describe_table`. Yalnızca tek bir
    SELECT / WITH sorgusu kabul edilir, salt okunur işlem içinde çalışır (en çok 1000 satır, 30 sn). Oracle "thin"
    kipte çalışır, Oracle istemcisi gerekmez (12.1+). Bilgisayarda 64 bit Oracle istemcisi (Oracle Client ya da Instant
    Client) varsa onun kitaplıkları kullanılır ("thick" kip): thin kipin desteklemediği eski parola biçimi (10G; "NJS-116"
    hatası) ve 12.1'den eski veritabanları bununla çalışır. İstemci yoksa Bağlantılar > Oracle sekmesindeki **Oracle
    istemcisini indir** düğmesi (Windows x64) Oracle Instant Client 19c "Basic" paketini Oracle'ın kendi sitesinden,
    Oracle'ın lisans koşullarıyla indirir (164 MB iner, yaklaşık 500 MB yer kaplar; proxy ayarı kullanılır, inen dosyanın
    SHA-256 özeti doğrulanır) ve `~/.atolye/oracle-client` altına açar; Microsoft Visual C++ Redistributable (2017+)
    kurulu olmalıdır. Atölye paketi kendisi dağıtmaz. Kitaplık ayrıca `ORACLE_HOME` ve `PATH` içinde aranır; başka yerdeyse
    `.env` içinde `ORACLE_CLIENT_LIB_DIR=<klasör>` ile gösterilir, `ORACLE_THIN=1` her durumda thin kipi zorlar. Yalnızca okuma yetkisi olan bir veritabanı kullanıcısı önerilir.
  - **WebLogic** (REST yönetim arayüzü; kullanıcı adı + parola, yalnızca okuma): `weblogic_servers`,
    `weblogic_applications`, `weblogic_deployments`, `weblogic_datasources`. Parola düz metin saklandığı için
    yönetici hesabı yerine "Monitor" rolünde bir kullanıcı kullanın.
  Yazan tek araç `jira_add_comment`'tir ve diğer araçlar gibi önce izin sorar.
- Bilgiler Atölye'de ayrıca saklanmaz; Claude Code ve Copilot CLI'ın MCP sunucularını tuttuğu kendi dosyalarına
  `atolye` adıyla yazılır (`~/.claude.json` ve `~/.copilot/mcp-config.json`). Böylece aynı araçlar terminaldeki
  `claude` ve `copilot` komutlarında da çalışır. API anahtarı bu dosyalarda düz metin olarak durur ve tarayıcıya
  geri gönderilmez; anahtara gereğinden geniş izin vermeyin.

### GitHub Copilot CLI (isteğe bağlı)

Sağ üstteki seçiciyle oturumlar **Claude Code** yerine **GitHub Copilot CLI** ile de çalıştırılabilir. Atölye,
Copilot CLI'ın sunucu modunu ([`copilot --acp`](https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server),
Agent Client Protocol; GitHub'da önizleme aşamasında) kullanır; cevap akışı, araç kartları, diff, izin kartları, plan
(yapılacaklar) ve bağlam halkası Claude oturumlarındakiyle aynı arayüzde görünür.

```bash
npm install -g @github/copilot   # Copilot CLI'ı kur
copilot login                    # tarayıcıdan GitHub hesabıyla giriş yap (bir kez)
```

Kurulu değilse seçicide "kurulu değil" yazar. Seçicide başka bir motorun adına tıklamak o klasörde seçilen motorla yeni bir oturum
açar; açık oturum kendi motoruyla çalışmaya devam eder ve kenar çubuğunda "Copilot" etiketiyle (birden çok motor listeleniyorsa motor simgesiyle) görünür.
Copilot oturumunda sağ üstte **kalan Copilot kotası** (toplam hak, kalan, yüzde; üzerine gelince plan ve sıfırlanma tarihi) ve o oturumda harcanan kredi görünür. Kota, Copilot CLI'ın bilgisayardaki kendi önbelleğinden okunur; Atölye bunun için GitHub'a istek atmaz. Copilot'ta model ve plan modu Copilot'un kendi komutlarıyla (`/model`, `/plan`) seçilir; harcama etiketi yalnızca
Claude gateway'i içindir. Copilot CLI başka bir yerdeyse `.env` içinde `COPILOT_CLI_PATH` ile gösterilebilir. Copilot konuşmalarının yerel bir kopyası `~/.atolye/copilot/` altında tutulur; böylece Copilot o an bağlanamasa da eski konuşma hemen görünür. Açılış yavaşsa `COPILOT_EXTRA_ARGS=--disable-builtin-mcps` GitHub'ın yerleşik MCP sunucularını kapatır. Kuruluşunuzun Copilot politikası üçüncü taraf MCP sunucularını kapatmışsa Jira / Confluence / Bitbucket araçları yalnızca Claude Code oturumlarında çalışır.

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
- OpenAI uyumlu yerel modeller için köprü (`/kopru/…`) yalnızca bu bilgisayardan ve her açılışta yeniden üretilen bir
  anahtarla çağrılabilir; model sunucusunun asıl API anahtarı Atölye'nin dışına yalnızca o sunucuya giderken çıkar.
- Token tarayıcıya hiçbir zaman gönderilmez; yalnızca Node.js sürecinde kalır.
- Claude dosya düzenleyebilir ve komut çalıştırabilir. *İzinleri atla* modunu yalnızca güvendiğiniz klasörlerde kullanın.

## Mimari

```
Tarayıcı (public/)  ⇄  WebSocket  ⇄  Node.js sunucusu (src/)  →  Claude Agent SDK  →  Gateway  →  Claude
```

- `src/cli.js`: başlangıç, `.env` okuma, tarayıcıyı açma
- `src/server.js`: Express + WebSocket, oturum listesi, klasör ve dosya API'leri
- `src/manager.js`: tarayıcıdan bağımsız çalışan oturumlar, olay tamponu ve boşta kalanları kapatma
- `src/store.js`: kalıcı arayüz durumu (`~/.atolye/durum.json`: projeler, açık/kapalı klasörler, son seçimler)
- `src/copilot.js`: GitHub Copilot CLI motoru (ACP istemcisi; Copilot mesajlarını arayüzün kart yapısına çevirir)
- `src/integrations.js`, `src/atlassian.js`, `src/mcp-server.js`: Jira / Confluence / Bitbucket bağlantıları (ayarları CLI'ların
  kendi dosyalarına yazar; araçları küçük bir MCP sunucusuyla sunar)
- `src/spend.js`: gateway harcama özetini çekme (sistem sertifikaları / PowerShell yedeği) ve özetleme
- `public/i18n.js`, `src/messages.js`: Türkçe/İngilizce metinler (Türkçe metin anahtardır; `npm test` eksik çeviriyi yakalar)
- `src/session.js`: Agent SDK `query()` akışını açık tutan oturum sınıfı (izinler, durdurma, mod/model değişimi)
- `public/`: derleme gerektirmeyen arayüz (HTML, CSS, JS)

## Lisans ve sorumluluk

MIT lisansı (bkz. `LICENSE`): yazılım olduğu gibi, hiçbir garanti verilmeden sunulur.

Atölye yalnızca bir arayüzdür; Claude Code, GitHub Copilot ve bağlanan servislerin (Jira, Confluence, Bitbucket, Graylog,
Jenkins, Fortify, SonarQube, WebLogic) lisansını içermez. Bağlantılar üzerinden getirilen veriler, sorularla birlikte seçilen yapay
zekâ hizmetine gönderilir. **Kurulumdan ve kullanımdan doğacak tüm sorumluluk — veri paylaşımı, lisans ve kuruluş
kurallarına uygunluk, yapılan işlemler ve sonuçları dahil — kurulumu yapan ve kullanan kişiye aittir; yazılımı
geliştirenler sorumlu tutulamaz.** Bu koşullar kurulum sırasında gösterilir ve `evet` yazılarak kabul edilmeden kurulum
yapılmaz.

---

optona.tr tarafından yazılmıştır.
