import { signInWithGoogle, signOut } from "@/app/auth/actions";

export function SignInButton() {
  return (
    <form action={signInWithGoogle}>
      <button
        type="submit"
        className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        Continue with Google
      </button>
    </form>
  );
}

export function SignOutButton() {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        Sign out
      </button>
    </form>
  );
}
