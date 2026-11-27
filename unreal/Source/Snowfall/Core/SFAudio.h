#pragma once
#include "CoreMinimal.h"
class UAudioComponent; class USoundBase;

/** Thin helpers over imported SoundWaves in /Game/Audio (music, ambience loops, one-shots). Volumes follow the player's settings. */
struct SNOWFALL_API FSFAudio
{
	static USoundBase* Load(const FString& Name);                    // e.g. "SFX/SFX_Bell", "Music/MU_her"
	static void Sfx(const UObject* Ctx, const FString& Name, float Volume = 1.f, float Pitch = 1.f);
	static void SfxAt(const UObject* Ctx, const FString& Name, const FVector& Loc, float Volume = 1.f, float Pitch = 1.f);
	static void Step(const UObject* Ctx, const FString& Surface, float Volume);
	/** Starts (or crossfades to) a music track; loops. */
	static void Music(const UObject* Ctx, const FString& Piece, float FadeIn = 3.f);
	static void StopMusic(const UObject* Ctx, float Fade = 2.f);
	/** Sets an ambience loop's level (0 stops it). */
	static void Amb(const UObject* Ctx, const FString& Name, float Level, float Fade = 2.f);
	static void StopAllAmb(const UObject* Ctx, float Fade = 2.f);
	static float SfxScale(const UObject* Ctx);
	static float MusicScale(const UObject* Ctx);
};
