#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "SFFigure.generated.h"

class USkeletalMeshComponent; class UPoseableMeshComponent; class UPointLightComponent; class UMaterialInstanceDynamic; class UAnimSequence;

/**
 * A person in the story. "Him" and the Shadow are dark silhouettes (Xbot, animated). "Her" is always a figure made of
 * light (Michelle mesh with M_LightFigure: fresnel rim + drifting sparks, dissolvable), posed rather than animated.
 */
UCLASS()
class SNOWFALL_API ASFFigure : public AActor
{
	GENERATED_BODY()
public:
	ASFFigure();
	virtual void Tick(float Dt) override;

	/** Sets up the mesh. Who: "him", "shadow", "kid", "her". */
	void Init(const FString& Who, float HeightCm = 180.f, FLinearColor Tint = FLinearColor(0.012f, 0.013f, 0.016f));
	void Play(const FString& Anim, float Rate = 1.f, bool bLoop = true);
	/** Bone offsets in degrees (X,Y,Z euler on top of the base pose), e.g. {"LeftUpLeg", (-88,0,4)}. */
	void Pose(const TMap<FString, FVector>& Offsets, const FString& BaseAnim = TEXT(""));
	void SetDissolve(float D);
	void SetGlow(float G);
	FString Who;
	float HipHeight = 95.f;
	const FString& GetAnim() const { return CurAnim; }

	UPROPERTY(VisibleAnywhere) USceneComponent* Root;
	UPROPERTY(VisibleAnywhere) USkeletalMeshComponent* Body;
	UPROPERTY(VisibleAnywhere) UPoseableMeshComponent* Posed;
	UPROPERTY(VisibleAnywhere) UPointLightComponent* Glow;
private:
	UPROPERTY() UMaterialInstanceDynamic* MID;
	TMap<FString, FVector> PoseOffsets;
	bool bPosed = false; FString CurAnim; float Dissolve = 0.f, GlowAmt = 1.f;
	UAnimSequence* FindAnim(const FString& Name) const;
	FString CharName;
	void ApplyPose();
};
