#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "SFSnowfall.generated.h"

class UInstancedStaticMeshComponent; class UMaterialInstanceDynamic;

/**
 * Falling snow around the camera: thousands of tiny instanced flakes whose positions are wrapped inside a box that
 * follows the camera (material M_Snowflake does the wrap + wind + turbulence in WPO). Lit by the scene, blurred by
 * real depth of field and motion blur.
 */
UCLASS()
class SNOWFALL_API ASFSnowfall : public AActor
{
	GENERATED_BODY()
public:
	ASFSnowfall();
	virtual void BeginPlay() override;
	virtual void Tick(float Dt) override;
	UPROPERTY(EditAnywhere, Category = "Snow") int32 Count = 60000;
	UPROPERTY(EditAnywhere, Category = "Snow") FVector Box = FVector(1800, 1800, 1200);
	UPROPERTY(EditAnywhere, Category = "Snow") FVector Wind = FVector(80, 240, -160);   // cm/s (UE axes)
	UPROPERTY(EditAnywhere, Category = "Snow") float FlakeSize = 1.0f;
	UPROPERTY(EditAnywhere, Category = "Snow") float Turbulence = 40.f;
	UPROPERTY(EditAnywhere, Category = "Snow") float Brightness = 1.4f;
	/** Wind-driven mist sheets: big soft cards drifting through the trees (depth-faded, never closer than ~2.5 m). */
	UPROPERTY(EditAnywhere, Category = "Snow") int32 MistCount = 56;
	UPROPERTY(EditAnywhere, Category = "Snow") FVector MistBox = FVector(7000, 7000, 1600);
	UPROPERTY(EditAnywhere, Category = "Snow") float MistOpacity = 0.3f;
	UPROPERTY(EditAnywhere, Category = "Snow") FLinearColor MistColor = FLinearColor(0.52f, 0.545f, 0.575f);   // ~ blizzard fog colour at Brightness 1.4
	float TimeScale = 1.f;
	float Density = 1.f;
	UPROPERTY(VisibleAnywhere) UInstancedStaticMeshComponent* Flakes;
	UPROPERTY(VisibleAnywhere) UInstancedStaticMeshComponent* Mist;
private:
	UPROPERTY() UMaterialInstanceDynamic* MID;
	UPROPERTY() UMaterialInstanceDynamic* MistMID;
	FVector Offset = FVector::ZeroVector; float LocalTime = 0.f;
};
