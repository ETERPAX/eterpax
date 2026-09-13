"use client";

import { motion } from "framer-motion";
import { fadeUp, stagger } from "@/lib/animations";

type SectionHeadingProps = {
  label: string;
  title: string;
  description?: string;
};

export function SectionHeading({ label, title, description }: SectionHeadingProps) {
  return (
    <motion.div
      variants={stagger}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-80px" }}
      className="mx-auto max-w-2xl text-center"
    >
      <motion.p variants={fadeUp} className="text-xs font-semibold tracking-[0.2em] text-neutral-400 uppercase">
        {label}
      </motion.p>
      <motion.h2
        variants={fadeUp}
        className="mt-4 text-3xl font-bold tracking-tight text-black sm:text-4xl lg:text-5xl"
      >
        {title}
      </motion.h2>
      {description && (
        <motion.p variants={fadeUp} className="mt-5 text-lg leading-relaxed text-neutral-500">
          {description}
        </motion.p>
      )}
    </motion.div>
  );
}
