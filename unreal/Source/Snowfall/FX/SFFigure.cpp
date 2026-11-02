#include "FX/SFFigure.h"
#include "Snowfall.h"
#include "Components/SkeletalMeshComponent.h"
#include "Components/PoseableMeshComponent.h"
#include "Components/PointLightComponent.h"
#include "Engine/SkeletalMesh.h"
#include "Animation/AnimSequence.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"

ASFFigure::ASFFigure()
{
	PrimaryActorTick.bCanEverTick = true;
	Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root")); RootComponent = Root;
	Body = CreateDefaultSubobject<USkeletalMeshComponent>(TEXT("Body")); Body->SetupAttachment(Root);
	Body->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Posed = CreateDefaultSubobject<UPoseableMeshComponent>(TEXT("Posed")); Posed->SetupAttachment(Root);
	Posed->SetCollisionEnabled(ECollisionEnabled::NoCollision); Posed->SetVisibility(false);
	Glow = CreateDefaultSubobject<UPointLightComponent>(TEXT("Glow")); Glow->SetupAttachment(Root);
	Glow->SetRelativeLocation(FVector(15, 0, 100)); Glow->SetIntensity(0.f); Glow->SetAttenuationRadius(350.f);
	Glow->SetCastShadows(false); Glow->SetLightColor(FLinearColor(1.f, 0.85f, 0.68f));
	Glow->bUseInverseSquaredFalloff = true;
}

UAnimSequence* ASFFigure::FindAnim(const FString& Name) const
{
	const FString Path = FString::Printf(TEXT("/Game/Characters/%s/A_%s_%s.A_%s_%s"), *CharName, *CharName, *Name, *CharName, *Name);
	UAnimSequence* A = LoadObject<UAnimSequence>(nullptr, *Path);
	if (!A) UE_LOG(LogSnowfall, Warning, TEXT("anim missing %s"), *Path);
	return A;
}

void ASFFigure::Init(const FString& InWho, float HeightCm, FLinearColor Tint)
{
	Who = InWho;
	const bool bHer = Who == TEXT("her");
	CharName = bHer ? TEXT("Michelle") : TEXT("Xbot");
	const FString MeshPath = FString::Printf(TEXT("/Game/Characters/%s/SK_%s.SK_%s"), *CharName, *CharName, *CharName);
	USkeletalMesh* Mesh = LoadObject<USkeletalMesh>(nullptr, *MeshPath);
	if (!Mesh) { UE_LOG(LogSnowfall, Error, TEXT("missing %s"), *MeshPath); return; }
	Body->SetSkeletalMesh(Mesh);
	Posed->SetSkinnedAssetAndUpdate(Mesh);
	const FBoxSphereBounds B = Mesh->GetBounds();
	const float H = B.BoxExtent.Z * 2.f;
	const float S = H > 1.f ? HeightCm / H : 1.f;
	const float Bulk = bHer ? 1.f : 1.12f;
	Body->SetRelativeScale3D(FVector(S * Bulk, S * Bulk, S));
	Posed->SetRelativeScale3D(FVector(S * Bulk, S * Bulk, S));
	const float Bottom = (B.Origin.Z - B.BoxExtent.Z) * S;
	Body->SetRelativeLocation(FVector(0, 0, -Bottom)); Posed->SetRelativeLocation(FVector(0, 0, -Bottom));
	HipHeight = HeightCm * 0.53f;
	UMaterialInterface* Base = LoadObject<UMaterialInterface>(nullptr, bHer ? TEXT("/Game/Materials/M_LightFigure.M_LightFigure") : TEXT("/Game/Materials/M_Silhouette.M_Silhouette"));
	if (Base)
	{
		MID = UMaterialInstanceDynamic::Create(Base, this);
		MID->SetVectorParameterValue(TEXT("Color"), bHer ? FLinearColor(1.f, 0.86f, 0.68f) : Tint);
		for (int32 i = 0; i < Mesh->GetMaterials().Num(); ++i) { Body->SetMaterial(i, MID); Posed->SetMaterial(i, MID); }
	}
	Body->SetCastShadow(!bHer); Posed->SetCastShadow(!bHer);
	if (bHer) { Glow->SetIntensity(6.f); }
}

void ASFFigure::Play(const FString& Anim, float Rate, bool bLoop)
{
	bPosed = false; Posed->SetVisibility(false); Body->SetVisibility(true);
	if (Anim != CurAnim)
	{
		if (UAnimSequence* A = FindAnim(Anim)) { Body->PlayAnimation(A, bLoop); CurAnim = Anim; }
	}
	Body->SetPlayRate(Rate);
}

void ASFFigure::Pose(const TMap<FString, FVector>& Offsets, const FString& BaseAnim)
{
	PoseOffsets = Offsets;
	if (!BaseAnim.IsEmpty()) { if (UAnimSequence* A = FindAnim(BaseAnim)) { Body->PlayAnimation(A, false); Body->SetPosition(0.f, false); Body->SetPlayRate(0.f); } }
	else Body->Stop();
	Body->TickAnimation(0.f, false); Body->RefreshBoneTransforms();
	bPosed = true;
	Body->SetVisibility(false); Posed->SetVisibility(true);
	ApplyPose();
}

void ASFFigure::ApplyPose()
{
	Posed->CopyPoseFromSkeletalComponent(Body);
	for (const auto& P : PoseOffsets)
	{
		const FName Bone(*(TEXT("mixamorig") + P.Key));
		if (Posed->GetBoneIndex(Bone) == INDEX_NONE) continue;
		// offsets are authored in the bone's local frame: rotate around the bone's own axes
		const FTransform BT = Posed->GetBoneTransformByName(Bone, EBoneSpaces::ComponentSpace);
		const FQuat Off = FQuat(FRotator(P.Value.Y, P.Value.Z, P.Value.X));
		Posed->SetBoneRotationByName(Bone, (BT.GetRotation() * Off).Rotator(), EBoneSpaces::ComponentSpace);
	}
}

void ASFFigure::SetDissolve(float D) { Dissolve = D; if (MID) MID->SetScalarParameterValue(TEXT("Dissolve"), D); Glow->SetIntensity(Who == TEXT("her") ? 6.f * (1.f - D) * GlowAmt : 0.f); }
void ASFFigure::SetGlow(float G) { GlowAmt = G; if (MID) MID->SetScalarParameterValue(TEXT("Opacity"), G); SetDissolve(Dissolve); }

void ASFFigure::Tick(float Dt)
{
	Super::Tick(Dt);
	if (MID) MID->SetScalarParameterValue(TEXT("Breath"), FMath::Sin(GetWorld()->GetTimeSeconds() * 1.3f));
}
