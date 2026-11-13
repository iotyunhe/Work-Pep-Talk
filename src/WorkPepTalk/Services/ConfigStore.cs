using System.IO;
using System.Text.Json;
using WorkPepTalk.Models;

namespace WorkPepTalk.Services;

/// <summary>
/// 配置读写。绿色版语义：config.json 永远在 exe 同级目录，
/// 不写注册表、不写 AppData —— 整个文件夹拷到 U 盘也能带着设置走。
/// </summary>
public sealed class ConfigStore
{
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true
    };

    private readonly string _path;
    private readonly object _gate = new();

    public AppConfig Current { get; private set; }

    public string Path_ => _path;

    public ConfigStore()
    {
        _path = ResolvePath();
        Current = Load();
    }

    /// <summary>
    /// exe 同级优先。若目录不可写（比如装在 Program Files），
    /// 回落到 %APPDATA%\WorkPepTalk —— 宁可换个位置，也不能启动就崩。
    /// </summary>
    private static string ResolvePath()
    {
        var beside = System.IO.Path.Combine(AppPaths.BaseDir, "config.json");
        try
        {
            var dir = System.IO.Path.GetDirectoryName(beside)!;
            var probe = System.IO.Path.Combine(dir, ".write-test");
            File.WriteAllText(probe, "1");
            File.Delete(probe);
            return beside;
        }
        catch
        {
            var fallback = System.IO.Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "WorkPepTalk");
            Directory.CreateDirectory(fallback);
            return System.IO.Path.Combine(fallback, "config.json");
        }
    }

    private AppConfig Load()
    {
        try
        {
            if (!File.Exists(_path)) return AppConfig.Default();

            var json = File.ReadAllText(_path);
            if (string.IsNullOrWhiteSpace(json)) return AppConfig.Default();

            var cfg = JsonSerializer.Deserialize<AppConfig>(json, Options);
            return cfg ?? AppConfig.Default();
        }
        catch (Exception ex)
        {
            // 配置文件坏了不能让应用起不来。备份原件，用默认配置继续跑。
            TryBackupBroken(ex);
            return AppConfig.Default();
        }
    }

    private void TryBackupBroken(Exception ex)
    {
        try
        {
            var bad = System.IO.Path.Combine(
                System.IO.Path.GetDirectoryName(_path)!,
                "config.bad-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".json");
            File.Copy(_path, bad, overwrite: true);
            File.Delete(_path);
            Log.Warn($"config.json 解析失败，已备份到 {bad}：{ex.Message}");
        }
        catch
        {
            // 备份也失败就算了，不阻断启动
        }
    }

    /// <summary>整份覆盖保存。文件很小，直接同步写，不走异步队列。</summary>
    public void Save(AppConfig cfg)
    {
        lock (_gate)
        {
            Current = cfg;
            try
            {
                var json = JsonSerializer.Serialize(cfg, Options);
                var tmp = _path + ".tmp";
                File.WriteAllText(tmp, json);

                // 原子替换：写一半断电也不会留下半个 JSON
                if (File.Exists(_path))
                {
                    File.Replace(tmp, _path, null, ignoreMetadataErrors: true);
                }
                else
                {
                    File.Move(tmp, _path);
                }
            }
            catch (Exception ex)
            {
                Log.Warn("保存配置失败：" + ex.Message);
            }
        }
    }

    /// <summary>只改窗口相关字段，其余保持不动。用于拖动和收起。</summary>
    public void SaveWindow(int? x, int? y, string? screen, bool collapsed)
    {
        var cfg = Current;
        cfg.Window.X = x;
        cfg.Window.Y = y;
        cfg.Window.Screen = screen;
        cfg.Window.Collapsed = collapsed;
        Save(cfg);
    }
}
