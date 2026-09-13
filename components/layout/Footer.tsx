import {
  footerCompanyLinks,
  footerLegalLinks,
  footerProductLinks,
} from "@/lib/data/footer";

export function Footer() {
  return (
    <footer className="border-t border-neutral-200 bg-white py-16 lg:py-20">
      <div className="mx-auto max-w-6xl px-6 lg:px-8">
        <div className="grid gap-12 md:grid-cols-4">
          <div className="md:col-span-2">
            <p className="text-sm font-bold tracking-[0.2em] text-black">ETERPAX</p>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-neutral-500">
              The world&apos;s most trusted platform for securing and delivering your digital legacy.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold tracking-[0.15em] text-neutral-400 uppercase">Product</p>
            <ul className="mt-4 space-y-3">
              {footerProductLinks.map((item) => (
                <li key={item}>
                  <a href="#" className="text-sm text-neutral-500 transition-colors hover:text-black">
                    {item}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold tracking-[0.15em] text-neutral-400 uppercase">Company</p>
            <ul className="mt-4 space-y-3">
              {footerCompanyLinks.map((item) => (
                <li key={item}>
                  <a href="#" className="text-sm text-neutral-500 transition-colors hover:text-black">
                    {item}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-16 flex flex-col items-center justify-between gap-4 border-t border-neutral-100 pt-8 sm:flex-row">
          <p className="text-xs text-neutral-400">
            &copy; {new Date().getFullYear()} ETERPAX. All rights reserved.
          </p>
          <div className="flex gap-6">
            {footerLegalLinks.map((item) => (
              <a key={item} href="#" className="text-xs text-neutral-400 transition-colors hover:text-black">
                {item}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
