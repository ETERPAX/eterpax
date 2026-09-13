import HeroV2 from "@/design-system/components/Hero/Hero-v2";

export default function LabPage() {
  return (
    <main className="min-h-screen bg-slate-100">
      <div className="border-b bg-white px-8 py-4 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-800">
          ETERPAX Design Lab
        </h1>

        <p className="mt-1 text-slate-500">
          Foundation 01 · Hero Structure
        </p>
      </div>

      <HeroV2 /> 
    </main>
  );
}