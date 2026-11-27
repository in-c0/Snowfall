#pragma once
#include "CoreMinimal.h"
#include "Story/SFDirector.h"
#include "SFLevelDirectors.generated.h"

class ASFSnowfall; class ASFFigure; class USFInteractComponent; class UPointLightComponent; class UMaterialInstanceDynamic; class ACameraActor;

/** The garden you wake in, the library of memories, the bedroom: story hub (book, window, globe, cherries, radio, red doors, reunion). */
UCLASS()
class SNOWFALL_API ASFLibraryDirector : public ASFDirector
{
	GENERATED_BODY()
protected:
	virtual void Script() override;
	virtual void Tick(float Dt) override;
	void Refresh();
	void WakeUp();
	void Memory(FName Level);
	void CherryMemory();
	void RadioSpeaks();
	void Reunion();
	void AfterReturn();
	TMap<FString, USFInteractComponent*> Items;
	UPROPERTY() ASFFigure* Her = nullptr;
	UPROPERTY() ASFSnowfall* Snow = nullptr;
	UPROPERTY() AActor* Lure = nullptr;
	FVector LureTarget; bool bLure = false;
	bool bInReunion = false, bSaidBottle = false, bSaidDoor = false;
	bool Has(const TCHAR* F) const;
public:
	virtual bool AutoTarget(FVector& Out) const override { if (bLure) { Out = LureTarget; return true; } return false; }
};

UCLASS() class SNOWFALL_API ASFParkDirector : public ASFDirector { GENERATED_BODY() protected: virtual void Script() override; virtual void Tick(float Dt) override;
	UPROPERTY() ASFFigure* Her = nullptr; UPROPERTY() AActor* Chair = nullptr; TArray<FVector> Path; float S = 0.f, Speed = 0.f, MaxV = 0.85f; bool bPushing = false; };
UCLASS() class SNOWFALL_API ASFFieldDirector : public ASFDirector { GENERATED_BODY() public: virtual bool AutoTarget(FVector& Out) const override; protected: virtual void Script() override; virtual void Tick(float Dt) override;
	UPROPERTY() ASFFigure* Her = nullptr; UPROPERTY() AActor* Chair = nullptr; float Ph = 0.f, Spd = 0.f, ChaseT = 0.f; bool bChase = false, bCaught = false; FVector Center; };
UCLASS() class SNOWFALL_API ASFRoadDirector : public ASFDirector { GENERATED_BODY() protected: virtual void Script() override; virtual void Tick(float Dt) override;
	UPROPERTY() ASFFigure* Him = nullptr; UPROPERTY() ACameraActor* Cam = nullptr; UPROPERTY() AActor* FarGlow = nullptr; int32 Pass = 1; bool bLeaving = false; FVector Start, End; float Along = 0.f, Side = 0.f, CamYaw = 0.f; };
UCLASS() class SNOWFALL_API ASFRedDirector : public ASFDirector { GENERATED_BODY() public: virtual bool AutoTarget(FVector& Out) const override { Out = Marker(TEXT("HerBed")); return true; } protected: virtual void Script() override; virtual void Tick(float Dt) override;
	UPROPERTY() ASFFigure* Her = nullptr; int32 Frag = 1; float Heart = 0.f; };
