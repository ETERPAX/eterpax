import { Lock, Users, Heart } from "lucide-react";

const cards = [
  {
    icon: Lock,
    title: "Your information.",
    subtitle: "Always secure.",
    description: "Bank-level encryption protects what matters most.",
  },
  {
    icon: Users,
    title: "You decide",
    subtitle: "who and when.",
    description: "Choose your guardians and what they will receive.",
  },
  {
    icon: Heart,
    title: "Clarity for them.",
    subtitle: "Peace for you.",
    description: "Give your loved ones clarity when they need it most.",
  },
];

export default function HeroTrustCards() {
  return (
    <div className="mx-auto max-w-7xl px-12">
      <div className="grid grid-cols-1 gap-8 md:grid-cols-3">

        {cards.map((card, index) => {
          const Icon = card.icon;

          return (
            <div
              key={index}
              className={`relative ${
                index !== 2 ? "md:border-r md:border-white/20 md:pr-8" : ""
              }`}
            >
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-white/10 backdrop-blur-md border border-white/20">
                <Icon className="h-7 w-7 text-[#55BFC8]" />
              </div>

              <h3 className="text-[28px] font-serif leading-tight text-white">
                {card.title}
                <br />
                <span className="text-[#55BFC8]">{card.subtitle}</span>
              </h3>

              <p className="mt-4 max-w-[260px] text-[16px] leading-7 text-white/80">
                {card.description}
              </p>

              <div className="mt-6 h-[3px] w-12 rounded-full bg-[#55BFC8]" />
            </div>
          );
        })}

      </div>
    </div>
  );
}