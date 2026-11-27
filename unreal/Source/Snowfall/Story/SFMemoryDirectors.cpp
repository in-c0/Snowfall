#include "Story/SFLevelDirectors.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Core/SFCharacter.h"
#include "Core/SFGameInstance.h"
#include "Core/SFInteractComponent.h"
#include "Core/SFAudio.h"
#include "FX/SFFigure.h"
#include "UI/SFOverlay.h"
#include "Snowfall.h"
#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMeshActor.h"
#include "Engine/StaticMesh.h"
#include "GameFramework/PlayerController.h"
#include "Kismet/GameplayStatics.h"
#include "Engine/World.h"

static FActorSpawnParameters AnySP() { FActorSpawnParameters P; P.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn; return P; }
static TMap<FString, FVector> SitPose()
{
	TMap<FString, FVector> S;
	S.Add(TEXT("LeftUpLeg"), FVector(-88, 0, 4)); S.Add(TEXT("RightUpLeg"), FVector(-88, 0, -4)); S.Add(TEXT("LeftLeg"), FVector(92, 0, 0)); S.Add(TEXT("RightLeg"), FVector(92, 0, 0));
	S.Add(TEXT("Spine"), FVector(4, 0, 0)); S.Add(TEXT("LeftArm"), FVector(58, 0, -28)); S.Add(TEXT("RightArm"), FVector(58, 0, 28));
	S.Add(TEXT("LeftForeArm"), FVector(0, 0, -55)); S.Add(TEXT("RightForeArm"), FVector(0, 0, 55)); S.Add(TEXT("Head"), FVector(8, 0, 0));
	return S;
}
static FVector Ground(UWorld* W, FVector P)
{
	FHitResult H;
	if (W->LineTraceSingleByChannel(H, P + FVector(0, 0, 400), P - FVector(0, 0, 800), ECC_Visibility)) P.Z = H.ImpactPoint.Z;
	return P;
}
// sample a polyline at arc length S (cm); returns position and tangent
static void Along(const TArray<FVector>& Path, float S, FVector& OutP, FVector& OutT)
{
	OutP = Path.Num() ? Path[0] : FVector::ZeroVector; OutT = FVector::ForwardVector;
	for (int32 i = 0; i + 1 < Path.Num(); ++i)
	{
		const float L = FVector::Dist(Path[i], Path[i + 1]);
		if (S <= L || i + 2 == Path.Num()) { const float K = FMath::Clamp(S / FMath::Max(L, 1.f), 0.f, 1.f); OutP = FMath::Lerp(Path[i], Path[i + 1], K); OutT = (Path[i + 1] - Path[i]).GetSafeNormal(); return; }
		S -= L;
	}
}

// ======================================================================= park: the first meeting
void ASFParkDirector::Script()
{
	ASFCharacter* P = Me();
	for (int32 i = 0; i < 64; ++i) { if (AActor* A = Tagged(FName(*FString::Printf(TEXT("Path%d"), i)))) Path.Add(A->GetActorLocation()); else break; }
	if (Path.Num() < 2) { Path = { P->GetActorLocation() + P->GetActorForwardVector() * 150.f, P->GetActorLocation() + P->GetActorForwardVector() * 6000.f }; }
	Chair = Tagged(TEXT("Chair"));
	if (!Chair)
		if (UStaticMesh* M = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/Models/wheelchair_01/wheelchair_01.wheelchair_01")))
		{ AStaticMeshActor* A = GetWorld()->SpawnActor<AStaticMeshActor>(AStaticMeshActor::StaticClass(), FTransform::Identity, AnySP()); A->SetMobility(EComponentMobility::Movable); A->GetStaticMeshComponent()->SetStaticMesh(M); Chair = A; }
	if (Chair) Chair->GetRootComponent()->SetMobility(EComponentMobility::Movable);
	Her = GetWorld()->SpawnActor<ASFFigure>(ASFFigure::StaticClass(), FTransform::Identity, AnySP());
	Her->Init(TEXT("her"), 166.f); Her->Pose(SitPose());
	P->bCanMove = false; P->Surface = TEXT("leaves");
	FSFAudio::Music(this, TEXT("her")); FSFAudio::Amb(this, TEXT("birds"), 0.15f);
	// opening: the reference composition (low, front-left of the chair under the maples), then behind her
	ACameraActor* Open = Cast<ACameraActor>(Tagged(TEXT("OpeningCam")));
	APlayerController* PC = UGameplayStatics::GetPlayerController(this, 0);
	if (Open && PC) PC->SetViewTargetWithBlend(Open, 0.f);
	FadeTo(0.f, 2.5f, FLinearColor::White)
	.Say(TEXT("park.narr_1"))
	.Do([this, PC]() { if (PC) PC->SetViewTargetWithBlend(Me(), 2.5f, VTBlend_EaseInOut, 2.f); })
	.Say(TEXT("park.narr_2"))
	.Do([this]() { bPushing = true; Every([this, T = 0.f](float Dt) mutable { T += Dt; if (T > 3.f && S < 50.f) { Hint(TEXT("p.push")); return false; } return S < 50.f; }); })
	.Until([this]() { return S > 400.f; }).Say(TEXT("park.her_1")).Say(TEXT("park.him_1")).Say(TEXT("park.her_2")).Say(TEXT("park.narr_3"))
	.Do([this]() { MaxV = 0.35f; }).Say(TEXT("park.her_3")).Do([this]() { MaxV = 0.85f; })
	.Say(TEXT("park.narr_4"))
	.Do([this]() { MaxV = 1.5f; }).Say(TEXT("park.her_4")).Wait(2.f).Do([this]() { MaxV = 0.85f; })
	.Say(TEXT("park.narr_5")).Say(TEXT("park.narr_6"))
	.Tween(2.5f, [this](float K) { SetExposure(K * 3.f); })
	.Do([this]() { GI()->SetFlag(TEXT("m_park")); Go(TEXT("L_Library"), TEXT("book"), 1.f, FLinearColor::White); });
}

void ASFParkDirector::Tick(float Dt)
{
	Super::Tick(Dt);
	ASFCharacter* P = Me();
	if (!P || Path.Num() < 2) return;
	const float Want = bPushing && P->MoveInput_Forward() > 0.1f ? MaxV * 100.f : 0.f;
	Speed = FMath::FInterpTo(Speed, Want, Dt, 1.6f);
	S += Speed * Dt;
	FVector CP, CT; Along(Path, S + 110.f, CP, CT);
	CP = Ground(GetWorld(), CP);
	if (Chair) { Chair->SetActorLocation(CP); Chair->SetActorRotation(FRotator(0, CT.Rotation().Yaw + 90.f, 0)); }
	if (Her) { Her->SetActorLocation(CP + FVector(0, 0, 52.f - Her->HipHeight) - CT * 8.f); Her->SetActorRotation(FRotator(0, CT.Rotation().Yaw - 90.f, 0)); }
	if (bPushing)
	{
		FVector PP, PT; Along(Path, S, PP, PT);
		P->SetActorLocation(Ground(GetWorld(), PP) + FVector(0, 0, 92.f), false);
		P->CurrentSpeed = Speed;
		P->bYawLimit = true; P->YawCenter = PT.Rotation().Yaw; P->YawRange = 60.f;
	}
}

// ======================================================================= snowfield: she races, you chase
void ASFFieldDirector::Script()
{
	ASFCharacter* P = Me();
	Center = Marker(TEXT("FieldCenter"), P->GetActorLocation() + P->GetActorForwardVector() * 1500.f);
	if (UStaticMesh* M = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/Models/wheelchair_01/wheelchair_01.wheelchair_01")))
	{ AStaticMeshActor* A = GetWorld()->SpawnActor<AStaticMeshActor>(AStaticMeshActor::StaticClass(), FTransform::Identity, AnySP()); A->SetMobility(EComponentMobility::Movable); A->GetStaticMeshComponent()->SetStaticMesh(M); Chair = A; }
	Her = GetWorld()->SpawnActor<ASFFigure>(ASFFigure::StaticClass(), FTransform::Identity, AnySP());
	Her->Init(TEXT("her"), 166.f); Her->Pose(SitPose());
	P->Surface = TEXT("snow");
	FSFAudio::Music(this, TEXT("her")); FSFAudio::Amb(this, TEXT("wind_soft"), 0.25f);
	FadeTo(0.f, 2.5f, FLinearColor::White)
	.Say(TEXT("field.narr_1"))
	.Do([this]() { FSFAudio::Sfx(this, TEXT("SFX/SFX_Chime"), 0.6f); }).Say(TEXT("field.her_1"))
	.Do([this]() { bChase = true; Spd = 2.6f; })
	.Say(TEXT("field.narr_2")).Say(TEXT("field.her_2"))
	.Do([this]() { Hint(TEXT("p.catch")); })
	.Wait(6.f).Say(TEXT("field.narr_3"))
	.Until([this]() { return bCaught; })
	.Say(TEXT("field.her_3")).Say(TEXT("field.him_1")).Say(TEXT("field.narr_4"))
	.Tween(2.2f, [this](float K) { SetExposure(K * 3.f); })
	.Do([this]() { GI()->SetFlag(TEXT("m_field")); Go(TEXT("L_Library"), TEXT("globe"), 1.f, FLinearColor::White); });
}

void ASFFieldDirector::Tick(float Dt)
{
	Super::Tick(Dt);
	ASFCharacter* P = Me();
	if (!P || !Her) return;
	const float R = 1200.f;
	if (bChase && !bCaught)
	{
		ChaseT += Dt;
		FVector Pos = Center + FVector(FMath::Cos(Ph) * R, FMath::Sin(Ph * 1.4f) * R * 0.6f, 0);
		const float D = FVector::Dist2D(Pos, P->GetActorLocation()) / 100.f;
		const float Tired = FMath::Clamp((ChaseT - 18.f) / 22.f, 0.f, 1.f);
		float Want = D > 7.f ? 0.4f : (D < 3.f && ChaseT < 22.f ? 3.4f : 2.4f);
		Want *= 1.f - Tired * 0.75f;
		Spd = FMath::FInterpTo(Spd, Want, Dt, 2.f);
		Ph += Spd * 100.f * Dt / R;
		if (ChaseT > 22.f && D < 1.8f) { bCaught = true; FSFAudio::Sfx(this, TEXT("SFX/SFX_Chime"), 0.7f); }
	}
	const FVector Pos = Ground(GetWorld(), Center + FVector(FMath::Cos(Ph) * R, FMath::Sin(Ph * 1.4f) * R * 0.6f, 0));
	const FVector Nx = Center + FVector(FMath::Cos(Ph + 0.02f) * R, FMath::Sin((Ph + 0.02f) * 1.4f) * R * 0.6f, 0);
	FRotator Face = (Nx - Pos).Rotation(); Face.Pitch = 0;
	if (bCaught) Face = (P->GetActorLocation() - Pos).Rotation(), Face.Pitch = 0;
	if (Chair) { Chair->SetActorLocation(Pos); Chair->SetActorRotation(FRotator(0, Face.Yaw + 90.f, 0)); }
	Her->SetActorLocation(Pos + FVector(0, 0, 52.f - Her->HipHeight)); Her->SetActorRotation(FRotator(0, Face.Yaw - 90.f, 0));
}

// ======================================================================= the road: the same night, again
void ASFRoadDirector::Script()
{
	ASFCharacter* P = Me();
	const bool bVisit2 = GI()->PendingSpawn == TEXT("visit2") || GI()->Flag(TEXT("reunion"));
	Start = Marker(TEXT("RoadStart"), P->GetActorLocation());
	End = Marker(TEXT("RoadEnd"), Start + P->GetActorForwardVector() * 7000.f);
	Him = GetWorld()->SpawnActor<ASFFigure>(ASFFigure::StaticClass(), FTransform(Start), AnySP());
	Him->Init(TEXT("him"), 180.f, FLinearColor(0.008f, 0.01f, 0.014f)); Him->Play(TEXT("idle"));
	P->bCanMove = false; P->bCanLook = false; P->SetActorHiddenInGame(true);
	Cam = GetWorld()->SpawnActor<ACameraActor>(ACameraActor::StaticClass(), FTransform::Identity, AnySP());
	Cam->GetCameraComponent()->SetFieldOfView(55.f);
	if (APlayerController* PC = UGameplayStatics::GetPlayerController(this, 0)) PC->SetViewTargetWithBlend(Cam, 0.f);
	FSFAudio::Music(this, TEXT("loop")); FSFAudio::Amb(this, TEXT("wind_soft"), 0.2f);
	// the cold glow that always hangs ~40 m further down the road (unfogged card, follows him)
	if (UStaticMesh* Plane = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Plane.Plane")))
		if (UMaterialInterface* GM = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/Materials/M_SF_GlowCard.M_SF_GlowCard")))
		{
			AStaticMeshActor* G = GetWorld()->SpawnActor<AStaticMeshActor>(AStaticMeshActor::StaticClass(), FTransform::Identity, AnySP());
			G->SetMobility(EComponentMobility::Movable);
			G->GetStaticMeshComponent()->SetStaticMesh(Plane);
			G->GetStaticMeshComponent()->SetCollisionEnabled(ECollisionEnabled::NoCollision);
			G->GetStaticMeshComponent()->SetCastShadow(false);
			UMaterialInstanceDynamic* MID = UMaterialInstanceDynamic::Create(GM, G);
			MID->SetVectorParameterValue(TEXT("Color"), FLinearColor(0.0137f, 0.262f, 0.434f));
			MID->SetScalarParameterValue(TEXT("Intensity"), 0.6f);
			G->GetStaticMeshComponent()->SetMaterial(0, MID);
			G->SetActorScale3D(FVector(64.f, 40.f, 1.f));
			FarGlow = G;
		}
	FadeTo(0.f, 2.f);
	if (!bVisit2)
	{
		Say(TEXT("road.narr_1")).Say(TEXT("road.him_1"))
		.Until([this]() { return Pass >= 2; }).Say(TEXT("road.narr_2"))
		.Until([this]() { return Pass >= 3; }).Say(TEXT("road.narr_3")).Say(TEXT("road.him_2"))
		.Choose({ TEXT("road.c_keep"), TEXT("road.c_leave") }, [this](int32 C)
		{
			if (C == 0) Until([this]() { return Pass >= 4; }).Choose({ TEXT("road.c_leave") }, [this](int32) { bLeaving = true; });
			else bLeaving = true;
		})
		.Until([this]() { return bLeaving; })
		.Do([this]() { FSFAudio::Sfx(this, TEXT("SFX/SFX_TapeStop")); FSFAudio::StopMusic(this, 0.3f); GI()->SetFlag(TEXT("road1")); Go(TEXT("L_Library"), TEXT("window"), 1.4f); });
	}
	else
	{
		Say(TEXT("road.narr_again")).Until([this]() { return Pass >= 2; }).Say(TEXT("road.him_stop"))
		.Choose({ TEXT("road.c_leave") }, [this](int32) { bLeaving = true; })
		.Do([this]() { FSFAudio::StopMusic(this, 5.f); Go(TEXT("L_Bench"), TEXT(""), 5.f, FLinearColor(0.91f, 0.92f, 0.93f)); });
	}
}

void ASFRoadDirector::Tick(float Dt)
{
	Super::Tick(Dt);
	ASFCharacter* P = Me();
	if (!P || !Him || !Cam) return;
	const FVector Dir = (End - Start).GetSafeNormal2D();
	const FVector Right = FVector::CrossProduct(FVector::UpVector, Dir);
	const float Len = FVector::Dist2D(Start, End);
	const float In = bLeaving ? 0.f : P->MoveInput_Forward();
	const float V = FMath::Max(In, 0.f) * 140.f;
	Along += V * Dt;
	Side = FMath::Clamp(Side + P->MoveInput_Right() * 120.f * Dt, -250.f, 250.f);
	if (Along > Len) { Along -= Len; Pass++; }   // seamless: identical road, identical fog
	const FVector Pos = Ground(GetWorld(), Start + Dir * Along + Right * Side);
	Him->SetActorLocation(Pos); Him->SetActorRotation(FRotator(0, Dir.Rotation().Yaw - 90.f, 0));
	if (V > 20.f) Him->Play(TEXT("walk"), V / 140.f); else Him->Play(TEXT("idle"));
	const FVector CamPos = Pos - Dir * 720.f + FVector(0, 0, 260.f);
	Cam->SetActorLocation(FMath::VInterpTo(Cam->GetActorLocation().IsNearlyZero() ? CamPos : Cam->GetActorLocation(), CamPos, Dt, 3.f));
	if (Along < 5.f && V > 0.f) Cam->SetActorLocation(CamPos);
	Cam->SetActorRotation((Pos + Dir * 1500.f + FVector(0, 0, 60) - Cam->GetActorLocation()).Rotation());
	SetFocus(720.f, 2.8f);
	if (FarGlow)
	{
		const FVector GP = Pos + Dir * 4000.f + FVector(0, 0, 350.f);
		FarGlow->SetActorLocation(GP);
		// BasicShapes/Plane faces +Z: tip it up so it faces back along the road toward the camera
		FarGlow->SetActorRotation(FRotationMatrix::MakeFromZX(-Dir, FVector::UpVector).Rotator());
	}
	if (V > 20.f && FMath::Fmod(Along, 85.f) < V * Dt) FSFAudio::Step(this, TEXT("stone"), 0.35f);
}

// ======================================================================= red rooms
void ASFRedDirector::Script()
{
	ASFCharacter* P = Me();
	const FString Sp = GI()->PendingSpawn;
	Frag = Sp == TEXT("frag3") ? 3 : Sp == TEXT("frag2") ? 2 : 1;
	P->Surface = TEXT("wood"); P->WalkSpeed = 150.f;
	const AActor* Bed = Tagged(TEXT("HerBed"));
	Her = GetWorld()->SpawnActor<ASFFigure>(ASFFigure::StaticClass(), Bed ? Bed->GetActorTransform() : FTransform::Identity, AnySP());
	Her->Init(TEXT("her"), 166.f);
	TMap<FString, FVector> Lie; Lie.Add(TEXT("LeftArm"), FVector(72, 0, -8)); Lie.Add(TEXT("RightArm"), FVector(60, 0, 30)); Lie.Add(TEXT("RightForeArm"), FVector(0, 0, 60)); Lie.Add(TEXT("Head"), FVector(-4, 18, 0));
	Her->Pose(Lie);
	for (AActor* A : AllTagged(TEXT("Frag3Only"))) A->SetActorHiddenInGame(Frag != 3);
	if (Frag < 3) { FSFAudio::Music(this, TEXT("red")); FSFAudio::Amb(this, TEXT("drone"), 0.35f); }
	else { FSFAudio::Music(this, TEXT("waltz")); FSFAudio::Amb(this, TEXT("fire"), 0.4f); }
	FadeTo(0.f, 2.f);
	auto Cut = [this]()
	{
		Do([this]() { FSFAudio::Sfx(this, TEXT("SFX/SFX_TapeStop")); FSFAudio::StopMusic(this, 0.2f); FSFAudio::StopAllAmb(this, 0.5f); if (SSFOverlay* O = UI()) { O->FadeColor = FLinearColor::Black; O->Fade = 1.f; } })
		.Wait(1.4f)
		.Do([this]() { GI()->SetFlag(FName(*FString::Printf(TEXT("r%d"), Frag))); GI()->Travel(this, TEXT("L_Library"), FString::Printf(TEXT("door%d"), Frag)); });
	};
	const FVector BedPos = Marker(TEXT("HerBed"));
	if (Frag == 1)
	{
		Say(TEXT("red.narr_1")).Say(TEXT("red.narr_2"))
		.Until([this, BedPos]() { return FVector::Dist2D(Me()->GetActorLocation(), BedPos) < 220.f; })
		.Say(TEXT("red.her_1")).Say(TEXT("red.him_1")).Say(TEXT("red.her_2")).Say(TEXT("red.him_2")).Say(TEXT("red.her_3")).Say(TEXT("red.narr_3")).Say(TEXT("red.her_4"))
		.Choose({ TEXT("red.c_no"), TEXT("red.c_silent") }, [this](int32) {})
		.Say(TEXT("red.him_3")).Say(TEXT("red.her_5"));
		Cut();
	}
	else if (Frag == 2)
	{
		TSharedPtr<bool> Tried = MakeShared<bool>(false);
		Say(TEXT("red2.narr_1")).Say(TEXT("red2.narr_2")).Say(TEXT("red2.narr_3")).Say(TEXT("red2.narr_4")).Say(TEXT("red2.narr_5"))
		.Do([this, Tried]() { FSFAudio::Amb(this, TEXT("heart"), 0.5f, 2.f); USFInteractComponent* C = AddInteract(Tagged(TEXT("HerBed")), TEXT("p.capsule"), 3.f, [Tried]() { *Tried = true; }, 300.f, 60.f); C->SetRelativeLocation(FVector(0, 0, 70)); })
		.Until([this, Tried]() { Me()->Shake = FMath::Min(Me()->HoldT / 3.f, 1.f) * 0.15f; return *Tried || Me()->HoldT > 2.1f; })
		.Do([this]() { Me()->Shake = 0.f; Me()->bBlockInteract = true; FSFAudio::Sfx(this, TEXT("SFX/SFX_Glass_Shatter")); })
		.Say(TEXT("red2.him_1")).Do([this]() { FSFAudio::Amb(this, TEXT("heart"), 0.f, 3.f); })
		.Say(TEXT("red2.narr_6")).Say(TEXT("red2.narr_7"));
		Cut();
	}
	else
	{
		TSharedPtr<bool> Took = MakeShared<bool>(false), Gave = MakeShared<bool>(false);
		Say(TEXT("red3.narr_1")).Say(TEXT("red3.narr_2")).Say(TEXT("red3.him_1")).Say(TEXT("red3.her_1")).Say(TEXT("red3.narr_3")).Say(TEXT("red3.her_2"))
		.Do([this, Took]() { AddInteract(Tagged(TEXT("I_cherries")), TEXT("p.take_cherry"), 0.f, [Took]() { *Took = true; }, 220.f, 25.f); })
		.Until([Took]() { return *Took; })
		.Do([this, Gave]() { AddInteract(Tagged(TEXT("I_bedGive")), TEXT("p.give_cherry"), 0.f, [Gave]() { *Gave = true; }, 240.f, 40.f); })
		.Until([Gave]() { return *Gave; })
		.Do([this]() { Me()->bCanMove = false; })
		.FadeTo(1.f, 2.f, FLinearColor(0.06f, 0.02f, 0.01f)).Wait(4.f)
		.Do([this]() { if (AActor* V = Tagged(TEXT("PillowView"))) { Me()->PlaceEyeAt(V->GetActorLocation()); Me()->SetLookRotation(V->GetActorRotation().Yaw, V->GetActorRotation().Pitch); } for (AActor* A : AllTagged(TEXT("BottleFull"))) A->SetActorHiddenInGame(true); for (AActor* A : AllTagged(TEXT("BottleEmpty"))) A->SetActorHiddenInGame(false); })
		.FadeTo(0.f, 2.5f, FLinearColor(0.06f, 0.02f, 0.01f))
		.Say(TEXT("red3.her_3")).Say(TEXT("red3.him_2")).Say(TEXT("red3.her_4")).Say(TEXT("red3.narr_4"))
		.Say(TEXT("red3.narr_5")).Say(TEXT("red3.narr_6")).Say(TEXT("red3.her_5")).Say(TEXT("red3.him_3")).Say(TEXT("red3.her_6"))
		.Do([this]() { FSFAudio::Amb(this, TEXT("heart"), 0.4f, 3.f); })
		.Say(TEXT("red3.him_4")).Say(TEXT("red3.her_7")).Say(TEXT("red3.him_5"))
		.Do([this]() { Every([this, T = 0.f](float Dt) mutable { T += Dt; if (Her) Her->SetGlow(FMath::Max(0.25f, 1.f - T / 10.f)); return T < 10.f; }); })
		.Say(TEXT("red3.her_8"));
		Cut();
	}
}

void ASFRedDirector::Tick(float Dt) { Super::Tick(Dt); }

bool ASFFieldDirector::AutoTarget(FVector& Out) const
{
	if (!Her) return false;
	Out = Her->GetActorLocation();
	return true;
}
