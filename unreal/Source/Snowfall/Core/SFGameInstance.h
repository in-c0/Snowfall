#pragma once
#include "CoreMinimal.h"
#include "Engine/GameInstance.h"
#include "SFGameInstance.generated.h"

/** Persistent story state, settings, localized text and level travel. */
UCLASS()
class SNOWFALL_API USFGameInstance : public UGameInstance
{
	GENERATED_BODY()
public:
	virtual void Init() override;

	// ---- text ----
	FText T(const FString& Key) const;
	FString Who(const FString& Key) const;      // him | her | shadow | narr | radio
	FString Lang = TEXT("en");
	void SetLang(const FString& L);

	// ---- story flags ----
	bool Flag(const FName& F) const { const bool* B = Flags.Find(F); return B && *B; }
	void SetFlag(const FName& F, bool V = true) { Flags.Add(F, V); SaveProgress(); }
	TMap<FName, bool> Flags;

	// ---- settings ----
	float MasterVol = 0.9f, MusicVol = 0.8f, SfxVol = 0.9f, Brightness = 1.f, Sensitivity = 1.f, SubtitleScale = 1.f;
	int32 Quality = 3; // 0..3 maps to sg.* scalability
	void ApplySettings();
	void SaveProgress() const;
	void LoadProgress();

	// ---- travel ----
	/** Arrival spot in the next level (e.g. "book", "door2"). */
	FString PendingSpawn;
	bool bStarted = false;          // title dismissed
	bool bSkipTitle = false;
	void Travel(const UObject* Ctx, FName Level, const FString& Spawn = FString());

	// ---- automated verification ----
	bool bAutoShot = false;
	bool bAutoPlay = false; float AutoPlaySpeed = 2.f; double AutoPlayStart = 0.0; int32 AutoPlayShot = 0; int32 AutoPlayChoice = 0;
	float AutoShotDelay = 6.f;
	TArray<FString> AutoShotLevels;
	int32 AutoShotIndex = 0;
	FString AutoShotTag;

private:
	struct FLine { FString En, Ko; };
	TMap<FString, FLine> Text;
	void LoadText();
};
