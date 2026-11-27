#include "Story/SFAutoPilot.h"
#include "Story/SFDirector.h"
#include "Core/SFCharacter.h"
#include "Core/SFGameInstance.h"
#include "Core/SFInteractComponent.h"
#include "UI/SFHUD.h"
#include "UI/SFOverlay.h"
#include "Snowfall.h"
#include "EngineUtils.h"
#include "Kismet/GameplayStatics.h"
#include "HAL/FileManager.h"
#include "Misc/FileHelper.h"
#include "UnrealClient.h"
#include "Camera/CameraComponent.h"

ASFAutoPilot::ASFAutoPilot() { PrimaryActorTick.bCanEverTick = true; PrimaryActorTick.TickGroup = TG_PrePhysics; }

void ASFAutoPilot::Log(const FString& Msg) const
{
	const USFGameInstance* GI = Cast<USFGameInstance>(GetGameInstance());
	const double Now = FPlatformTime::Seconds();
	const FString Line = FString::Printf(TEXT("[%7.1fs] %-11s %s"), GI ? Now - GI->AutoPlayStart : 0.0, *Level, *Msg);
	UE_LOG(LogSnowfall, Display, TEXT("AUTOPLAY %s"), *Line);
	FFileHelper::SaveStringToFile(Line + TEXT("\n"), *(OutDir / TEXT("autoplay.log")), FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM, &IFileManager::Get(), FILEWRITE_Append);
}

void ASFAutoPilot::BeginPlay()
{
	Super::BeginPlay();
	USFGameInstance* GI = Cast<USFGameInstance>(GetGameInstance());
	Level = UGameplayStatics::GetCurrentLevelName(this);
	OutDir = FPaths::ProjectSavedDir() / TEXT("AutoShots") / (GI ? GI->AutoShotTag : FString(TEXT("play")));
	IFileManager::Get().MakeDirectory(*OutDir, true);
	if (GI && GI->AutoPlayStart == 0.0) GI->AutoPlayStart = FPlatformTime::Seconds();
	UGameplayStatics::SetGlobalTimeDilation(this, GI ? GI->AutoPlaySpeed : 2.f);
	Log(TEXT("enter"));
}

void ASFAutoPilot::Shot(const FString& Why)
{
	USFGameInstance* GI = Cast<USFGameInstance>(GetGameInstance());
	const int32 N = GI ? GI->AutoPlayShot++ : 0;
	FScreenshotRequest::RequestScreenshot(OutDir / FString::Printf(TEXT("play_%03d_%s_%s.png"), N, *Level, *Why), false, false);
}

void ASFAutoPilot::Quit(const FString& Why)
{
	Log(Why);
	Shot(TEXT("final"));
	FTimerHandle H;
	GetWorldTimerManager().SetTimer(H, []() { FPlatformMisc::RequestExit(false); }, 1.5f, false);
	SetActorTickEnabled(false);
}

void ASFAutoPilot::Tick(float Dt)
{
	Super::Tick(Dt);
	USFGameInstance* GI = Cast<USFGameInstance>(GetGameInstance());
	ASFCharacter* P = Cast<ASFCharacter>(UGameplayStatics::GetPlayerPawn(this, 0));
	SSFOverlay* O = ASFHUD::Get(this);
	if (!P || !GI) return;
	T += Dt; ShotT += Dt;
	if (ShotT > 6.f) { ShotT = 0.f; Shot(TEXT("t")); }

	// progress = story flags
	if (GI->Flags.Num() != LastFlags)
	{
		if (LastFlags >= 0)
		{
			FString Fl; for (const auto& Pair : GI->Flags) if (Pair.Value) Fl += Pair.Key.ToString() + TEXT(" ");
			Log(FString::Printf(TEXT("flags: %s"), *Fl));
		}
		LastFlags = GI->Flags.Num(); NoProgressT = 0.f;
	}
	NoProgressT += Dt;
	const double Total = FPlatformTime::Seconds() - GI->AutoPlayStart;
	if (O && O->IsEnded()) { Quit(FString::Printf(TEXT("AUTOPLAY END reached (%.0f s real time)"), Total)); return; }
	if (NoProgressT > 420.f) { Quit(TEXT("AUTOPLAY STUCK: no story progress for 7 min")); return; }
	if (Total > 3600.0) { Quit(TEXT("AUTOPLAY TIMEOUT")); return; }

	// choices: answer after a beat
	if (O && O->IsChoiceOpen())
	{
		ChoiceT += Dt;
		if (ChoiceT > 1.5f) { ChoiceT = 0.f; Log(FString::Printf(TEXT("choice -> %d"), GI->AutoPlayChoice)); O->PickChoice(GI->AutoPlayChoice); P->AutoInput(FVector2D::ZeroVector, false, false); }
		return;
	}
	ChoiceT = 0.f;

	// target: nearest enabled interactable in this world, else the director's hint
	USFInteractComponent* Best = nullptr; float BestD = 4000.f;
	for (const TWeakObjectPtr<USFInteractComponent>& W : USFInteractComponent::Registry())
	{
		USFInteractComponent* I = W.Get();
		if (!I || !I->bEnabled || I->GetWorld() != GetWorld()) continue;
		const float D = FVector::Dist(I->GetComponentLocation(), P->GetActorLocation());
		if (D < BestD) { BestD = D; Best = I; }
	}
	FVector Goal; bool bGoal = false; float Reach = 150.f;
	if (Best) { Goal = Best->GetComponentLocation(); bGoal = true; Reach = Best->MaxDistance * 0.6f; if (Best != Target.Get()) { Target = Best; Log(TEXT("target ") + Best->LabelKey); } }
	else
	{
		for (TActorIterator<ASFDirector> It(GetWorld()); It; ++It) if (It->AutoTarget(Goal)) { bGoal = true; break; }
	}

	const FVector Eye = P->GetActorLocation() + FVector(0, 0, P->EyeHeight - 92.f);
	FVector2D Move(0.f, 1.f);
	bool bHeld = false, bPress = false;
	if (bGoal)
	{
		const FVector D = Goal - Eye;
		const float Dist2D = FVector(D.X, D.Y, 0).Size();
		float WantYaw = FMath::RadiansToDegrees(FMath::Atan2(D.Y, D.X)) + UnstickYaw;
		const float WantPitch = FMath::RadiansToDegrees(FMath::Atan2(D.Z, FMath::Max(Dist2D, 1.f)));
		if (P->bCanLook)
		{
			const FRotator Cur = P->GetControlRotation();
			const float NY = FMath::FixedTurn(Cur.Yaw, WantYaw, 140.f * Dt);
			const float NP = FMath::FixedTurn(FRotator::NormalizeAxis(Cur.Pitch), WantPitch, 90.f * Dt);
			P->SetLookRotation(NY, NP);
		}
		const float YawErr = FMath::Abs(FRotator::NormalizeAxis(P->GetControlRotation().Yaw - WantYaw));
		Move = Dist2D > Reach ? FVector2D(0.f, YawErr < 60.f ? 1.f : 0.2f) : FVector2D::ZeroVector;
		if (Best && Dist2D <= Best->MaxDistance && P->Focus == Best)
		{
			if (Best->HoldSeconds > 0.f) bHeld = true; else { HoldT += Dt; if (HoldT > 0.6f) { bPress = true; HoldT = 0.f; Log(TEXT("use ") + Best->LabelKey); } }
		}
	}
	// unstick: no movement while trying to move
	const float Moved = FVector::Dist2D(P->GetActorLocation(), LastPos);
	LastPos = P->GetActorLocation();
	if (Move.SizeSquared() > 0.01f && P->bCanMove && Moved < 10.f * Dt) StuckT += Dt; else StuckT = FMath::Max(0.f, StuckT - Dt);
	if (StuckT > 4.f) { StuckT = 0.f; UnstickYaw = FMath::RandBool() ? 70.f : -70.f; UnstickT = 2.5f; Log(TEXT("unstick")); }
	if (UnstickT > 0.f) { UnstickT -= Dt; if (UnstickT <= 0.f) UnstickYaw = 0.f; }
	P->AutoInput(Move, bHeld, bPress);
}
