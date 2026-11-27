#include "UI/SFHUD.h"
#include "UI/SFOverlay.h"
#include "Core/SFGameInstance.h"
#include "Engine/GameViewportClient.h"
#include "Engine/World.h"
#include "Engine/Engine.h"
#include "GameFramework/PlayerController.h"
#include "Kismet/GameplayStatics.h"
#include "Widgets/SWeakWidget.h"

void ASFHUD::BeginPlay()
{
	Super::BeginPlay();
	USFGameInstance* GI = Cast<USFGameInstance>(GetGameInstance());
	Overlay = SNew(SSFOverlay).GI(GI);
	if (UGameViewportClient* VC = GetWorld()->GetGameViewport())
	{
		Root = SNew(SWeakWidget).PossiblyNullContent(Overlay.ToSharedRef());
		VC->AddViewportWidgetContent(Root.ToSharedRef(), 10);
	}
}
void ASFHUD::EndPlay(const EEndPlayReason::Type Reason)
{
	if (UWorld* W = GetWorld()) if (UGameViewportClient* VC = W->GetGameViewport()) if (Root.IsValid()) VC->RemoveViewportWidgetContent(Root.ToSharedRef());
	Overlay.Reset(); Root.Reset();
	Super::EndPlay(Reason);
}
SSFOverlay* ASFHUD::Get(const UObject* WorldContext)
{
	APlayerController* PC = UGameplayStatics::GetPlayerController(WorldContext, 0);
	ASFHUD* H = PC ? Cast<ASFHUD>(PC->GetHUD()) : nullptr;
	return H && H->Overlay.IsValid() ? H->Overlay.Get() : nullptr;
}
