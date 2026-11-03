#include "Story/SFBlizzardDirector.h"
#include "Core/SFCharacter.h"
#include "Core/SFGameInstance.h"
#include "Core/SFAudio.h"
#include "FX/SFSnowfall.h"
#include "FX/SFFigure.h"
#include "UI/SFOverlay.h"
#include "Snowfall.h"
#include "Engine/SpotLight.h"
#include "Components/SpotLightComponent.h"
#include "Components/DirectionalLightComponent.h"
#include "Components/SkyLightComponent.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Components/DecalComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/DirectionalLight.h"
#include "Engine/SkyLight.h"
#include "Engine/ExponentialHeightFog.h"
#include "Engine/PostProcessVolume.h"
#include "Engine/StaticMeshActor.h"
#include "Engine/DecalActor.h"
#include "Engine/StaticMesh.h"
#include "CineCameraActor.h"
#include "CineCameraComponent.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "GameFramework/PlayerController.h"
#include "Kismet/GameplayStatics.h"
#include "Engine/World.h"
#include "EngineUtils.h"

template <class T> static T* FirstOf(UWorld* W) { for (TActorIterator<T> It(W); It; ++It) return *It; return nullptr; }

void ASFBlizzardDirector::Script()
{
	ASFCharacter* P = Me();
	USFGameInstance* G = GI();
	FActorSpawnParameters SP; SP.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	// weather
	Snow = GetWorld()->SpawnActor<ASFSnowfall>(ASFSnowfall::StaticClass(), FTransform::Identity, SP);
	if (bEnding) { Snow->Wind = FVector(20, 60, -80); Snow->Turbulence = 25.f; Snow->Count = 14000; }
	if (AExponentialHeightFog* F = Fog()) { FogBase = F->GetComponent()->FogDensity; FogColorBase = F->GetComponent()->FogInscatteringLuminance; }
	if (ADirectionalLight* D = FirstOf<ADirectionalLight>(GetWorld())) SunBase = D->GetLightComponent()->Intensity;
	if (ASkyLight* S = FirstOf<ASkyLight>(GetWorld())) SkyBase = S->GetLightComponent()->Intensity;
	// the player's invisible body (casts a shadow when light comes from behind)
	Body = GetWorld()->SpawnActor<ASFFigure>(ASFFigure::StaticClass(), FTransform::Identity, SP);
	Body->Init(TEXT("him"));
	Body->Body->SetHiddenInGame(true); Body->Body->bCastHiddenShadow = true;
	// light from behind
	Back = GetWorld()->SpawnActor<ASpotLight>(ASpotLight::StaticClass(), FTransform::Identity, SP);
	Back->SpotLightComponent->SetIntensity(0.f); Back->SpotLightComponent->SetLightColor(FLinearColor(1.f, 0.88f, 0.72f));
	Back->SpotLightComponent->SetOuterConeAngle(32.f); Back->SpotLightComponent->SetInnerConeAngle(12.f);
	Back->SpotLightComponent->SetAttenuationRadius(9000.f); Back->SpotLightComponent->SetCastShadows(true);
	Back->SpotLightComponent->SetMobility(EComponentMobility::Movable);
	// post-process warp material
	if (APostProcessVolume* V = Look())
		if (UMaterialInterface* M = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/Materials/PP/M_PP_Warp.M_PP_Warp")))
		{ Warp = UMaterialInstanceDynamic::Create(M, this); V->Settings.WeightedBlendables.Array.Add(FWeightedBlendable(1.f, Warp)); Warp->SetScalarParameterValue(TEXT("Warp"), 0.f); }
	YawCenter = P->GetYaw();
	P->Surface = TEXT("snow"); P->WalkSpeed = 175.f; P->RunSpeed = 320.f;
	FSFAudio::Amb(this, TEXT("wind"), bEnding ? 0.3f : 0.55f, 3.f);
	if (bEnding) { Ending(); return; }
	Shadow = GetWorld()->SpawnActor<ASFFigure>(ASFFigure::StaticClass(), FTransform(FRotator(0, YawCenter, 0), Marker(TEXT("ShadowStart"), P->GetActorLocation() + P->GetActorForwardVector() * 1600.f)), SP);
	Shadow->Init(TEXT("shadow"), 182.f, FLinearColor(0.02f, 0.021f, 0.025f));
	Shadow->Play(TEXT("idle"));
	if (!G->bStarted)
	{
		P->bCanMove = false; P->bCanLook = false;
		if (SSFOverlay* O = UI()) { O->SetCrosshair(false); O->Fade = 1.f; O->FadeColor = FLinearColor::Black; }
		FadeTo(0.f, 3.f).Do([this]()
		{
			if (SSFOverlay* O = UI())
			{
				APlayerController* PC = UGameplayStatics::GetPlayerController(this, 0);
				if (PC) { PC->bShowMouseCursor = true; PC->SetInputMode(FInputModeGameAndUI()); }
				TWeakObjectPtr<ASFBlizzardDirector> Self(this);
				O->ShowTitle(true, [Self]() { if (Self.IsValid()) { Self->GI()->bStarted = true; if (SSFOverlay* O2 = Self->UI()) { O2->ShowTitle(false); O2->SetCrosshair(true); } Self->Intro(); } });
			}
		});
	}
	else { FadeTo(0.f, 2.f); Intro(); }
}

void ASFBlizzardDirector::Intro()
{
	if (bBegun) return; bBegun = true;
	ASFCharacter* P = Me();
	P->bCanMove = true; P->bCanLook = true;
	if (APlayerController* PC = UGameplayStatics::GetPlayerController(this, 0)) { PC->bShowMouseCursor = false; PC->SetInputMode(FInputModeGameOnly()); }
	P->bYawLimit = true; P->YawCenter = YawCenter; P->YawRange = 55.f;
	FSFAudio::Music(this, TEXT("blizzard"));
	Every([this](float) { if (Elapsed > 6.f && Me() && Me()->Moved < 1.f && !bLookedBack) { Hint(TEXT("p.walk")); return false; } return Me() && Me()->Moved < 1.f; });
	Until([this]() { return Me()->Moved > 7.f; })
	.Say(TEXT("s0.him_where")).Wait(0.6f).Say(TEXT("s0.shadow_dots"), 2.2f)
	.Until([this]() { return Me()->Moved > 30.f; })
	.Say(TEXT("s0.him_from")).Say(TEXT("s0.shadow_dots2"), 2.4f).Say(TEXT("s0.shadow_dont"), 2.8f).Say(TEXT("s0.shadow_hold")).Say(TEXT("s0.shadow_follow")).Say(TEXT("s0.him_dots"), 1.8f)
	.Choose({ TEXT("s0.c_follow"), TEXT("s0.c_stay"), TEXT("s0.c_else") }, [this](int32 C)
	{
		GI()->SetFlag(FName(*FString::Printf(TEXT("s0choice%d"), C)));
		if (C == 0) Say(TEXT("s0.shadow_good"), 2.f);
		if (C == 1) Do([this]() { Me()->SpeedScale = 0.f; }).Wait(2.5f).Say(TEXT("s0.shadow_freeze")).Wait(1.f).Do([this]() { Me()->SpeedScale = 1.f; });
		if (C == 2) Say(TEXT("s0.shadow_nowhere"));
	})
	.Do([this]() { M0 = Me()->Moved; T0 = Elapsed; })
	.Until([this]()
	{
		const float K = FMath::Min(FMath::Max((Me()->Moved - M0) / 38.f, (Elapsed - T0) / 45.f), 1.f);
		SetStorm(K);
		if (K > 0.75f && !bSaidCant) { bSaidCant = true; Say(TEXT("s0.him_cold")); }
		return K >= 1.f;
	})
	.Do([this]() { FSFAudio::StopMusic(this, 4.f); })
	.Tween(5.f, [this](float K)
	{
		Dark = K; BackOn = K * 0.7f;
		if (Snow) { Snow->Density = 1.f - K * 0.75f; Snow->Wind = FVector(80, 240, -160) * (1.f - K) + FVector(0, 10, -60) * K; }
		if (AExponentialHeightFog* F = Fog()) { F->GetComponent()->SetFogInscatteringColor(FogColorBase * (1.f - K * 0.98f)); F->GetComponent()->SetFogDensity(FMath::Lerp(FogBase * 3.f, FogBase * 1.2f, K)); }
		if (ASkyLight* S = FirstOf<ASkyLight>(GetWorld())) S->GetLightComponent()->SetIntensity(SkyBase * (1.f - K * 0.97f));
		FSFAudio::Amb(this, TEXT("wind"), 1.1f * (1.f - K) + 0.05f, 0.3f);
		Me()->Surface = K > 0.6f ? TEXT("stone") : TEXT("snow");
	})
	.Wait(2.5f)
	.Do([this]()
	{
		Every([this](float Dt)
		{
			if (bLookedBack) return false;
			BellT -= Dt;
			if (BellT <= 0.f)
			{
				BellT = 8.5f; Bells++;
				const FVector Behind = Me()->GetActorLocation() - FRotator(0, YawCenter, 0).Vector() * 2200.f + FVector(0, 0, 150);
				FSFAudio::SfxAt(this, TEXT("SFX/SFX_Bell"), Behind, 0.55f + Bells * 0.1f);
				if (Bells == 1) Me()->bYawLimit = false;
				if (Bells == 3) Hint(TEXT("p.lookback"));
			}
			return true;
		});
	})
	.Until([this]() { return Bells > 0 && FMath::Abs(FRotator::NormalizeAxis(Me()->GetYaw() - YawCenter)) > 140.f; })
	.Do([this]() { bLookedBack = true; LookBack(); });
}

void ASFBlizzardDirector::SetStorm(float K)
{
	Storm = K;
	if (AExponentialHeightFog* F = Fog())
	{
		F->GetComponent()->SetFogDensity(FMath::Lerp(FogBase, FogBase * 3.f, K));
		const float Dk = FMath::SmoothStep(0.55f, 1.f, K);
		F->GetComponent()->SetFogInscatteringColor(FogColorBase * (1.f - Dk * 0.9f));
	}
	if (Snow) { Snow->Wind = FVector(80 + K * 200, 240 + K * 400, -160 - K * 100); Snow->Turbulence = 40.f + K * 50.f; }
	const float Dk = FMath::SmoothStep(0.55f, 1.f, K);
	if (ADirectionalLight* D = FirstOf<ADirectionalLight>(GetWorld())) D->GetLightComponent()->SetIntensity(SunBase * (1.f - Dk));
	if (ASkyLight* S = FirstOf<ASkyLight>(GetWorld())) S->GetLightComponent()->SetIntensity(SkyBase * (1.f - Dk * 0.9f));
	if (Shadow) Shadow->SetActorHiddenInGame(K > 0.85f);
	FSFAudio::Amb(this, TEXT("wind"), 0.55f + K * 0.6f, 0.5f);
}

void ASFBlizzardDirector::LookBack()
{
	ASFCharacter* P = Me();
	P->bCanMove = false;
	if (SSFOverlay* O = UI()) O->Hint(FText(), 0.f);
	FSFAudio::Sfx(this, TEXT("SFX/SFX_Whoosh"), 0.8f);
	Tween(3.5f, [this](float K)
	{
		if (Snow) Snow->TimeScale = 1.f - K * 0.97f;
		BackOn = 0.7f + K * 0.8f;
		if (Warp) Warp->SetScalarParameterValue(TEXT("Warp"), K * 0.8f);
		SetExposure(K * 2.f);
	})
	.Do([this]()
	{
		for (int32 i = 0; i < 9; ++i) { /* glitch pulses */ }
		if (Warp) Warp->SetScalarParameterValue(TEXT("Glitch"), 0.4f);
		FSFAudio::Sfx(this, TEXT("SFX/SFX_TapeStop"), 0.9f);
		FSFAudio::StopAllAmb(this, 1.2f);
	})
	.Tween(1.6f, [this](float K) { if (Warp) { Warp->SetScalarParameterValue(TEXT("Collapse"), K); Warp->SetScalarParameterValue(TEXT("Warp"), 0.8f + K); } })
	.Do([this]() { if (SSFOverlay* O = UI()) { O->FadeColor = FLinearColor::Black; O->Fade = 1.f; } GI()->SetFlag(TEXT("s0done")); })
	.Wait(1.2f)
	.Do([this]() { GI()->Travel(this, TEXT("L_Library"), TEXT("wake")); });
}

void ASFBlizzardDirector::Tick(float Dt)
{
	Super::Tick(Dt);
	ASFCharacter* P = Me();
	if (!P) return;
	const FVector PL = P->GetActorLocation();
	const FVector Fwd = FRotator(0, YawCenter, 0).Vector();
	if (Body) { Body->SetActorLocation(PL - FVector(0, 0, 92.f)); Body->SetActorRotation(FRotator(0, P->GetYaw() - 90.f, 0)); if (P->CurrentSpeed > 30.f) Body->Play(TEXT("walk"), P->CurrentSpeed / 140.f); else Body->Play(TEXT("idle")); }
	if (Back)
	{
		Back->SetActorLocation(PL - Fwd * 900.f + FVector(0, 0, 230.f));
		Back->SetActorRotation((PL + Fwd * 1000.f - FVector(0, 0, 200.f) - Back->GetActorLocation()).Rotation());
		Back->SpotLightComponent->SetIntensity(BackOn * 600000.f);
	}
	// the Shadow walks when you walk, waits when you wait
	if (Shadow && !Shadow->IsHidden())
	{
		const FVector S = Shadow->GetActorLocation();
		const float Ahead = FVector::DotProduct(S - PL, Fwd) / 100.f;
		float Want = 0.f;
		const float Spd = P->CurrentSpeed / 100.f;
		Want = FMath::Clamp(Spd * 0.95f + (Ahead - 14.f) * -0.25f, 0.f, 2.6f);
		if (Spd < 0.2f && Ahead > 10.f) Want = FMath::Max(0.f, Want - 0.6f);
		ShadowSpeed = FMath::FInterpTo(ShadowSpeed, Want, Dt, 2.f);
		FVector N = S + Fwd * ShadowSpeed * 100.f * Dt;
		FHitResult Hit;
		if (GetWorld()->LineTraceSingleByChannel(Hit, N + FVector(0, 0, 300), N - FVector(0, 0, 600), ECC_Visibility)) N.Z = Hit.ImpactPoint.Z;
		Shadow->SetActorLocation(N);
		Shadow->SetActorRotation(FRotator(0, YawCenter - 90.f, 0));
		// hysteresis: flipping walk/idle every frame around one threshold restarted the animation each time
		if (ShadowSpeed > 0.3f || (ShadowSpeed > 0.15f && Shadow->GetAnim() == TEXT("walk"))) Shadow->Play(TEXT("walk"), FMath::Max(ShadowSpeed / 1.35f, 0.2f)); else Shadow->Play(TEXT("idle"));
	}
	// ending: children running in loops far out on the snow
	for (int32 i = 0; i < Kids.Num(); ++i)
	{
		KidPh[i] += Dt * KidSp[i];
		const FVector C = KidCenter[i];
		const FVector Pp = C + FVector(FMath::Cos(KidPh[i]) * KidR[i], FMath::Sin(KidPh[i] * 1.3f) * KidR[i] * 0.6f, 0) * 100.f;
		const FVector Np = C + FVector(FMath::Cos(KidPh[i] + 0.05f) * KidR[i], FMath::Sin((KidPh[i] + 0.05f) * 1.3f) * KidR[i] * 0.6f, 0) * 100.f;
		Kids[i]->SetActorLocation(Pp); Kids[i]->SetActorRotation(FRotator(0, (Np - Pp).Rotation().Yaw - 90.f, 0));
	}
}

// ---------------------------------------------------------------- ending
void ASFBlizzardDirector::Ending()
{
	ASFCharacter* P = Me();
	P->WalkSpeed = 160.f;
	FSFAudio::Music(this, TEXT("end"));
	FSFAudio::Amb(this, TEXT("kids"), 0.f);
	FActorSpawnParameters SP; SP.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	const FVector KC = Marker(TEXT("KidsCenter"), P->GetActorLocation() + FVector(4000, 1500, 0));
	const FLinearColor Coats[4] = { FLinearColor(0.16f, 0.04f, 0.04f), FLinearColor(0.04f, 0.06f, 0.14f), FLinearColor(0.18f, 0.14f, 0.04f), FLinearColor(0.05f, 0.09f, 0.05f) };
	for (int32 i = 0; i < 4; ++i)
	{
		ASFFigure* K = GetWorld()->SpawnActor<ASFFigure>(ASFFigure::StaticClass(), FTransform(KC), SP);
		K->Init(TEXT("kid"), 115.f, Coats[i]); K->Play(TEXT("run"), 0.9f + 0.1f * i);
		Kids.Add(K); KidCenter.Add(KC + FVector(i * 320.f, -i * 220.f, 0)); KidPh.Add(FMath::FRand() * 6.f); KidR.Add(3.f + FMath::FRand() * 4.f); KidSp.Add(0.35f + FMath::FRand() * 0.25f);
	}
	FadeTo(0.f, 2.5f).Wait(3.f).Say(TEXT("s5.narr_1"))
	.Until([this]() { return FVector::Dist2D(Me()->GetActorLocation(), Marker(TEXT("SitPoint"))) < 3000.f; })
	.Do([this]() { FSFAudio::Amb(this, TEXT("kids"), 0.9f, 6.f); })
	.Say(TEXT("s5.narr_2"))
	.Do([this]() { AddInteractAt(Marker(TEXT("SitPoint")) + FVector(0, 0, 80), TEXT("p.sit"), 0.8f, [this]() { SitDown(); }, 320.f, 80.f); });
}

void ASFBlizzardDirector::SitDown()
{
	ASFCharacter* P = Me();
	P->bCanMove = false; P->bCanLook = false; P->bBlockInteract = true;
	if (SSFOverlay* O = UI()) { O->SetCrosshair(false); O->ClearPrompt(); }
	FActorSpawnParameters SP; SP.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	const FVector Seat = Marker(TEXT("SeatPoint"), Marker(TEXT("SitPoint")));
	const FRotator SeatRot = Tagged(TEXT("SeatPoint")) ? Tagged(TEXT("SeatPoint"))->GetActorRotation() : FRotator::ZeroRotator;
	FadeTo(1.f, 0.8f).Do([this, Seat, SeatRot, SP]()
	{
		Him = GetWorld()->SpawnActor<ASFFigure>(ASFFigure::StaticClass(), FTransform(SeatRot, Seat), SP);
		Him->Init(TEXT("him"), 180.f, FLinearColor(0.02f, 0.022f, 0.026f));
		TMap<FString, FVector> Sit;
		Sit.Add(TEXT("LeftUpLeg"), FVector(-84, 0, 7)); Sit.Add(TEXT("RightUpLeg"), FVector(-84, 0, -7));
		Sit.Add(TEXT("LeftLeg"), FVector(84, 0, 0)); Sit.Add(TEXT("RightLeg"), FVector(84, 0, 0));
		Sit.Add(TEXT("Spine"), FVector(12, 0, 0)); Sit.Add(TEXT("Spine1"), FVector(6, 0, 0));
		Him->Pose(Sit, TEXT("sad_pose"));
		Him->SetActorLocation(Seat - FVector(0, 0, Him->HipHeight - 45.f));
		// a glass of wine at his feet, and the snow beneath it
		if (UStaticMesh* GM = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/Props/SM_WineGlass.SM_WineGlass")))
		{
			AStaticMeshActor* G = GetWorld()->SpawnActor<AStaticMeshActor>(AStaticMeshActor::StaticClass(), FTransform(Marker(TEXT("GlassPoint"), Seat + FVector(60, 40, -45))), SP);
			G->SetMobility(EComponentMobility::Movable); G->GetStaticMeshComponent()->SetStaticMesh(GM); Glass = G;
		}
		if (UMaterialInterface* SM = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/Materials/M_WineStain.M_WineStain")))
		{
			ADecalActor* D = GetWorld()->SpawnActor<ADecalActor>(ADecalActor::StaticClass(), FTransform(FRotator(-90, 0, 0), Marker(TEXT("GlassPoint"), Seat + FVector(60, 40, -45)) + FVector(-25, 15, 0), FVector(0.4f, 1.0f, 1.0f)), SP);
			Stain = UMaterialInstanceDynamic::Create(SM, this); D->SetDecalMaterial(Stain); D->GetDecal()->DecalSize = FVector(60, 90, 90);
			Stain->SetScalarParameterValue(TEXT("Grow"), 0.f); Stain->SetScalarParameterValue(TEXT("Cover"), 0.f);
		}
		Cine = GetWorld()->SpawnActor<ACineCameraActor>(ACineCameraActor::StaticClass(), FTransform::Identity, SP);
		Cine->GetCineCameraComponent()->CurrentFocalLength = 35.f;
		Cine->GetCineCameraComponent()->CurrentAperture = 2.0f;
		Cine->GetCineCameraComponent()->FocusSettings.FocusMethod = ECameraFocusMethod::Manual;
		if (APlayerController* PC = UGameplayStatics::GetPlayerController(this, 0)) PC->SetViewTargetWithBlend(Cine, 0.f);
	})
	.Do([this, Seat, SeatRot]()
	{
		// camera path: close and low beside the bench, then a long slow pull back
		const FVector Side = SeatRot.RotateVector(FVector(0, -1, 0)), Front = SeatRot.Vector();
		const FVector A = Seat + Front * 190.f + Side * 120.f + FVector(0, 0, 10);
		const FVector B = Seat + Front * 1200.f + Side * 900.f + FVector(0, 0, 260);
		TSharedPtr<FVector> LA = MakeShared<FVector>(A), LB = MakeShared<FVector>(B);
		Cine->SetActorLocation(A); Cine->SetActorRotation((Seat - FVector(0, 0, 30) - A).Rotation());
		if (SSFOverlay* O = UI()) O->Letterbox = 1.f;
		FadeTo(0.f, 2.5f).Wait(2.5f)
		.Tween(0.7f, [this](float K) { if (Glass) Glass->SetActorRotation(FRotator(0, 0, K * 83.f)); }, false)
		.Do([this]() { FSFAudio::Step(this, TEXT("snow"), 0.3f); })
		.Do([this]() { Every([this, T = 0.f](float Dt) mutable { T += Dt; if (Stain) Stain->SetScalarParameterValue(TEXT("Grow"), FMath::Sqrt(FMath::Min(T / 14.f, 1.f)) * 0.95f); return T < 14.f; }); })
		.Wait(3.f)
		.Do([this, LA, LB, Seat]()
		{
			Every([this, LA, LB, Seat, T = 0.f](float Dt) mutable
			{
				T += Dt; const float K = FMath::SmoothStep(0.f, 1.f, FMath::Min(T / 26.f, 1.f));
				const FVector C = FMath::Lerp(*LA, *LB, K);
				Cine->SetActorLocation(C); Cine->SetActorRotation((Seat + FVector(0, 0, 20) - C).Rotation());
				Cine->GetCineCameraComponent()->FocusSettings.ManualFocusDistance = (Seat - C).Size();
				return T < 26.f;
			});
		})
		.Wait(7.f)
		.Do([this]() { Him->Play(TEXT("idle")); Him->SetActorLocation(Him->GetActorLocation() + FVector(0, 0, Him->HipHeight - 45.f)); })
		.Wait(1.6f)
		.Do([this]()
		{
			Him->Play(TEXT("walk"), 0.85f);
			const FVector Start = Him->GetActorLocation();
			const FVector Dir = (Him->GetActorRotation() + FRotator(0, 90.f + 30.f, 0)).Vector();
			Him->SetActorRotation(FRotator(0, Dir.Rotation().Yaw - 90.f, 0));
			Every([this, Start, Dir, T = 0.f](float Dt) mutable { T += Dt; FVector N = Start + Dir * 125.f * T; FHitResult H; if (GetWorld()->LineTraceSingleByChannel(H, N + FVector(0, 0, 300), N - FVector(0, 0, 600), ECC_Visibility)) N.Z = H.ImpactPoint.Z; Him->SetActorLocation(N); return T < 16.f; });
		})
		.Wait(18.f)
		.Do([this]() { Him->SetActorHiddenInGame(true); FSFAudio::Amb(this, TEXT("kids"), 0.f, 18.f); })
		.Tween(16.f, [this](float K) { if (Stain) Stain->SetScalarParameterValue(TEXT("Cover"), K); }, false)
		.Wait(2.f)
		.Do([this]() { FSFAudio::StopMusic(this, 8.f); FSFAudio::StopAllAmb(this, 8.f); })
		.FadeTo(1.f, 6.f, FLinearColor(0.91f, 0.92f, 0.93f))
		.Do([this]()
		{
			const bool bClosed = !(GI()->Flag(TEXT("r1")) && GI()->Flag(TEXT("r2")) && GI()->Flag(TEXT("r3")));
			if (SSFOverlay* O = UI())
			{
				APlayerController* PC = UGameplayStatics::GetPlayerController(this, 0);
				if (PC) { PC->bShowMouseCursor = true; PC->SetInputMode(FInputModeGameAndUI()); }
				TWeakObjectPtr<ASFBlizzardDirector> Self(this);
				O->ShowEnd(bClosed, [Self]() { if (Self.IsValid()) { Self->GI()->Flags.Empty(); Self->GI()->bStarted = false; Self->GI()->Travel(Self.Get(), TEXT("L_Blizzard")); } });
			}
		});
	});
}

bool ASFBlizzardDirector::AutoTarget(FVector& Out) const
{
	if (bEnding) { Out = Marker(TEXT("SitPoint")); return true; }
	if (Shadow) { Out = Shadow->GetActorLocation(); return true; }
	return false;
}
