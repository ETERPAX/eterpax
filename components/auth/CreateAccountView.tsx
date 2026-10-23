"use client";



import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { OnboardingFormLayout } from "./OnboardingFormLayout";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { supabase } from "@/lib/supabase";
export function CreateAccountView({ mode = "create" }: { mode?: "create" | "edit" }) {
  const editing = mode === "edit";
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
const [existingUser, setExistingUser] = useState(false);
useEffect(() => {
  const loadUser = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      if (editing) router.replace("/login");
      return;
    }

    setExistingUser(true);

    setEmail(user.email ?? "");
    setFirstName(user.user_metadata?.firstName ?? "");
    setLastName(user.user_metadata?.lastName ?? "");
    setDateOfBirth(user.user_metadata?.dateOfBirth ?? "");
    setLoaded(true);
  };

  void loadUser().catch(() => setError("We couldn’t load your account. Please refresh."));
}, [editing, router]);
const handleContinue = async () => {
  setError("");
  if (editing && (!loaded || !existingUser)) return;

  if (!firstName || !lastName || !dateOfBirth || !email) {
    setError("Please complete all required fields.");
    return;
  }

  setLoading(true);

  if (existingUser) {
    const { error: updateError } = await supabase.auth.updateUser({
      ...(editing ? {} : { email }),
      data: {
        firstName,
        lastName,
        dateOfBirth,
      },
    });

    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }

    setLoading(false);
    window.location.assign(editing ? "/settings" : "/dashboard");
    return;
  }

  if (!password || !confirmPassword) {
    setError("Please create and confirm your password.");
    setLoading(false);
    return;
  }

  if (password !== confirmPassword) {
    setError("Passwords do not match.");
    setLoading(false);
    return;
  }

  if (password.length < 8) {
    setError("Password must be at least 8 characters.");
    setLoading(false);
    return;
  }

  const { error: signUpError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        firstName,
        lastName,
        dateOfBirth,
      },
    },
  });

  if (signUpError) {
    setError(signUpError.message);
    setLoading(false);
    return;
  }

  setLoading(false);
  window.location.assign("/dashboard");
};

  if (editing && !loaded) return <main className="min-h-screen bg-[#F7F8FA] px-6 py-12">
    <Link href="/settings" className="text-sm font-medium text-[#0F5C88]">← Back to Settings</Link>
    <p className="mt-6" role={error ? "alert" : "status"}>{error || "Loading your account…"}</p>
  </main>;

  const form = (
      <div className="space-y-6">
        <div className="space-y-3 text-center">
          <h1 className="text-5xl font-light tracking-tight text-[#0D2340]">
          {editing ? "Personal information" : "Create Your Account"}
          </h1>

          <p className="mx-auto max-w-lg text-lg leading-8 text-neutral-600">
            {editing ? "Update your personal account details." : "Create your secure ETERPAX account and begin building your continuity plan."}
          </p>
        </div>

        <div className="space-y-5">

        <Input
  label="First Name"
  placeholder="Enter your first name"
  value={firstName}
  onChange={(e) => setFirstName(e.target.value)}
/>

<Input
  label="Last Name"
  placeholder="Enter your last name"
  value={lastName}
  onChange={(e) => setLastName(e.target.value)}
/>

<Input
  label="Date of Birth"
  type="date"
  value={dateOfBirth}
  onChange={(e) => setDateOfBirth(e.target.value)}
/>

{!editing && <>
<Input
  label="Email"
  type="email"
  placeholder="Enter your email address"
  value={email}
  onChange={(e) => setEmail(e.target.value)}
/>

<Input
  label="Password"
  type="password"
  placeholder="Create a strong password"
  value={password}
  onChange={(e) => setPassword(e.target.value)}
/>
<p className="text-sm text-neutral-500 -mt-3">
  Use at least 8 characters. For better security, use a mix of letters,
  numbers, and symbols.
</p>
<Input
  label="Confirm Password"
  type="password"
  placeholder="Re-enter your password"
  value={confirmPassword}
  onChange={(e) => setConfirmPassword(e.target.value)}
/>
</>}
{error && (
  <p className="text-sm text-red-500 text-center">
    {error}
  </p>
)}
<div className="flex justify-center pt-4">
<Button onClick={handleContinue} disabled={loading}>
  {loading ? (editing ? "Saving..." : "Creating account...") : (editing ? "Save changes" : "Continue")}
</Button>
</div>
      </div>
      </div>
  );
  if (editing) return <main className="min-h-screen bg-[#F7F8FA] px-6 py-12">
    <div className="mx-auto max-w-3xl">
      <Link href="/settings" className="text-sm font-medium text-[#0F5C88] hover:underline">← Back to Settings</Link>
      <section className="mt-8 rounded-3xl border border-neutral-200 bg-white p-7">{form}</section>
    </div>
  </main>;
  return <OnboardingFormLayout step={1} totalSteps={5}>{form}</OnboardingFormLayout>;
}