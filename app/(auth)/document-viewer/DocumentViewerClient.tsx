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
  const documentUrl = searchParams.get("url");
  const messageId = searchParams.get("message");
  const backHref = messageId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(messageId)
    ? `/review?message=${encodeURIComponent(messageId)}`
    : "/your-messages";
  const filename = (searchParams.get("filename") || "document")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^\.+/, "") || "document";

  return <DocumentViewer key={documentUrl} documentUrl={documentUrl} filename={filename} backHref={backHref} />;
}

function DocumentViewer({ documentUrl, filename, backHref }: { documentUrl: string | null; filename: string; backHref: string }) {
  const router = useRouter();
  const [resolved, setResolved] = useState<{ url: string; mime: string; text: string } | null>(null);
  const [loadError, setLoadError] = useState(false);

  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageWidth, setPageWidth] = useState(800);

  useEffect(() => {
    if (!documentUrl) return;
    const controller = new AbortController();
    let ownedUrl: string | undefined;

    const load = async () => {
      try {
        const url = new URL(documentUrl);
        const localBlob = url.protocol === "blob:" && url.origin === window.location.origin;
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        // Retain only the existing signed document-bucket URL flow for legacy files.
        const legacyDocument = supabaseUrl && url.origin === new URL(supabaseUrl).origin &&
          url.pathname.startsWith("/storage/v1/object/sign/message-documents/") &&
          Boolean(url.searchParams.get("token"));
        if (url.username || url.password || (!localBlob && !legacyDocument)) {
          throw new Error("Unsupported document URL");
        }
        const response = await fetch(url.href, {
          signal: controller.signal,
          credentials: "omit",
          redirect: "error",
        });
        if (!response.ok) throw new Error("Unable to load document");
        const blob = await response.blob();
        const mime = blob.type.split(";")[0].trim().toLowerCase();
        const text = mime === "text/plain" ? await blob.text() : "";
        if (controller.signal.aborted) return;
        // Review owns its blob URL. Only URLs created here are revoked here.
        const resolvedUrl = localBlob ? documentUrl : (ownedUrl = URL.createObjectURL(blob));
        setResolved({ url: resolvedUrl, mime, text });
      } catch {
        if (!controller.signal.aborted) setLoadError(true);
      }
    };
    void load();
    return () => {
      controller.abort();
      if (ownedUrl) URL.revokeObjectURL(ownedUrl);
    };
  }, [documentUrl]);

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
          onClick={() => router.push(backHref)}
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

      {/* Render only formats supported by the selected viewer. */}
      <section className="px-4 pb-10 md:px-10">
        <div className="mx-auto max-w-6xl">
          {!documentUrl || loadError ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
              <p className="text-slate-500">Document unavailable.</p>
            </div>
          ) : !resolved ? (
            <p className="p-10 text-center text-slate-500">Loading secure document...</p>
          ) : resolved.mime === "text/plain" ? (
            <pre className="max-h-[75vh] overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-white p-6 text-sm text-slate-800">
              {resolved.text}
            </pre>
          ) : resolved.mime !== "application/pdf" ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
              <p className="text-slate-500">Preview unavailable for this format.</p>
              <a href={resolved.url} download={filename} className="mt-4 inline-block text-[#0A7BA8] underline">
                Download {filename}
              </a>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-sm">
              <Document
                file={resolved.url}
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
