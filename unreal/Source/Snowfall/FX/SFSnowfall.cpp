#include "FX/SFSnowfall.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "Engine/StaticMesh.h"
#include "Kismet/GameplayStatics.h"
#include "Camera/PlayerCameraManager.h"

ASFSnowfall::ASFSnowfall()
{
	PrimaryActorTick.bCanEverTick = true;
	Flakes = CreateDefaultSubobject<UInstancedStaticMeshComponent>(TEXT("Flakes"));
	RootComponent = Flakes;
	Flakes->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Flakes->SetCastShadow(false);
	Flakes->bAffectDistanceFieldLighting = false;
	Flakes->SetGenerateOverlapEvents(false);
}

void ASFSnowfall::BeginPlay()
{
	Super::BeginPlay();
	UStaticMesh* Mesh = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/FX/SM_Flake.SM_Flake"));
	UMaterialInterface* Mat = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/FX/M_Snowflake.M_Snowflake"));
	if (!Mesh || !Mat) { SetActorTickEnabled(false); return; }
	Flakes->SetStaticMesh(Mesh);
	MID = UMaterialInstanceDynamic::Create(Mat, this);
	Flakes->SetMaterial(0, MID);
	Flakes->SetBoundsScale(200.f);
	FRandomStream R(1234);
	TArray<FTransform> T; T.Reserve(Count);
	for (int32 i = 0; i < Count; ++i)
	{
		const FVector P(R.FRand() * Box.X, R.FRand() * Box.Y, R.FRand() * Box.Z);
		const float S = FlakeSize * (0.45f + R.FRand() * 0.9f);
		T.Add(FTransform(FRotator(R.FRand() * 360, R.FRand() * 360, R.FRand() * 360), P, FVector(S)));
	}
	Flakes->AddInstances(T, false, false);
	MID->SetVectorParameterValue(TEXT("Box"), FLinearColor(Box.X, Box.Y, Box.Z, 0));
}

void ASFSnowfall::Tick(float Dt)
{
	Super::Tick(Dt);
	if (!MID) return;
	const float Ts = TimeScale;
	LocalTime += Dt * Ts;
	const float Gust = 0.7f + 0.3f * FMath::Sin(LocalTime * 0.31f) + 0.25f * FMath::Sin(LocalTime * 0.87f + 1.3f);
	Offset += FVector(Wind.X * Gust, Wind.Y * Gust, Wind.Z) * Dt * Ts;
	FVector Cam = FVector::ZeroVector;
	if (APlayerCameraManager* PCM = UGameplayStatics::GetPlayerCameraManager(this, 0)) Cam = PCM->GetCameraLocation();
	SetActorLocation(Cam - Box * 0.5f);
	MID->SetVectorParameterValue(TEXT("Offset"), FLinearColor(Offset.X, Offset.Y, Offset.Z, 0));
	MID->SetVectorParameterValue(TEXT("CamPos"), FLinearColor(Cam.X, Cam.Y, Cam.Z, 0));
	MID->SetVectorParameterValue(TEXT("Vel"), FLinearColor(Wind.X * Gust, Wind.Y * Gust, Wind.Z, 0));
	MID->SetScalarParameterValue(TEXT("LocalTime"), LocalTime);
	MID->SetScalarParameterValue(TEXT("Turb"), Turbulence);
	MID->SetScalarParameterValue(TEXT("Bright"), Brightness);
	MID->SetScalarParameterValue(TEXT("Density"), Density);
	MID->SetScalarParameterValue(TEXT("TimeScale"), Ts);
}
