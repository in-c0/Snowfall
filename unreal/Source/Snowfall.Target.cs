using UnrealBuildTool;
public class SnowfallTarget : TargetRules
{
	public SnowfallTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("Snowfall");
	}
}
