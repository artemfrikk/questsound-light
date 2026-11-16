// QuestSound Light for Windows as one file. The program (Electron, ~100 MB) is packed inside this .exe as a
// zip. On the first start of a version it is unpacked once into %LOCALAPPDATA%\QuestSound Light\app-<version>
// with a small progress window; every later start just runs it from there, at once.
// Built by build/pack-win.ps1 with the C# compiler that comes with Windows (.NET Framework 4.x).
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

static class Launcher {
  const string Exe = "QuestSound Light.exe";

  [STAThread]
  static int Main(string[] args) {
    try {
      var asm = Assembly.GetExecutingAssembly();
      string version;
      using (var r = new StreamReader(asm.GetManifestResourceStream("version.txt"))) version = r.ReadToEnd().Trim();
      var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "QuestSound Light");
      var dir = Path.Combine(root, "app-" + version);
      if (!File.Exists(Path.Combine(dir, ".ready"))) {
        if (!Unpack(asm, dir)) return 1;
        Cleanup(root, dir);
      }
      var psi = new ProcessStartInfo(Path.Combine(dir, Exe)) { UseShellExecute = false, WorkingDirectory = dir, Arguments = Join(args) };
      psi.EnvironmentVariables["QSL_LAUNCHER"] = Application.ExecutablePath; // so "start with the computer" points at this file
      Process.Start(psi);
      return 0;
    } catch (Exception e) {
      MessageBox.Show("Не удалось запустить QuestSound Light:\n" + e.Message, "QuestSound Light", MessageBoxButtons.OK, MessageBoxIcon.Error);
      return 1;
    }
  }

  // the first start of this version: unpack with a progress window
  static bool Unpack(Assembly asm, string dir) {
    var form = new Form {
      Text = "QuestSound Light", FormBorderStyle = FormBorderStyle.FixedSingle, MaximizeBox = false, MinimizeBox = false,
      StartPosition = FormStartPosition.CenterScreen, ClientSize = new Size(420, 130), BackColor = Color.FromArgb(16, 20, 27), ForeColor = Color.FromArgb(232, 236, 241),
      Font = new Font("Segoe UI", 10f), Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath),
    };
    var title = new Label { Text = "Готовлю QuestSound Light к первому запуску…", AutoSize = false, Location = new Point(20, 18), Size = new Size(380, 24), Font = new Font("Segoe UI Semibold", 11f) };
    var note = new Label { Text = "Это нужно один раз, дальше программа будет открываться сразу.", AutoSize = false, Location = new Point(20, 46), Size = new Size(380, 22), ForeColor = Color.FromArgb(139, 148, 163) };
    var bar = new ProgressBar { Location = new Point(20, 84), Size = new Size(380, 14), Minimum = 0, Maximum = 1000, Style = ProgressBarStyle.Continuous };
    form.Controls.AddRange(new Control[] { title, note, bar });
    Exception error = null;
    var tmp = dir + ".part";
    var worker = new Thread(() => {
      try {
        if (Directory.Exists(tmp)) Directory.Delete(tmp, true);
        using (var zip = new ZipArchive(asm.GetManifestResourceStream("app.zip"), ZipArchiveMode.Read)) {
          long total = 0, done = 0;
          foreach (var en in zip.Entries) total += en.Length;
          foreach (var en in zip.Entries) {
            var path = Path.GetFullPath(Path.Combine(tmp, en.FullName));
            if (!path.StartsWith(Path.GetFullPath(tmp) + Path.DirectorySeparatorChar)) continue; // no entry may leave the folder
            if (en.FullName.EndsWith("/")) { Directory.CreateDirectory(path); continue; }
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            en.ExtractToFile(path, true);
            done += en.Length;
            var p = (int)(total > 0 ? done * 1000 / total : 1000);
            form.BeginInvoke((Action)(() => bar.Value = Math.Min(1000, p)));
          }
        }
        File.WriteAllText(Path.Combine(tmp, ".ready"), "ok");
        if (Directory.Exists(dir)) Directory.Delete(dir, true);
        Directory.Move(tmp, dir);
      } catch (Exception e) { error = e; }
      form.BeginInvoke((Action)(() => form.Close()));
    }) { IsBackground = true };
    form.Shown += (s, e) => worker.Start();
    Application.EnableVisualStyles();
    Application.Run(form);
    worker.Join();
    if (error != null) {
      MessageBox.Show("Не удалось распаковать QuestSound Light:\n" + error.Message + "\n\nПроверьте, что на диске есть 300 МБ свободного места.", "QuestSound Light", MessageBoxButtons.OK, MessageBoxIcon.Error);
      return false;
    }
    return true;
  }

  // older versions are removed; one still running stays until next time
  static void Cleanup(string root, string keep) {
    foreach (var d in Directory.GetDirectories(root, "app-*")) {
      if (string.Equals(d, keep, StringComparison.OrdinalIgnoreCase)) continue;
      try { Directory.Delete(d, true); } catch { }
    }
  }

  static string Join(string[] args) {
    var parts = new string[args.Length];
    for (int i = 0; i < args.Length; i++) parts[i] = "\"" + args[i].Replace("\"", "\\\"") + "\"";
    return string.Join(" ", parts);
  }
}
