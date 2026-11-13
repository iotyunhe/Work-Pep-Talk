using System.Text.Json.Serialization;

namespace WorkPepTalk.Models;

/// <summary>
/// config.json 的强类型映射。字段名与设计书第 9 页的契约一一对应。
/// 序列化时统一转 camelCase，保证 JS 端读到的和写回的形状一致。
/// </summary>
public sealed class AppConfig
{
    public int Version { get; set; } = 1;
    public SetupConfig Setup { get; set; } = new();
    public PayConfig Pay { get; set; } = new();
    public ScheduleConfig Schedule { get; set; } = new();
    public LookConfig Look { get; set; } = new();
    public WindowConfig Window { get; set; } = new();
    public BehaviourConfig Behaviour { get; set; } = new();

    public static AppConfig Default() => new();
}

/// <summary>
/// 首次引导的状态。Pay 里的 8000/22/8 只是占位值，Done 为 false 时
/// 界面显示「未设置」而不是把这些占位数当成用户收入展示出来。
/// </summary>
public sealed class SetupConfig
{
    public bool Done { get; set; }
}

public sealed class PayConfig
{
    /// <summary>monthly | daily | hourly</summary>
    public string Mode { get; set; } = "monthly";
    public double Value { get; set; } = 8000;
    /// <summary>可自行填写，不锁死 21.75</summary>
    public double DaysPerMonth { get; set; } = 22;
    public double HoursPerDay { get; set; } = 8;
}

public sealed class ScheduleConfig
{
    public string Start { get; set; } = "09:00";
    public string End { get; set; } = "18:00";
    public string LunchStart { get; set; } = "12:00";
    public string LunchEnd { get; set; } = "13:00";
    public bool ExcludeLunch { get; set; } = true;
}

public sealed class LookConfig
{
    /// <summary>A 纸质 | B 仪表 | C 像素</summary>
    public string Theme { get; set; } = "A";
    /// <summary>九色预设 id，或 "photo" 表示用自定义图</summary>
    public string Background { get; set; } = "white";
    /// <summary>自定义背景图，data URL。空表示没设</summary>
    public string? BgImage { get; set; }
    /// <summary>builtin | custom</summary>
    public string Avatar { get; set; } = "builtin";
    public List<AvatarFile> AvatarFiles { get; set; } = new();
}

public sealed class AvatarFile
{
    public string Mood { get; set; } = "";
    public string Src { get; set; } = "";
}

public sealed class WindowConfig
{
    public int? X { get; set; }
    public int? Y { get; set; }
    public string? Screen { get; set; }
    public bool Collapsed { get; set; }
}

public sealed class BehaviourConfig
{
    public bool AlwaysOnTop { get; set; } = true;
    public bool ClickThrough { get; set; }
    public bool AutoStart { get; set; } = true;
}

[JsonSourceGenerationOptions(WriteIndented = true, PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(AppConfig))]
internal partial class ConfigJsonContext : JsonSerializerContext;
