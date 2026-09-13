import { ShieldCheck, Globe, Shield } from "lucide-react";

const items = [
  {
    icon: ShieldCheck,
    title: "Private by design",
  },
  {
    icon: Globe,
    title: "You're in control",
  },
  {
    icon: Shield,
    title: "Trusted worldwide",
  },
];

export default function TrustStrip() {
  return (
    <section className="py-6">

<div className="mx-auto max-w-[1180px]">

      <h2 className="mb-2 text-center text-[22px] font-serif text-[#0D2340]">
          Built on trust. Designed for life.
        </h2>

        <div className="grid grid-cols-3">

          {items.map((item, index) => {

            const Icon = item.icon;

            return (

              <div
                key={item.title}
                className={`flex items-center justify-center gap-3 py-0 ${
                  index !== 2
                    ? "border-r border-slate-200"
                    : ""
                }`}
              >

                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#F6FBFC]">

                  <Icon className="h-5 w-5 text-[#1597A8]" />

                </div>

                <span className="text-[15px] font-medium text-[#0D2340]">
  {item.title}
</span>
                
               

              </div>

            );
          })}

        </div>

      </div>

    </section>
  );
}