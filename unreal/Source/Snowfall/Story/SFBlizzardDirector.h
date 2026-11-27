#pragma once
#include "CoreMinimal.h"
#include "Story/SFDirector.h"
#include "SFBlizzardDirector.generated.h"

class ASFSnowfall; class ASFFigure; class USpotLightComponent; class ASpotLight; class UMaterialInstanceDynamic; class ACineCameraActor;

UCLASS()
class SNOWFALL_API ASFBlizzardDirector : public ASFDirector
{
	GENERATED_BODY()
public:
	bool bEnding = false;
	virtual void Tick(float Dt) override;
	virtual bool AutoTarget(FVector& Out) const override;
protected:
	virtual void Script() override;
	void Intro();
	void Ending();
	void SetStorm(float K);
	void LookBack();
	void SitDown();

	UPROPERTY() ASFSnowfall* Snow = nullptr;
	UPROPERTY() ASFFigure* Shadow = nullptr;
	UPROPERTY() ASFFigure* Body = nullptr;     // the player's own body: invisible, casts a shadow
	UPROPERTY() ASpotLight* Back = nullptr;
	UPROPERTY() UMaterialInstanceDynamic* Warp = nullptr;
	UPROPERTY() ASFFigure* Him = nullptr;
	UPROPERTY() TArray<ASFFigure*> Kids;
	UPROPERTY() ACineCameraActor* Cine = nullptr;
	UPROPERTY() AActor* Glass = nullptr;
	UPROPERTY() UMaterialInstanceDynamic* Stain = nullptr;
	float ShadowSpeed = 0.f, Storm = 0.f, Dark = 0.f, BackOn = 0.f;
	float FogBase = 0.f; FLinearColor FogColorBase;
	float SunBase = 0.f, SkyBase = 0.f;
	float YawCenter = 0.f;
	bool bLookedBack = false, bBegun = false, bSaidCant = false;
	int32 Bells = 0; float BellT = 0.f;
	float M0 = 0.f, T0 = 0.f;
	TArray<FVector> KidCenter; TArray<float> KidPh, KidR, KidSp;
};
