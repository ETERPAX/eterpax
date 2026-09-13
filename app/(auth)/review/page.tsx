"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ShieldCheck,
  ArrowRight,
  Lock,
  FileText,
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

export default function ReviewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const messageId = searchParams.get("message");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

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
    const { data: documentRows, error: documentRowsError } = await supabase
      .from("message_documents")
      .select("document_path")
      .eq("message_id", message.id)
      .order("created_at", { ascending: true });

    if (documentRowsError) {
      console.error("ERROR LOADING MESSAGE DOCUMENTS:", documentRowsError);
    }

    const documents = await Promise.all(
      (documentRows ?? []).map(async (document) => {
        const { data: signedData, error: signedError } =
          await supabase.storage
            .from("message-documents")
            .createSignedUrl(document.document_path, 3600);

        if (signedError) {
          console.error("ERROR CREATING DOCUMENT URL:", signedError);
          return null;
        }

        return {
          path: document.document_path,
          url: signedData.signedUrl,
        };
      })
    );
          // VIDEOS FOR THIS MESSAGE
          const { data: videos, error: videosError } = await supabase
            .from("message_videos")
            .select("video_path")
            .eq("message_id", message.id);

          if (videosError) {
            console.error(
              "ERROR LOADING MESSAGE VIDEOS:",
              videosError
            );
          }

          // CREATE SIGNED URL FOR EACH VIDEO
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
const { data: photos, error: photosError } = await supabase
.from("message_photos")
.select("storage_path")
.eq("message_id", message.id)
.order("sort_order", { ascending: true });

if (photosError) {
console.error("ERROR LOADING MESSAGE PHOTOS:", photosError);
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
              (document): document is { path: string; url: string } =>
                Boolean(document)
            ),
            video_urls: videoUrls.filter(
              (url): url is string => Boolean(url)
            ),
            photo_urls: photoUrls.filter((url): url is string => Boolean(url)),
            voice_url: voiceUrl,
          };
        })
      );

      setMessages(messagesWithUrls);
      setLoading(false);
    };

    loadMessages();
  }, []);

  return (
    <main
      className="min-h-screen overflow-y-auto overflow-x-hidden bg-cover bg-center bg-fixed text-[#102A43]"
      style={{
        backgroundImage: "url('/images/hero-family-v2.jpg')",
      }}
    >
      {/* Header */}
      <header className="flex items-center justify-between px-8 py-6 md:px-14">
        <div className="text-xl font-medium tracking-[0.28em]">
          ETERPAX
        </div>

        <div className="flex items-center gap-2 text-sm text-[#64748B]">
          <ShieldCheck className="h-4 w-4" />
          Secure Preview
        </div>
      </header>

      {/* Main content */}
      <section className="mx-auto max-w-6xl px-6 pb-10 pt-4 md:px-10">
        <div className="mb-8">
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="inline-flex items-center text-sm font-medium text-slate-500 transition hover:text-[#0A7BA8]"
          >
            ← Back to Dashboard
          </button>
        </div>

        {/* Intro */}
        <div className="mx-auto max-w-3xl text-center">
          <p className="mb-4 text-sm font-medium uppercase tracking-[0.22em] text-[#0A7BA8]">
            Your Continuity Plan
          </p>

          <h1 className="font-serif text-4xl font-light tracking-tight md:text-5xl">
            See how your message will feel.
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-600">
            Before you activate your plan, experience what your loved one
            will see when your message is delivered.
          </p>
        </div>

        {/* Preview card */}
        <div className="mx-auto mt-8 max-w-5xl overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_25px_80px_rgba(16,42,67,0.10)]">
          {/* Preview header */}
          <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5 md:px-8">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                Message Preview
              </p>

              <p className="mt-1 text-sm text-slate-600">
                How it will appear to your loved one
              </p>
            </div>

            <div className="flex items-center gap-2 rounded-full bg-[#F0F7FA] px-3 py-2 text-xs text-[#0A7BA8]">
              <Lock className="h-3.5 w-3.5" />
              Private & Secure
            </div>
          </div>

          {/* Message experience */}
          <div className="bg-[#FAFAF8] px-6 py-10 md:px-14 md:py-14">
            <div className="mx-auto max-w-3xl">
              {loading ? (
                <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
                  <p className="text-sm text-slate-500">
                    Loading your messages...
                  </p>
                </div>
              ) : messages.length === 0 ? (
                <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                    No messages yet
                  </p>

                  <h2 className="mt-4 font-serif text-3xl font-light text-[#102A43]">
                    Your continuity collection is waiting.
                  </h2>

                  <p className="mt-4 text-base leading-7 text-slate-500">
                    Create your first message and it will appear here.
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  {messages.map((message, index) => (
                    <div
                      key={message.id}
                      className="space-y-4"
                    >
                      {/* Message card */}
                      <button
                        type="button"
                        onClick={() =>
                          router.push(
                            `/your-messages?message=${message.id}`
                          )
                        }
                        className="w-full rounded-2xl bg-white p-6 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md md:p-8"
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                              Message {messages.length - index}
                            </p>

                            <p className="mt-2 text-sm text-slate-500">
                              For{" "}
                              <span className="font-medium text-[#102A43]">
                                {message.recipient_name ||
                                  "Someone special"}
                              </span>
                            </p>
                          </div>

                          <div className="rounded-full bg-[#F0F7FA] px-3 py-1.5 text-xs text-[#0A7BA8]">
                            {message.status || "draft"}
                          </div>
                        </div>

                        <h2 className="mt-6 font-serif text-3xl font-light text-[#102A43] md:text-4xl">
                          A message meant for you.
                        </h2>

                        <div className="mt-6 text-base leading-7 text-slate-600">
  <div
    dangerouslySetInnerHTML={{
      __html: message.body || "<p>No message content yet.</p>",
    }}
  />
</div>
                        
                      </button>

                      {/* Document */}
                      {message.documents.length > 0 ? (
  message.documents.map((document, index) => (
    <button
      key={`${document.path}-${index}`}
      onClick={() => {
        router.push(
          `/document-viewer?url=${encodeURIComponent(document.url)}`
        );
      }}
      className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3"
    >
      <div className="flex items-center gap-3">
        <FileText className="h-5 w-5 text-[#0A7BA8]" />

        <div>
          <p className="text-sm font-medium text-[#102A43]">
            {document.path
              .split("/")
              .pop()
              ?.replace(/^\d+-\d+-/, "") || "Document"}
          </p>

          <p className="text-xs text-slate-500">
            Secure PDF
          </p>
        </div>
      </div>

      <span className="text-sm font-medium text-[#0A7BA8]">
        View document →
      </span>
    </button>
  ))
) : message.document_path ? (
  <button
    onClick={() => {
      router.push(
        `/document-viewer?url=${encodeURIComponent(
          message.document_url!
        )}`
      );
    }}
    className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3"
  >
    <div className="flex items-center gap-3">
      <FileText className="h-5 w-5 text-[#0A7BA8]" />

      <div>
        <p className="text-sm font-medium text-[#102A43]">
          {message.document_path
            .split("/")
            .pop()
            ?.replace(/^\d+-\d+-/, "") || "Document"}
        </p>

        <p className="text-xs text-slate-500">
          Secure PDF
        </p>
      </div>
    </div>

    <span className="text-sm font-medium text-[#0A7BA8]">
      View document →
    </span>
  </button>
) : null}

                      {/* Videos */}
                      {message.video_urls?.length > 0 && (
                        <div className="mt-4 space-y-3">
                          {message.video_urls.map(
                            (videoUrl, videoIndex) => (
                              <div
                                key={videoIndex}
                                className="rounded-xl border border-slate-200 bg-white p-3"
                              >
                                <p className="mb-2 text-xs font-medium uppercase tracking-[0.15em] text-slate-400">
                                  Video {videoIndex + 1}
                                </p>

                                <video
                                  src={videoUrl}
                                  controls
                                  playsInline
                                  className="w-full rounded-lg"
                                />
                              </div>
                            )
                          )}
                        </div>
                      )}
                      {/* Photos */}
{message.photo_urls?.length > 0 && (
  <div className="mt-4 space-y-3">
    {message.photo_urls.map((photoUrl, photoIndex) => (
      <div
        key={photoIndex}
        className="rounded-xl border border-slate-200 bg-white p-3"
      >
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.15em] text-slate-400">
          Photo {photoIndex + 1}
        </p>

        <img
          src={photoUrl}
          alt={`Photo ${photoIndex + 1}`}
          className="w-full rounded-lg object-cover"
        />
      </div>
    ))}
  </div>
)}
                      {/* Voice */}
{message.voice_url && (
  <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
    <p className="mb-2 text-xs font-medium uppercase tracking-[0.15em] text-slate-400">
      Voice Message
    </p>

    <audio
      src={message.voice_url}
      controls
      preload="metadata"
      className="w-full"
    />
  </div>
)}
                    </div>
                  ))}
                </div>
              )}
            </div>
      
            {/* Continuity collection */}
            <div className="mt-10">
              <div className="mb-6 text-center">
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-[#0A7BA8]">
                  Your continuity collection
                </p>

                <h3 className="mt-2 font-serif text-2xl font-light tracking-tight text-[#102A43] md:text-3xl">
                  What you&apos;ve chosen to preserve.
                </h3>

                <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-500 md:text-base">
                  Your words, voice, memories, and important things —
                  prepared privately for the people you trust.
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {/* Letter */}
                <Link
                  href="/your-messages"
                  className="block rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-[#0A7BA8] hover:shadow-md"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#F0F7FA] text-[#0A7BA8]">
                    <FileText className="h-5 w-5" />
                  </div>

                  <p className="mt-5 text-xs font-medium uppercase tracking-[0.2em] text-slate-400">
                    Letter
                  </p>

                  <h4 className="mt-2 font-serif text-2xl font-light text-[#102A43]">
                    A letter meant for you.
                  </h4>

                  <p className="mt-3 text-sm leading-6 text-slate-500">
                    Personal words, memories, and wishes written
                    especially for you.
                  </p>
                </Link>

                {/* Video */}
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#F0F7FA] text-[#0A7BA8]">
                    <span className="text-lg">▶</span>
                  </div>

                  <p className="mt-5 text-xs font-medium uppercase tracking-[0.2em] text-slate-400">
                    Video
                  </p>

                  <h4 className="mt-2 font-serif text-2xl font-light text-[#102A43]">
                    A voice meant to stay.
                  </h4>

                  <p className="mt-3 text-sm leading-6 text-slate-500">
                    A private video message recorded especially for
                    you.
                  </p>
                </div>

                {/* Photos */}
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#F0F7FA] text-[#0A7BA8]">
                    <span className="text-lg">▧</span>
                  </div>

                  <p className="mt-5 text-xs font-medium uppercase tracking-[0.2em] text-slate-400">
                    Photos
                  </p>

                  <h4 className="mt-2 font-serif text-2xl font-light text-[#102A43]">
                    Moments to remember.
                  </h4>

                  <p className="mt-3 text-sm leading-6 text-slate-500">
                    A private collection of photographs chosen to stay
                    with you.
                  </p>
                </div>

                {/* Documents */}
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#F0F7FA] text-[#0A7BA8]">
                    <FileText className="h-5 w-5" />
                  </div>

                  <p className="mt-5 text-xs font-medium uppercase tracking-[0.2em] text-slate-400">
                    Documents
                  </p>

                  <h4 className="mt-2 font-serif text-2xl font-light text-[#102A43]">
                    Important things entrusted to you.
                  </h4>

                  <p className="mt-3 text-sm leading-6 text-slate-500">
                    Important documents securely preserved for the right
                    moment.
                  </p>
                </div>
              </div>
            </div>

            {/* Activation footer */}
            <div className="mt-10 flex flex-col items-center justify-between gap-5 border-t border-slate-200 pt-7 md:flex-row">
              <div>
                <p className="text-sm font-medium text-[#102A43]">
                  Your message is ready.
                </p>

                <p className="mt-1 text-sm text-slate-500">
                  You can still make changes before activation.
                </p>
              </div>

              <button
                type="button"
                onClick={() => router.push("/payment")}
                className="inline-flex items-center gap-3 rounded-full bg-[#0A7BA8] px-7 py-3.5 text-sm font-medium text-white transition hover:bg-[#08698F]"
              >
                Protect My Plan
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Brand statement */}
        <p className="mt-8 text-center text-xs tracking-wide text-slate-400">
          Confidence is designed. Trust is earned. Continuity is
          intentional.
        </p>
      </section>
    </main>
  );
}