"use client";



import { useEffect, useState } from "react";
import { OnboardingFormLayout } from "./OnboardingFormLayout";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { supabase } from "@/lib/supabase";
export function CreateAccountView() {
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

    if (!user) return;

    setExistingUser(true);

    setEmail(user.email ?? "");
    setFirstName(user.user_metadata?.firstName ?? "");
    setLastName(user.user_metadata?.lastName ?? "");
    setDateOfBirth(user.user_metadata?.dateOfBirth ?? "");
  };

  loadUser();
}, []);
const handleContinue = async () => {
  setError("");

  if (!firstName || !lastName || !dateOfBirth || !email) {
    setError("Please complete all required fields.");
    return;
  }

  setLoading(true);

  if (existingUser) {
    const { error: updateError } = await supabase.auth.updateUser({
      email,
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
    window.location.href = "/your-messages";
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

  if (password.length < 6) {
    setError("Password must be at least 6 characters.");
    setLoading(false);
    return;
  }

  const { data, error: signUpError } = await supabase.auth.signUp({
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

  console.log("ACCOUNT CREATED:", data.user);

  setLoading(false);
  window.location.href = "/your-messages";
};

  return (
    <OnboardingFormLayout step={1} totalSteps={5}>
      <div className="space-y-6">
        <div className="space-y-3 text-center">
          <h1 className="text-5xl font-light tracking-tight text-[#0D2340]">
          Create Your Account
          </h1>

          <p className="mx-auto max-w-lg text-lg leading-8 text-neutral-600">
            Create your secure ETERPAX account and begin building your continuity plan.
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

<Input
  label="Confirm Password"
  type="password"
  placeholder="Re-enter your password"
  value={confirmPassword}
  onChange={(e) => setConfirmPassword(e.target.value)}
/>
{error && (
  <p className="text-sm text-red-500 text-center">
    {error}
  </p>
)}
<div className="flex justify-center pt-4">
<Button onClick={handleContinue} disabled={loading}>
  {loading ? "Creating account..." : "Continue"}
</Button>
</div>
      </div>
      </div>
    </OnboardingFormLayout>
  );
}