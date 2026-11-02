using UnrealBuildTool;
public class Snowfall : ModuleRules
{
	public Snowfall(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicIncludePaths.Add(ModuleDirectory);
		PublicDependencyModuleNames.AddRange(new string[] { "RHI",
			"Core", "CoreUObject", "Engine", "InputCore", "EnhancedInput",
			"Slate", "SlateCore", "Json", "JsonUtilities", "RenderCore", "CinematicCamera", "UMG"
		});
		if (Target.bBuildEditor) { PrivateDependencyModuleNames.Add("UnrealEd"); }
	}
}
