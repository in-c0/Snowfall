#pragma once
#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "SFDevLibrary.generated.h"

class UMaterialInterface;

/** Small helpers for the editor-Python content build. */
UCLASS()
class SNOWFALL_API USFDevLibrary : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()
public:
	/** Translation/compile errors of a material for the current shader platform (empty if it compiled). */
	UFUNCTION(BlueprintCallable, Category = "Snowfall|Dev")
	static TArray<FString> GetMaterialErrors(UMaterialInterface* Material);
};
