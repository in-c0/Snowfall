#include "Story/SFWalkCapture.h"
#include "Core/SFCharacter.h"
#include "Core/SFGameInstance.h"
#include "UI/SFHUD.h"
#include "UI/SFOverlay.h"
#include "Snowfall.h"
#include "Kismet/GameplayStatics.h"
#include "HAL/FileManager.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "UnrealClient.h"
#include "RHI.h"
#include "FX/SFFigure.h"
#include "Components/SkeletalMeshComponent.h"
#include "Camera/PlayerCameraManager.h"
#include "EngineUtils.h"
#include "Engine/Engine.h"
#include "HAL/IConsoleManager.h"
#include "Misc/Parse.h"
#include "Misc/CommandLine.h"

ASFWalkCapture::ASFWalkCapture() { PrimaryActorTick.bCanEverTick = true; PrimaryActorTick.TickGroup = TG_PrePhysics; }

void ASFWalkCapture::BeginPlay()
{
	Super::BeginPlay();
	const FString Level = UGameplayStatics::GetCurrentLevelName(this);
	const FString Path = FPaths::ProjectContentDir() / TEXT("Data/Art") / FString::Printf(TEXT("%s.%s.json"), *Level, *CaptureName);
	FString Json;
	TSharedPtr<FJsonObject> Root;
	if (!FFileHelper::LoadFileToString(Json, *Path) || !FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Json), Root) || !Root.IsValid())
	{
		UE_LOG(LogSnowfall, Error, TEXT("WALKCAPTURE cannot read %s"), *Path);
		FPlatformMisc::RequestExit(false);
		return;
	}
	Root->TryGetNumberField(TEXT("warmup"), Warmup);
	Root->TryGetBoolField(TEXT("absolute_yaw"), bAbsoluteYaw);   // keys in world yaw (0 = +X), not relative to the spawn
	const TArray<TSharedPtr<FJsonValue>>* Arr;
	if (Root->TryGetArrayField(TEXT("keys"), Arr))
		for (const TSharedPtr<FJsonValue>& V : *Arr)
		{
			const TSharedPtr<FJsonObject> O = V->AsObject(); if (!O) continue;
			FKey K{ 0, 0, 0, 0, 0, 0, false };
			O->TryGetNumberField(TEXT("t"), K.T); O->TryGetNumberField(TEXT("fwd"), K.Fwd); O->TryGetNumberField(TEXT("side"), K.Side);
			O->TryGetNumberField(TEXT("yaw"), K.Yaw); O->TryGetNumberField(TEXT("pitch"), K.Pitch);
			K.bHeading = O->TryGetNumberField(TEXT("heading"), K.Heading);   // walk direction independent of where we look
			if (!K.bHeading) K.Heading = K.Yaw;
			Keys.Add(K);
		}
	Keys.Sort([](const FKey& A, const FKey& B) { return A.T < B.T; });
	Duration = Keys.Num() ? Keys.Last().T : 0.f;
	const USFGameInstance* GI = Cast<USFGameInstance>(GetGameInstance());
	// -walkperf: same walk, real time, no screenshots -> frame times that mean something for play
	bPerf = FParse::Param(FCommandLine::Get(), TEXT("walkperf"));
	// -walkcvars=a=1;b=0 : render settings for A/B frame-time experiments, applied before the first measured frame
	FString CVarList;
	if (FParse::Value(FCommandLine::Get(), TEXT("walkcvars="), CVarList, false))
	{
		TArray<FString> Pairs; CVarList.ParseIntoArray(Pairs, TEXT(";"));
		for (const FString& Pair : Pairs)
		{
			FString K, V;
			if (!Pair.Split(TEXT("="), &K, &V)) continue;
			if (IConsoleVariable* CV = IConsoleManager::Get().FindConsoleVariable(*K)) { CV->Set(*V, ECVF_SetByConsole); UE_LOG(LogSnowfall, Display, TEXT("WALKCAPTURE cvar %s=%s"), *K, *CV->GetString()); }
			else UE_LOG(LogSnowfall, Warning, TEXT("WALKCAPTURE unknown cvar %s"), *K);
		}
	}
	OutDir = FPaths::ProjectSavedDir() / TEXT("AutoShots") / (GI && !GI->AutoShotTag.IsEmpty() ? GI->AutoShotTag : FString(TEXT("walk"))) / (CaptureName + (bPerf ? TEXT("_perf") : TEXT("")));
	IFileManager::Get().MakeDirectory(*OutDir, true);
	Timings = TEXT("frame,t,real_ms,gpu_ms,x,y,z,yaw,pitch,fig_dist,fig_z\n");
	UE_LOG(LogSnowfall, Display, TEXT("WALKCAPTURE %s keys=%d duration=%.1fs out=%s"), *CaptureName, Keys.Num(), Duration, *OutDir);
}

ASFWalkCapture::FKey ASFWalkCapture::Eval(float Time) const
{
	if (Keys.Num() == 0) return FKey{ Time, 0, 0, 0, 0, 0, false };
	if (Time <= Keys[0].T) return Keys[0];
	for (int32 i = 1; i < Keys.Num(); ++i)
		if (Time <= Keys[i].T)
		{
			const FKey& A = Keys[i - 1]; const FKey& B = Keys[i];
			const float S = FMath::SmoothStep(0.f, 1.f, (Time - A.T) / FMath::Max(B.T - A.T, 1e-3f));
			return FKey{ Time, FMath::Lerp(A.Fwd, B.Fwd, S), FMath::Lerp(A.Side, B.Side, S), FMath::Lerp(A.Yaw, B.Yaw, S), FMath::Lerp(A.Pitch, B.Pitch, S), FMath::Lerp(A.Heading, B.Heading, S), true };
		}
	return Keys.Last();
}

void ASFWalkCapture::Tick(float Dt)
{
	Super::Tick(Dt);
	ASFCharacter* P = Cast<ASFCharacter>(UGameplayStatics::GetPlayerPawn(this, 0));
	if (!P || Keys.Num() == 0) return;
	if (SSFOverlay* O = ASFHUD::Get(this)) { O->SetCrosshair(false); O->ClearPrompt(); }
	P->bCanMove = true; P->bCanLook = true; P->bYawLimit = false; P->SpeedScale = 1.f;
	if (T < 0.f)
	{
		YawStart = bAbsoluteYaw ? 0.f : P->GetYaw(); T = 0.f; LastPos = P->GetActorLocation();
		UE_LOG(LogSnowfall, Display, TEXT("WALKCAPTURE start at %s yaw=%.1f"), *LastPos.ToString(), YawStart);
		for (TActorIterator<ASFFigure> It(GetWorld()); It; ++It)
		{
			FVector O, E; It->GetActorBounds(false, O, E, true);
			UE_LOG(LogSnowfall, Display, TEXT("WALKCAPTURE figure %s who=%s at %s hidden=%d body_scale=%s bounds_extent=%s"), *It->GetName(), *It->Who,
				*It->GetActorLocation().ToString(), It->IsHidden() ? 1 : 0, It->Body ? *It->Body->GetComponentScale().ToString() : TEXT("-"), *E.ToString());
		}
	}
	T += Dt;
	const float Tc = T - Warmup;   // timeline time
	const FKey K = Eval(FMath::Max(Tc, 0.f));
	// walk along Heading while looking along Yaw: rotate the (fwd, side) input into the view frame
	const float D = FMath::DegreesToRadians(K.Heading - K.Yaw);
	const float F = K.Fwd * FMath::Cos(D) - K.Side * FMath::Sin(D), Sd = K.Fwd * FMath::Sin(D) + K.Side * FMath::Cos(D);
	P->AutoInput(Tc < 0.f ? FVector2D::ZeroVector : FVector2D(Sd, F), false, false);
	P->SetLookRotation(YawStart + K.Yaw, K.Pitch);
	// -walkhide=ClassA,ClassB: hide every actor of those classes (isolating which object causes an artefact)
	static FString HideList; static bool bHideParsed = false;
	if (!bHideParsed) { bHideParsed = true; FParse::Value(FCommandLine::Get(), TEXT("walkhide="), HideList); }
	if (!HideList.IsEmpty())
		for (TActorIterator<AActor> It(GetWorld()); It; ++It)
			if (!It->IsHidden() && HideList.Contains(It->GetClass()->GetName())) It->SetActorHiddenInGame(true);
	// -walkbodynoshadow: the player's invisible body keeps casting its shadow (story: light from behind) - A/B test
	static const bool bNoBodyShadow = FParse::Param(FCommandLine::Get(), TEXT("walkbodynoshadow"));
	if (bNoBodyShadow)
		for (TActorIterator<ASFFigure> It(GetWorld()); It; ++It)
			if (FVector::Dist2D(It->GetActorLocation(), P->GetActorLocation()) < 60.f && It->Body && It->Body->bCastHiddenShadow)
			{ It->Body->SetCastHiddenShadow(false); It->Body->SetCastShadow(false); UE_LOG(LogSnowfall, Display, TEXT("WALKCAPTURE body shadow off")); }
	// -walkhidenear / -walkhidefar: hide only the player's own body figure, or only the figures away from the player
	static const bool bHideNear = FParse::Param(FCommandLine::Get(), TEXT("walkhidenear")), bHideFar = FParse::Param(FCommandLine::Get(), TEXT("walkhidefar"));
	if (bHideNear || bHideFar)
		for (TActorIterator<ASFFigure> It(GetWorld()); It; ++It)
		{
			const bool bNear = FVector::Dist2D(It->GetActorLocation(), P->GetActorLocation()) < 60.f;
			if (!It->IsHidden() && ((bNear && bHideNear) || (!bNear && bHideFar))) It->SetActorHiddenInGame(true);
		}
	if (Tc < 0.f) return;
	const double Now = FPlatformTime::Seconds();
	const double RealMs = LastReal > 0.0 ? (Now - LastReal) * 1000.0 : 0.0;
	LastReal = Now;
	const FVector L = P->GetActorLocation();
	const float Step = FVector::Dist2D(L, LastPos); LastPos = L; Travelled += Step;
	if (K.Fwd > 0.3f && Step < 1.f) Blocked++;
	// -walkprofile: a ProfileGPU breakdown (written to the log) while the forest fills the view
	static const bool bProfile = FParse::Param(FCommandLine::Get(), TEXT("walkprofile"));
	if (bProfile && ((Tc >= 12.f && Tc - Dt < 12.f) || (Tc >= 46.f && Tc - Dt < 46.f)))
		if (GEngine) { UE_LOG(LogSnowfall, Display, TEXT("WALKCAPTURE ProfileGPU at t=%.1f"), Tc); GEngine->Exec(GetWorld(), TEXT("ProfileGPU")); }
	if (!bPerf) FScreenshotRequest::RequestScreenshot(OutDir / FString::Printf(TEXT("f_%05d.png"), Frame), false, false);
	if (Frame > 0) RealTimes.Add(RealMs);
	// real_ms includes writing the PNG; gpu_ms is the GPU time of the last rendered frame (the number that matters for play)
	const double GpuMs = FPlatformTime::ToMilliseconds(RHIGetGPUFrameCycles(0));
	GpuSum += GpuMs; GpuMax = FMath::Max(GpuMax, GpuMs);
	// nearest visible story figure (the Shadow): its distance to the eye and height, to explain anything that pops in front
	float FigDist = -1.f, FigZ = 0.f;
	if (APlayerController* PC = UGameplayStatics::GetPlayerController(this, 0))
	{
		const FVector Eye = PC->PlayerCameraManager ? PC->PlayerCameraManager->GetCameraLocation() : L;
		for (TActorIterator<ASFFigure> It(GetWorld()); It; ++It)
			if (!It->IsHidden() && FVector::Dist2D(It->GetActorLocation(), L) > 60.f)   // skip the player's own (hidden) body
			{
				const float FD = FVector::Dist(It->GetActorLocation(), Eye);
				// bones that blow up (a scale key glitch would turn one of the robot's ball joints into a huge sphere)
				if (It->Body && It->Body->GetNumBones() > 0)
				{
					const float ActorScale = It->Body->GetComponentScale().GetMax();
					for (int32 Bi = 0; Bi < It->Body->GetNumBones(); ++Bi)
					{
						const FTransform BT = It->Body->GetBoneTransform(Bi);
						const FVector Local = It->Body->GetComponentTransform().InverseTransformPosition(BT.GetLocation());
						const float Sc = BT.GetScale3D().GetMax() / FMath::Max(ActorScale, 1e-3f);
						if (Sc > 1.5f || Local.Size() > 400.f)
							UE_LOG(LogSnowfall, Warning, TEXT("WALKCAPTURE t=%.2f figure %s bone %s scale=%.2f local=%s anim=%s"), Tc, *It->GetName(),
								*It->Body->GetBoneName(Bi).ToString(), Sc, *Local.ToString(), *It->GetAnim());
					}
				}
				if (FigDist < 0.f || FD < FigDist) { FigDist = FD; FigZ = It->GetActorLocation().Z - L.Z; }
			}
	}
	Timings += FString::Printf(TEXT("%d,%.3f,%.2f,%.2f,%.0f,%.0f,%.0f,%.1f,%.1f,%.0f,%.0f\n"), Frame, Tc, RealMs, GpuMs, L.X, L.Y, L.Z, P->GetYaw(), K.Pitch, FigDist, FigZ);
	Frame++;
	if (Tc > Duration) Finish();
}

void ASFWalkCapture::Finish()
{
	SetActorTickEnabled(false);
	FFileHelper::SaveStringToFile(Timings, *(OutDir / TEXT("timings.csv")));
	RealTimes.Sort();
	double Sum = 0.0; for (double V : RealTimes) Sum += V;
	const double Avg = RealTimes.Num() ? Sum / RealTimes.Num() : 0.0, P95 = RealTimes.Num() ? RealTimes[FMath::Min(RealTimes.Num() - 1, int32(RealTimes.Num() * 0.95))] : 0.0;
	UE_LOG(LogSnowfall, Display, TEXT("WALKCAPTURE done mode=%s frames=%d travelled=%.1fm blocked_frames=%d frame_avg=%.2fms frame_p95=%.2fms frame_max=%.2fms gpu_avg=%.2fms gpu_max=%.2fms"),
		bPerf ? TEXT("perf") : TEXT("capture"), Frame, Travelled / 100.f, Blocked, Avg, P95, RealTimes.Num() ? RealTimes.Last() : 0.0, Frame ? GpuSum / Frame : 0.0, GpuMax);
	FTimerHandle H;
	GetWorldTimerManager().SetTimer(H, []() { FPlatformMisc::RequestExit(false); }, 1.0f, false);
}
