#pragma once
#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "SFHUD.generated.h"

class SSFOverlay;

UCLASS()
class SNOWFALL_API ASFHUD : public AHUD
{
	GENERATED_BODY()
public:
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type Reason) override;
	TSharedPtr<SSFOverlay> Overlay;
	static SSFOverlay* Get(const UObject* WorldContext);
private:
	TSharedPtr<class SWidget> Root;
};
