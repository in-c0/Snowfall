#pragma once
#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "SFGameMode.generated.h"

UCLASS()
class SNOWFALL_API ASFGameMode : public AGameModeBase
{
	GENERATED_BODY()
public:
	ASFGameMode();
	virtual AActor* ChoosePlayerStart_Implementation(AController* Player) override;
	virtual void StartPlay() override;
};
