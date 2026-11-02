#include "Story/SFDirector.h"
#include "Core/SFCharacter.h"
#include "Core/SFGameInstance.h"
#include "Core/SFInteractComponent.h"
#include "UI/SFHUD.h"
#include "UI/SFOverlay.h"
#include "Snowfall.h"
#include "Kismet/GameplayStatics.h"
#include "Engine/PostProcessVolume.h"
#include "Engine/ExponentialHeightFog.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "TimerManager.h"

ASFDirector::ASFDirector() { PrimaryActorTick.bCanEverTick = true; PrimaryActorTick.bTickEvenWhenPaused = false; }

void ASFDirector::BeginPlay()
{
	Super::BeginPlay();
	// the pawn may spawn a frame later; build the script on the next tick
}

ASFCharacter* ASFDirector::Me() const { return Cast<ASFCharacter>(UGameplayStatics::GetPlayerPawn(this, 0)); }
USFGameInstance* ASFDirector::GI() const { return Cast<USFGameInstance>(GetGameInstance()); }
SSFOverlay* ASFDirector::UI() const { return ASFHUD::Get(this); }

AActor* ASFDirector::Tagged(FName Tag) const
{
	for (TActorIterator<AActor> It(GetWorld()); It; ++It) if (It->ActorHasTag(Tag)) return *It;
	return nullptr;
}
TArray<AActor*> ASFDirector::AllTagged(FName Tag) const
{
	TArray<AActor*> Out; UGameplayStatics::GetAllActorsWithTag(this, Tag, Out); return Out;
}
FVector ASFDirector::Marker(FName Tag, FVector Fallback) const { const AActor* A = Tagged(Tag); return A ? A->GetActorLocation() : Fallback; }

APostProcessVolume* ASFDirector::Look() const
{
	for (TActorIterator<APostProcessVolume> It(GetWorld()); It; ++It) if (It->bUnbound) return *It;
	return nullptr;
}
AExponentialHeightFog* ASFDirector::Fog() const { for (TActorIterator<AExponentialHeightFog> It(GetWorld()); It; ++It) return *It; return nullptr; }
void ASFDirector::SetExposure(float Ev)
{
	if (APostProcessVolume* V = Look()) { V->Settings.bOverride_AutoExposureBias = true; V->Settings.AutoExposureBias = Ev; }
}
void ASFDirector::SetFocus(float DistanceCm, float Aperture)
{
	if (APostProcessVolume* V = Look())
	{
		V->Settings.bOverride_DepthOfFieldFocalDistance = true; V->Settings.DepthOfFieldFocalDistance = DistanceCm;
		V->Settings.bOverride_DepthOfFieldFstop = true; V->Settings.DepthOfFieldFstop = Aperture;
	}
}

ASFDirector& ASFDirector::Push(FSFStep&& S)
{
	if (InsertAt >= 0) { Queue.Insert(MoveTemp(S), InsertAt++); }
	else Queue.Add(MoveTemp(S));
	return *this;
}
ASFDirector& ASFDirector::Do(TFunction<void()> F) { FSFStep S; S.Type = FSFStep::EType::Do; S.Fn = MoveTemp(F); return Push(MoveTemp(S)); }
ASFDirector& ASFDirector::Wait(float Sec) { FSFStep S; S.Type = FSFStep::EType::Wait; S.Dur = Sec; return Push(MoveTemp(S)); }
ASFDirector& ASFDirector::Until(TFunction<bool()> P) { FSFStep S; S.Type = FSFStep::EType::Until; S.Pred = MoveTemp(P); return Push(MoveTemp(S)); }
ASFDirector& ASFDirector::Say(const FString& Key, float Dur, bool bNoSkip)
{
	FSFStep S; S.Type = FSFStep::EType::Say; S.Key = Key; S.Dur = Dur > 0 ? Dur : LineSeconds(Key); S.bNoSkip = bNoSkip;
	Push(MoveTemp(S));
	return Wait(0.45f);
}
ASFDirector& ASFDirector::Choose(const TArray<FString>& Keys, TFunction<void(int32)> On)
{
	FSFStep S; S.Type = FSFStep::EType::Choice; S.Keys = Keys; S.OnChoice = MoveTemp(On); return Push(MoveTemp(S));
}
ASFDirector& ASFDirector::Tween(float Dur, TFunction<void(float)> F, bool bSmooth)
{
	FSFStep S; S.Type = FSFStep::EType::Tween; S.Dur = FMath::Max(Dur, 0.f);
	S.TweenFn = bSmooth ? TFunction<void(float)>([F](float K) { F(K * K * (3.f - 2.f * K)); }) : MoveTemp(F);
	return Push(MoveTemp(S));
}
ASFDirector& ASFDirector::FadeTo(float Alpha, float Dur, FLinearColor Color)
{
	TSharedPtr<float> From = MakeShared<float>(0.f);
	Do([this, From, Color]() { if (SSFOverlay* O = UI()) { *From = O->Fade; O->FadeColor = Color; } });
	return Tween(Dur, [this, From, Alpha](float K) { if (SSFOverlay* O = UI()) O->Fade = FMath::Lerp(*From, Alpha, K); });
}

float ASFDirector::LineSeconds(const FString& Key) const
{
	const FString Txt = GI() ? GI()->T(Key).ToString() : Key;
	TArray<FString> Words; Txt.ParseIntoArrayWS(Words);
	const bool bKo = GI() && GI()->Lang == TEXT("ko");
	return FMath::Max(2.2f, 1.3f + Words.Num() * 0.32f + (bKo ? Txt.Len() * 0.03f : 0.f));
}

void ASFDirector::Hint(const FString& Key, float Seconds) { if (SSFOverlay* O = UI()) O->Hint(GI()->T(Key), Seconds); }

USFInteractComponent* ASFDirector::AddInteract(AActor* Host, const FString& Label, float Hold, TFunction<void()> OnUse, float MaxDist, float Radius)
{
	if (!Host) Host = this;
	USFInteractComponent* C = NewObject<USFInteractComponent>(Host);
	C->LabelKey = Label; C->HoldSeconds = Hold; C->MaxDistance = MaxDist; C->Radius = Radius;
	if (Host->GetRootComponent()) C->SetupAttachment(Host->GetRootComponent());
	C->RegisterComponent();
	C->OnUse.BindLambda([OnUse](USFInteractComponent*) { if (OnUse) OnUse(); });
	return C;
}
USFInteractComponent* ASFDirector::AddInteractAt(const FVector& Where, const FString& Label, float Hold, TFunction<void()> OnUse, float MaxDist, float Radius)
{
	USFInteractComponent* C = AddInteract(this, Label, Hold, OnUse, MaxDist, Radius);
	C->SetWorldLocation(Where);
	return C;
}

void ASFDirector::Go(FName Level, const FString& Spawn, float FadeOut, FLinearColor Color)
{
	if (bTravelling) return;
	bTravelling = true;
	FadeTo(1.f, FadeOut, Color).Do([this, Level, Spawn]() { if (GI()) GI()->Travel(this, Level, Spawn); });
}

void ASFDirector::Tick(float Dt)
{
	Super::Tick(Dt);
	Elapsed += Dt;
	if (!bScripted)
	{
		if (!Me()) return;
		bScripted = true;
		Script();
	}
	for (int32 i = Tickers.Num() - 1; i >= 0; --i) if (!Tickers[i](Dt)) Tickers.RemoveAt(i);

	ASFCharacter* P = Me();
	SSFOverlay* O = UI();
	int32 Guard = 0;
	while (Queue.Num() > 0 && Guard++ < 64)
	{
		FSFStep& S = Queue[0];
		const bool bFirst = !S.bStarted; S.bStarted = true;
		bool bDone = false;
		InsertAt = 1;
		switch (S.Type)
		{
		case FSFStep::EType::Do: { auto F = MoveTemp(S.Fn); Queue.RemoveAt(0); InsertAt = 0; if (F) F(); InsertAt = -1; continue; }
		case FSFStep::EType::Wait: S.T += bFirst ? 0.f : Dt; bDone = S.T >= S.Dur; break;
		case FSFStep::EType::Until: bDone = S.Pred ? S.Pred() : true; break;
		case FSFStep::EType::Tween:
			if (bFirst) { S.T = 0.f; if (S.TweenFn) S.TweenFn(S.Dur <= 0.f ? 1.f : 0.f); bDone = S.Dur <= 0.f; break; }
			S.T += Dt; if (S.TweenFn) S.TweenFn(FMath::Clamp(S.T / FMath::Max(S.Dur, 1e-3f), 0.f, 1.f)); bDone = S.T >= S.Dur; break;
		case FSFStep::EType::Say:
			if (bFirst) { if (O) O->ShowLine(GI()->T(S.Key), S.Who.IsEmpty() ? GI()->Who(S.Key) : S.Who); if (P) P->bAdvancePressed = false; }
			else S.T += Dt;
			if (S.T >= S.Dur || (!S.bNoSkip && P && P->bAdvancePressed && S.T > 0.5f)) { bDone = true; if (O) O->HideLine(); if (P) P->bAdvancePressed = false; }
			break;
		case FSFStep::EType::Choice:
			if (bFirst)
			{
				TArray<FText> Labels; for (const FString& K : S.Keys) Labels.Add(GI()->T(K));
				TWeakObjectPtr<ASFDirector> Self(this);
				if (O) O->ShowChoices(Labels, [Self](int32 I) { if (Self.IsValid() && Self->Queue.Num() && Self->Queue[0].Type == FSFStep::EType::Choice) { Self->Queue[0].bPicked = true; Self->Queue[0].Picked = I; } });
			}
			if (S.bPicked)
			{
				auto Cb = MoveTemp(S.OnChoice); const int32 I = S.Picked;
				Queue.RemoveAt(0); InsertAt = 0; if (Cb) Cb(I); InsertAt = -1; continue;
			}
			break;
		}
		InsertAt = -1;
		if (!bDone) break;
		Queue.RemoveAt(0);
	}
	InsertAt = -1;
}
