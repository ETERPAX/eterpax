"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { navLinks } from "@/lib/data/navigation";

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);

    handleScroll();

    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <motion.header
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-500 ${
        scrolled
          ? "border-b border-neutral-200/80 bg-white/80 backdrop-blur-xl shadow-[0_1px_0_0_rgba(0,0,0,0.03)]"
          : "bg-transparent"
      }`}
    >
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6 lg:h-[72px] lg:px-8">

        <Link
          href="/"
          className="text-sm font-bold tracking-[0.2em] text-black transition-opacity hover:opacity-70"
        >
          ETERPAX
        </Link>

        <div className="hidden items-center gap-10 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-neutral-500 transition-colors hover:text-black"
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-4">
          <Link
            href="/login"
            className="hidden text-sm text-neutral-500 transition-colors hover:text-black sm:block"
          >
            Login
          </Link>

          <Link
            href="/signup"
           className="rounded-full bg-[#0F5C88] px-5 py-2.5 text-sm font-medium text-white transition-all hover:bg-[#17375E] hover:shadow-lg hover:shadow-[#0F5C88]/20"
          >
            Create Legacy
          </Link>
        </div>

      </nav>
    </motion.header>
  );
}