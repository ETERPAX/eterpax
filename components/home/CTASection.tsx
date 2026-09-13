"use client";

import { motion } from "framer-motion";
import { PricingCard } from "@/components/landing/PricingCard";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { stagger } from "@/lib/animations";
import { pricingPlans } from "@/lib/data/pricing";

export function CTASection() {
  return (
    <section id="pricing" className="border-t border-neutral-100 bg-neutral-50/30 py-24 lg:py-36">
      <div className="mx-auto max-w-6xl px-6 lg:px-8">
        <SectionHeading
          label="Pricing"
          title="Invest in forever"
          description="Simple, transparent pricing. No hidden fees. Cancel anytime."
        />

        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-60px" }}
          className="mt-20 grid gap-6 lg:grid-cols-3"
        >
          {pricingPlans.map((plan) => (
            <PricingCard key={plan.name} plan={plan} />
          ))}
        </motion.div>
      </div>
    </section>
  );
}
