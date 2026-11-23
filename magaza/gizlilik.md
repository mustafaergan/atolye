# Atölye tarayıcı eklentisi: gizlilik politikası

Son güncelleme: 23 Kasım 2026

*English version below.*

Atölye eklentisi, Chrome'u (ya da Microsoft Edge'i) **aynı bilgisayarda çalışan** Atölye uygulamasına bağlar. Atölye,
yapay zekâ destekli kodlama ve iş yardımcılarını tarayıcıda kullandıran yerel bir uygulamadır
([kaynak kodu](https://github.com/mustafaergan/atolye)). Eklenti, kullanıcının izin verdiği sekmelerde yapay zekânın
sayfayı okumasını, form alanlarını doldurmasını ve tıklamasını sağlar.

## Hangi veriler işlenir

Eklenti yalnızca kullanıcının **paylaştığı** sekmelerde (eklenti simgesinden "Bu sekmeyi paylaş" dediği ve tarayıcının
sorduğu site iznini onayladığı) ya da yapay zekânın kullanıcının isteğiyle açtığı ve izinli olan sekmelerde çalışır.
Bu sekmelerde, Atölye'den bir istek geldiğinde:

- sayfanın başlığı, adresi ve görünen metni,
- form alanlarının etiketleri, türleri ve değerleri (**parola alanlarının değeri okunmaz**; yalnızca dolu ya da boş
  olduğu bildirilir),
- düğme ve bağlantıların yazıları,
- istenirse sayfanın görünen kısmının ekran görüntüsü

okunur ve Atölye uygulamasına gönderilir.

## Veriler nereye gider

- Eklenti verileri **yalnızca bu bilgisayardaki Atölye uygulamasına** (`127.0.0.1` ya da `localhost` adresi) gönderir.
  Başka bir adrese bağlanamaz; adres ayarı yerel adreslerle sınırlıdır.
- Atölye, bu verileri kullanıcının Atölye'de seçtiği yapay zekâ hizmetine (ör. kuruluşun Claude ağ geçidi, GitHub
  Copilot ya da bilgisayardaki yerel bir model) kullanıcının sorusunu yanıtlamak için iletir. Bu iletim, kullanıcının
  seçtiği hizmetin kendi koşullarına tabidir.
- Eklentinin geliştiricisi hiçbir veriyi toplamaz, görmez ya da saklamaz. Eklentide analiz, reklam ya da izleme kodu
  yoktur. Veriler satılmaz, devredilmez ve eklentinin tek amacı dışında kullanılmaz.

## Eklentinin tarayıcıda sakladıkları

- `chrome.storage.local`: Atölye'nin yerel adresi, eşleştirme kodu, "Duraklat" ve "Bütün sekmelere izin ver" seçimleri.
- `chrome.storage.session` (tarayıcı kapanınca silinir): paylaşılan sekmelerin numaraları ve son 25 işlemin kısa
  özeti (işlem adı, saat, sonuç).

Eklenti kaldırıldığında bu veriler tarayıcı tarafından silinir.

## Kullanıcının denetimi

- Yapay zekâ yalnızca paylaşılan sekmeleri kullanır. Paylaşma eklenti simgesinden bırakılabilir.
- Verilen site izinleri eklentinin penceresinden ya da tarayıcının eklenti ayarlarından kaldırılabilir.
- "Duraklat" seçeneği açıkken hiçbir işlem yapılmaz.
- Eklenti parola ve dosya alanlarına hiçbir zaman yazmaz. Form doldurma işlemi formu göndermez; her işlem eklentinin
  "Son işlemler" listesinde görünür.
- Atölye'de bağlantı kapatıldığında ya da eşleştirme kodu yenilendiğinde eklentinin bağlantısı kesilir.

## İletişim

Sorular ve bildirimler için: <https://github.com/mustafaergan/atolye/issues>

---

# Atölye browser extension: privacy policy

Last updated: 23 November 2026

The Atölye extension connects Chrome (or Microsoft Edge) to the Atölye application **running on the same computer**.
Atölye is a local application for using AI coding and work assistants in the browser
([source code](https://github.com/mustafaergan/atolye)). The extension lets the AI read the page, fill form fields and
click in the tabs the user allows.

## What data is processed

The extension works only in tabs the user has **shared** (by clicking "Share this tab" in the extension and approving
the browser's site permission prompt), or in permitted tabs the AI opened at the user's request. In these tabs, when
Atölye asks for it, the extension reads:

- the page title, address and visible text,
- labels, types and values of form fields (**the value of password fields is never read**; only whether the field is
  empty is reported),
- the text of buttons and links,
- on request, a screenshot of the visible part of the page,

and sends it to the Atölye application.

## Where the data goes

- The extension sends data **only to the Atölye application on this computer** (`127.0.0.1` or `localhost`). It cannot
  connect to any other address; the address setting is restricted to local addresses.
- Atölye forwards this data to the AI service the user selected in Atölye (e.g. the organization's Claude gateway,
  GitHub Copilot or a local model) to answer the user's request. That transfer is governed by the selected service's
  own terms.
- The developer of the extension does not collect, see or store any data. The extension contains no analytics,
  advertising or tracking code. Data is not sold, transferred or used for any purpose other than the extension's single
  purpose.

## What the extension stores in the browser

- `chrome.storage.local`: the local Atölye address, the pairing code, and the "Pause" and "Allow all tabs" choices.
- `chrome.storage.session` (cleared when the browser closes): ids of shared tabs and a short summary of the last 25
  actions (action name, time, result).

The browser deletes this data when the extension is removed.

## User control

- The AI uses only shared tabs. Sharing can be stopped from the extension.
- Granted site permissions can be removed in the extension window or in the browser's extension settings.
- While "Pause" is on, no action is performed.
- The extension never types into password or file fields. Filling a form does not submit it; every action is shown in
  the extension's "Recent actions" list.
- Turning the connection off in Atölye or renewing the pairing code disconnects the extension.

## Contact

Questions and reports: <https://github.com/mustafaergan/atolye/issues>
