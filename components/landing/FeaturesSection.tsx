"use client";

import { motion } from "framer-motion";
import { FeatureCard } from "@/components/home/FeatureCard";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { stagger } from "@/lib/animations";
import { features } from "@/lib/data/features";

export function FeaturesSection() {
  return (
    <section id="features" className="border-t border-neutral-100 bg-neutral-50/30 py-24 lg:py-36">
      <div className="mx-auto max-w-6xl px-6 lg:px-8">
        <SectionHeading
          label="Features"
          title="Everything your legacy needs"
          description="Purpose-built tools to preserve, protect, and deliver what matters most."
        />

        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-60px" }}
          className="mt-20 grid gap-6 sm:grid-cols-2"
        >
          {features.map((feature) => (
            <FeatureCard
              key={feature.title}
              title={feature.title}
              description={feature.description}
            />
          ))}
        </motion.div>
      </div>
    </section>
  );
}
