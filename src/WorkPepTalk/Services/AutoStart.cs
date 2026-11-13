using Microsoft.Win32;

namespace WorkPepTalk.Services;

/// <summary>
/// 开机自启。只写 HKCU，不需要管理员权限，也不会污染系统级配置。
/// 值名固定为 WorkPepTalk，路径指向当前 exe —— 换个目录运行会自动更新。
/// </summary>
public static class AutoStart
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "WorkPepTalk";

    public static bool IsEnabled()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKey, writable: false);
            var v = key?.GetValue(ValueName) as string;
            return !string.IsNullOrEmpty(v);
        }
        catch
        {
            return false;
        }
    }

    public static void Set(bool enable)
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKey, writable: true)
                            ?? Registry.CurrentUser.CreateSubKey(RunKey);
            if (key is null) return;

            if (enable)
            {
                var exe = Environment.ProcessPath ?? "";
                if (string.IsNullOrEmpty(exe)) return;
                // 加引号，路径里有空格也不会被截断
                key.SetValue(ValueName, $"\"{exe}\"");
                Log.Info("已开启开机自启：" + exe);
            }
            else
            {
                key.DeleteValue(ValueName, throwOnMissingValue: false);
                Log.Info("已关闭开机自启");
            }
        }
        catch (Exception ex)
        {
            Log.Warn("设置开机自启失败：" + ex.Message);
        }
    }

    /// <summary>启动时校一次：配置说开但注册表里没有（比如换机器），就补上。</summary>
    public static void Sync(bool wanted)
    {
        if (wanted && !IsEnabled()) Set(true);
        else if (!wanted && IsEnabled()) Set(false);
    }
}
