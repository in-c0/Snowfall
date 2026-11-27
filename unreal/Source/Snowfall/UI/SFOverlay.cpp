#include "UI/SFOverlay.h"
#include "Core/SFGameInstance.h"
#include "Widgets/SOverlay.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SSpacer.h"
#include "Widgets/Text/STextBlock.h"
#include "Widgets/Input/SButton.h"
#include "Widgets/Input/SSlider.h"
#include "Widgets/Images/SImage.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/Notifications/SProgressBar.h"
#include "Styling/CoreStyle.h"
#include "Misc/Paths.h"

#define LOCTEXT_NAMESPACE "Snowfall"

static const FLinearColor Snow(0.87f, 0.89f, 0.92f, 1.f);
static const FLinearColor Ash(0.32f, 0.35f, 0.39f, 1.f);
static const FLinearColor Ember(0.89f, 0.68f, 0.46f, 1.f);
static const FLinearColor Frost(0.49f, 0.6f, 0.75f, 1.f);

FSlateFontInfo SSFOverlay::SerifFont(int32 Size, bool bItalic) const
{
	const bool bKo = GI && GI->Lang == TEXT("ko");
	const FString File = bKo ? TEXT("GowunBatang-Regular.ttf") : (bItalic ? TEXT("CormorantGaramond-Italic.ttf") : TEXT("CormorantGaramond-Regular.ttf"));
	const FString Path = FPaths::ProjectContentDir() / TEXT("Fonts") / File;
	if (FPaths::FileExists(Path)) return FSlateFontInfo(Path, Size);
	return FCoreStyle::GetDefaultFontStyle(bItalic ? "Italic" : "Regular", Size);
}
FSlateFontInfo SSFOverlay::MonoFont(int32 Size) const
{
	const FString Path = FPaths::ProjectContentDir() / TEXT("Fonts/DMMono-Regular.ttf");
	if (FPaths::FileExists(Path) && !(GI && GI->Lang == TEXT("ko"))) return FSlateFontInfo(Path, Size);
	return FCoreStyle::GetDefaultFontStyle("Regular", Size);
}
FLinearColor SSFOverlay::WhoColor(const FString& Who) const
{
	if (Who == TEXT("her")) return Ember;
	if (Who == TEXT("shadow")) return FLinearColor(0.55f, 0.58f, 0.62f);
	if (Who == TEXT("radio")) return Frost;
	if (Who == TEXT("narr")) return FLinearColor(0.78f, 0.8f, 0.83f);
	return Snow;
}

TSharedRef<SWidget> SSFOverlay::MakeTextButton(TAttribute<FText> Label, int32 Size, TFunction<void()> OnClick)
{
	return SNew(SButton)
		.ButtonStyle(FCoreStyle::Get(), "NoBorder")
		.OnClicked_Lambda([OnClick]() { if (OnClick) OnClick(); return FReply::Handled(); })
		[
			SNew(STextBlock).Text(Label).Font(SerifFont(Size)).ColorAndOpacity(Snow)
		];
}

TSharedRef<SWidget> SSFOverlay::MakeSlider(const FText& Label, float Min, float Max, TFunction<float()> Get, TFunction<void(float)> Set)
{
	return SNew(SHorizontalBox)
		+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
		[ SNew(SBox).WidthOverride(170.f)[ SNew(STextBlock).Text(Label).Font(MonoFont(11)).ColorAndOpacity(FLinearColor(0.6f, 0.64f, 0.68f)) ] ]
		+ SHorizontalBox::Slot().FillWidth(1.f).VAlign(VAlign_Center)
		[
			SNew(SSlider).MinValue(Min).MaxValue(Max)
			.Value_Lambda([Get]() { return Get(); })
			.OnValueChanged_Lambda([Set](float V) { Set(V); })
		];
}

void SSFOverlay::Construct(const FArguments& InArgs)
{
	GI = InArgs._GI;
	const float S = GI ? GI->SubtitleScale : 1.f;

	ChildSlot
	[
		SNew(SOverlay)
		// ---- crosshair dot ----
		+ SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Center)
		[
			SNew(SBox).WidthOverride_Lambda([this]() { return bPromptOn ? 9.f : 4.f; }).HeightOverride_Lambda([this]() { return bPromptOn ? 9.f : 4.f; })
			.Visibility_Lambda([this]() { return bCrosshair && !IsMenuOpen() ? EVisibility::HitTestInvisible : EVisibility::Collapsed; })
			[ SNew(SImage).Image(FCoreStyle::Get().GetBrush("WhiteBrush")).ColorAndOpacity_Lambda([this]() { return FLinearColor(1, 1, 1, bPromptOn ? 0.9f : 0.5f); }) ]
		]
		// ---- interaction prompt ----
		+ SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Center).Padding(0, 90, 0, 0)
		[
			SNew(SVerticalBox).Visibility(EVisibility::HitTestInvisible)
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center)
			[ SNew(STextBlock).Text_Lambda([this]() { return PromptLabel; }).Font(SerifFont(20, true)).ColorAndOpacity_Lambda([this]() { return FLinearColor(Snow.R, Snow.G, Snow.B, PromptAlpha); }).ShadowOffset(FVector2D(0, 1)).ShadowColorAndOpacity(FLinearColor(0, 0, 0, 0.8f)) ]
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0, 4)
			[ SNew(STextBlock).Text_Lambda([this]() { return PromptAct; }).Font(MonoFont(11)).ColorAndOpacity_Lambda([this]() { return FLinearColor(0.6f, 0.64f, 0.68f, PromptAlpha); }) ]
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center)
			[
				SNew(SBox).WidthOverride(90.f).HeightOverride(2.f)
				.Visibility_Lambda([this]() { return PromptProgress > 0.f ? EVisibility::HitTestInvisible : EVisibility::Hidden; })
				[ SNew(SProgressBar).Percent_Lambda([this]() { return TOptional<float>(FMath::Max(PromptProgress, 0.f)); }).FillColorAndOpacity(FLinearColor(1, 1, 1, 0.85f)) ]
			]
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0, 4)
			[ SNew(STextBlock).Text_Lambda([this]() { return PromptSeen; }).Font(MonoFont(10)).ColorAndOpacity_Lambda([this]() { return FLinearColor(Frost.R, Frost.G, Frost.B, PromptAlpha * 0.7f); }) ]
		]
		// ---- hint (top) ----
		+ SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Top).Padding(0, 26, 0, 0)
		[ SNew(STextBlock).Text_Lambda([this]() { return HintText; }).Font(MonoFont(12)).ColorAndOpacity_Lambda([this]() { return FLinearColor(Frost.R, Frost.G, Frost.B, HintAlpha * 0.85f); }).Visibility(EVisibility::HitTestInvisible) ]
		// ---- subtitle ----
		+ SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Bottom).Padding(0, 0, 0, 110)
		[
			SNew(SBox).MaxDesiredWidth(1100.f).Visibility(EVisibility::HitTestInvisible)
			[
				SNew(STextBlock)
				.Text_Lambda([this]() { return LineText; })
				.Font_Lambda([this, S]() { return SerifFont(FMath::RoundToInt(30 * (GI ? GI->SubtitleScale : S)), LineWho == TEXT("narr") || LineWho == TEXT("shadow")); })
				.ColorAndOpacity_Lambda([this]() { FLinearColor C = WhoColor(LineWho); C.A = LineAlpha; return FSlateColor(C); })
				.ShadowOffset(FVector2D(0, 1.5f)).ShadowColorAndOpacity_Lambda([this]() { return FLinearColor(0, 0, 0, 0.85f * LineAlpha); })
				.Justification(ETextJustify::Center).AutoWrapText(true)
			]
		]
		// ---- choices ----
		+ SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Bottom).Padding(0, 0, 0, 200)
		[
			SNew(SBorder).BorderImage(FCoreStyle::Get().GetBrush("NoBrush")).Padding(0)
			.ColorAndOpacity_Lambda([this]() { return FLinearColor(1, 1, 1, ChoiceAlpha); })
			.Visibility_Lambda([this]() { return bChoiceOpen ? EVisibility::Visible : EVisibility::Collapsed; })
			[ SAssignNew(ChoiceBox, SVerticalBox) ]
		]
		// ---- letterbox ----
		+ SOverlay::Slot().VAlign(VAlign_Top).HAlign(HAlign_Fill)
		[ SNew(SBox).HeightOverride_Lambda([this]() { return Letterbox * 130.f; }).Visibility(EVisibility::HitTestInvisible)[ SNew(SImage).Image(FCoreStyle::Get().GetBrush("WhiteBrush")).ColorAndOpacity(FLinearColor::Black) ] ]
		+ SOverlay::Slot().VAlign(VAlign_Bottom).HAlign(HAlign_Fill)
		[ SNew(SBox).HeightOverride_Lambda([this]() { return Letterbox * 130.f; }).Visibility(EVisibility::HitTestInvisible)[ SNew(SImage).Image(FCoreStyle::Get().GetBrush("WhiteBrush")).ColorAndOpacity(FLinearColor::Black) ] ]
		// ---- fade ----
		+ SOverlay::Slot()
		[ SNew(SImage).Image(FCoreStyle::Get().GetBrush("WhiteBrush")).Visibility(EVisibility::HitTestInvisible).ColorAndOpacity_Lambda([this]() { FLinearColor C = FadeColor; C.A = FMath::Clamp(Fade, 0.f, 1.f); return FSlateColor(C); }) ]
		// ---- title ----
		+ SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Bottom).Padding(0, 0, 0, 70)
		[
			SNew(SBorder).BorderImage(FCoreStyle::Get().GetBrush("NoBrush")).Padding(0)
			.ColorAndOpacity_Lambda([this]() { return FLinearColor(1, 1, 1, TitleAlpha); })
			.Visibility_Lambda([this]() { return TitleAlpha > 0.01f ? EVisibility::Visible : EVisibility::Collapsed; })
			[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center)
			[ SNew(STextBlock).Text(LOCTEXT("title", "snowfall")).Font(SerifFont(120, true)).ColorAndOpacity(Snow).ShadowOffset(FVector2D(0, 2)).ShadowColorAndOpacity(FLinearColor(0, 0, 0, 0.35f)) ]
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0, 8)
			[ SNew(STextBlock).Text_Lambda([this]() { return GI ? GI->T(TEXT("ui.warning")) : FText(); }).Font_Lambda([this]() { return SerifFont(19); }).ColorAndOpacity(FLinearColor(0.8f, 0.82f, 0.85f)) ]
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center)
			[ SNew(STextBlock).Text_Lambda([this]() { return GI ? GI->T(TEXT("ui.warning2")) : FText(); }).Font_Lambda([this]() { return SerifFont(16); }).ColorAndOpacity(FLinearColor(0.55f, 0.58f, 0.62f)) ]
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0, 22)
			[ MakeTextButton(TAttribute<FText>::CreateLambda([this]() { return GI ? GI->T(TEXT("ui.begin")) : FText(); }), 26, [this]() { if (BeginCb) BeginCb(); }) ]
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center)
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth().Padding(10, 0)[ MakeTextButton(LOCTEXT("en", "EN"), 15, [this]() { if (GI) GI->SetLang(TEXT("en")); RefreshTexts(); }) ]
				+ SHorizontalBox::Slot().AutoWidth().Padding(10, 0)[ MakeTextButton(FText::FromString(TEXT("한국어")), 15, [this]() { if (GI) GI->SetLang(TEXT("ko")); RefreshTexts(); }) ]
			]
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0, 14)
			[ SNew(STextBlock).Text_Lambda([this]() { return GI ? GI->T(TEXT("ui.controls")) : FText(); }).Font_Lambda([this]() { return MonoFont(11); }).ColorAndOpacity(FLinearColor(0.62f, 0.66f, 0.7f)) ]
			]
		]
		// ---- pause ----
		+ SOverlay::Slot()
		[
			SNew(SBorder).BorderImage(FCoreStyle::Get().GetBrush("WhiteBrush")).BorderBackgroundColor(FLinearColor(0.01f, 0.012f, 0.016f, 0.82f))
			.ColorAndOpacity_Lambda([this]() { return FLinearColor(1, 1, 1, PauseAlpha); })
			.Visibility_Lambda([this]() { return bPause ? EVisibility::Visible : EVisibility::Collapsed; })
			.HAlign(HAlign_Center).VAlign(VAlign_Center)
			[
				SNew(SBox).WidthOverride(560.f)
				[
					SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight().Padding(0, 0, 0, 18)[ SNew(STextBlock).Text_Lambda([this]() { return GI ? GI->T(TEXT("ui.paused")) : FText(); }).Font_Lambda([this]() { return SerifFont(42, true); }).ColorAndOpacity(Snow) ]
					+ SVerticalBox::Slot().AutoHeight().Padding(0, 6)[ MakeSlider(LOCTEXT("vol", "VOLUME"), 0, 1, [this]() { return GI->MasterVol; }, [this](float V) { GI->MasterVol = V; GI->SaveProgress(); }) ]
					+ SVerticalBox::Slot().AutoHeight().Padding(0, 6)[ MakeSlider(LOCTEXT("mus", "MUSIC"), 0, 1, [this]() { return GI->MusicVol; }, [this](float V) { GI->MusicVol = V; GI->SaveProgress(); }) ]
					+ SVerticalBox::Slot().AutoHeight().Padding(0, 6)[ MakeSlider(LOCTEXT("sfx", "SOUND"), 0, 1, [this]() { return GI->SfxVol; }, [this](float V) { GI->SfxVol = V; GI->SaveProgress(); }) ]
					+ SVerticalBox::Slot().AutoHeight().Padding(0, 6)[ MakeSlider(LOCTEXT("bri", "BRIGHTNESS"), 0.6f, 1.6f, [this]() { return GI->Brightness; }, [this](float V) { GI->Brightness = V; GI->SaveProgress(); }) ]
					+ SVerticalBox::Slot().AutoHeight().Padding(0, 6)[ MakeSlider(LOCTEXT("sen", "MOUSE"), 0.3f, 2.5f, [this]() { return GI->Sensitivity; }, [this](float V) { GI->Sensitivity = V; GI->SaveProgress(); }) ]
					+ SVerticalBox::Slot().AutoHeight().Padding(0, 6)[ MakeSlider(LOCTEXT("sub", "SUBTITLES"), 0.8f, 1.6f, [this]() { return GI->SubtitleScale; }, [this](float V) { GI->SubtitleScale = V; GI->SaveProgress(); }) ]
					+ SVerticalBox::Slot().AutoHeight().Padding(0, 6)[ MakeSlider(LOCTEXT("q", "QUALITY"), 0, 3, [this]() { return (float)GI->Quality; }, [this](float V) { GI->Quality = FMath::RoundToInt(V); GI->ApplySettings(); GI->SaveProgress(); }) ]
					+ SVerticalBox::Slot().AutoHeight().Padding(0, 10)
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot().AutoWidth().Padding(0, 0, 18, 0)[ MakeTextButton(LOCTEXT("en2", "EN"), 17, [this]() { GI->SetLang(TEXT("en")); RefreshTexts(); }) ]
						+ SHorizontalBox::Slot().AutoWidth()[ MakeTextButton(FText::FromString(TEXT("한국어")), 17, [this]() { GI->SetLang(TEXT("ko")); RefreshTexts(); }) ]
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(0, 10)[ SAssignNew(ChapterBox, SVerticalBox) ]
					+ SVerticalBox::Slot().AutoHeight().Padding(0, 16)[ MakeTextButton(TAttribute<FText>::CreateLambda([this]() { return GI ? GI->T(TEXT("ui.resume")) : FText(); }), 24, [this]() { if (ResumeCb) ResumeCb(); }) ]
				]
			]
		]
		// ---- end card ----
		+ SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Center)
		[
			SNew(SBorder).BorderImage(FCoreStyle::Get().GetBrush("NoBrush")).Padding(0)
			.ColorAndOpacity_Lambda([this]() { return FLinearColor(1, 1, 1, EndAlpha); })
			.Visibility_Lambda([this]() { return bEnd ? EVisibility::Visible : EVisibility::Collapsed; })
			[
			SNew(SBox).WidthOverride(820.f)
			[
				SNew(SVerticalBox)
				+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center)[ SNew(STextBlock).Text(LOCTEXT("t2", "snowfall")).Font(SerifFont(96, true)).ColorAndOpacity(FLinearColor(0.02f, 0.025f, 0.03f)) ]
				+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0, 6)[ SNew(STextBlock).Text_Lambda([this]() { return bEndClosed && GI ? GI->T(TEXT("end.closed")) : FText(); }).Font_Lambda([this]() { return SerifFont(19, true); }).ColorAndOpacity(FLinearColor(0.12f, 0.13f, 0.15f)) ]
				+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0, 10)[ SNew(STextBlock).Text_Lambda([this]() { return GI ? GI->T(TEXT("end.thanks")) : FText(); }).Font_Lambda([this]() { return SerifFont(20); }).ColorAndOpacity(FLinearColor(0.05f, 0.055f, 0.065f)) ]
				+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0, 10)[ SNew(STextBlock).Text_Lambda([this]() { return GI ? GI->T(TEXT("end.credit_story")) : FText(); }).Font_Lambda([this]() { return MonoFont(11); }).ColorAndOpacity(FLinearColor(0.12f, 0.13f, 0.15f)) ]
				+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center)[ SNew(STextBlock).Text_Lambda([this]() { return GI ? GI->T(TEXT("end.credit_assets")) : FText(); }).Font_Lambda([this]() { return MonoFont(10); }).ColorAndOpacity(FLinearColor(0.12f, 0.13f, 0.15f)).AutoWrapText(true).Justification(ETextJustify::Center) ]
				+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0, 22, 0, 4)[ SNew(STextBlock).Text_Lambda([this]() { return GI ? GI->T(TEXT("end.help")) : FText(); }).Font_Lambda([this]() { return SerifFont(19); }).ColorAndOpacity(FLinearColor(0.04f, 0.045f, 0.05f)) ]
				+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center)[ SNew(STextBlock).Text_Lambda([this]() { return GI ? GI->T(TEXT("end.help2")) : FText(); }).Font_Lambda([this]() { return MonoFont(12); }).ColorAndOpacity(FLinearColor(0.1f, 0.11f, 0.12f)) ]
				+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0, 24)
				[
					SNew(SButton).ButtonStyle(FCoreStyle::Get(), "NoBorder").OnClicked_Lambda([this]() { if (AgainCb) AgainCb(); return FReply::Handled(); })
					[ SNew(STextBlock).Text_Lambda([this]() { return GI ? GI->T(TEXT("end.again")) : FText(); }).Font_Lambda([this]() { return SerifFont(22); }).ColorAndOpacity(FLinearColor(0.05f, 0.055f, 0.065f)) ]
				]
			]
			]
		]
	];
}

void SSFOverlay::Tick(const FGeometry& G, const double T, const float Dt)
{
	SCompoundWidget::Tick(G, T, Dt);
	auto Approach = [Dt](float& V, float Target, float Speed) { V = FMath::FInterpTo(V, Target, Dt, Speed); };
	Approach(LineAlpha, LineTarget, 4.f);
	Approach(PromptAlpha, bPromptOn ? 1.f : 0.f, 8.f);
	Approach(ChoiceAlpha, bChoiceOpen ? 1.f : 0.f, 6.f);
	if (HintTimer > 0.f) { HintTimer -= Dt; Approach(HintAlpha, 1.f, 2.f); } else Approach(HintAlpha, 0.f, 2.f);
	Approach(TitleAlpha, bTitle ? 1.f : 0.f, 1.2f);
	Approach(PauseAlpha, bPause ? 1.f : 0.f, 8.f);
	Approach(EndAlpha, bEnd ? 1.f : 0.f, 0.5f);
}

void SSFOverlay::ShowLine(const FText& Text, const FString& Who) { LineText = Text; LineWho = Who; LineTarget = 1.f; LineAlpha = 0.f; }
void SSFOverlay::HideLine() { LineTarget = 0.f; }

void SSFOverlay::ShowChoices(const TArray<FText>& Labels, TFunction<void(int32)> OnPick)
{
	ChoiceCb = MoveTemp(OnPick);
	ChoiceBox->ClearChildren();
	for (int32 i = 0; i < Labels.Num(); ++i)
	{
		ChoiceBox->AddSlot().AutoHeight().HAlign(HAlign_Center).Padding(0, 6)
		[
			SNew(SButton).ButtonStyle(FCoreStyle::Get(), "NoBorder").OnClicked_Lambda([this, i]() { PickChoice(i); return FReply::Handled(); })
			[
				SNew(SBorder).BorderImage(FCoreStyle::Get().GetBrush("WhiteBrush")).BorderBackgroundColor(FLinearColor(0.02f, 0.025f, 0.035f, 0.45f)).Padding(FMargin(18, 9))
				[
					SNew(SHorizontalBox)
					+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0, 0, 14, 0)[ SNew(STextBlock).Text(FText::AsNumber(i + 1)).Font(MonoFont(11)).ColorAndOpacity(FLinearColor(0.5f, 0.54f, 0.58f)) ]
					+ SHorizontalBox::Slot().AutoWidth()[ SNew(STextBlock).Text(Labels[i]).Font(SerifFont(24)).ColorAndOpacity(Snow) ]
				]
			]
		];
	}
	bChoiceOpen = true;
}
void SSFOverlay::PickChoice(int32 Index)
{
	if (!bChoiceOpen || Index < 0 || Index >= ChoiceBox->NumSlots()) return;
	bChoiceOpen = false;
	if (ChoiceCb) { auto Cb = MoveTemp(ChoiceCb); ChoiceCb = nullptr; Cb(Index); }
}

void SSFOverlay::SetPrompt(const FText& Label, float Progress, bool bSeen)
{
	bPromptOn = true; PromptLabel = Label; PromptProgress = Progress;
	PromptAct = FText::FromString(Progress >= 0.f ? (GI && GI->Lang == TEXT("ko") ? TEXT("E · 길게") : TEXT("E · HOLD")) : TEXT("E"));
	PromptSeen = bSeen && GI ? GI->T(TEXT("ui.seen")) : FText();
}
void SSFOverlay::ClearPrompt() { bPromptOn = false; PromptProgress = -1.f; }
void SSFOverlay::Hint(const FText& Text, float Seconds) { HintText = Text; HintTimer = Seconds; }

void SSFOverlay::ShowTitle(bool bShow, TFunction<void()> OnBegin) { bTitle = bShow; if (OnBegin) BeginCb = MoveTemp(OnBegin); }
void SSFOverlay::ShowPause(bool bShow, TFunction<void()> OnResume, TFunction<void(FName)> OnChapter)
{
	bPause = bShow;
	if (OnResume) ResumeCb = MoveTemp(OnResume);
	if (OnChapter) ChapterCb = MoveTemp(OnChapter);
	if (bShow) BuildChapters();
}
void SSFOverlay::ShowEnd(bool bClosedDoors, TFunction<void()> OnAgain) { bEnd = true; bEndClosed = bClosedDoors; AgainCb = MoveTemp(OnAgain); }

void SSFOverlay::BuildChapters()
{
	if (!ChapterBox.IsValid() || !GI) return;
	ChapterBox->ClearChildren();
	static const TCHAR* Ids[] = { TEXT("L_Blizzard"), TEXT("L_Library"), TEXT("L_Road"), TEXT("L_Red"), TEXT("L_Bench") };
	static const TCHAR* Keys[] = { TEXT("ui.ch_snow"), TEXT("ui.ch_library"), TEXT("ui.ch_road"), TEXT("ui.ch_red"), TEXT("ui.ch_bench") };
	TSharedRef<SHorizontalBox> Row = SNew(SHorizontalBox);
	for (int32 i = 0; i < 5; ++i)
	{
		const FName Id(Ids[i]);
		const bool bOpen = GI->Flag(FName(*(FString(TEXT("ch_")) + Ids[i])));
		Row->AddSlot().AutoWidth().Padding(0, 0, 16, 0)
		[
			SNew(SButton).ButtonStyle(FCoreStyle::Get(), "NoBorder").IsEnabled(bOpen).OnClicked_Lambda([this, Id]() { if (ChapterCb) ChapterCb(Id); return FReply::Handled(); })
			[ SNew(STextBlock).Text(GI->T(Keys[i])).Font(SerifFont(17)).ColorAndOpacity(bOpen ? Snow : FLinearColor(0.2f, 0.21f, 0.23f)) ]
		];
	}
	ChapterBox->AddSlot().AutoHeight()[ Row ];
}

void SSFOverlay::RefreshTexts() { BuildChapters(); }

#undef LOCTEXT_NAMESPACE
