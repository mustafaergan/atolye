# Atölye eklentisi: mağaza başvurusu

Chrome Web Store ve Microsoft Edge Add-ons başvurusunda formlara yapıştırılacak metinler ve adımlar. Paket:
`npm run eklenti` → `dist/atolye-chrome-<sürüm>.zip`.

## Yayın adımları (kullanıcı yapar)

1. **Chrome Web Store:** <https://chrome.google.com/webstore/devconsole> adresinde geliştirici hesabı açılır (tek seferlik
   kayıt ücreti; Google hesabı gerekir). **Edge Add-ons:** <https://partner.microsoft.com/dashboard/microsoftedge> (ücretsiz).
2. "Yeni öğe" ile `dist/atolye-chrome-<sürüm>.zip` yüklenir.
3. Aşağıdaki metinler ilgili alanlara yapıştırılır; simge ve ekran görüntüleri `magaza/gorseller/` klasöründen yüklenir.
4. Gizlilik politikası adresi: `https://github.com/mustafaergan/atolye/blob/main/magaza/gizlilik.md`
   (depo `main` dalına gönderildikten sonra çalışır).
5. Görünürlük: şirket içi kullanım için **Liste dışı (Unlisted)** önerilir: aramada çıkmaz, bağlantıyı bilen kurar.
   Kuruluş Google Workspace kullanıyorsa "Yalnızca alan adım" (Private) da seçilebilir.
6. "İncelemeye gönder". Sonraki sürümlerde `manifest.json` içindeki `version` artırılıp yeni zip yüklenir.

## Mağaza kaydı

- **Ad:** Atölye
- **Kategori:** Geliştirici Araçları (Developer Tools) — Edge'de "Developer tools"
- **Dil:** Türkçe (isteğe bağlı İngilizce)
- **Kısa açıklama (manifest'ten, 132 karakter sınırı):**
  Chrome'u bilgisayarınızdaki Atölye'ye bağlar: yapay zekâ yalnızca paylaştığınız sekmeleri okur, form doldurur, tıklar.

### Ayrıntılı açıklama (Türkçe)

```
Atölye eklentisi, Chrome'u bilgisayarınızda çalışan Atölye uygulamasına bağlar. Atölye, Claude Code ve GitHub Copilot gibi yapay zekâ yardımcılarını tarayıcıda kullandıran yerel bir uygulamadır (açık kaynak: github.com/mustafaergan/atolye).

Eklenti kurulu olduğunda Atölye'deki yapay zekâya şunları yaptırabilirsiniz:
• "Bu formu örnek verilerle doldur, gönderme" — test ve deneme formlarını saniyeler içinde doldurur.
• "Bu sayfadaki tabloyu özetle" — açık sayfayı okuyup özetler.
• "Kaydet düğmesine bas, çıkan uyarıyı söyle" — sayfada tıklar ve sonucu bildirir.

Siz denetimdesiniz:
• Yapay zekâ yalnızca sizin paylaştığınız sekmeleri kullanır. Paylaşınca tarayıcı o site için izin ister; izinleri istediğiniz an kaldırabilirsiniz.
• Paylaşılan sekmelerde simgede "AI" yazar; yapılan her işlem eklentinin "Son işlemler" listesinde görünür.
• Parola ve dosya alanlarına asla yazılmaz, parola değerleri okunmaz. Form doldurma formu göndermez.
• "Duraklat" ile bütün işlemleri tek tıkla durdurursunuz.
• Eklenti yalnızca bu bilgisayardaki Atölye'ye bağlanır ve Atölye'nin verdiği eşleştirme koduyla çalışır. Eklentide analiz, reklam ya da izleme kodu yoktur.

Kurulum: Atölye'de Bağlantılar > Chrome bölümünü etkinleştirin, eklenti simgesine tıklayıp oradaki eşleştirme kodunu yapıştırın.

Not: Eklenti tek başına çalışmaz; bilgisayarınızda Atölye uygulamasının kurulu ve açık olması gerekir.
```

### Detailed description (English)

```
The Atölye extension connects Chrome to the Atölye application running on your computer. Atölye is a local app for using AI assistants such as Claude Code and GitHub Copilot in the browser (open source: github.com/mustafaergan/atolye).

With the extension installed, you can ask the AI in Atölye to:
• "Fill this form with sample data, don't submit" — fills test forms in seconds.
• "Summarize the table on this page" — reads and summarizes the open page.
• "Click Save and tell me the warning" — clicks on the page and reports the result.

You stay in control:
• The AI uses only the tabs you share. When you share, the browser asks for permission for that site; you can remove permissions at any time.
• Shared tabs show "AI" on the icon; every action appears in the extension's "Recent actions" list.
• It never types into password or file fields and never reads password values. Filling a form does not submit it.
• "Pause" stops everything with one click.
• The extension connects only to Atölye on this computer, using the pairing code Atölye gives you. There is no analytics, advertising or tracking code.

Setup: enable Connections > Chrome in Atölye, click the extension icon and paste the pairing code shown there.

Note: the extension does not work on its own; the Atölye application must be installed and running on your computer.
```

## Gizlilik sekmesi (Privacy practices)

- **Tek amaç (Single purpose):**
  `Connects the browser to the user's locally running Atölye application so that its AI assistant can read, fill in and click on web pages in the tabs the user explicitly shares.`
- **İzin gerekçeleri:**
  - `activeTab`: `Lets the extension see the address of the current tab when the user opens the extension, so it can offer to share that tab and ask for permission for that site only. It also allows a screenshot of that tab after the user clicks the extension.`
  - `scripting`: `Injects the extension's own bundled script into tabs the user has shared, to read the page text and form fields and to fill fields or click when the user's AI assistant asks. No remote code is used.`
  - `storage`: `Stores the local Atölye address, the pairing code, the user's choices (pause, allow all tabs), the list of shared tabs and the recent actions list shown in the popup.`
  - `alarms`: `Periodically re-establishes the connection to the local Atölye application if the service worker was stopped.`
  - Host permission `http://127.0.0.1/*`, `http://localhost/*`: `The extension connects to the Atölye application running on the same computer at a local address (WebSocket). It never connects to any remote server.`
  - Optional host permission `<all_urls>`: `Requested at runtime only for the specific site of a tab the user chooses to share (for example https://example.com/*), or for all sites only if the user explicitly turns on "Allow all tabs" and confirms. Nothing is requested at install time.`
- **Uzaktan kod (Remote code):** `No, I am not using remote code.` (Bütün betikler pakette.)
- **Veri kullanımı (Data usage):** İşaretlenecek tür: **Web sitesi içeriği (Website content)**. Sayfadaki form değerleri
  kişisel bilgi içerebileceği için **Kişisel iletişim bilgileri** de işaretlenebilir (temkinli seçim).
  Onaylanacak üç beyan: veriler onaylı kullanım dışında üçüncü taraflara satılmaz/devredilmez; tek amaçla ilgisiz
  amaçlarla kullanılmaz; kredi değerliliği ya da borç verme için kullanılmaz.
- **Gizlilik politikası adresi:** `https://github.com/mustafaergan/atolye/blob/main/magaza/gizlilik.md`

## İnceleyici için test talimatı (Test instructions)

```
The extension is a companion to a local desktop/web app and needs it to be useful.
1. Install Node.js 18.18+ and run: git clone https://github.com/mustafaergan/atolye.git && cd atolye && npm install && npm start . Atölye opens at http://127.0.0.1:3210.
2. Open http://127.0.0.1:3210, click "Bağlantılar" (Connections) > "Chrome" > "Etkinleştir" (Enable). Copy the pairing code shown.
3. Click the extension icon > "Bağlantı ayarları" (Connection settings), paste the code, click "Kaydet ve bağlan" (Save and connect). The status changes to "Bağlı" (Connected).
4. Open any web page with a form, click the extension icon > "Bu sekmeyi paylaş" (Share this tab) and accept the site permission prompt.
5. In Atölye, start a session, select the "Chrome" connection and ask: "fill the open form with sample data, do not submit". An AI provider (Claude/Copilot) must be configured in Atölye for this step; steps 1-4 already show the connection and permission flow without one.
The extension only connects to 127.0.0.1/localhost and only acts on tabs shared in step 4.
```

## Görseller

`magaza/gorseller/` içinde: `simge-128.png` (mağaza simgesi), `ekran-1.png`, `ekran-2.png` (1280×800), `tanitim-440x280.png`
(küçük tanıtım görseli).
