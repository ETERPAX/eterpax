"use client";

import { motion } from "framer-motion";
import { CheckIcon } from "@/components/icons";
import { fadeUp } from "@/lib/animations";

type PricingPlan = {
  name: string;
  price: string;
  period: string;
  description: string;
  features: readonly string[];
  cta: string;
  highlighted: boolean;
};

type PricingCardProps = {
  plan: PricingPlan;
};

export function PricingCard({ plan }: PricingCardProps) {
  return (
    <motion.div
      variants={fadeUp}
      className={`relative flex flex-col rounded-2xl border p-8 transition-all ${
        plan.highlighted
          ? "border-black bg-black text-white shadow-2xl shadow-black/20"
          : "border-neutral-200 bg-white hover:border-neutral-300 hover:shadow-lg hover:shadow-black/[0.04]"
      }`}
    >
      {plan.highlighted && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-white px-4 py-1 text-xs font-semibold text-black">
          Most Popular
        </span>
      )}
      <h3 className={`text-lg font-bold ${plan.highlighted ? "text-white" : "text-black"}`}>
        {plan.name}
      </h3>
      <div className="mt-4 flex items-baseline gap-1">
        <span className={`text-4xl font-bold ${plan.highlighted ? "text-white" : "text-black"}`}>
          {plan.price}
        </span>
        <span className={`text-sm ${plan.highlighted ? "text-neutral-400" : "text-neutral-500"}`}>
          {plan.period}
        </span>
      </div>
      <p className={`mt-3 text-sm ${plan.highlighted ? "text-neutral-400" : "text-neutral-500"}`}>
        {plan.description}
      </p>
      <ul className="mt-8 flex-1 space-y-3">
        {plan.features.map((feature) => (
          <li
            key={feature}
            className={`flex items-center gap-3 text-sm ${
              plan.highlighted ? "text-neutral-300" : "text-neutral-600"
            }`}
          >
            <CheckIcon
              className={`h-4 w-4 shrink-0 ${plan.highlighted ? "text-white" : "text-black"}`}
            />
            {feature}
          </li>
        ))}
      </ul>
      <a
        href="#"
        className={`mt-8 block rounded-full py-3.5 text-center text-sm font-medium transition-all ${
          plan.highlighted
            ? "bg-white text-black hover:bg-neutral-100"
            : "bg-black text-white hover:bg-neutral-800"
        }`}
      >
        {plan.cta}
      </a>
    </motion.div>
  );
}
