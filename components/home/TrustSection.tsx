"use client";

import { motion } from "framer-motion";
import { fadeUp, stagger } from "@/lib/animations";
import { trustItems } from "@/lib/data/trust";

export function TrustSection() {
  return (
    <section className="border-y border-neutral-100 bg-neutral-50/50 py-24 lg:py-32">
      <div className="mx-auto max-w-6xl px-6 lg:px-8">
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-60px" }}
          className="grid gap-8 md:grid-cols-3"
        >
          {trustItems.map((item) => (
            <motion.div
              key={item.title}
              variants={fadeUp}
              className="group rounded-2xl border border-neutral-200/60 bg-white p-8 transition-all hover:border-neutral-300 hover:shadow-lg hover:shadow-black/[0.04]"
            >
            <div className="mb-5 inline-flex rounded-xl bg-[#0F5C88]/10 p-3 text-[#0F5C88] transition-colors group-hover:bg-[#0F5C88] group-hover:text-white">  
                 {item.icon}
            </div>
              <h3 className="text-lg font-bold text-black">{item.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-neutral-500">{item.description}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
