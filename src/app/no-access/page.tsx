import Link from "next/link";
import { ShieldAlert } from "lucide-react";

/** For a role that can open no screen at all (a custom role with too little in it). */
export default function NoAccess() {
  return (
    <main id="main" className="flex min-h-screen items-center justify-center p-6">
      <div className="card max-w-md p-6 text-center">
        <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-amber-600" aria-hidden />
        <h1 className="text-lg font-semibold">Your role has no screens yet</h1>
        <p className="mt-2 text-sm text-fg-muted">Ask your Pharmacy Admin to give your role at least one permission, then sign in again.</p>
        <Link href="/login" className="mt-4 inline-block text-sm text-primary hover:underline">Back to sign-in</Link>
      </div>
    </main>
  );
}
