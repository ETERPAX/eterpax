"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft, Lock } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc =
  `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export default function DocumentViewerPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const documentUrl = searchParams.get("url");

  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageWidth, setPageWidth] = useState(800);

  useEffect(() => {
    const updateWidth = () => {
      const width = Math.min(window.innerWidth - 48, 900);
      setPageWidth(width);
    };

    updateWidth();
    window.addEventListener("resize", updateWidth);

    return () => {
      window.removeEventListener("resize", updateWidth);
    };
  }, []);

  return (
    <main className="min-h-screen bg-[#F8FAFC] text-[#102A43]">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-5 md:px-10">
        <button
          type="button"
          onClick={() => router.push("/your-messages")}
          className="flex items-center gap-2 text-sm font-medium text-[#0A7BA8] transition hover:opacity-70"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>

        <div className="flex items-center gap-2 text-sm text-[#64748B]">
          <Lock className="h-4 w-4" />
          Private & Secure
        </div>
      </header>

      {/* Title */}
      <section className="px-6 py-6 md:px-10">
        <div className="mx-auto max-w-6xl">
          <p className="text-xs uppercase tracking-[0.2em] text-[#64748B]">
            DOCUMENT VIEWER
          </p>

          <h1 className="mt-2 font-serif text-3xl font-light text-[#102A43] md:text-4xl">
            Your secure document
          </h1>
        </div>
      </section>

      {/* PDF */}
      <section className="px-4 pb-10 md:px-10">
        <div className="mx-auto max-w-6xl">
          {!documentUrl ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
              <p className="text-slate-500">Document unavailable.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-sm">
              <Document
                file={documentUrl}
                onLoadSuccess={({ numPages }) => {
                  setNumPages(numPages);
                }}
                loading={
                  <div className="flex min-h-[500px] items-center justify-center text-slate-500">
                    Loading secure document...
                  </div>
                }
                error={
                  <div className="flex min-h-[500px] items-center justify-center p-10 text-center text-slate-500">
                    Unable to display this document.
                  </div>
                }
              >
                {numPages &&
                  Array.from({ length: numPages }, (_, index) => (
                    <div
                      key={`page_${index + 1}`}
                      className="flex justify-center border-b border-slate-200 bg-slate-100 py-4 last:border-b-0"
                    >
                      <Page
                        pageNumber={index + 1}
                        width={pageWidth}
                        renderTextLayer
                        renderAnnotationLayer
                      />
                    </div>
                  ))}
              </Document>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}