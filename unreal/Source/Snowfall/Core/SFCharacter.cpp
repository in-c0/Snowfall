#include "Core/SFCharacter.h"
#include "Core/SFInteractComponent.h"
#include "Core/SFGameInstance.h"
#include "Core/SFAudio.h"
#include "UI/SFHUD.h"
#include "UI/SFOverlay.h"
#include "Camera/CameraComponent.h"
#include "Components/CapsuleComponent.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "GameFramework/PlayerController.h"
#include "EnhancedInputComponent.h"
#include "EnhancedInputSubsystems.h"
#include "InputMappingContext.h"
#include "InputAction.h"
#include "InputModifiers.h"
#include "Kismet/GameplayStatics.h"
#include "Engine/LocalPlayer.h"

ASFCharacter::ASFCharacter()
{
	PrimaryActorTick.bCanEverTick = true;
	GetCapsuleComponent()->InitCapsuleSize(30.f, 92.f);
	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
	Camera->SetupAttachment(GetCapsuleComponent());
	Camera->SetRelativeLocation(FVector(0, 0, EyeHeight - 92.f));
	Camera->bUsePawnControlRotation = true;
	Camera->SetFieldOfView(70.f);
	Camera->PostProcessSettings.bOverride_MotionBlurAmount = true; Camera->PostProcessSettings.MotionBlurAmount = 0.35f;
	bUseControllerRotationYaw = true;
	UCharacterMovementComponent* M = GetCharacterMovement();
	M->MaxWalkSpeed = WalkSpeed; M->BrakingDecelerationWalking = 900.f; M->MaxAcceleration = 900.f;
	M->GroundFriction = 6.f; M->NavAgentProps.bCanCrouch = false; M->SetWalkableFloorAngle(50.f);
	M->MaxStepHeight = 30.f;
}

void ASFCharacter::BeginPlay()
{
	Super::BeginPlay();
	LastPos = GetActorLocation();
}

void ASFCharacter::SetupPlayerInputComponent(UInputComponent* PIC)
{
	Super::SetupPlayerInputComponent(PIC);
	Ctx = NewObject<UInputMappingContext>(this);
	auto Act = [this](EInputActionValueType T) { UInputAction* A = NewObject<UInputAction>(this); A->ValueType = T; return A; };
	MoveAct = Act(EInputActionValueType::Axis2D); LookAct = Act(EInputActionValueType::Axis2D);
	RunAct = Act(EInputActionValueType::Boolean); UseAct = Act(EInputActionValueType::Boolean); PauseAct = Act(EInputActionValueType::Boolean);
	C1Act = Act(EInputActionValueType::Boolean); C2Act = Act(EInputActionValueType::Boolean); C3Act = Act(EInputActionValueType::Boolean);
	auto Map = [this](UInputAction* A, const FKey& K, bool bSwizzle = false, bool bNegate = false)
	{
		FEnhancedActionKeyMapping& M = Ctx->MapKey(A, K);
		if (bSwizzle) { UInputModifierSwizzleAxis* S = NewObject<UInputModifierSwizzleAxis>(this); S->Order = EInputAxisSwizzle::YXZ; M.Modifiers.Add(S); }
		if (bNegate) { M.Modifiers.Add(NewObject<UInputModifierNegate>(this)); }
	};
	// move: X = right, Y = forward
	Map(MoveAct, EKeys::W, true); Map(MoveAct, EKeys::Up, true);
	Map(MoveAct, EKeys::S, true, true); Map(MoveAct, EKeys::Down, true, true);
	Map(MoveAct, EKeys::D); Map(MoveAct, EKeys::Right);
	Map(MoveAct, EKeys::A, false, true); Map(MoveAct, EKeys::Left, false, true);
	Map(MoveAct, EKeys::Gamepad_Left2D);
	Map(LookAct, EKeys::Mouse2D); Map(LookAct, EKeys::Gamepad_Right2D);
	Map(RunAct, EKeys::LeftShift); Map(RunAct, EKeys::Gamepad_LeftThumbstick);
	Map(UseAct, EKeys::E); Map(UseAct, EKeys::LeftMouseButton); Map(UseAct, EKeys::SpaceBar); Map(UseAct, EKeys::Enter); Map(UseAct, EKeys::Gamepad_FaceButton_Bottom);
	Map(PauseAct, EKeys::Escape); Map(PauseAct, EKeys::P); Map(PauseAct, EKeys::Gamepad_Special_Right);
	Map(C1Act, EKeys::One); Map(C2Act, EKeys::Two); Map(C3Act, EKeys::Three);

	if (APlayerController* PC = Cast<APlayerController>(GetController()))
		if (ULocalPlayer* LP = PC->GetLocalPlayer())
			if (UEnhancedInputLocalPlayerSubsystem* Sub = LP->GetSubsystem<UEnhancedInputLocalPlayerSubsystem>())
				Sub->AddMappingContext(Ctx, 0);

	if (UEnhancedInputComponent* EI = Cast<UEnhancedInputComponent>(PIC))
	{
		EI->BindAction(MoveAct, ETriggerEvent::Triggered, this, &ASFCharacter::Move);
		EI->BindAction(MoveAct, ETriggerEvent::Completed, this, &ASFCharacter::MoveDone);
		EI->BindAction(LookAct, ETriggerEvent::Triggered, this, &ASFCharacter::Look);
		EI->BindAction(RunAct, ETriggerEvent::Started, this, &ASFCharacter::RunDown);
		EI->BindAction(RunAct, ETriggerEvent::Completed, this, &ASFCharacter::RunUp);
		EI->BindAction(UseAct, ETriggerEvent::Started, this, &ASFCharacter::InteractDown);
		EI->BindAction(UseAct, ETriggerEvent::Completed, this, &ASFCharacter::InteractUp);
		EI->BindAction(PauseAct, ETriggerEvent::Started, this, &ASFCharacter::PauseToggle);
		EI->BindAction(C1Act, ETriggerEvent::Started, this, &ASFCharacter::Choice1);
		EI->BindAction(C2Act, ETriggerEvent::Started, this, &ASFCharacter::Choice2);
		EI->BindAction(C3Act, ETriggerEvent::Started, this, &ASFCharacter::Choice3);
	}
}

void ASFCharacter::Move(const FInputActionValue& V) { MoveInput = V.Get<FVector2D>(); }

void ASFCharacter::Look(const FInputActionValue& V)
{
	if (!bCanLook || !Controller) return;
	SSFOverlay* O = ASFHUD::Get(this);
	if (O && (O->IsChoiceOpen() || O->IsMenuOpen())) return;
	const USFGameInstance* GI = Cast<USFGameInstance>(GetGameInstance());
	const float S = (GI ? GI->Sensitivity : 1.f) * 0.11f;
	const FVector2D D = V.Get<FVector2D>();
	FRotator R = Controller->GetControlRotation();
	R.Yaw += D.X * S * 10.f / 10.f;
	float P = FRotator::NormalizeAxis(R.Pitch) + D.Y * S;
	R.Pitch = FMath::Clamp(P, PitchMin, PitchMax);
	Controller->SetControlRotation(R);
}

void ASFCharacter::PlaceFeetAt(const FVector& Feet)
{
	SetActorLocation(Feet + FVector(0, 0, GetCapsuleComponent()->GetScaledCapsuleHalfHeight() + 1.f), false, nullptr, ETeleportType::TeleportPhysics);
}

void ASFCharacter::PlaceEyeAt(const FVector& Eye)
{
	GetCharacterMovement()->DisableMovement();
	SetActorEnableCollision(false);
	SetActorLocation(Eye - FVector(0, 0, EyeHeight - GetCapsuleComponent()->GetScaledCapsuleHalfHeight()), false, nullptr, ETeleportType::TeleportPhysics);
}

void ASFCharacter::SetLookRotation(float Yaw, float Pitch)
{
	if (Controller) Controller->SetControlRotation(FRotator(Pitch, Yaw, 0.f));
}
float ASFCharacter::GetYaw() const { return Controller ? Controller->GetControlRotation().Yaw : GetActorRotation().Yaw; }

void ASFCharacter::InteractDown(const FInputActionValue& V)
{
	SSFOverlay* O = ASFHUD::Get(this);
	if (O && O->IsMenuOpen()) return;
	bInteractHeld = true; bInteractPressed = true; bAdvancePressed = true;
}

void ASFCharacter::PickChoice(int32 I) { if (SSFOverlay* O = ASFHUD::Get(this)) O->PickChoice(I); }

void ASFCharacter::PauseToggle(const FInputActionValue& V)
{
	SSFOverlay* O = ASFHUD::Get(this);
	APlayerController* PC = Cast<APlayerController>(GetController());
	USFGameInstance* GI = Cast<USFGameInstance>(GetGameInstance());
	if (!O || !PC || !GI || !GI->bStarted) return;
	const bool bNow = !UGameplayStatics::IsGamePaused(this);
	UGameplayStatics::SetGamePaused(this, bNow);
	PC->bShowMouseCursor = bNow;
	if (bNow) PC->SetInputMode(FInputModeGameAndUI()); else PC->SetInputMode(FInputModeGameOnly());
	TWeakObjectPtr<ASFCharacter> Self(this);
	O->ShowPause(bNow,
		[Self]() { if (Self.IsValid()) Self->PauseToggle(FInputActionValue()); },
		[Self, GI](FName Level) { if (!Self.IsValid()) return; UGameplayStatics::SetGamePaused(Self.Get(), false); GI->Travel(Self.Get(), Level); });
}

void ASFCharacter::Tick(float Dt)
{
	Super::Tick(Dt);
	SSFOverlay* O = ASFHUD::Get(this);
	const bool bUI = O && (O->IsChoiceOpen() || O->IsMenuOpen());
	if (APlayerController* PC = Cast<APlayerController>(GetController()))
	{
		const bool bWantCursor = bUI;
		if (PC->bShowMouseCursor != bWantCursor) { PC->bShowMouseCursor = bWantCursor; if (bWantCursor) PC->SetInputMode(FInputModeGameAndUI()); else PC->SetInputMode(FInputModeGameOnly()); }
	}
	// movement
	UCharacterMovementComponent* M = GetCharacterMovement();
	M->MaxWalkSpeed = (bRunHeld ? RunSpeed : WalkSpeed) * SpeedScale;
	if (bCanMove && !bUI && Controller)
	{
		const FRotator Yaw(0, Controller->GetControlRotation().Yaw, 0);
		AddMovementInput(FRotationMatrix(Yaw).GetUnitAxis(EAxis::X), MoveInput.Y);
		AddMovementInput(FRotationMatrix(Yaw).GetUnitAxis(EAxis::Y), MoveInput.X);
	}
	// yaw limit (soft wall)
	if (bYawLimit && Controller)
	{
		FRotator R = Controller->GetControlRotation();
		float D = FRotator::NormalizeAxis(R.Yaw - YawCenter);
		if (FMath::Abs(D) > YawRange) D = FMath::Sign(D) * (YawRange + (FMath::Abs(D) - YawRange) * 0.15f);
		D = FMath::Clamp(D, -YawRange * 1.12f, YawRange * 1.12f);
		R.Yaw = YawCenter + D;
		Controller->SetControlRotation(R);
	}
	// distance + head bob + footsteps
	const FVector P = GetActorLocation();
	const float Step = FVector::Dist2D(P, LastPos);
	LastPos = P;
	Moved += Step / 100.f;
	CurrentSpeed = Step / FMath::Max(Dt, 1e-4f);
	UpdateFootsteps(Step);
	EyeHeight = FMath::FInterpTo(EyeHeight, EyeTarget, Dt, 3.f);
	const float K = FMath::Min(CurrentSpeed / 250.f, 1.f) * BobScale;
	BobT += Dt;
	const FVector Bob(0, FMath::Cos(StepPhase * 0.5f) * 2.f * K, FMath::Sin(StepPhase) * 3.5f * K + FMath::Sin(BobT * 0.9f) * 0.4f);
	FVector ShakeV = Shake > 0.f ? FVector(FMath::FRandRange(-1.f, 1.f), FMath::FRandRange(-1.f, 1.f), FMath::FRandRange(-1.f, 1.f)) * Shake * 40.f : FVector::ZeroVector;
	Camera->SetRelativeLocation(FVector(0, 0, EyeHeight - 92.f) + Bob + ShakeV);
	Camera->SetRelativeRotation(FRotator(0, 0, Roll));
	UpdateInteraction(Dt);
	bInteractPressed = false;
}

void ASFCharacter::UpdateFootsteps(float StepCm)
{
	const float Prev = StepPhase;
	StepPhase += StepCm / 100.f * 1.15f * PI / 1.f * 0.35f * 3.f;
	if (FMath::FloorToInt(Prev / PI) != FMath::FloorToInt(StepPhase / PI) && CurrentSpeed > 30.f)
		FSFAudio::Step(this, Surface, StepGain * FMath::Clamp(0.5f + CurrentSpeed / 300.f, 0.5f, 1.2f));
}

void ASFCharacter::UpdateInteraction(float Dt)
{
	SSFOverlay* O = ASFHUD::Get(this);
	USFInteractComponent* Best = nullptr; float BestScore = 1e9f;
	const bool bUI = O && (O->IsChoiceOpen() || O->IsMenuOpen());
	if (bCanLook && !bUI && !bBlockInteract)
	{
		const FVector Eye = Camera->GetComponentLocation();
		const FVector Fwd = Camera->GetForwardVector();
		for (const TWeakObjectPtr<USFInteractComponent>& W : USFInteractComponent::Registry())
		{
			USFInteractComponent* I = W.Get();
			if (!I || !I->bEnabled || I->GetWorld() != GetWorld()) continue;
			const FVector D = I->GetComponentLocation() - Eye;
			const float Dist = D.Size();
			if (Dist > I->MaxDistance) continue;
			const float Ang = FMath::Acos(FMath::Clamp(FVector::DotProduct(D / FMath::Max(Dist, 1.f), Fwd), -1.f, 1.f));
			const float Lim = I->AngleSlack + FMath::Atan2(I->Radius, Dist);
			if (Ang > Lim) continue;
			const float Score = Ang + Dist * 0.0005f;
			if (Score < BestScore) { BestScore = Score; Best = I; }
		}
	}
	USFGameInstance* GI = Cast<USFGameInstance>(GetGameInstance());
	if (Best != Focus) { Focus = Best; HoldT = 0.f; if (O) { if (Best) O->SetPrompt(GI ? GI->T(Best->LabelKey) : FText(), Best->HoldSeconds > 0 ? 0.f : -1.f, Best->bSeen); else O->ClearPrompt(); } }
	if (!Focus) return;
	if (Focus->HoldSeconds > 0.f)
	{
		if (bInteractHeld)
		{
			HoldT += Dt;
			if (O) O->SetPrompt(GI ? GI->T(Focus->LabelKey) : FText(), FMath::Min(HoldT / Focus->HoldSeconds, 1.f), Focus->bSeen);
			if (HoldT >= Focus->HoldSeconds)
			{
				USFInteractComponent* It = Focus; Focus = nullptr; HoldT = 0.f; if (O) O->ClearPrompt();
				It->bEnabled = It->bRepeat;
				It->OnUse.ExecuteIfBound(It);
			}
		}
		else if (HoldT > 0.f) { HoldT = FMath::Max(0.f, HoldT - Dt * 2.f); if (O) O->SetPrompt(GI ? GI->T(Focus->LabelKey) : FText(), HoldT / Focus->HoldSeconds, Focus->bSeen); }
	}
	else if (bInteractPressed)
	{
		USFInteractComponent* It = Focus; Focus = nullptr; if (O) O->ClearPrompt();
		It->bEnabled = It->bRepeat;
		It->OnUse.ExecuteIfBound(It);
	}
}
