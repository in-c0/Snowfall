#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "SFWalkCapture.generated.h"

/**
 * Moving-view evidence: with -walkcapture=<name> (plus -benchmark -fps=30 for a fixed time step), drives the real
 * player pawn through Content/Data/Art/<Level>.<name>.json — keyframes {t, fwd, side, yaw, pitch, heading?} with yaw/heading relative
 * to the spawn heading — and writes every frame to Saved/AutoShots/<tag>/<name>/f_00000.png plus frame timings.
 * Collision, footsteps, the story director and weather all run as in play; only the input comes from the timeline.
 */
UCLASS()
class SNOWFALL_API ASFWalkCapture : public AActor
{
	GENERATED_BODY()
public:
	ASFWalkCapture();
	virtual void BeginPlay() override;
	virtual void Tick(float Dt) override;
	FString CaptureName;
private:
	struct FKey { float T, Fwd, Side, Yaw, Pitch, Heading; bool bHeading; };
	TArray<FKey> Keys;
	float Warmup = 4.f, Duration = 0.f, T = -1.f, YawStart = 0.f; bool bAbsoluteYaw = false;
	int32 Frame = 0;
	double LastReal = 0.0;
	FString OutDir, Timings;
	FVector LastPos = FVector::ZeroVector; float Travelled = 0.f; int32 Blocked = 0; double GpuSum = 0.0, GpuMax = 0.0; bool bPerf = false; TArray<double> RealTimes;
	FKey Eval(float Time) const;
	void Finish();
};
