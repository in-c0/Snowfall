#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "InputActionValue.h"
#include "SFCharacter.generated.h"

class UCameraComponent;
class UInputAction;
class UInputMappingContext;
class USFInteractComponent;
class USoundBase;

/** First-person walker: soft acceleration, head bob, footsteps by surface, yaw limits, look-to-interact. */
UCLASS()
class SNOWFALL_API ASFCharacter : public ACharacter
{
	GENERATED_BODY()
public:
	ASFCharacter();
	virtual void Tick(float Dt) override;
	virtual void SetupPlayerInputComponent(UInputComponent* PIC) override;
	virtual void BeginPlay() override;

	UPROPERTY(VisibleAnywhere) UCameraComponent* Camera;

	// tuning (cm/s)
	float WalkSpeed = 200.f, RunSpeed = 380.f;
	bool bCanMove = true, bCanLook = true, bRunHeld = false;
	float SpeedScale = 1.f;
	/** Optional yaw limit around Center (degrees). */
	bool bYawLimit = false; float YawCenter = 0.f, YawRange = 55.f;
	float PitchMin = -75.f, PitchMax = 75.f;
	float EyeHeight = 162.f, EyeTarget = 162.f;
	float Shake = 0.f, Roll = 0.f, BobScale = 1.f;
	/** "snow" | "wood" | "leaves" | "grass" | "stone" */
	FString Surface = TEXT("snow");
	float StepGain = 0.55f, StepReverb = 0.f;
	float Moved = 0.f;           // metres walked (for scripted beats)
	float CurrentSpeed = 0.f;    // cm/s

	// interaction
	USFInteractComponent* Focus = nullptr;
	float HoldT = 0.f;
	bool bInteractHeld = false, bInteractPressed = false, bAdvancePressed = false;
	bool bBlockInteract = false;
	bool AnyMoveInput() const { return MoveInput.SizeSquared() > 0.01f; }
	float MoveInput_Forward() const { return MoveInput.Y; }
	float MoveInput_Right() const { return MoveInput.X; }

	void SetLookRotation(float Yaw, float Pitch);
	/** Markers from the three.js export are either feet positions or camera (eye) positions. */
	void PlaceFeetAt(const FVector& Feet);
	/** Puts the eye exactly at Eye (scripted close-ups, e.g. lying beside her); freezes walking + collision. */
	void PlaceEyeAt(const FVector& Eye);
	float GetYaw() const;
	/** Autopilot input (same effect as the player's keys). */
	void AutoInput(const FVector2D& Move, bool bHeld, bool bPressed) { MoveInput = Move; bInteractHeld = bHeld; if (bPressed) { bInteractPressed = true; bAdvancePressed = true; } }

public:
	void PauseToggle2() { PauseToggle(FInputActionValue()); }
protected:
	void Move(const FInputActionValue& V);
	void MoveDone(const FInputActionValue& V) { MoveInput = FVector2D::ZeroVector; }
	void Look(const FInputActionValue& V);
	void InteractDown(const FInputActionValue& V);
	void InteractUp(const FInputActionValue& V) { bInteractHeld = false; }
	void PauseToggle(const FInputActionValue& V);
	void RunDown(const FInputActionValue& V) { bRunHeld = true; }
	void RunUp(const FInputActionValue& V) { bRunHeld = false; }
	void Choice1(const FInputActionValue& V) { PickChoice(0); }
	void Choice2(const FInputActionValue& V) { PickChoice(1); }
	void Choice3(const FInputActionValue& V) { PickChoice(2); }
	void PickChoice(int32 I);
	void UpdateInteraction(float Dt);
	void UpdateFootsteps(float Dt);

	UPROPERTY() UInputMappingContext* Ctx;
	UPROPERTY() UInputAction* MoveAct; UPROPERTY() UInputAction* LookAct; UPROPERTY() UInputAction* RunAct;
	UPROPERTY() UInputAction* UseAct; UPROPERTY() UInputAction* PauseAct;
	UPROPERTY() UInputAction* C1Act; UPROPERTY() UInputAction* C2Act; UPROPERTY() UInputAction* C3Act;
	FVector2D MoveInput = FVector2D::ZeroVector;
	float StepPhase = 0.f; FVector LastPos;
	float BobT = 0.f;
};
