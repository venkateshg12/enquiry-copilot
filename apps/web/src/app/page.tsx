"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth.store";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const isBootstrapped = useAuthStore((state) => state.isBootstrapped);

  // A signed-in owner has no use for the landing page.
  useEffect(() => {
    if (isBootstrapped && user) router.replace("/inbox");
  }, [isBootstrapped, user, router]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-xl space-y-6 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-foreground">
          Enquiry<span className="text-primary">Assistant</span>
        </h1>
        <p className="text-lg text-muted-foreground">
          Faster, consistent replies — you approve every one.
        </p>
        <ul className="space-y-2 text-left text-sm text-foreground mx-auto max-w-md list-disc pl-5">
          <li>It reads your website form and your Gmail inbox.</li>
          <li>It drafts replies from your own info sheet, never from guesses.</li>
          <li>Nothing is sent until a person approves it.</li>
        </ul>
        <div className="flex justify-center gap-3">
          <Button asChild>
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/register">Create account</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
