#include "Story/SFLevelDirectors.h"
#include "Core/SFCharacter.h"
#include "Core/SFGameInstance.h"
#include "Core/SFInteractComponent.h"
#include "Core/SFAudio.h"
#include "FX/SFSnowfall.h"
#include "FX/SFFigure.h"
#include "UI/SFOverlay.h"
#include "Snowfall.h"
#include "Components/LightComponent.h"
#include "Components/PointLightComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/PointLight.h"
#include "Engine/StaticMeshActor.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "GameFramework/PlayerController.h"
#include "Kismet/GameplayStatics.h"
#include "Camera/CameraComponent.h"
#include "Engine/World.h"

bool ASFLibraryDirector::Has(const TCHAR* F) const { return GI()->Flag(FName(F)); }

static void SetLightsTagged(ASFDirector* D, const FString& Tag, float Intensity)
{
	for (AActor* A : D->AllTagged(FName(*Tag)))
		if (ULightComponent* L = A->FindComponentByClass<ULightComponent>()) L->SetIntensity(Intensity);
}
static void ShowTagged(ASFDirector* D, const FString& Tag, bool bShow)
{
	for (AActor* A : D->AllTagged(FName(*Tag))) A->SetActorHiddenInGame(!bShow);
}

void ASFLibraryDirector::Script()
{
	ASFCharacter* P = Me();
	FActorSpawnParameters SP; SP.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	Snow = GetWorld()->SpawnActor<ASFSnowfall>(ASFSnowfall::StaticClass(), FTransform::Identity, SP);
	Snow->Wind = FVector(15, 20, -70); Snow->Turbulence = 20.f; Snow->Density = 0.f;
	P->WalkSpeed = 200.f; P->RunSpeed = 380.f;
	FSFAudio::StopAllAmb(this, 1.f);
	const FString Spawn = GI()->PendingSpawn;
	GI()->PendingSpawn.Reset();
	if (Spawn == TEXT("wake") || (!Has(TEXT("woke")) && Spawn.IsEmpty())) { WakeUp(); return; }
	FSFAudio::Amb(this, TEXT("birds"), 0.12f); FSFAudio::Amb(this, TEXT("room"), 0.4f); FSFAudio::Amb(this, TEXT("clock"), 0.5f, 3.f);
	FSFAudio::Music(this, TEXT("library"));
	if (Has(TEXT("radio"))) FSFAudio::Amb(this, TEXT("drone"), 0.2f, 4.f);
	Refresh();
	FadeTo(0.f, Spawn == TEXT("book") || Spawn == TEXT("globe") ? 2.5f : 1.6f, Spawn == TEXT("book") || Spawn == TEXT("globe") ? FLinearColor::White : FLinearColor::Black);
	AfterReturn();
}

void ASFLibraryDirector::WakeUp()
{
	ASFCharacter* P = Me();
	P->bCanMove = false; P->EyeHeight = P->EyeTarget = 18.f; P->PitchMax = 85.f;
	P->SetLookRotation(P->GetYaw(), 55.f);
	P->Surface = TEXT("grass");
	if (SSFOverlay* O = UI()) { O->Fade = 1.f; O->FadeColor = FLinearColor::Black; }
	FSFAudio::Amb(this, TEXT("birds"), 0.35f, 6.f);
	Wait(1.5f)
	.Tween(2.5f, [this](float K) { if (SSFOverlay* O = UI()) O->Fade = 1.f - K * 0.6f; })
	.Tween(0.35f, [this](float K) { if (SSFOverlay* O = UI()) O->Fade = 0.4f + K * 0.6f; })
	.Tween(3.f, [this](float K) { if (SSFOverlay* O = UI()) O->Fade = 1.f - K; })
	.Do([this]() { FSFAudio::Music(this, TEXT("garden")); })
	.Say(TEXT("s1.him_warm"), 2.6f)
	.Do([this]() { Every([this, T = 0.f](float Dt) mutable { T += Dt; if (T > 5.f && !Me()->bCanMove) { Hint(TEXT("p.getup")); return false; } return !Me()->bCanMove; }); })
	.Until([this]() { return Me()->AnyMoveInput() || Me()->bInteractPressed; })
	.Do([this]() { if (SSFOverlay* O = UI()) O->Hint(FText(), 0.f); })
	.Tween(2.4f, [this](float K)
	{
		const float E = 1.f - FMath::Pow(1.f - K, 3.f);
		Me()->EyeHeight = Me()->EyeTarget = 18.f + E * 144.f;
		Me()->SetLookRotation(Me()->GetYaw(), 55.f * (1.f - E));
	}, false)
	.Do([this]() { Me()->bCanMove = true; Me()->PitchMax = 75.f; Refresh(); })
	.Until([this]() { return FVector::Dist2D(Me()->GetActorLocation(), Marker(TEXT("LibraryMouth"))) < 600.f; })
	.Say(TEXT("s1.him_been"))
	.Until([this]() { return FVector::Dist2D(Me()->GetActorLocation(), Marker(TEXT("LibraryMouth"))) < 150.f; })
	.Do([this]()
	{
		FSFAudio::Music(this, TEXT("library"));
		FSFAudio::Amb(this, TEXT("room"), 0.4f, 4.f); FSFAudio::Amb(this, TEXT("clock"), 0.5f, 6.f); FSFAudio::Amb(this, TEXT("birds"), 0.1f, 6.f);
		GI()->SetFlag(TEXT("woke"));
	})
	.Say(TEXT("hub.narr_enter"));
}

void ASFLibraryDirector::Refresh()
{
	for (auto& P : Items) if (P.Value) P.Value->bEnabled = false;
	auto Item = [this](const FString& Id, const FString& Label, float Hold, bool bOn, TFunction<void()> Use, float Dist = 260.f, float Rad = 30.f)
	{
		AActor* A = Tagged(FName(*(TEXT("I_") + Id)));
		if (!A) { UE_LOG(LogSnowfall, Warning, TEXT("marker I_%s missing"), *Id); return; }
		USFInteractComponent* C = Items.FindRef(Id);
		if (!C) { C = AddInteract(A, Label, Hold, Use, Dist, Rad); Items.Add(Id, C); }
		C->bEnabled = bOn;
	};
	const bool Park = Has(TEXT("m_park")), Road = Has(TEXT("road1")), Field = Has(TEXT("m_field")), Cherry = Has(TEXT("m_cherry")), Radio = Has(TEXT("radio"));
	Item(TEXT("book"), TEXT("p.book"), 1.4f, !Park, [this]() { Memory(TEXT("L_Park")); });
	Item(TEXT("window"), TEXT("p.window"), 1.4f, Park && !Road, [this]() { Say(TEXT("hub.narr_window")).Do([this]() { GI()->SetFlag(TEXT("roadVisit1")); Go(TEXT("L_Road"), TEXT("visit1"), 1.4f, FLinearColor(0.02f, 0.05f, 0.08f)); }); }, 300.f, 70.f);
	Item(TEXT("globe"), TEXT("p.globe"), 1.4f, Road && !Field, [this]() { Memory(TEXT("L_Field")); }, 220.f, 15.f);
	Item(TEXT("cherries"), TEXT("p.cherries"), 1.4f, Field && !Cherry, [this]() { CherryMemory(); }, 220.f, 25.f);
	Item(TEXT("bottle"), TEXT("p.bottle"), 0.f, !bSaidBottle, [this]() { bSaidBottle = true; Say(TEXT("hub.him_bottle"), 2.f); }, 160.f, 3.f);
	Item(TEXT("radio"), TEXT("p.radio"), 1.f, Cherry && !Radio, [this]() { RadioSpeaks(); });
	for (int32 n = 1; n <= 3; ++n)
	{
		const bool bDone = GI()->Flag(FName(*FString::Printf(TEXT("r%d"), n)));
		const bool bPrev = n == 1 || GI()->Flag(FName(*FString::Printf(TEXT("r%d"), n - 1)));
		const bool bOpen = Radio && !bDone && bPrev;
		ShowTagged(this, FString::Printf(TEXT("DoorChains%d"), n), Radio && !bDone);
		SetLightsTagged(this, FString::Printf(TEXT("DoorLight%d"), n), Radio && !bDone ? (bOpen ? 60.f : 15.f) : 0.f);
		Item(FString::Printf(TEXT("door%d"), n), TEXT("p.door"), 2.2f, bOpen, [this, n]()
		{
			if (!bSaidDoor) { bSaidDoor = true; Say(TEXT("hub.him_door"), 2.2f); }
			Do([this, n]() { FSFAudio::Sfx(this, TEXT("SFX/SFX_Heartbeat")); GI()->SetFlag(TEXT("redFrag"), false); GI()->Travel(this, TEXT("L_Red"), FString::Printf(TEXT("frag%d"), n)); });
		}, 260.f, 60.f);
	}
	Item(TEXT("exit"), TEXT("p.exit"), 2.f, Radio && !Has(TEXT("reunion")), [this]()
	{
		Me()->bCanMove = false; FSFAudio::StopMusic(this, 4.f); FSFAudio::StopAllAmb(this, 4.f);
		Go(TEXT("L_Bench"), TEXT(""), 3.f, FLinearColor(0.91f, 0.92f, 0.93f));
	}, 400.f, 250.f);
	SetLightsTagged(this, TEXT("WindowGlow"), Park && !Road ? 40.f : 3.f);
	for (AActor* A : AllTagged(TEXT("WindowPane")))
		if (UStaticMeshComponent* M = A->FindComponentByClass<UStaticMeshComponent>())
			if (UMaterialInstanceDynamic* D = M->CreateDynamicMaterialInstance(0)) D->SetScalarParameterValue(TEXT("On"), Park && !Road ? 1.f : 0.15f);
	if (Snow) Snow->Density = Radio ? 0.9f : 0.f;
	// a mote of light hovers by whatever wants remembering next
	const TCHAR* Next = !Park ? TEXT("I_book") : !Road ? TEXT("I_window") : !Field ? TEXT("I_globe") : !Cherry ? TEXT("I_cherries") : !Radio ? TEXT("I_radio")
		: !Has(TEXT("r1")) ? TEXT("I_door1") : !Has(TEXT("r2")) ? TEXT("I_door2") : !Has(TEXT("r3")) ? TEXT("I_door3") : TEXT("HerSit");
	bLure = Tagged(Next) != nullptr; if (bLure) LureTarget = Marker(Next);
	if (!Lure)
	{
		FActorSpawnParameters SP; SP.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
		APointLight* L = GetWorld()->SpawnActor<APointLight>(APointLight::StaticClass(), FTransform::Identity, SP);
		L->PointLightComponent->SetIntensity(30.f); L->PointLightComponent->SetAttenuationRadius(140.f); L->PointLightComponent->SetLightColor(FLinearColor(1.f, 0.8f, 0.55f));
		L->PointLightComponent->SetCastShadows(false); L->PointLightComponent->SetSourceRadius(2.f); L->SetMobility(EComponentMobility::Movable);
		Lure = L;
	}
}

void ASFLibraryDirector::Memory(FName Level)
{
	Me()->bCanMove = false;
	FSFAudio::Sfx(this, TEXT("SFX/SFX_Chime")); FSFAudio::Sfx(this, TEXT("SFX/SFX_Whoosh"), 0.6f);
	Tween(2.2f, [this](float K) { SetExposure(K * 3.5f); })
	.Do([this, Level]() { Go(Level, TEXT(""), 0.6f, FLinearColor::White); });
}

void ASFLibraryDirector::CherryMemory()
{
	ASFCharacter* P = Me();
	P->bCanMove = false;
	FSFAudio::Sfx(this, TEXT("SFX/SFX_Chime"));
	TSharedPtr<bool> Held = MakeShared<bool>(false), Given = MakeShared<bool>(false);
	FadeTo(1.f, 1.6f, FLinearColor::White)
	.Do([this]()
	{
		FActorSpawnParameters SP; SP.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
		const AActor* Bed = Tagged(TEXT("HerBed"));
		Her = GetWorld()->SpawnActor<ASFFigure>(ASFFigure::StaticClass(), Bed ? Bed->GetActorTransform() : FTransform::Identity, SP);
		Her->Init(TEXT("her"), 166.f);
		TMap<FString, FVector> Lie; Lie.Add(TEXT("LeftArm"), FVector(72, 0, -8)); Lie.Add(TEXT("RightArm"), FVector(60, 0, 30)); Lie.Add(TEXT("RightForeArm"), FVector(0, 0, 60)); Lie.Add(TEXT("Head"), FVector(-4, 18, 0));
		Her->Pose(Lie);
		if (AActor* V = Tagged(TEXT("CherryView"))) { Me()->PlaceFeetAt(V->GetActorLocation()); Me()->SetLookRotation(V->GetActorRotation().Yaw, V->GetActorRotation().Pitch); }
		SetExposure(0.4f); FSFAudio::Music(this, TEXT("her"));
	})
	.FadeTo(0.f, 2.f, FLinearColor::White)
	.Do([this]() { Me()->bCanMove = true; })
	.Say(TEXT("cherry.narr_1")).Say(TEXT("cherry.her_1"), 2.4f)
	.Do([this, Held]() { AddInteract(Tagged(TEXT("I_cherries")), TEXT("p.take_cherry"), 0.f, [Held]() { *Held = true; }, 220.f, 25.f); })
	.Until([Held]() { return *Held; })
	.Do([this, Given]() { AddInteract(Tagged(TEXT("I_bedGive")), TEXT("p.give_cherry"), 0.f, [Given]() { *Given = true; }, 240.f, 40.f); })
	.Until([Given]() { return *Given; })
	.Do([this]() { Me()->bCanMove = false; })
	.FadeTo(1.f, 1.8f, FLinearColor(0.1f, 0.055f, 0.03f))
	.Wait(1.2f)
	.Say(TEXT("cherry.narr_2")).Say(TEXT("cherry.narr_3"))
	.Do([this]()
	{
		if (Her) { Her->Destroy(); Her = nullptr; }
		GI()->SetFlag(TEXT("m_cherry"));
		SetExposure(0.f); FSFAudio::StopMusic(this, 3.f);
		Me()->bCanMove = true;
	})
	.FadeTo(0.f, 2.5f, FLinearColor(0.1f, 0.055f, 0.03f))
	.Do([this]() { FSFAudio::Music(this, TEXT("library")); FSFAudio::Amb(this, TEXT("radio"), 0.15f, 3.f); Refresh(); });
}

void ASFLibraryDirector::RadioSpeaks()
{
	Me()->bCanMove = false;
	FSFAudio::StopMusic(this, 2.f);
	FSFAudio::Amb(this, TEXT("radio"), 0.6f, 0.5f);
	Wait(1.2f)
	.Say(TEXT("hub.radio_1")).Say(TEXT("hub.radio_2")).Say(TEXT("hub.radio_3"))
	.Do([this]()
	{
		FSFAudio::Amb(this, TEXT("radio"), 0.f, 2.f);
		GI()->SetFlag(TEXT("radio"));
		Me()->bCanMove = true;
		FSFAudio::Amb(this, TEXT("drone"), 0.25f, 6.f);
		FSFAudio::Sfx(this, TEXT("SFX/SFX_Heartbeat"));
		Refresh();
	})
	.Wait(2.f).Say(TEXT("hub.narr_exit"));
}

void ASFLibraryDirector::AfterReturn()
{
	if (!(Has(TEXT("r1")) && Has(TEXT("r2")) && Has(TEXT("r3"))) || Has(TEXT("reunion"))) return;
	Wait(1.5f).Say(TEXT("hub.narr_alldone"))
	.Do([this]()
	{
		FSFAudio::Amb(this, TEXT("drone"), 0.f, 6.f);
		FActorSpawnParameters SP; SP.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
		const AActor* S = Tagged(TEXT("HerSit"));
		Her = GetWorld()->SpawnActor<ASFFigure>(ASFFigure::StaticClass(), S ? S->GetActorTransform() : FTransform::Identity, SP);
		Her->Init(TEXT("her"), 166.f);
		TMap<FString, FVector> Sit;
		Sit.Add(TEXT("LeftUpLeg"), FVector(-88, 0, 4)); Sit.Add(TEXT("RightUpLeg"), FVector(-88, 0, -4)); Sit.Add(TEXT("LeftLeg"), FVector(92, 0, 0)); Sit.Add(TEXT("RightLeg"), FVector(92, 0, 0));
		Sit.Add(TEXT("Spine"), FVector(4, 0, 0)); Sit.Add(TEXT("LeftArm"), FVector(58, 0, -28)); Sit.Add(TEXT("RightArm"), FVector(58, 0, 28));
		Sit.Add(TEXT("LeftForeArm"), FVector(0, 0, -55)); Sit.Add(TEXT("RightForeArm"), FVector(0, 0, 55)); Sit.Add(TEXT("Head"), FVector(8, 0, 0));
		Her->Pose(Sit);
		if (S) Her->SetActorLocation(S->GetActorLocation() - FVector(0, 0, Her->HipHeight - 52.f));
	})
	.Wait(2.f).Say(TEXT("hub.narr_bedlight"))
	.Do([this]() { FSFAudio::Music(this, TEXT("her")); });
}

void ASFLibraryDirector::Reunion()
{
	bInReunion = true;
	ASFCharacter* P = Me();
	P->bCanMove = false;
	const FVector Target = Her->GetActorLocation() + FVector(0, 0, 110);
	const FRotator Want = (Target - P->Camera->GetComponentLocation()).Rotation();
	const float Y0 = P->GetYaw(); const float P0 = P->Controller ? FRotator::NormalizeAxis(P->Controller->GetControlRotation().Pitch) : 0.f;
	const float Dy = FRotator::NormalizeAxis(Want.Yaw - Y0);
	TSharedPtr<bool> Let = MakeShared<bool>(false);
	Tween(2.f, [this, Y0, P0, Dy, Want](float K) { Me()->SetLookRotation(Y0 + Dy * K, FMath::Lerp(P0, Want.Pitch, K)); })
	.Do([this, Target]() { SetFocus((Target - Me()->Camera->GetComponentLocation()).Size(), 1.8f); })
	.Say(TEXT("reu.him_1")).Say(TEXT("reu.her_1"))
	.Choose({ TEXT("reu.c_missed"), TEXT("reu.c_why") }, [this](int32 C)
	{
		if (C == 0) Say(TEXT("reu.him_missed")).Say(TEXT("reu.her_missed"));
		else Say(TEXT("reu.him_why")).Say(TEXT("reu.her_why"));
	})
	.Say(TEXT("reu.him_2")).Say(TEXT("reu.her_2")).Say(TEXT("reu.him_3")).Say(TEXT("reu.her_3")).Say(TEXT("reu.him_4")).Say(TEXT("reu.her_4")).Say(TEXT("reu.her_5"))
	.Do([this, Let]() { Me()->bCanLook = true; USFInteractComponent* C = AddInteract(Her, TEXT("p.letgo"), 3.f, [Let]() { *Let = true; }, 420.f, 80.f); C->SetRelativeLocation(FVector(0, 0, 100)); C->AngleSlack = 0.6f; })
	.Until([Let]() { return *Let; })
	.Do([this]() { Me()->bCanLook = false; GI()->SetFlag(TEXT("reunion")); FSFAudio::StopMusic(this, 8.f); FSFAudio::Sfx(this, TEXT("SFX/SFX_Whoosh")); if (Snow) Snow->Density = 0.6f; })
	.Tween(7.f, [this](float K) { if (Her) Her->SetDissolve(K); SetExposure(K * 0.8f); })
	.Wait(2.f)
	.Do([this]() { GI()->SetFlag(TEXT("roadVisit2")); Go(TEXT("L_Road"), TEXT("visit2"), 3.f, FLinearColor::White); });
}

void ASFLibraryDirector::Tick(float Dt)
{
	Super::Tick(Dt);
	if (!Me()) return;
	if (Lure)
	{
		const float T = GetWorld()->GetTimeSeconds();
		Lure->SetActorHiddenInGame(!bLure || bInReunion);
		if (bLure) Lure->SetActorLocation(LureTarget + FVector(0, 0, 35.f + FMath::Sin(T * 1.3f) * 5.f));
	}
	if (Her && !bInReunion && Has(TEXT("r1")) && Has(TEXT("r2")) && Has(TEXT("r3")) && !Has(TEXT("reunion")) && FVector::Dist(Me()->GetActorLocation(), Her->GetActorLocation()) < 260.f) Reunion();
	// footsteps: grass in the garden, wood inside
	if (const AActor* M = Tagged(TEXT("LibraryMouth")))
		Me()->Surface = FVector::DotProduct(Me()->GetActorLocation() - M->GetActorLocation(), M->GetActorForwardVector()) > 0.f ? TEXT("wood") : TEXT("grass");
}
