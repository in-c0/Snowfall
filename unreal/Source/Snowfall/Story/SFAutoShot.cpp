#include "Story/SFAutoShot.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonReader.h"
#include "Dom/JsonObject.h"
#include "Core/SFGameInstance.h"
#include "UI/SFHUD.h"
#include "UI/SFOverlay.h"
#include "Snowfall.h"
#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/PlayerStart.h"
#include "Kismet/GameplayStatics.h"
#include "EngineUtils.h"
#include "UnrealClient.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "HAL/PlatformMisc.h"
#include "Engine/World.h"
#include "HAL/FileManager.h"
#include "Misc/Parse.h"
#include "Misc/CommandLine.h"

ASFAutoShot::ASFAutoShot() { PrimaryActorTick.bCanEverTick = true; }

void ASFAutoShot::BeginPlay()
{
	Super::BeginPlay();
	USFGameInstance* GI = Cast<USFGameInstance>(GetGameInstance());
	const FString Tag = GI && !GI->AutoShotTag.IsEmpty() ? GI->AutoShotTag : TEXT("latest");
	OutDir = FPaths::ProjectSavedDir() / TEXT("AutoShots") / Tag;
	IFileManager::Get().MakeDirectory(*OutDir, true);
	const FString Level = UGameplayStatics::GetCurrentLevelName(this);
	for (TActorIterator<ACameraActor> It(GetWorld()); It; ++It)
		if (It->ActorHasTag(TEXT("Shot")))
		{
			Views.Add(It->GetActorTransform());
			FString N = It->GetName();
			for (const FName& Tg : It->Tags) if (Tg.ToString().StartsWith(TEXT("shot_"))) N = Tg.ToString();
			Names.Add(Level + TEXT("_") + N);
		}
	// evidence views from the art layer (Content/Data/Art/<Level>.json "shots", three.js metres) - identical for any build
	{
		FString Json; TSharedPtr<FJsonObject> Root;
		const FString ArtPath = FPaths::ProjectContentDir() / TEXT("Data/Art") / (Level + TEXT(".json"));
		if (FFileHelper::LoadFileToString(Json, *ArtPath) && FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Json), Root) && Root.IsValid())
		{
			const TArray<TSharedPtr<FJsonValue>>* Shots;
			if (Root->TryGetArrayField(TEXT("shots"), Shots))
				for (const TSharedPtr<FJsonValue>& V : *Shots)
				{
					const TSharedPtr<FJsonObject> O = V->AsObject(); if (!O) continue;
					const TArray<TSharedPtr<FJsonValue>>* Pa; const TArray<TSharedPtr<FJsonValue>>* La; FString Name;
					if (!O->TryGetArrayField(TEXT("position"), Pa) || !O->TryGetArrayField(TEXT("lookAt"), La) || Pa->Num() < 3 || La->Num() < 3) continue;
					O->TryGetStringField(TEXT("name"), Name);
					auto C3 = [](const TArray<TSharedPtr<FJsonValue>>& A) { return FVector(-A[2]->AsNumber(), A[0]->AsNumber(), A[1]->AsNumber()) * 100.0; };
					const FVector From = C3(*Pa), To = C3(*La);
					Views.Add(FTransform((To - From).Rotation(), From)); Names.Add(Level + TEXT("_") + Name);
				}
		}
	}
	if (Views.Num() == 0)
	{
		FTransform Base = FTransform::Identity;
		for (TActorIterator<APlayerStart> It(GetWorld()); It; ++It) { Base = It->GetActorTransform(); break; }
		for (int32 i = 0; i < 3; ++i)
		{
			FTransform V = Base; V.AddToTranslation(FVector(0, 0, 70)); V.ConcatenateRotation(FRotator(0, i * 120.f, 0).Quaternion());
			Views.Add(V); Names.Add(FString::Printf(TEXT("%s_auto%d"), *Level, i));
		}
	}
	FActorSpawnParameters P; P.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	Cam = GetWorld()->SpawnActor<ACameraActor>(ACameraActor::StaticClass(), FTransform::Identity, P);
	Cam->GetCameraComponent()->SetFieldOfView(70.f);
	Cam->GetCameraComponent()->bConstrainAspectRatio = false;
	UE_LOG(LogSnowfall, Display, TEXT("AUTOSHOT level=%s views=%d out=%s"), *Level, Views.Num(), *OutDir);
	Next();
}

void ASFAutoShot::Next()
{
	Index++; T = 0.f; FrameAcc = 0.f; Frames = 0; WorstFrame = 0.f; bShotRequested = false;
	// -shotresume: a retry after a crash (e.g. a transient out-of-memory) only renders the views that are still missing
	static const bool bResume = FParse::Param(FCommandLine::Get(), TEXT("shotresume"));
	while (bResume && Index < Views.Num() && IFileManager::Get().FileExists(*(OutDir / (Names[Index] + TEXT(".png"))))) Index++;
	if (Index >= Views.Num()) { Finish(); return; }
	Cam->SetActorTransform(Views[Index]);
	if (APlayerController* PC = UGameplayStatics::GetPlayerController(this, 0)) PC->SetViewTargetWithBlend(Cam, 0.f);
}

void ASFAutoShot::Tick(float Dt)
{
	Super::Tick(Dt);
	if (Index < 0 || Index >= Views.Num()) return;
	if (SSFOverlay* O = ASFHUD::Get(this)) { O->Fade = 0.f; O->HideLine(); O->ShowTitle(false); O->SetCrosshair(false); O->ClearPrompt(); }
	if (APlayerController* PC = UGameplayStatics::GetPlayerController(this, 0)) if (PC->GetViewTarget() != Cam) PC->SetViewTargetWithBlend(Cam, 0.f);
	const USFGameInstance* GI = Cast<USFGameInstance>(GetGameInstance());
	const float Delay = GI ? GI->AutoShotDelay : 6.f;
	T += Dt;
	if (T > 1.5f) { FrameAcc += Dt; Frames++; WorstFrame = FMath::Max(WorstFrame, Dt); }
	if (!bShotRequested && T >= Delay)
	{
		bShotRequested = true;
		const FString File = OutDir / (Names[Index] + TEXT(".png"));
		FScreenshotRequest::RequestScreenshot(File, false, false);
		const float Avg = Frames ? FrameAcc / Frames : 0.f;
		const FString Line = FString::Printf(TEXT("{\"shot\":\"%s\",\"avg_ms\":%.2f,\"worst_ms\":%.2f,\"fps\":%.1f}\n"), *Names[Index], Avg * 1000.f, WorstFrame * 1000.f, Avg > 0 ? 1.f / Avg : 0.f);
		// written per shot, so the numbers survive a crash later in the run
		FFileHelper::SaveStringToFile(Line, *(OutDir / TEXT("report.jsonl")), FFileHelper::EEncodingOptions::AutoDetect, &IFileManager::Get(), FILEWRITE_Append);
		UE_LOG(LogSnowfall, Display, TEXT("AUTOSHOT shot=%s avg=%.2fms"), *File, Avg * 1000.f);
	}
	if (bShotRequested && T >= Delay + 1.0f) Next();
}

void ASFAutoShot::Finish()
{
	USFGameInstance* GI = Cast<USFGameInstance>(GetGameInstance());
	if (GI && GI->AutoShotLevels.IsValidIndex(GI->AutoShotIndex + 1))
	{
		GI->AutoShotIndex++;
		UGameplayStatics::OpenLevel(this, FName(*GI->AutoShotLevels[GI->AutoShotIndex]));
		return;
	}
	UE_LOG(LogSnowfall, Display, TEXT("AUTOSHOT done"));
	FPlatformMisc::RequestExit(false);
}
