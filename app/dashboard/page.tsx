"use client";
import { useLanguage } from "@/components/LanguageProvider";

import Link from "next/link";
import { parseActivationEligibility, protectionPresentation } from "@/lib/activation-policy/presentation";
import { YourPlanModal } from "@/components/dashboard/YourPlanModal";
import { useMessageDeletion } from "@/components/messages/useMessageDeletion";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  ArrowRight,
  Check,
  
  MessageCircle,
 
  ShieldCheck,
  Users,
} from "lucide-react";



type CheckInState = {
  frequency_days: number;
  enabled: boolean;
  status: "scheduled" | "awaiting_response" | "escalation_pending";
  missed_count: number;
  last_check_in_at: string | null;
  next_check_in_at: string | null;
  response_deadline_at: string | null;
};

const checkInColumns = "frequency_days, enabled, status, missed_count, last_check_in_at, next_check_in_at, response_deadline_at";

function isCheckInState(value: unknown): value is CheckInState {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.frequency_days === "number"
    && typeof row.enabled === "boolean"
    && ["scheduled", "awaiting_response", "escalation_pending"].includes(String(row.status))
    && typeof row.missed_count === "number"
    && [row.last_check_in_at, row.next_check_in_at, row.response_deadline_at]
      .every(value => value === null || (typeof value === "string" && Number.isFinite(Date.parse(value))));
}

export default function DashboardPage() {
  const { message: ui, format } = useLanguage();
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [guardianCount, setGuardianCount] = useState(0);
  const [messageCount, setMessageCount] = useState(0);
  const [showMessagesModal, setShowMessagesModal] = useState(false);
  const [checkIn, setCheckIn] = useState<CheckInState | null>(null);
  const [checkInLoading, setCheckInLoading] = useState(true);
  const [confirmingCheckIn, setConfirmingCheckIn] = useState(false);
  const confirmInFlight = useRef(false);
  const [checkInError, setCheckInError] = useState<string | null>(null);
  const [checkInSuccess, setCheckInSuccess] = useState(false);
  const [protection, setProtection] = useState({
    title: "Loading…", detail: "Checking your protection status.", deadline: "",
  });
  const [messages, setMessages] = useState<
  {
    id: string;
    recipient_name: string;
    recipient_email: string;
    status: string;
    deletion_state: string;
  }[]
>([]);

  const completedDeletions = useRef(new Set<string>());
  const deletion = useMessageDeletion(() => {}, id => {
    if (completedDeletions.current.has(id)) return;
    completedDeletions.current.add(id);
    setMessages(current => current.filter(message => message.id !== id));
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { count, error } = await supabase.from("messages")
        .select("id", { count: "exact", head: true }).eq("user_id", user.id);
      if (!error) setMessageCount(count ?? 0);
    })().catch(() => { /* Keep the previous count if refresh is unavailable. */ });
  });
  const deletionLabels = {
    deleting: "Deleting…", pending: "Cleanup pending", blocked: "Deletion blocked",
    deleted: "Message deleted", unknown: "Result uncertain — check deletion status",
  };

  useEffect(() => {
    const loadGuardianCount = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
    
      if (!user) {
        setGuardianCount(0);
        return;
      }
    
      const { count, error } = await supabase
        .from("guardians")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id);
    
      if (error) {
        console.error("ERROR LOADING GUARDIAN COUNT:", error);
        setGuardianCount(0);
        return;
      }
    
      setGuardianCount(count ?? 0);
    };
    const loadCheckIn = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          setCheckInError("Please sign in to confirm your Check-in.");
          return;
        }

        const { data, error } = await supabase
          .from("check_ins")
          .select(checkInColumns)
          .eq("user_id", user.id)
          .maybeSingle();

        if (error || (data && !isCheckInState(data))) {
          throw error ?? new Error("Unexpected Check-in state");
        }

        setCheckIn(data);
      } catch {
        setCheckInError("We could not load your Check-in. Please refresh to try again.");
      } finally {
        setCheckInLoading(false);
      }
    };
    
    loadGuardianCount();
    loadCheckIn();
    const loadProtection = async () => {
      try {
        const { data, error } = await supabase.rpc("get_account_activation_eligibility");
        if (error) throw error;
        setProtection(protectionPresentation(parseActivationEligibility(data)));
      } catch {
        setProtection({
          title: "Status unavailable",
          detail: "Please refresh to check your protection status.",
          deadline: "",
        });
      }
    };

    void loadProtection();

    const loadMessageCount = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setMessageCount(0);
        return;
      }

      const { count, error } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id);

      if (error) {
        console.error("ERROR LOADING MESSAGE COUNT:", error);
        setMessageCount(0);
        return;
      }

      setMessageCount(count ?? 0);
      const { data: messageData, error: messageError } = await supabase
  .from("messages")
  .select("id, recipient_name, recipient_email, status, deletion_state")
  .eq("user_id", user.id)
  .order("created_at", { ascending: false });

if (messageError) {
  console.error("ERROR LOADING MESSAGES:", messageError);
  setMessages([]);
  return;
}

setMessages(messageData ?? []);
    };

    loadMessageCount();
  }, []);

  const confirmCheckIn = async () => {
    if (confirmInFlight.current || checkInLoading || !checkIn) return;
    confirmInFlight.current = true;
    setConfirmingCheckIn(true);
    setCheckInError(null);
    setCheckInSuccess(false);
    let confirmationAccepted = false;

    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        setCheckInError("Please sign in again to confirm your Check-in.");
        return;
      }

      const { data, error } = await supabase.rpc("confirm_check_in");
      if (error) throw error;
      confirmationAccepted = true;

      let updated: unknown = Array.isArray(data) && data.length === 1 ? data[0] : data;
      if (!isCheckInState(updated)) {
        const { data: refreshed, error: refreshError } = await supabase
          .from("check_ins")
          .select(checkInColumns)
          .eq("user_id", user.id)
          .single();
        if (refreshError) throw refreshError;
        updated = refreshed;
      }
      if (!isCheckInState(updated)) throw new Error("Unexpected Check-in state");

      setCheckIn(updated);
      setCheckInSuccess(true);
    } catch {
      setCheckInError(confirmationAccepted
        ? "Your request completed, but we could not refresh your Check-in. Please reload to verify its state."
        : "We could not confirm your Check-in. Please try again. If the connection was interrupted, reload to verify its state.");
    } finally {
      confirmInFlight.current = false;
      setConfirmingCheckIn(false);
    }
  };

  const hasMessages = messageCount > 0;
  const hasGuardians = guardianCount > 0;

  return (
    <main className="relative min-h-dvh bg-[#F7F8FA]">
      {/* Background */}
      <div className="absolute inset-0">
        <img
          src="/images/hero-family-warm.jpg"
          alt=""
          className="h-full w-full object-cover object-right"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#3B1F00]/40 via-[#F97316]/35 to-[#F59E0B]/15" />
        <div className="absolute inset-0 bg-black/10" />
      </div>

      <div className="relative z-10 min-h-dvh">
        <div className="mx-auto flex min-h-dvh w-full max-w-[1500px] flex-col px-6 py-7 lg:px-10 lg:py-[clamp(0.5rem,1dvh,2.25rem)]">
          {/* Header */}
          <header className="flex items-start justify-between">
            <div>
              <div className="text-2xl font-light tracking-[0.35em] text-white">
                ETERPAX
              </div>

              <div className="mt-3 max-w-xs text-[10px] font-medium leading-4 tracking-[0.12em] text-white/70 lg:mt-1 lg:leading-[1.4]">
                Confidence is designed.
                <br />
                Trust is earned.
                <br />
                Continuity is intentional.
              </div>
            </div>
           
            {/* Settings */}
<Link
  href="/settings"
  className="inline-flex items-center justify-center rounded-full border border-white/30 bg-white/90 px-6 py-3 text-sm font-medium text-[#17375E] shadow-lg backdrop-blur-sm transition hover:bg-white"
>{ui("Settings")}</Link>
          </header>

          {/* Main */}
          <div className="flex flex-1 items-center py-10 lg:py-[clamp(0.5rem,1dvh,2.5rem)]">
            <div className="w-full">
              <div className="mx-auto max-w-6xl">
                {/* Intro */}
                <div className="mb-8 max-w-2xl lg:mb-[clamp(0.5rem,1dvh,2rem)]">
                  <p className="text-sm font-medium uppercase tracking-[0.24em] text-white/75">{ui("Your ETERPAX")}</p>

                  <h1 className="mt-3 font-serif text-5xl leading-[1.05] tracking-tight text-white md:text-6xl lg:mt-1 lg:text-[clamp(3rem,6.65dvh,4.5rem)]">{ui("A place for what")}<br />{ui("you want to leave.")}</h1>

                  <p className="mt-6 max-w-xl text-lg leading-8 text-white/80 lg:mt-[clamp(0.25rem,0.5dvh,1.5rem)]">{ui("Your words, your memories, and the things only you can give.")}</p>
                </div>

                {/* Messages — Main Card */}
                <div className="rounded-[30px] border border-white/60 bg-white/95 p-7 shadow-2xl backdrop-blur-md md:p-9 lg:py-[clamp(0.75rem,1.5dvh,2.25rem)]">
                  <div className="flex flex-col gap-7 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-start gap-5">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#0A7BA8]/10">
                        <MessageCircle className="h-7 w-7 text-[#0A7BA8]" />
                      </div>

                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#0A7BA8]">{ui("Your Messages")}</p>

                        {hasMessages ? (
                          <>
                            <h2 className="mt-2 text-2xl font-medium text-[#0D2340]">
                              {messageCount}{" "}
                              {messageCount === 1 ? ui("Message") : ui("Messages")}
                            </h2>

                            <p className="mt-2 max-w-lg text-sm leading-6 text-neutral-600">{ui("What you choose to leave, in your own words and your own way.")}</p>
                          </>
                        ) : (
                          <>
                            <h2 className="mt-2 text-2xl font-medium text-[#0D2340]">{ui("Nothing here yet.")}</h2>

                            <p className="mt-2 max-w-lg text-sm leading-6 text-neutral-600">{ui("When you're ready, create something that stays.")}</p>
                          </>
                        )}
                      </div>
                    </div>

                    <Link
                      href="/your-messages?new=true"
                      className="inline-flex shrink-0 items-center justify-center rounded-full bg-[#0A7BA8] px-7 py-3.5 text-sm font-medium text-white shadow-lg shadow-[#0A7BA8]/20 transition hover:-translate-y-0.5 hover:bg-[#08698F]"
                    >
                      {hasMessages
                        ? ui("Leave Something New")
                        : ui("Create Your First Message")}
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                    {hasMessages && (
  <button
    type="button"
    onClick={() => setShowMessagesModal(true)}
    className="inline-flex shrink-0 items-center justify-center rounded-full bg-[#0A7BA8] px-5 py-2.5 text-sm font-medium text-white shadow-md transition hover:bg-[#08698f]"
  >{ui("View Messages")}</button>
)}
                  </div>
                </div>
               
                {/* Supporting Areas */}
                <div className="mt-5 grid gap-5 md:grid-cols-3 lg:mt-[clamp(0.5rem,1dvh,1.25rem)]">
                  {/* Guardians */}
                  <Link
                    href="/guardians"
                    className="group rounded-[26px] border border-white/60 bg-white/90 p-6 shadow-xl backdrop-blur-md lg:py-[clamp(0.75rem,1.5dvh,1.5rem)] transition hover:-translate-y-1 hover:bg-white"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#0A7BA8]/10">
                        <Users className="h-5 w-5 text-[#0A7BA8]" />
                      </div>

                      {hasGuardians && (
                        <Check className="h-5 w-5 text-[#0A7BA8]" />
                      )}
                    </div>

                    <p className="mt-5 lg:mt-[clamp(0.375rem,0.75dvh,1.25rem)] text-xs font-semibold uppercase tracking-[0.16em] text-[#0A7BA8]">{ui("Your Guardians")}</p>

                    <h3 className="mt-2 lg:mt-1 text-xl font-medium text-[#0D2340]">
                      {hasGuardians
                        ? `${guardianCount} ${ui(guardianCount === 1 ? "Guardian" : "Guardians")}`
                        : ui("Not started")}
                    </h3>

                    <p className="mt-2 lg:mt-1 text-sm leading-6 lg:leading-5 text-neutral-500">{ui("People you trust to help carry out your ETERPAX protocol.")}</p>

                    <div className="mt-5 lg:mt-[clamp(0.375rem,0.75dvh,1.25rem)] flex items-center text-sm font-medium text-[#17375E]">
                      {hasGuardians ? ui("View Guardians") : ui("Choose your Guardians")}
                      <ArrowRight className="ml-2 h-4 w-4 transition group-hover:translate-x-1" />
                    </div>
                  </Link>

                  {/* Check-in */}
                  <div
                    className="group rounded-[26px] border border-white/60 bg-white/90 p-6 shadow-xl backdrop-blur-md lg:py-[clamp(0.75rem,1.5dvh,1.5rem)] transition hover:-translate-y-1 hover:bg-white"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#0A7BA8]/10">
                        <ShieldCheck className="h-5 w-5 text-[#0A7BA8]" />
                      </div>
                    </div>

                    <p className="mt-5 lg:mt-[clamp(0.375rem,0.75dvh,1.25rem)] text-xs font-semibold uppercase tracking-[0.16em] text-[#0A7BA8]">{ui("Your Check-in")}</p>

                    <h3 className="mt-2 lg:mt-1 text-xl font-medium text-[#0D2340]">
                    {checkInLoading ? ui("Loading...") : checkIn ? format("Every {count} days", { count: checkIn.frequency_days }) : checkInError ? ui("Unavailable") : ui("Not configured")}
                    </h3>

                    <p className="mt-2 lg:mt-1 text-sm leading-6 lg:leading-5 text-neutral-500">{ui("Stay connected with ETERPAX through your chosen check-in schedule.")}</p>

                    {checkIn && (
                      <div className="mt-3 lg:mt-[clamp(0.375rem,0.75dvh,0.75rem)] space-y-1 lg:space-y-0 text-sm leading-6 lg:leading-5 text-neutral-500">
                        <p>{!checkIn.enabled ? ui("Check-ins paused") : checkIn.status === "scheduled" ? ui("Scheduled") : checkIn.status === "awaiting_response" ? ui("Awaiting your response") : ui("Escalation pending")}</p>
                        <p>{ui("Missed check-ins:")} {checkIn.missed_count}</p>
                        {checkIn.last_check_in_at && <p>{ui("Last confirmed:")} {new Date(checkIn.last_check_in_at).toLocaleString()}</p>}
                        {checkIn.enabled && checkIn.next_check_in_at && <p>{ui("Next check-in:")} {new Date(checkIn.next_check_in_at).toLocaleString()}</p>}
                        {checkIn.enabled && checkIn.response_deadline_at && <p>{ui("Respond by:")} {new Date(checkIn.response_deadline_at).toLocaleString()}</p>}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={confirmCheckIn}
                      disabled={checkInLoading || !checkIn || confirmingCheckIn}
                      aria-busy={confirmingCheckIn}
                      className="mt-5 lg:mt-[clamp(0.375rem,0.75dvh,1.25rem)] inline-flex items-center justify-center rounded-full bg-[#0A7BA8] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#08698F] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {confirmingCheckIn ? ui("Confirming...") : ui("I'm OK")}
                    </button>
                    {checkInSuccess && <p role="status" className="mt-3 lg:mt-[clamp(0.375rem,0.75dvh,0.75rem)] text-sm text-[#0A7BA8]">{ui("Thank you. Your Check-in is confirmed.")}{checkIn && !checkIn.enabled ? ui(" Check-ins remain paused.") : ""}</p>}
                    {checkInError && <p role="alert" className="mt-3 lg:mt-[clamp(0.375rem,0.75dvh,0.75rem)] text-sm text-red-700">{ui(checkInError)}</p>}

                    <Link href="/check-in-settings" className="mt-5 lg:mt-[clamp(0.375rem,0.75dvh,1.25rem)] flex items-center text-sm font-medium text-[#17375E]">{ui("Manage Check-in")}<ArrowRight className="ml-2 h-4 w-4 transition group-hover:translate-x-1" />
                    </Link>
                  </div>

                  {/* Protection */}
                  <div className="rounded-[26px] border border-white/60 bg-white/90 p-6 shadow-xl backdrop-blur-md lg:py-[clamp(0.75rem,1.5dvh,1.5rem)]">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#0A7BA8]/10">
                      <ShieldCheck className="h-5 w-5 text-[#0A7BA8]" />
                    </div>

                    <p className="mt-5 lg:mt-[clamp(0.375rem,0.75dvh,1.25rem)] text-xs font-semibold uppercase tracking-[0.16em] text-[#0A7BA8]">{ui("Your Protection")}</p>

                    <h3 className="mt-2 lg:mt-1 text-xl font-medium text-[#0D2340]">
  {ui(protection.title)}
</h3>

                    <p className="mt-2 lg:mt-1 text-sm leading-6 lg:leading-5 text-neutral-500">
                      {ui(protection.detail)}
                    </p>

                    <p className="mt-5 lg:mt-[clamp(0.375rem,0.75dvh,1.25rem)] text-sm font-medium text-neutral-400">
                      {ui(protection.deadline)}
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowPlanModal(true)}
                      aria-haspopup="dialog"
                      className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded text-sm font-medium text-[#17375E] hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0A7BA8]"
                    >{ui("View Your Plan")}<ArrowRight aria-hidden="true" className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Closing line */}
                <div className="mt-8 text-center lg:mt-[clamp(0.5rem,1dvh,2rem)]">
                  <p className="text-sm tracking-wide text-white/70">{ui("Private by design. Always in your control.")}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <footer className="flex justify-end">
            <p className="text-xs tracking-wide text-white/55">
              ETERPAX
            </p>
          </footer>
        </div>
      </div>
      {showPlanModal && <YourPlanModal onClose={() => setShowPlanModal(false)} />}
      {showMessagesModal && (
  <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-6 backdrop-blur-sm">
    <div className="relative w-full max-w-4xl rounded-[32px] border border-white/70 bg-[#FCFBF8]/95 p-8 shadow-2xl md:p-10">
      
      <button
        type="button"
        onClick={() => setShowMessagesModal(false)}
        className="absolute right-7 top-7 flex h-10 w-10 items-center justify-center rounded-full text-xl text-neutral-500 transition hover:bg-black/5 hover:text-[#17375E]"
        aria-label={ui("Close messages")}
      >
        ×
      </button>

      <div className="pr-14">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#0A7BA8]">{ui("Your Messages")}</p>

        <h2 className="mt-3 font-serif text-4xl text-[#0D2340]">{ui("What you've chosen to preserve.")}</h2>

        <p className="mt-3 max-w-xl text-sm leading-6 text-neutral-500">{ui("Your words and memories, kept together in one place.")}</p>
        <Link
  href="/your-messages?new=true"
  className="mt-5 inline-flex items-center text-sm font-medium text-[#0A7BA8] transition hover:text-[#08698F]"
>{ui("+ Leave Something New")}</Link>
      </div>

      {deletion.notice && <p role="status" className="mt-5 rounded-xl border border-neutral-300 bg-white p-4 text-sm text-[#0D2340]">{ui(deletion.notice)}</p>}
      <div className="mt-8 max-h-[360px] space-y-3 overflow-y-auto pr-2">
  {messages.map((message) => {
    const state = deletion.states[message.id];
    const pending = message.deletion_state === "deleting" || deletion.pending.includes(message.id);
    const unavailable = pending || state === "unknown" || deletion.busy === message.id;
    return (
    <div
      key={message.id}
      className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-neutral-200 bg-white/80 px-5 py-4"
    >
      <div className="min-w-0">
        <p className="truncate font-medium text-[#0D2340]">
          {message.recipient_name}
        </p>

        <p className="mt-1 truncate text-sm text-neutral-500">
          {message.recipient_email}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4 sm:ml-6">
        {unavailable ? <span className="text-sm text-neutral-500">{ui("Edit unavailable")}</span> : <>
        <Link
          href={`/your-messages?message=${message.id}`}
          className="text-sm font-medium text-[#17375E] transition hover:text-[#0A7BA8]"
        >{ui("Edit")}</Link>

        <Link
          href={`/review?message=${message.id}`}
          className="text-sm font-medium text-[#0A7BA8] transition hover:text-[#08698F]"
        >{ui("Preview")}</Link>
        </>}
        {(state || pending) && <span role="status" className="text-sm font-medium text-[#0D2340]">{state ? ui(deletionLabels[state]) : ui("Cleanup pending")}</span>}
        {deletion.enabled && (pending || state === "unknown" ? (
          <button type="button" disabled={deletion.busy !== null}
            onClick={() => void deletion.run(message.id, "check")}
            className="text-sm font-medium text-[#0A7BA8] underline disabled:opacity-50">{ui("Check deletion status")}</button>
        ) : message.status === "draft" && message.deletion_state === "active" ? (
          <button type="button" disabled={deletion.busy !== null}
            onClick={() => void deletion.run(message.id, "delete", message.recipient_name)}
            className="text-sm font-medium text-red-700 disabled:opacity-50">{ui("Delete Message")}</button>
        ) : null)}
      </div>
    </div>
  );})}
  {deletion.pending.filter(id => !messages.some(message => message.id === id)).map(id => (
    <div key={id} className="rounded-xl border border-neutral-300 bg-white p-4 text-sm text-[#0D2340]">
      <p role="status">{deletion.states[id] ? ui(deletionLabels[deletion.states[id]]) : ui("Cleanup pending")}</p>
      {deletion.enabled && <button type="button" disabled={deletion.busy !== null}
        onClick={() => void deletion.run(id, "check")}
        className="mt-2 text-[#0A7BA8] underline disabled:opacity-50">{ui("Check deletion status")}</button>}
    </div>
  ))}
</div>
    </div>
  </div>
)}
    </main>
  );
}
