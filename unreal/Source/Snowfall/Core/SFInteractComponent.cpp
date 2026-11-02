#include "Core/SFInteractComponent.h"

USFInteractComponent::USFInteractComponent() { PrimaryComponentTick.bCanEverTick = false; }

TArray<TWeakObjectPtr<USFInteractComponent>>& USFInteractComponent::Registry()
{
	static TArray<TWeakObjectPtr<USFInteractComponent>> R;
	return R;
}
void USFInteractComponent::OnRegister() { Super::OnRegister(); Registry().AddUnique(this); }
void USFInteractComponent::OnUnregister() { Registry().Remove(this); Super::OnUnregister(); }
