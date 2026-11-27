#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "SFDirector.generated.h"

class ASFCharacter; class USFGameInstance; class SSFOverlay; class APostProcessVolume; class AExponentialHeightFog;
class USFInteractComponent;

/** One scripted beat. */
struct FSFStep
{
	enum class EType : uint8 { Do, Wait, Until, Say, Choice, Tween };
	EType Type = EType::Do;
	TFunction<void()> Fn;
	TFunction<bool()> Pred;
	TFunction<void(float)> TweenFn;
	TFunction<void(int32)> OnChoice;
	FString Key; TArray<FString> Keys; FString Who;
	float Dur = 0.f, T = 0.f; bool bStarted = false, bNoSkip = false, bPicked = false; int32 Picked = -1;
};

/**
 * Base for each level's story. Subclasses build a script in BeginPlay with chained calls:
 *   Say("s0.him_where").Wait(0.6f).Until([&]{ return Me()->Moved > 30; }).Choose({...}, [&](int32 C){ ... });
 * Steps added from inside a callback run immediately after the current step (natural branching).
 */
UCLASS()
class SNOWFALL_API ASFDirector : public AActor
{
	GENERATED_BODY()
public:
	ASFDirector();
	virtual void Tick(float Dt) override;
	virtual void BeginPlay() override;

	// ---- script builders ----
	ASFDirector& Do(TFunction<void()> F);
	ASFDirector& Wait(float Seconds);
	ASFDirector& Until(TFunction<bool()> P);
	ASFDirector& Say(const FString& Key, float Dur = -1.f, bool bNoSkip = false);
	ASFDirector& Choose(const TArray<FString>& Keys, TFunction<void(int32)> On);
	ASFDirector& Tween(float Dur, TFunction<void(float)> F, bool bSmooth = true);
	ASFDirector& FadeTo(float Alpha, float Dur, FLinearColor Color = FLinearColor::Black);
	/** Runs every frame until it returns false (background behaviour). */
	void Every(TFunction<bool(float)> F) { Tickers.Add(MoveTemp(F)); }

	// ---- helpers ----
	ASFCharacter* Me() const;
	USFGameInstance* GI() const;
	SSFOverlay* UI() const;
	AActor* Tagged(FName Tag) const;
	TArray<AActor*> AllTagged(FName Tag) const;
	FVector Marker(FName Tag, FVector Fallback = FVector::ZeroVector) const;
	USFInteractComponent* AddInteract(AActor* Host, const FString& Label, float Hold, TFunction<void()> OnUse, float MaxDist = 260.f, float Radius = 30.f);
	USFInteractComponent* AddInteractAt(const FVector& Where, const FString& Label, float Hold, TFunction<void()> OnUse, float MaxDist = 260.f, float Radius = 30.f);
	void Go(FName Level, const FString& Spawn = FString(), float FadeOut = 1.2f, FLinearColor Color = FLinearColor::Black);
	void Hint(const FString& Key, float Seconds = 6.f);
	float LineSeconds(const FString& Key) const;

	// look (post process / fog) access
	APostProcessVolume* Look() const;
	AExponentialHeightFog* Fog() const;
	void SetExposure(float Ev);
	void SetFocus(float DistanceCm, float Aperture = 2.8f);

	float Elapsed = 0.f;
	bool bTravelling = false;
	/** Autopilot hint: where a player would head next when nothing interactable is around. */
	virtual bool AutoTarget(FVector& Out) const { return false; }
protected:
	TArray<FSFStep> Queue;
	int32 InsertAt = -1;
	TArray<TFunction<bool(float)>> Tickers;
	ASFDirector& Push(FSFStep&& S);
	/** Called at BeginPlay after the player exists; build the level's script here. */
	virtual void Script() {}
	/** Called when the title is dismissed (first level only). */
	virtual void OnBegin() {}
	bool bScripted = false;
};
