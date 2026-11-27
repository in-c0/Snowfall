#include "Core/SFAudio.h"
#include "Core/SFGameInstance.h"
#include "Snowfall.h"
#include "Sound/SoundBase.h"
#include "Sound/SoundWave.h"
#include "Components/AudioComponent.h"
#include "Kismet/GameplayStatics.h"
#include "Engine/World.h"

namespace
{
	TMap<FString, TWeakObjectPtr<USoundBase>> GCache;
	TWeakObjectPtr<UAudioComponent> GMusic; FString GMusicName;
	TMap<FString, TWeakObjectPtr<UAudioComponent>> GAmb;
	USFGameInstance* GI(const UObject* C) { return C ? Cast<USFGameInstance>(UGameplayStatics::GetGameInstance(C)) : nullptr; }
}

USoundBase* FSFAudio::Load(const FString& Name)
{
	if (TWeakObjectPtr<USoundBase>* P = GCache.Find(Name)) if (P->IsValid()) return P->Get();
	FString Short = FPaths::GetBaseFilename(Name);
	const FString Path = FString::Printf(TEXT("/Game/Audio/%s.%s"), *Name, *Short);
	USoundBase* S = LoadObject<USoundBase>(nullptr, *Path);
	if (!S) UE_LOG(LogSnowfall, Warning, TEXT("Sound not found: %s"), *Path);
	GCache.Add(Name, S);
	return S;
}
float FSFAudio::SfxScale(const UObject* C) { const USFGameInstance* G = GI(C); return G ? G->MasterVol * G->SfxVol : 1.f; }
float FSFAudio::MusicScale(const UObject* C) { const USFGameInstance* G = GI(C); return G ? G->MasterVol * G->MusicVol : 1.f; }

void FSFAudio::Sfx(const UObject* C, const FString& Name, float Volume, float Pitch)
{
	if (USoundBase* S = Load(Name)) UGameplayStatics::PlaySound2D(C, S, Volume * SfxScale(C), Pitch);
}
void FSFAudio::SfxAt(const UObject* C, const FString& Name, const FVector& Loc, float Volume, float Pitch)
{
	if (USoundBase* S = Load(Name)) UGameplayStatics::PlaySoundAtLocation(C, S, Loc, Volume * SfxScale(C), Pitch);
}
void FSFAudio::Step(const UObject* C, const FString& Surface, float Volume)
{
	const int32 I = FMath::RandRange(0, 5);
	Sfx(C, FString::Printf(TEXT("SFX/SFX_Step_%s_%d"), *Surface, I), Volume, FMath::FRandRange(0.9f, 1.1f));
}
void FSFAudio::Music(const UObject* C, const FString& Piece, float FadeIn)
{
	if (GMusic.IsValid() && GMusicName == Piece && GMusic->IsPlaying()) return;
	StopMusic(C, 2.5f);
	USoundBase* S = Load(TEXT("Music/MU_") + Piece);
	if (!S) return;
	if (USoundWave* W = Cast<USoundWave>(S)) W->bLooping = true;
	UAudioComponent* A = UGameplayStatics::SpawnSound2D(C, S, MusicScale(C), 1.f, 0.f, nullptr, false, false);
	if (A) { A->FadeIn(FadeIn, MusicScale(C)); GMusic = A; GMusicName = Piece; }
}
void FSFAudio::StopMusic(const UObject* C, float Fade)
{
	if (GMusic.IsValid()) GMusic->FadeOut(Fade, 0.f);
	GMusic = nullptr; GMusicName.Reset();
}
void FSFAudio::Amb(const UObject* C, const FString& Name, float Level, float Fade)
{
	TWeakObjectPtr<UAudioComponent>* Ex = GAmb.Find(Name);
	if (Ex && Ex->IsValid() && (*Ex)->GetWorld() == C->GetWorld())
	{
		if (Level <= 0.001f) { (*Ex)->FadeOut(Fade, 0.f); GAmb.Remove(Name); }
		else (*Ex)->AdjustVolume(Fade, Level * SfxScale(C));
		return;
	}
	if (Level <= 0.001f) return;
	USoundBase* S = Load(FString::Printf(TEXT("Amb/AMB_%s_loop"), *Name));
	if (!S) return;
	if (USoundWave* W = Cast<USoundWave>(S)) W->bLooping = true;
	UAudioComponent* A = UGameplayStatics::SpawnSound2D(C, S, Level * SfxScale(C), 1.f, FMath::FRandRange(0.f, 10.f), nullptr, false, false);
	if (A) { A->FadeIn(Fade, Level * SfxScale(C)); GAmb.Add(Name, A); }
}
void FSFAudio::StopAllAmb(const UObject* C, float Fade)
{
	for (auto& P : GAmb) if (P.Value.IsValid()) P.Value->FadeOut(Fade, 0.f);
	GAmb.Empty();
}
