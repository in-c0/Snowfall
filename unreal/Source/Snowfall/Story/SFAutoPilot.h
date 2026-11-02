#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "SFAutoPilot.generated.h"

class USFInteractComponent;

/**
 * Automated playthrough (-autoplay [-autoplayspeed=2] [-autochoice=0] [-shottag=X]): plays the story like a patient
 * player — walks to the nearest usable thing (or the director's AutoTarget), looks at it, presses/holds use, answers
 * choices, keeps walking forward otherwise. Logs every level / flag change, saves a screenshot every few seconds to
 * Saved/AutoShots/<tag>/play_*.png, and quits with AUTOPLAY END (reached the ending) or AUTOPLAY STUCK/TIMEOUT.
 */
UCLASS()
class SNOWFALL_API ASFAutoPilot : public AActor
{
	GENERATED_BODY()
public:
	ASFAutoPilot();
	virtual void BeginPlay() override;
	virtual void Tick(float Dt) override;
private:
	FString Level, OutDir;
	float T = 0.f, ShotT = 0.f, ChoiceT = 0.f, HoldT = 0.f, StuckT = 0.f, UnstickYaw = 0.f, UnstickT = 0.f, NoProgressT = 0.f;
	FVector LastPos = FVector::ZeroVector;
	int32 LastFlags = -1;
	TWeakObjectPtr<USFInteractComponent> Target;
	void Shot(const FString& Why);
	void Log(const FString& Msg) const;
	void Quit(const FString& Why);
};
