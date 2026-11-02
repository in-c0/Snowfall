#include "FX/SFInstanceSet.h"
#include "Snowfall.h"
#include "Components/HierarchicalInstancedStaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Misc/FileHelper.h"

ASFInstanceSet::ASFInstanceSet()
{
	Instances = CreateDefaultSubobject<UHierarchicalInstancedStaticMeshComponent>(TEXT("Instances"));
	RootComponent = Instances;
	Instances->SetMobility(EComponentMobility::Static);
	Instances->SetCollisionProfileName(TEXT("BlockAll"));
}

// C: three world → UE world (cm). Applied to a three-space column vector.
static FVector C3(const FVector& V) { return FVector(-V.Z, V.X, V.Y) * 100.f; }

FTransform ASFInstanceSet::ThreeToUE(const float* M, const FVector& GX, const FVector& GY, const FVector& GZ)
{
	// three matrix columns (column-major): basis X, basis Y, basis Z, translation
	const FVector BX(M[0], M[1], M[2]), BY(M[4], M[5], M[6]), BZ(M[8], M[9], M[10]), T(M[12], M[13], M[14]);
	// G maps three-local unit axes to UE-local vectors (cm). Its inverse maps UE-local back to three-local.
	// For a UE-local unit vector e: three_local = Ginv·e; world_three = M·three_local; world_ue = C·world_three.
	FMatrix G = FMatrix::Identity;
	G.SetAxis(0, GX); G.SetAxis(1, GY); G.SetAxis(2, GZ);   // columns = images of three axes (UE row-vector convention handled below)
	const FMatrix Ginv = G.Inverse();
	auto Apply = [&](const FVector& UeLocal) -> FVector
	{
		// UE FMatrix uses row vectors: v' = v * M. SetAxis(i) sets row i, so v_three = UeLocal * Ginv gives coefficients.
		const FVector Th = Ginv.TransformVector(UeLocal);   // coordinates in three-local basis
		const FVector W = BX * Th.X + BY * Th.Y + BZ * Th.Z; // three world direction (no translation)
		return C3(W);
	};
	FMatrix Out = FMatrix::Identity;
	Out.SetAxis(0, Apply(FVector(1, 0, 0)));
	Out.SetAxis(1, Apply(FVector(0, 1, 0)));
	Out.SetAxis(2, Apply(FVector(0, 0, 1)));
	Out.SetOrigin(C3(T));
	return FTransform(Out);
}

int32 ASFInstanceSet::LoadFromFile(const FString& BinPath, int32 CustomFloats, UStaticMesh* Mesh, UMaterialInterface* Material, FVector GX, FVector GY, FVector GZ)
{
	TArray<uint8> Bytes;
	if (!FFileHelper::LoadFileToArray(Bytes, *BinPath)) { UE_LOG(LogSnowfall, Error, TEXT("instances: cannot read %s"), *BinPath); return 0; }
	const int32 Stride = 16 + CustomFloats;
	const int32 Count = Bytes.Num() / (Stride * 4);
	const float* F = reinterpret_cast<const float*>(Bytes.GetData());
	Instances->SetStaticMesh(Mesh);
	if (Material) Instances->SetMaterial(0, Material);
	Instances->NumCustomDataFloats = CustomFloats;
	TArray<FTransform> Xf; Xf.Reserve(Count);
	for (int32 i = 0; i < Count; ++i) Xf.Add(ThreeToUE(F + i * Stride, GX, GY, GZ));
	Instances->ClearInstances();
	Instances->AddInstances(Xf, false, false);
	if (CustomFloats > 0)
		for (int32 i = 0; i < Count; ++i)
		{
			TArray<float> D; D.Append(F + i * Stride + 16, CustomFloats);
			Instances->SetCustomData(i, D, false);
		}
	Instances->MarkRenderStateDirty();
	return Count;
}

void ASFInstanceSet::SetSingle(const TArray<float>& Matrix16, UStaticMesh* Mesh, UMaterialInterface* Material, FVector GX, FVector GY, FVector GZ)
{
	if (Matrix16.Num() < 16) return;
	Instances->SetStaticMesh(Mesh);
	if (Material) Instances->SetMaterial(0, Material);
	Instances->ClearInstances();
	Instances->AddInstance(ThreeToUE(Matrix16.GetData(), GX, GY, GZ), true);
}

void ASFInstanceSet::Configure(bool bCastShadow, bool bCollide, float CullDistance, bool bNaniteFallbackOk)
{
	Instances->SetCastShadow(bCastShadow);
	Instances->SetCollisionEnabled(bCollide ? ECollisionEnabled::QueryAndPhysics : ECollisionEnabled::NoCollision);
	if (CullDistance > 0.f) { Instances->InstanceStartCullDistance = (int32)(CullDistance * 0.8f); Instances->InstanceEndCullDistance = (int32)CullDistance; }
}
