#pragma once
#include "CoreMinimal.h"
#include "Widgets/SCompoundWidget.h"
#include "Widgets/DeclarativeSyntaxSupport.h"

class USFGameInstance;
class SVerticalBox;

/** Every on-screen element of the game, drawn with Slate (no binary UMG assets needed). */
class SNOWFALL_API SSFOverlay : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SSFOverlay) {}
		SLATE_ARGUMENT(USFGameInstance*, GI)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);
	virtual void Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime) override;

	// subtitles / choices / prompt
	void ShowLine(const FText& Text, const FString& Who);
	void HideLine();
	void ShowChoices(const TArray<FText>& Labels, TFunction<void(int32)> OnPick);
	void PickChoice(int32 Index);
	bool IsChoiceOpen() const { return bChoiceOpen; }
	void SetPrompt(const FText& Label, float Progress, bool bSeen);
	void ClearPrompt();
	void Hint(const FText& Text, float Seconds = 6.f);
	void SetCrosshair(bool bOn) { bCrosshair = bOn; }

	// screen effects
	FLinearColor FadeColor = FLinearColor::Black;
	float Fade = 1.f;        // 0..1
	float Letterbox = 0.f;   // 0..1

	// menus
	void ShowTitle(bool bShow, TFunction<void()> OnBegin = nullptr);
	void ShowPause(bool bShow, TFunction<void()> OnResume = nullptr, TFunction<void(FName)> OnChapter = nullptr);
	void ShowEnd(bool bClosedDoors, TFunction<void()> OnAgain);
	bool IsMenuOpen() const { return bTitle || bPause || bEnd; }
	bool IsEnded() const { return bEnd; }
	bool IsTitleOpen() const { return bTitle; }
	void RefreshTexts();

private:
	USFGameInstance* GI = nullptr;
	FSlateFontInfo SerifFont(int32 Size, bool bItalic = false) const;
	FSlateFontInfo MonoFont(int32 Size) const;
	FLinearColor WhoColor(const FString& Who) const;

	FText LineText; FString LineWho; float LineAlpha = 0.f; float LineTarget = 0.f;
	TSharedPtr<SVerticalBox> ChoiceBox; bool bChoiceOpen = false; TFunction<void(int32)> ChoiceCb; float ChoiceAlpha = 0.f;
	FText PromptLabel, PromptAct, PromptSeen; float PromptAlpha = 0.f; float PromptProgress = -1.f; bool bPromptOn = false;
	FText HintText; float HintTimer = 0.f; float HintAlpha = 0.f;
	bool bCrosshair = true;
	bool bTitle = false, bPause = false, bEnd = false, bEndClosed = false;
	float TitleAlpha = 0.f, PauseAlpha = 0.f, EndAlpha = 0.f;
	TFunction<void()> BeginCb, ResumeCb, AgainCb; TFunction<void(FName)> ChapterCb;
	TSharedPtr<SVerticalBox> ChapterBox;
	void BuildChapters();
	TSharedRef<SWidget> MakeSlider(const FText& Label, float Min, float Max, TFunction<float()> Get, TFunction<void(float)> Set);
	TSharedRef<SWidget> MakeTextButton(TAttribute<FText> Label, int32 Size, TFunction<void()> OnClick);
};
