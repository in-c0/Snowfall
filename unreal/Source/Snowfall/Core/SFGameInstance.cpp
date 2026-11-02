#include "Core/SFGameInstance.h"
#include "Snowfall.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Misc/CommandLine.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Dom/JsonObject.h"
#include "Kismet/GameplayStatics.h"
#include "GameFramework/GameUserSettings.h"
#include "Engine/Engine.h"

void USFGameInstance::Init()
{
	Super::Init();
	LoadText();
	LoadProgress();
	// -autoshot -shotlevels=L_Blizzard+L_Library -shotdelay=6 -shottag=run3
	bAutoShot = FParse::Param(FCommandLine::Get(), TEXT("autoshot"));
	FString Levels;
	if (FParse::Value(FCommandLine::Get(), TEXT("shotlevels="), Levels)) Levels.ParseIntoArray(AutoShotLevels, TEXT("+"));
	FParse::Value(FCommandLine::Get(), TEXT("shotdelay="), AutoShotDelay);
	FParse::Value(FCommandLine::Get(), TEXT("shottag="), AutoShotTag);
	FString L;
	if (FParse::Value(FCommandLine::Get(), TEXT("lang="), L)) Lang = L;
	bAutoPlay = FParse::Param(FCommandLine::Get(), TEXT("autoplay"));
	FParse::Value(FCommandLine::Get(), TEXT("autoplayspeed="), AutoPlaySpeed);
	FParse::Value(FCommandLine::Get(), TEXT("autochoice="), AutoPlayChoice);
	if (bAutoPlay && AutoShotTag.IsEmpty()) AutoShotTag = TEXT("play");
	bSkipTitle = bAutoShot || bAutoPlay || FParse::Param(FCommandLine::Get(), TEXT("notitle"));
	if (bSkipTitle) bStarted = true;
	FString Fl;
	if (FParse::Value(FCommandLine::Get(), TEXT("flags="), Fl))
	{
		TArray<FString> Parts; Fl.ParseIntoArray(Parts, TEXT("+"));
		for (const FString& P : Parts) Flags.Add(FName(*P), true);
	}
	ApplySettings();
}

void USFGameInstance::LoadText()
{
	const FString Path = FPaths::ProjectContentDir() / TEXT("Data/script.json");
	FString Json;
	if (!FFileHelper::LoadFileToString(Json, *Path)) { UE_LOG(LogSnowfall, Error, TEXT("Missing %s"), *Path); return; }
	TSharedPtr<FJsonObject> Root;
	const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Json);
	if (!FJsonSerializer::Deserialize(Reader, Root) || !Root.IsValid()) { UE_LOG(LogSnowfall, Error, TEXT("Bad script.json")); return; }
	for (const auto& Pair : Root->Values)
	{
		const TSharedPtr<FJsonObject>* Obj;
		if (Pair.Value->TryGetObject(Obj))
		{
			FLine Line;
			(*Obj)->TryGetStringField(TEXT("en"), Line.En);
			(*Obj)->TryGetStringField(TEXT("ko"), Line.Ko);
			Text.Add(FString(*Pair.Key), Line);
		}
	}
	UE_LOG(LogSnowfall, Log, TEXT("Loaded %d lines"), Text.Num());
}

FText USFGameInstance::T(const FString& Key) const
{
	const FLine* L = Text.Find(Key);
	if (!L) return FText::FromString(Key);
	return FText::FromString(Lang == TEXT("ko") && !L->Ko.IsEmpty() ? L->Ko : L->En);
}

FString USFGameInstance::Who(const FString& Key) const
{
	FString Left, Right;
	if (!Key.Split(TEXT("."), &Left, &Right)) return TEXT("narr");
	FString W = Right; int32 U;
	if (Right.FindChar(TEXT('_'), U)) W = Right.Left(U);
	return W;
}

void USFGameInstance::SetLang(const FString& L) { Lang = L; SaveProgress(); }

void USFGameInstance::ApplySettings()
{
	if (UGameUserSettings* S = GEngine ? GEngine->GetGameUserSettings() : nullptr)
	{
		S->SetOverallScalabilityLevel(FMath::Clamp(Quality, 0, 3));
		S->ApplySettings(false);
	}
}

void USFGameInstance::SaveProgress() const
{
	TSharedRef<FJsonObject> Root = MakeShared<FJsonObject>();
	TSharedRef<FJsonObject> F = MakeShared<FJsonObject>();
	for (const auto& P : Flags) F->SetBoolField(P.Key.ToString(), P.Value);
	Root->SetObjectField(TEXT("flags"), F);
	Root->SetStringField(TEXT("lang"), Lang);
	Root->SetNumberField(TEXT("master"), MasterVol); Root->SetNumberField(TEXT("music"), MusicVol); Root->SetNumberField(TEXT("sfx"), SfxVol);
	Root->SetNumberField(TEXT("bright"), Brightness); Root->SetNumberField(TEXT("sens"), Sensitivity); Root->SetNumberField(TEXT("sub"), SubtitleScale);
	Root->SetNumberField(TEXT("quality"), Quality);
	FString Out; const TSharedRef<TJsonWriter<>> W = TJsonWriterFactory<>::Create(&Out);
	FJsonSerializer::Serialize(Root, W);
	FFileHelper::SaveStringToFile(Out, *(FPaths::ProjectSavedDir() / TEXT("snowfall_progress.json")));
}

void USFGameInstance::LoadProgress()
{
	FString Json;
	if (!FFileHelper::LoadFileToString(Json, *(FPaths::ProjectSavedDir() / TEXT("snowfall_progress.json")))) return;
	TSharedPtr<FJsonObject> Root;
	if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Json), Root) || !Root.IsValid()) return;
	Root->TryGetStringField(TEXT("lang"), Lang);
	double V;
	if (Root->TryGetNumberField(TEXT("master"), V)) MasterVol = V;
	if (Root->TryGetNumberField(TEXT("music"), V)) MusicVol = V;
	if (Root->TryGetNumberField(TEXT("sfx"), V)) SfxVol = V;
	if (Root->TryGetNumberField(TEXT("bright"), V)) Brightness = V;
	if (Root->TryGetNumberField(TEXT("sens"), V)) Sensitivity = V;
	if (Root->TryGetNumberField(TEXT("sub"), V)) SubtitleScale = V;
	if (Root->TryGetNumberField(TEXT("quality"), V)) Quality = (int32)V;
	// chapter unlocks persist; in-progress story flags restart with a new run
	const TSharedPtr<FJsonObject>* F;
	if (Root->TryGetObjectField(TEXT("flags"), F))
		for (const auto& P : (*F)->Values) { const FString K(*P.Key); if (K.StartsWith(TEXT("ch_"))) Flags.Add(FName(*K), P.Value->AsBool()); }
}

void USFGameInstance::Travel(const UObject* Ctx, FName Level, const FString& Spawn)
{
	PendingSpawn = Spawn;
	SetFlag(FName(*(TEXT("ch_") + Level.ToString())), true);
	UGameplayStatics::OpenLevel(Ctx, Level, true);
}
