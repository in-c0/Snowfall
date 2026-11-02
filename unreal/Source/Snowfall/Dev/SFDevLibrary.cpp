#include "Dev/SFDevLibrary.h"
#include "Materials/Material.h"
#include "Materials/MaterialInterface.h"
#include "MaterialShared.h"
#include "RHIShaderPlatform.h"
#include "RHI.h"

TArray<FString> USFDevLibrary::GetMaterialErrors(UMaterialInterface* Material)
{
	TArray<FString> Out;
	if (!Material) return Out;
	UMaterial* M = Material->GetMaterial();
	if (!M) return Out;
	{
		if (FMaterialResource* R = M->GetMaterialResource(GMaxRHIShaderPlatform))
		{
			R->FinishCompilation();
			for (const FString& E : R->GetCompileErrors()) Out.AddUnique(E);
		}
	}
	return Out;
}
