#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "SFInstanceSet.generated.h"

class UHierarchicalInstancedStaticMeshComponent; class UStaticMesh; class UMaterialInterface;

/**
 * A set of placements of one mesh, loaded from the three.js export (float32 column-major matrices + custom floats).
 * Conversion: UE_world = C · M_three · G⁻¹, where C maps three world (m, Y-up, RH) to UE (cm, Z-up, LH):
 * (x,y,z) → (−z, x, y)·100, and G is the axis mapping the glTF importer applied to mesh vertices (measured by
 * calibration in the content build, passed in as three basis vectors).
 */
UCLASS()
class SNOWFALL_API ASFInstanceSet : public AActor
{
	GENERATED_BODY()
public:
	ASFInstanceSet();
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Snowfall") UHierarchicalInstancedStaticMeshComponent* Instances;

	/** Returns number of instances added. GX/GY/GZ: images of three local +X,+Y,+Z in UE mesh-local units (cm). */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Snowfall")
	int32 LoadFromFile(const FString& BinPath, int32 CustomFloats, UStaticMesh* Mesh, UMaterialInterface* Material, FVector GX, FVector GY, FVector GZ);

	/** Single placement from a three.js world matrix (16 floats, column-major). */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Snowfall")
	void SetSingle(const TArray<float>& Matrix16, UStaticMesh* Mesh, UMaterialInterface* Material, FVector GX, FVector GY, FVector GZ);

	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Snowfall")
	void Configure(bool bCastShadow, bool bCollide, float CullDistance, bool bNaniteFallbackOk);

	static FTransform ThreeToUE(const float* M, const FVector& GX, const FVector& GY, const FVector& GZ);
};
