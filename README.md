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
- 🛡️ **İzin onayı**: İzin ver / Bu oturumda hep izin ver / Reddet (sebep yazarak)
- 📋 **Plan modu**: plan onayı ve sonrasında otomatik düzenleme moduna geçiş
- ❓ Claude'un sorduğu sorular için seçenekli cevap kartları
- ✅ Yapılacaklar listesi (TodoWrite) görünümü
- 🔀 İzin modları: *Her işlemde sor*, *Düzenlemeleri kabul et*, *Plan modu*, *İzinleri atla* (Shift+Tab ile geçiş)
- 🤖 Model seçimi (gateway'in sunduğu modeller)
- 🗂️ Oturum geçmişi: listeleme, devam etme, yeniden adlandırma, silme (Claude CLI oturumlarıyla ortak)
- 📁 Klasör seçici, `@dosya` önerisi, `/komut` menüsü (`/compact`, `/context`, kendi komutlarınız…)
- 🖼️ Görsel ekleme (yapıştır, sürükle-bırak, dosya seç)
- ⏹️ Durdurma (Esc), açık/koyu tema, mobil uyumlu düzen

## Gereksinimler

- Node.js 18.18 veya üstü
- Claude'a erişim: şirket gateway'i, Anthropic API anahtarı ya da `claude` ile giriş yapılmış bir hesap

> Claude Code CLI'ın ayrıca kurulu olması gerekmez; Agent SDK kendi Claude Code ikili dosyasıyla gelir.

## Kurulum

```bash
git clone https://github.com/mustafaergan/atolye.git
cd atolye
npm install
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
- `src/session.js`: Agent SDK `query()` akışını açık tutan oturum sınıfı (izinler, durdurma, mod/model değişimi)
- `public/`: derleme gerektirmeyen arayüz (HTML, CSS, JS)

## Lisans

MIT
