#pragma once
#include "CoreMinimal.h"
#include "Components/SceneComponent.h"
#include "SFInteractComponent.generated.h"

DECLARE_DELEGATE_OneParam(FSFOnUse, class USFInteractComponent*);

/** Something the player can look at and use (press or hold). Registered globally so the character can pick a focus. */
UCLASS(ClassGroup = (Snowfall), meta = (BlueprintSpawnableComponent))
class SNOWFALL_API USFInteractComponent : public USceneComponent
{
	GENERATED_BODY()
public:
	USFInteractComponent();
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Interact") FString LabelKey = TEXT("p.remember");
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Interact") float HoldSeconds = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Interact") float MaxDistance = 260.f;   // cm
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Interact") float Radius = 30.f;         // cm (target size)
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Interact") float AngleSlack = 0.22f;    // rad
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Interact") bool bEnabled = true;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Interact") bool bRepeat = false;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Interact") bool bSeen = false;
	FSFOnUse OnUse;

	static TArray<TWeakObjectPtr<USFInteractComponent>>& Registry();
protected:
	virtual void OnRegister() override;
	virtual void OnUnregister() override;
};
