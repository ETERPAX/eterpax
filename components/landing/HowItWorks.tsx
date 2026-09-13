"use client";

import { motion } from "framer-motion";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { fadeUp, stagger } from "@/lib/animations";
import { steps } from "@/lib/data/steps";

export function HowItWorks() {
  return (
    <section id="how-it-works" className="py-24 lg:py-36">
      <div className="mx-auto max-w-6xl px-6 lg:px-8">
        <SectionHeading
          label="How it works"
          title="Your continuity plan in three simple steps"

          description="Create your continuity plan in minutes. We'll take care of the rest." 
          
        />

        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-60px" }}
          className="mt-20 grid gap-6 lg:grid-cols-3"
        >
          {steps.map((step, index) => (
            <motion.div
              key={step.title}
              variants={fadeUp}
              className="relative rounded-2xl border border-neutral-200 bg-white p-10 transition-all hover:border-neutral-300 hover:shadow-xl hover:shadow-black/[0.04]"
            >
              {index < steps.length - 1 && (
                <div className="absolute top-1/2 -right-3 hidden h-px w-6 bg-neutral-200 lg:block" />
              )}
              <span className="text-xs font-semibold tracking-[0.2em] text-neutral-300 uppercase">
                Step {step.step}
              </span>
              <h3 className="mt-4 text-2xl font-bold text-black">{step.title}</h3>
              <p className="mt-4 text-sm leading-relaxed text-neutral-500">{step.description}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
