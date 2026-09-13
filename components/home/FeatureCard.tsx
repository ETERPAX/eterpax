"use client";

import { motion } from "framer-motion";
import { fadeUp } from "@/lib/animations";

type FeatureCardProps = {
  title: string;
  description: string;
};

export function FeatureCard({ title, description }: FeatureCardProps) {
  return (
    <motion.div
      variants={fadeUp}
      whileHover={{ y: -4 }}
      transition={{ duration: 0.3 }}
      className="rounded-2xl border border-neutral-200 bg-white p-8 transition-shadow hover:shadow-lg hover:shadow-black/[0.04]"
    >
      <h3 className="text-lg font-bold text-black">{title}</h3>
      <p className="mt-3 text-sm leading-relaxed text-neutral-500">{description}</p>
    </motion.div>
  );
}
