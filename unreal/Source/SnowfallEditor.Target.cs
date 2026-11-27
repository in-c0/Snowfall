using UnrealBuildTool;
public class SnowfallEditorTarget : TargetRules
{
	public SnowfallEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("Snowfall");
	}
}
