#include "Core/SFGameMode.h"
#include "Core/SFCharacter.h"
#include "Core/SFGameInstance.h"
#include "Story/SFDirector.h"
#include "Story/SFAutoShot.h"
#include "Story/SFAutoPilot.h"
#include "Story/SFBlizzardDirector.h"
#include "Story/SFLevelDirectors.h"
#include "Kismet/GameplayStatics.h"
#include "Misc/CommandLine.h"
#include "UI/SFHUD.h"
#include "GameFramework/PlayerStart.h"
#include "EngineUtils.h"
#include "Engine/World.h"

ASFGameMode::ASFGameMode()
{
	DefaultPawnClass = ASFCharacter::StaticClass();
	HUDClass = ASFHUD::StaticClass();
}

AActor* ASFGameMode::ChoosePlayerStart_Implementation(AController* Player)
{
	// arrival spot: a PlayerStart whose tag matches the pending spawn ("book", "door2"…), else the untagged default
	const USFGameInstance* GI = Cast<USFGameInstance>(GetGameInstance());
	const FName Want = GI && !GI->PendingSpawn.IsEmpty() ? FName(*GI->PendingSpawn) : NAME_None;
	APlayerStart* Fallback = nullptr;
	for (TActorIterator<APlayerStart> It(GetWorld()); It; ++It)
	{
		if (Want != NAME_None && (It->PlayerStartTag == Want || It->ActorHasTag(Want))) return *It;
		if (It->PlayerStartTag == NAME_None || It->PlayerStartTag == FName(TEXT("default"))) Fallback = *It;
	}
	return Fallback ? Fallback : Super::ChoosePlayerStart_Implementation(Player);
}

void ASFGameMode::StartPlay()
{
	Super::StartPlay();
	USFGameInstance* GI = Cast<USFGameInstance>(GetGameInstance());
	// one director per level, chosen by map name
	const FString Map = UGameplayStatics::GetCurrentLevelName(this);
	FActorSpawnParameters DP; DP.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	UClass* Cls = nullptr;
	if (Map == TEXT("L_Blizzard") || Map == TEXT("L_Bench")) Cls = ASFBlizzardDirector::StaticClass();
	else if (Map == TEXT("L_Library")) Cls = ASFLibraryDirector::StaticClass();
	else if (Map == TEXT("L_Park")) Cls = ASFParkDirector::StaticClass();
	else if (Map == TEXT("L_Field")) Cls = ASFFieldDirector::StaticClass();
	else if (Map == TEXT("L_Road")) Cls = ASFRoadDirector::StaticClass();
	else if (Map == TEXT("L_Red")) Cls = ASFRedDirector::StaticClass();
	if (Cls && !(GI && GI->bAutoShot && FParse::Param(FCommandLine::Get(), TEXT("noscript"))))
	{
		ASFDirector* D = GetWorld()->SpawnActor<ASFDirector>(Cls, FTransform::Identity, DP);
		if (ASFBlizzardDirector* B = Cast<ASFBlizzardDirector>(D)) B->bEnding = Map == TEXT("L_Bench");
	}
	if (GI && GI->bAutoPlay)
	{
		FActorSpawnParameters P; P.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
		GetWorld()->SpawnActor<ASFAutoPilot>(ASFAutoPilot::StaticClass(), FTransform::Identity, P);
	}
	if (GI && GI->bAutoShot)
	{
		FActorSpawnParameters P; P.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
		GetWorld()->SpawnActor<ASFAutoShot>(ASFAutoShot::StaticClass(), FTransform::Identity, P);
	}
}
