// Atölye masaüstü penceresi: Atölye'yi tarayıcı sekmesi yerine kendi penceresinde açar.
// Windows'un kendi WebView2 bileşenini (Microsoft Edge altyapısı) kullanır; ayrı bir tarayıcı ya da çalışma ortamı
// taşımaz, bu yüzden küçüktür. Kendi simgesi ve kimliği olduğu için görev çubuğuna sabitlenebilir; sabitlenen simge
// Atölye sunucusu çalışmıyorsa önce onu başlatır.
//
// Kurulum sırasında bu bilgisayarda derlenir (atolye.ps1 masaustu-ac): .NET Framework'ün csc.exe derleyicisi C# 5
// desteklediği için kod bilerek eski sözdizimiyle yazılmıştır.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

static class Program
{
    [DllImport("shell32.dll")]
    static extern int SetCurrentProcessExplicitAppUserModelID([MarshalAs(UnmanagedType.LPWStr)] string id);
    [DllImport("user32.dll")]
    static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")]
    static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")]
    static extern bool IsIconic(IntPtr h);

    [STAThread]
    static void Main()
    {
        // Görev çubuğu pencereyi ve sabitlenen kısayolu bu kimlikle eşleştirir
        SetCurrentProcessExplicitAppUserModelID("Atolye.Masaustu");
        bool first;
        using (Mutex m = new Mutex(true, "Atolye.Masaustu.TekPencere", out first))
        {
            if (!first) { BringExisting(); return; }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm());
            GC.KeepAlive(m);
        }
    }

    // İkinci kez açılırsa yeni pencere yerine açık olan öne getirilir
    static void BringExisting()
    {
        Process me = Process.GetCurrentProcess();
        foreach (Process p in Process.GetProcessesByName(me.ProcessName))
        {
            if (p.Id == me.Id || p.MainWindowHandle == IntPtr.Zero) continue;
            if (IsIconic(p.MainWindowHandle)) ShowWindow(p.MainWindowHandle, 9);
            SetForegroundWindow(p.MainWindowHandle);
            return;
        }
    }
}

class MainForm : Form
{
    readonly string root;     // Atölye kurulum klasörü (bu dosya <kurulum>\masaustu-app içinde durur)
    readonly string url;
    readonly string dataDir;  // pencere konumu ve WebView2 verisi (kurulum klasörünün dışında: güncelleme kilitlenmesin)
    readonly Label status;
    readonly Button retry;
    WebView2 web;
    int failures;

    public MainForm()
    {
        string exeDir = Path.GetDirectoryName(Application.ExecutablePath);
        root = Environment.GetEnvironmentVariable("ATOLYE_KOK");
        if (string.IsNullOrEmpty(root)) root = Path.GetDirectoryName(exeDir);
        url = "http://127.0.0.1:" + ReadPort();
        dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Atolye-masaustu");

        Text = "Atölye";
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
        BackColor = Color.FromArgb(250, 249, 245);
        MinimumSize = new Size(640, 480);
        StartPosition = FormStartPosition.Manual;
        LoadBounds();

        status = new Label();
        status.Dock = DockStyle.Fill;
        status.TextAlign = ContentAlignment.MiddleCenter;
        status.Font = new Font("Segoe UI", 12f);
        status.ForeColor = Color.FromArgb(90, 85, 75);
        status.Text = "Atölye başlatılıyor…";
        Controls.Add(status);

        retry = new Button();
        retry.Text = "Yeniden dene";
        retry.AutoSize = true;
        retry.Visible = false;
        retry.Click += delegate { Start(); };
        Controls.Add(retry);
        retry.BringToFront();

        Shown += delegate { Start(); };
        FormClosing += delegate { SaveBounds(); };
        Resize += delegate { retry.Location = new Point((ClientSize.Width - retry.Width) / 2, ClientSize.Height / 2 + 40); };
    }

    int ReadPort()
    {
        try
        {
            foreach (string line in File.ReadAllLines(Path.Combine(root, ".env")))
            {
                Match m = Regex.Match(line, @"^\s*ATOLYE_PORT\s*=\s*(\d+)\s*$");
                if (m.Success) return int.Parse(m.Groups[1].Value);
            }
        }
        catch { }
        return 3210;
    }

    bool Ping()
    {
        try
        {
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url + "/api/config");
            req.Proxy = null; // yerel adres şirket proxy'sine gönderilmez
            req.Timeout = 1500;
            using (HttpWebResponse res = (HttpWebResponse)req.GetResponse()) return res.StatusCode == HttpStatusCode.OK;
        }
        catch { return false; }
    }

    // Sunucu çalışmıyorsa kurulumun kendi başlatma komutuyla (port denetimi dahil) başlatılır
    bool EnsureServer()
    {
        if (Ping()) return true;
        try
        {
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe");
            psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + Path.Combine(root, "atolye.ps1") + "\" baslat -TarayiciAcma";
            psi.WorkingDirectory = root;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.EnvironmentVariables["ATOLYE_SORMA"] = "1";
            Process.Start(psi);
        }
        catch { return false; }
        for (int i = 0; i < 90; i++)
        {
            Thread.Sleep(500);
            if (Ping()) return true;
        }
        return false;
    }

    async void Start()
    {
        retry.Visible = false;
        status.Text = "Atölye başlatılıyor…";
        bool up = await Task.Run(new Func<bool>(EnsureServer));
        if (IsDisposed) return;
        if (!up)
        {
            status.Text = "Atölye başlatılamadı.\nAyrıntı için kayıt dosyasına bakın:\n" + Path.Combine(root, "atolye.log");
            retry.Visible = true;
            return;
        }
        if (web != null) { web.CoreWebView2.Navigate(url); return; }
        try
        {
            Directory.CreateDirectory(dataDir);
            web = new WebView2();
            web.Dock = DockStyle.Fill;
            web.DefaultBackgroundColor = BackColor;
            Controls.Add(web);
            CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(dataDir, "WebView2"), null);
            await web.EnsureCoreWebView2Async(env);
            web.CoreWebView2.Settings.IsStatusBarEnabled = false;
            web.CoreWebView2.NewWindowRequested += OnNewWindow;
            web.CoreWebView2.PermissionRequested += OnPermission;
            web.CoreWebView2.NavigationCompleted += OnNavigated;
            web.CoreWebView2.Navigate(url);
            web.BringToFront();
        }
        catch (Exception ex)
        {
            // WebView2 bu bilgisayarda yoksa (eski Windows) Atölye tarayıcıda açılır
            try { Process.Start(url); } catch { }
            MessageBox.Show(this, "Atölye kendi penceresinde açılamadı; tarayıcıda açıldı.\n\nSebep: " + ex.Message +
                "\n\nMicrosoft Edge WebView2 bu bilgisayarda kurulu olmayabilir.", "Atölye", MessageBoxButtons.OK, MessageBoxIcon.Information);
            Close();
        }
    }

    // Yeni sekmede açılan bağlantılar (kayıtlar sayfası, dış adresler) varsayılan tarayıcıya gider
    void OnNewWindow(object sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        e.Handled = true;
        if (e.Uri != null && (e.Uri.StartsWith("http://") || e.Uri.StartsWith("https://")))
        {
            try { Process.Start(e.Uri); } catch { }
        }
    }

    void OnPermission(object sender, CoreWebView2PermissionRequestedEventArgs e)
    {
        if (e.PermissionKind == CoreWebView2PermissionKind.ClipboardRead && e.Uri != null && e.Uri.StartsWith(url))
            e.State = CoreWebView2PermissionState.Allow;
    }

    // Sayfa açılamadıysa (sunucu güncelleme için yeniden başlıyor olabilir) birkaç kez yeniden denenir
    async void OnNavigated(object sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        if (e.IsSuccess) { failures = 0; return; }
        if (e.WebErrorStatus == CoreWebView2WebErrorStatus.OperationCanceled) return;
        if (++failures > 5) return;
        await Task.Delay(2000);
        if (IsDisposed) return;
        bool up = await Task.Run(new Func<bool>(EnsureServer));
        if (up && !IsDisposed) web.CoreWebView2.Navigate(url);
    }

    string BoundsFile { get { return Path.Combine(dataDir, "pencere.txt"); } }

    void LoadBounds()
    {
        Rectangle area = Screen.PrimaryScreen.WorkingArea;
        Size = new Size(Math.Min(1360, area.Width * 85 / 100), Math.Min(900, area.Height * 88 / 100));
        Location = new Point(area.Left + (area.Width - Width) / 2, area.Top + (area.Height - Height) / 2);
        try
        {
            string[] p = File.ReadAllText(BoundsFile).Trim().Split(',');
            Rectangle r = new Rectangle(int.Parse(p[0]), int.Parse(p[1]), int.Parse(p[2]), int.Parse(p[3]));
            bool visible = false;
            foreach (Screen s in Screen.AllScreens) if (s.WorkingArea.IntersectsWith(r)) visible = true;
            if (visible && r.Width >= 640 && r.Height >= 480) Bounds = r;
            if (p.Length > 4 && p[4] == "1") WindowState = FormWindowState.Maximized;
        }
        catch { }
    }

    void SaveBounds()
    {
        try
        {
            Directory.CreateDirectory(dataDir);
            Rectangle r = WindowState == FormWindowState.Normal ? Bounds : NormalBounds();
            File.WriteAllText(BoundsFile, r.X + "," + r.Y + "," + r.Width + "," + r.Height + "," + (WindowState == FormWindowState.Maximized ? "1" : "0"));
        }
        catch { }
    }

    Rectangle NormalBounds() { return base.RestoreBounds; }
}
