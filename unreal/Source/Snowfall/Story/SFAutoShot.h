#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "SFAutoShot.generated.h"

/**
 * Automated verification: with -autoshot, visits every CameraActor tagged "Shot" in the level (or orbits the player
 * start if none), waits for Lumen/TSR to settle, writes a PNG + frame timings to Saved/AutoShots/<tag>/, then loads
 * the next level from -shotlevels=A+B+C and finally quits.
 */
UCLASS()
class SNOWFALL_API ASFAutoShot : public AActor
{
	GENERATED_BODY()
public:
	ASFAutoShot();
	virtual void BeginPlay() override;
	virtual void Tick(float Dt) override;
private:
	TArray<FTransform> Views;
	TArray<FString> Names;
	int32 Index = -1;
	float T = 0.f, FrameAcc = 0.f; int32 Frames = 0; float WorstFrame = 0.f;
	bool bShotRequested = false;
	FString OutDir, Report;
	class ACameraActor* Cam = nullptr;
	void Next();
	void Finish();
};
