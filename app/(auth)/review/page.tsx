"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ShieldCheck,
  Lock,
  FileText,
  Video,
  Mic,
  Images,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

type Message = {
  id: string;
  recipient_name: string | null;
  body: string | null;
  status: string | null;
  created_at: string;
  document_path: string | null;
  document_url: string | null;
  documents: {
    path: string;
    url: string;
  }[];
  video_urls: string[];
  video_url?: string | null;
  photo_urls: string[];
  voice_url?: string | null;
};

type PreviewModal =
  | { type: "letter"; message: Message }
  | { type: "video"; message: Message }
  | { type: "voice"; message: Message }
  | { type: "photos"; message: Message }
  | { type: "documents"; message: Message }
  | null;

function hasLetter(body: string | null) {
  if (!body) return false;

  const plainText = body
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .trim();

  return plainText.length > 0;
}

function ReviewContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const messageId = searchParams.get("message");

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewModal, setPreviewModal] =
    useState<PreviewModal>(null);

  useEffect(() => {
    const loadMessages = async () => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        setLoading(false);
        return;
      }

      if (!messageId) {
        setMessages([]);
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("messages")
        .select(
          "id, recipient_name, recipient_email, body, status, created_at, document_path, voice_path"
        )
        .eq("user_id", user.id)
        .eq("id", messageId)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("ERROR LOADING MESSAGES:", error);
        setMessages([]);
        setLoading(false);
        return;
      }

      const messagesWithUrls = await Promise.all(
        (data ?? []).map(async (message) => {
          // LEGACY DOCUMENT URL
          const documentUrl: string | null = null;

          // MULTIPLE DOCUMENTS FOR THIS MESSAGE
          const {
            data: documentRows,
            error: documentRowsError,
          } = await supabase
            .from("message_documents")
            .select("document_path")
            .eq("message_id", message.id)
            .order("created_at", { ascending: true });

          if (documentRowsError) {
            console.error(
              "ERROR LOADING MESSAGE DOCUMENTS:",
              documentRowsError
            );
          }

          const documents = await Promise.all(
            (documentRows ?? []).map(async (document) => {
              const {
                data: signedData,
                error: signedError,
              } = await supabase.storage
                .from("message-documents")
                .createSignedUrl(
                  document.document_path,
                  3600
                );

              if (signedError) {
                console.error(
                  "ERROR CREATING DOCUMENT URL:",
                  signedError
                );
                return null;
              }

              return {
                path: document.document_path,
                url: signedData.signedUrl,
              };
            })
          );

          // VIDEOS FOR THIS MESSAGE
          const { data: videos, error: videosError } =
            await supabase
              .from("message_videos")
              .select("video_path")
              .eq("message_id", message.id);

          if (videosError) {
            console.error(
              "ERROR LOADING MESSAGE VIDEOS:",
              videosError
            );
          }

          const videoUrls = await Promise.all(
            (videos ?? []).map(async (video) => {
              const {
                data: signedVideoUrlData,
                error: signedVideoUrlError,
              } = await supabase.storage
                .from("message-videos")
                .createSignedUrl(video.video_path, 3600);

              if (signedVideoUrlError) {
                console.error(
                  "ERROR CREATING VIDEO URL:",
                  signedVideoUrlError
                );
                return null;
              }

              return signedVideoUrlData.signedUrl;
            })
          );

          // VOICE FOR THIS MESSAGE
          let voiceUrl: string | null = null;

          if (message.voice_path) {
            const {
              data: signedVoiceUrlData,
              error: signedVoiceUrlError,
            } = await supabase.storage
              .from("message-audio")
              .createSignedUrl(message.voice_path, 3600);

            if (signedVoiceUrlError) {
              console.error(
                "ERROR CREATING VOICE URL:",
                signedVoiceUrlError
              );
            } else {
              voiceUrl = signedVoiceUrlData.signedUrl;
            }
          }

          // PHOTOS FOR THIS MESSAGE
          const { data: photos, error: photosError } =
            await supabase
              .from("message_photos")
              .select("storage_path")
              .eq("message_id", message.id)
              .order("sort_order", { ascending: true });

          if (photosError) {
            console.error(
              "ERROR LOADING MESSAGE PHOTOS:",
              photosError
            );
          }

          const photoUrls = await Promise.all(
            (photos ?? []).map(async (photo) => {
              const {
                data: signedPhotoUrlData,
                error: signedPhotoUrlError,
              } = await supabase.storage
                .from("message-photos")
                .createSignedUrl(photo.storage_path, 3600);

              if (signedPhotoUrlError) {
                console.error(
                  "ERROR CREATING PHOTO URL:",
                  signedPhotoUrlError
                );
                return null;
              }

              return signedPhotoUrlData.signedUrl;
            })
          );

          return {
            ...message,
            document_url: documentUrl,
            documents: documents.filter(
              (
                document
              ): document is {
                path: string;
                url: string;
              } => Boolean(document)
            ),
            video_urls: videoUrls.filter(
              (url): url is string => Boolean(url)
            ),
            photo_urls: photoUrls.filter(
              (url): url is string => Boolean(url)
            ),
            voice_url: voiceUrl,
          };
        })
      );

      setMessages(messagesWithUrls);
      setLoading(false);
    };

    loadMessages();
  }, [messageId]);

  const closeModal = () => {
    setPreviewModal(null);
  };

  return (
    <main
      className="relative min-h-screen overflow-x-hidden bg-cover bg-center bg-fixed text-white"
      style={{
        backgroundImage:
          "url('/images/hero-family-v2.jpg')",
      }}
    >
      {/* SAME ETERPAX HERO FILTER */}
      <div className="fixed inset-0 bg-gradient-to-r from-[#071B2E]/60 via-[#071B2E]/25 to-transparent pointer-events-none" />
      <div className="fixed inset-0 bg-black/5 pointer-events-none" />

      {/* HEADER */}
      <header className="relative z-10 flex items-start justify-between px-8 pb-6 pt-10 md:px-14 md:pt-12">
        <div>
          <div className="text-xl font-medium tracking-[0.28em] text-white">
            ETERPAX
          </div>

          <div className="mt-3 text-xs font-medium leading-5 tracking-wide text-white/75">
            Confidence is designed.
            <br />
            Trust is earned.
            <br />
            Continuity is intentional.
          </div>
        </div>

        <div className="flex items-center gap-2 text-sm text-white/70">
          <ShieldCheck className="h-4 w-4" />
          Secure Preview
        </div>
      </header>

      {/* MAIN */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 pb-14 pt-4 md:px-10">
        <div className="mb-8">
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="inline-flex items-center text-sm font-medium text-white/80 transition hover:text-white"
          >
            ← Back to Dashboard
          </button>
        </div>

        {/* INTRO */}
        <div className="mx-auto max-w-4xl text-center">
          <p className="mb-4 text-sm font-medium uppercase tracking-[0.22em] text-[#2AA7D6]">
            Your Continuity Plan
          </p>

          <h1 className="font-serif text-4xl font-light tracking-tight text-white md:text-5xl">
            See what you&apos;ve chosen to preserve.
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-white/85">
            Review your message and everything you&apos;ve
            included, all in one place.
          </p>
        </div>

        {/* CONTENT */}
        <div className="mx-auto mt-12 max-w-4xl">
          {loading ? (
            <div className="py-16 text-center">
              <p className="text-sm text-white/70">
                Loading your message...
              </p>
            </div>
          ) : messages.length === 0 ? (
            <div className="rounded-3xl border border-white/20 bg-black/15 p-10 text-center backdrop-blur-md">
              <p className="text-xs uppercase tracking-[0.2em] text-white/60">
                No messages yet
              </p>

              <h2 className="mt-4 font-serif text-3xl font-light text-white">
                Your continuity collection is waiting.
              </h2>

              <p className="mt-4 text-base leading-7 text-white/70">
                Create your first message and it will appear
                here.
              </p>
            </div>
          ) : (
            <div className="space-y-10">
              {messages.map((message, index) => {
                const letterExists = hasLetter(message.body);
                const videoExists =
                  message.video_urls.length > 0;
                const voiceExists = Boolean(
                  message.voice_url
                );
                const photosExist =
                  message.photo_urls.length > 0;
                const documentsExist =
                  message.documents.length > 0 ||
                  Boolean(
                    message.document_path &&
                      message.document_url
                  );

                return (
                  <div key={message.id}>
                    {/* MESSAGE IDENTITY */}
                    <div className="border-y border-white/30 py-6">
                      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
                        <div>
                          <p className="text-xs font-medium uppercase tracking-[0.24em] text-white/65">
                            Message {messages.length - index}
                          </p>

                          <p className="mt-3 text-xl font-medium text-white md:text-2xl">
                            For{" "}
                            {message.recipient_name ||
                              "Someone special"}
                          </p>
                        </div>

                        <div className="self-start rounded-full border border-white/25 bg-white/10 px-4 py-2 text-xs capitalize text-white/85 backdrop-blur-md sm:self-auto">
                          {message.status || "draft"}
                        </div>
                      </div>
                    </div>

                    {/* CONTENT BUTTONS */}
                    <div className="mt-8 flex flex-wrap gap-4">
                      {letterExists && (
                        <button
                          type="button"
                          onClick={() =>
                            setPreviewModal({
                              type: "letter",
                              message,
                            })
                          }
                          className="group flex min-h-28 w-36 flex-col items-center justify-center rounded-2xl border border-white/30 bg-black/15 px-5 py-5 text-center backdrop-blur-md transition hover:-translate-y-1 hover:bg-white/15"
                        >
                          <FileText className="h-7 w-7 text-[#54BCE5]" />

                          <span className="mt-3 text-sm font-medium text-white">
                            Letter
                          </span>
                        </button>
                      )}

                      {videoExists && (
                        <button
                          type="button"
                          onClick={() =>
                            setPreviewModal({
                              type: "video",
                              message,
                            })
                          }
                          className="group flex min-h-28 w-36 flex-col items-center justify-center rounded-2xl border border-white/30 bg-black/15 px-5 py-5 text-center backdrop-blur-md transition hover:-translate-y-1 hover:bg-white/15"
                        >
                          <Video className="h-7 w-7 text-[#54BCE5]" />

                          <span className="mt-3 text-sm font-medium text-white">
                            Video
                          </span>

                          <span className="mt-1 text-xs text-white/60">
                            {message.video_urls.length}{" "}
                            {message.video_urls.length === 1
                              ? "video"
                              : "videos"}
                          </span>
                        </button>
                      )}

                      {voiceExists && (
                        <button
                          type="button"
                          onClick={() =>
                            setPreviewModal({
                              type: "voice",
                              message,
                            })
                          }
                          className="group flex min-h-28 w-36 flex-col items-center justify-center rounded-2xl border border-white/30 bg-black/15 px-5 py-5 text-center backdrop-blur-md transition hover:-translate-y-1 hover:bg-white/15"
                        >
                          <Mic className="h-7 w-7 text-[#54BCE5]" />

                          <span className="mt-3 text-sm font-medium text-white">
                            Voice
                          </span>

                          <span className="mt-1 text-xs text-white/60">
                            1 recording
                          </span>
                        </button>
                      )}

                      {photosExist && (
                        <button
                          type="button"
                          onClick={() =>
                            setPreviewModal({
                              type: "photos",
                              message,
                            })
                          }
                          className="group flex min-h-28 w-36 flex-col items-center justify-center rounded-2xl border border-white/30 bg-black/15 px-5 py-5 text-center backdrop-blur-md transition hover:-translate-y-1 hover:bg-white/15"
                        >
                          <Images className="h-7 w-7 text-[#54BCE5]" />

                          <span className="mt-3 text-sm font-medium text-white">
                            Photos
                          </span>

                          <span className="mt-1 text-xs text-white/60">
                            {message.photo_urls.length}{" "}
                            {message.photo_urls.length === 1
                              ? "photo"
                              : "photos"}
                          </span>
                        </button>
                      )}

                      {documentsExist && (
                        <button
                          type="button"
                          onClick={() =>
                            setPreviewModal({
                              type: "documents",
                              message,
                            })
                          }
                          className="group flex min-h-28 w-36 flex-col items-center justify-center rounded-2xl border border-white/30 bg-black/15 px-5 py-5 text-center backdrop-blur-md transition hover:-translate-y-1 hover:bg-white/15"
                        >
                          <FileText className="h-7 w-7 text-[#54BCE5]" />

                          <span className="mt-3 text-sm font-medium text-white">
                            Documents
                          </span>

                          <span className="mt-1 text-xs text-white/60">
                            {message.documents.length > 0
                              ? `${message.documents.length} ${
                                  message.documents.length ===
                                  1
                                    ? "document"
                                    : "documents"
                                }`
                              : "1 document"}
                          </span>
                        </button>
                      )}
                    </div>

                    {/* FOOTER ACTIONS */}
                    <div className="mt-10 flex flex-col justify-between gap-5 border-t border-white/25 pt-6 sm:flex-row sm:items-center">
                      <p className="text-sm text-white/70">
                        Your message remains private and secure.
                      </p>

                      <div className="flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            router.push(
                              `/your-messages?message=${message.id}`
                            )
                          }
                          className="rounded-full border border-white/40 bg-black/10 px-6 py-3 text-sm font-medium text-white backdrop-blur-md transition hover:bg-white/15"
                        >
                          Edit Message
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            router.push("/dashboard")
                          }
                          className="rounded-full bg-[#0A7BA8] px-6 py-3 text-sm font-medium text-white shadow-lg transition hover:bg-[#08698F]"
                        >
                          Back to Dashboard
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* BRAND STATEMENT */}
        <p className="mt-14 text-center text-xs uppercase tracking-[0.24em] text-white/55">
          Your words. Your memories. Your way.
        </p>
      </section>

      {/* MODAL */}
      {previewModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#071B2E]/60 p-4 backdrop-blur-sm md:p-8"
          onClick={closeModal}
        >
          <div
            className="relative max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-[28px] border border-white/20 bg-[#FAFAF8] p-6 text-[#102A43] shadow-2xl md:p-9"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={closeModal}
              className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-[#102A43]"
              aria-label="Close preview"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="pr-14">
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-[#0A7BA8]">
                {previewModal.type}
              </p>

              <h2 className="mt-2 font-serif text-3xl font-light text-[#102A43]">
                For{" "}
                {previewModal.message.recipient_name ||
                  "Someone special"}
              </h2>
            </div>

            {/* LETTER MODAL */}
{previewModal.type === "letter" && (
  <div className="mt-8">
    <div className="mx-auto max-h-[50vh] max-w-2xl overflow-y-auto rounded-2xl bg-[#FBF8F1] px-8 py-8 md:px-10 md:py-10">
      <div
        className="font-serif text-lg leading-9 text-[#102A43] md:text-xl"
        dangerouslySetInnerHTML={{
          __html: previewModal.message.body || "",
        }}
      />
    </div>
  </div>
)}

            {/* VIDEO MODAL */}
            {previewModal.type === "video" && (
              <div className="mt-8 space-y-5">
                {previewModal.message.video_urls.map(
                  (videoUrl, videoIndex) => (
                    <div
                      key={videoIndex}
                      className="overflow-hidden rounded-2xl bg-black shadow-sm"
                    >
                      <video
                        src={videoUrl}
                        controls
                        playsInline
                        className="w-full"
                      />
                    </div>
                  )
                )}
              </div>
            )}

            {/* VOICE MODAL */}
            {previewModal.type === "voice" &&
              previewModal.message.voice_url && (
                <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <p className="mb-4 text-sm text-slate-500">
                    Voice message
                  </p>

                  <audio
                    src={previewModal.message.voice_url}
                    controls
                    preload="metadata"
                    className="w-full"
                  />
                </div>
              )}

            {/* PHOTOS MODAL */}
            {previewModal.type === "photos" && (
              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                {previewModal.message.photo_urls.map(
                  (photoUrl, photoIndex) => (
                    <img
                      key={photoIndex}
                      src={photoUrl}
                      alt={`Photo ${photoIndex + 1}`}
                      className="h-auto w-full rounded-2xl object-cover shadow-sm"
                    />
                  )
                )}
              </div>
            )}

            {/* DOCUMENTS MODAL */}
            {previewModal.type === "documents" && (
              <div className="mt-8 space-y-3">
                {previewModal.message.documents.length >
                0 ? (
                  previewModal.message.documents.map(
                    (document, index) => (
                      <button
                        key={`${document.path}-${index}`}
                        type="button"
                        onClick={() =>
                          router.push(
                            `/document-viewer?url=${encodeURIComponent(
                              document.url
                            )}`
                          )
                        }
                        className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 text-left transition hover:border-[#0A7BA8]/40 hover:shadow-sm"
                      >
                        <div className="flex items-center gap-3">
                          <FileText className="h-5 w-5 shrink-0 text-[#0A7BA8]" />

                          <div>
                            <p className="text-sm font-medium text-[#102A43]">
                              {document.path
                                .split("/")
                                .pop()
                                ?.replace(
                                  /^\d+-\d+-/,
                                  ""
                                ) || "Document"}
                            </p>

                            <p className="mt-1 text-xs text-slate-500">
                              Secure document
                            </p>
                          </div>
                        </div>

                        <span className="ml-4 text-sm font-medium text-[#0A7BA8]">
                          View →
                        </span>
                      </button>
                    )
                  )
                ) : (
                  <p className="text-sm text-slate-500">
                    No documents available.
                  </p>
                )}
              </div>
            )}

            <div className="mt-8 flex justify-end border-t border-slate-200 pt-5">
              <button
                type="button"
                onClick={closeModal}
                className="rounded-full bg-[#0A7BA8] px-6 py-3 text-sm font-medium text-white transition hover:bg-[#08698F]"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function ReviewPage() {
  return (
    <Suspense fallback={null}>
      <ReviewContent />
    </Suspense>
  );
}