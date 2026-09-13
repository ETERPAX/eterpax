"use client";

import { motion } from "framer-motion";
import { fadeUp, stagger } from "@/lib/animations";
import { securityBadges, securityFeatures } from "@/lib/data/security";

export function SecuritySection() {
  return (
    <section id="security" className="py-24 lg:py-36">
      <div className="mx-auto max-w-6xl px-6 lg:px-8">
        <div className="grid items-center gap-16 lg:grid-cols-2 lg:gap-24">
          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-60px" }}
          >
            <motion.p variants={fadeUp} className="text-xs font-semibold tracking-[0.2em] text-neutral-400 uppercase">
              Security
            </motion.p>
            <motion.h2
              variants={fadeUp}
              className="mt-4 text-3xl font-bold tracking-tight text-black sm:text-4xl lg:text-5xl lg:leading-[1.1]"
            >
              Fort Knox for your digital life
            </motion.h2>
            <motion.p variants={fadeUp} className="mt-6 text-lg leading-relaxed text-neutral-500">
              Your legacy deserves the same protection as the world&apos;s most sensitive data.
              We built ETERPAX with security engineers from leading institutions.
            </motion.p>

            <motion.div variants={fadeUp} className="mt-10 flex items-center gap-8">
              {securityBadges.map((badge) => (
                <div key={badge} className="text-center">
                  <p className="text-sm font-bold text-black">{badge}</p>
                  <p className="mt-1 text-xs text-neutral-400">Certified</p>
                </div>
              ))}
            </motion.div>
          </motion.div>

          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-60px" }}
            className="grid gap-4 sm:grid-cols-2"
          >
            {securityFeatures.map((feature) => (
              <motion.div
                key={feature.title}
                variants={fadeUp}
                className="rounded-xl border border-neutral-200 bg-white p-6 transition-all hover:border-neutral-300"
              >
                <h3 className="text-sm font-bold text-black">{feature.title}</h3>
                <p className="mt-2 text-xs leading-relaxed text-neutral-500">{feature.description}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
}
