"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import { ArrowRightIcon } from "@/components/icons";

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-white">
      <div className="relative mx-auto h-[860px] max-w-[1600px] lg:h-[860px]">

        {/* LEFT CONTENT */}
        <div className="relative z-10 flex h-full items-center px-8 pt-28 lg:px-16">
        <div className="max-w-[620px]">
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: .5 }}
            className="mb-6 text-xs uppercase tracking-[0.35em] text-[#6CC6C9]"
          >
            CONFIDENCE IS DESIGNED.
            <br />
            TRUST IS EARNED.
            <br />
            CONTINUITY IS INTENTIONAL.
          </motion.p>

          <motion.h1
            initial={{ opacity:0,y:20 }}
            animate={{ opacity:1,y:0 }}
            transition={{ delay:.15,duration:.6 }}
            className="text-6xl font-serif leading-tight text-white lg:text-7xl"
          >
            Protect what
            <br />
            <span className="text-[#68C7C7]">matters most.</span>
          </motion.h1>

          <motion.div
            initial={{ opacity:0 }}
            animate={{ opacity:1 }}
            transition={{ delay:.3 }}
            className="mt-8 h-px w-24 bg-[#C9A96A]"
          />

          <motion.p
            initial={{ opacity:0,y:20 }}
            animate={{ opacity:1,y:0 }}
            transition={{ delay:.4 }}
            className="mt-8 max-w-xl text-lg leading-8 text-white/80"
          >
            Prepare today so the people you love always have
            clarity tomorrow.
          </motion.p>

          <motion.div
            initial={{ opacity:0,y:20 }}
            animate={{ opacity:1,y:0 }}
            transition={{ delay:.55 }}
            className="mt-12 flex flex-wrap items-center gap-5"
          >

            <Link
              href="/signup"
              className="flex items-center gap-3 rounded-full bg-[#3C8EF3] px-8 py-4 font-medium text-white transition hover:bg-[#2F7CE0]"
            >
              Create My Continuity Plan

              <ArrowRightIcon className="h-4 w-4"/>
            </Link>

            <button
              className="flex items-center gap-3 text-white transition hover:text-[#68C7C7]"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/30">
                ▶
              </div>

              Watch video
            </button>

          </motion.div>

        </div>  {/* ← Cierra el contenedor flex */}

        {/* RIGHT IMAGE */}

        <div className="relative h-[700px] lg:h-screen">

          <Image
            src="/images/hero-family-v2.jpg"
            alt="Hero"
            fill
            priority
            className="object-cover"
          />

          <div className="absolute inset-0 bg-gradient-to-r from-[#0E2237] via-[#0E223733] to-transparent"/>

        </div>

      </div>
      </div>
    </section>
  );
}