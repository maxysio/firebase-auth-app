"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/context";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase/client";
import Image from "next/image";
import { useEffect, useState } from "react";

function roleBadgeColor(role: string | undefined): string {
  switch (role) {
    case "superAdmin":
      return "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300";
    case "admin":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300";
    case "user":
      return "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300";
    case "viewer":
      return "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300";
    default:
      return "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
  }
}

function roleLabel(role: string | undefined, superAdmin?: boolean): string {
  if (superAdmin) return "Super Admin";
  switch (role) {
    case "admin":
      return "Admin";
    case "user":
      return "User";
    case "viewer":
      return "Viewer";
    default:
      return "Unknown";
  }
}

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [orgName, setOrgName] = useState<string | null>(null);
  const [orgLoading, setOrgLoading] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (!user || user.superAdmin) return;
    if (!user.orgId) return;

    setOrgLoading(true);
    auth.currentUser
      ?.getIdToken()
      .then((token) =>
        fetch("/api/user/org", {
          headers: { Authorization: `Bearer ${token}` },
        })
      )
      .then((res) => res?.json())
      .then((data) => {
        if (data?.org?.name) setOrgName(data.org.name);
      })
      .finally(() => setOrgLoading(false));
  }, [user]);

  async function handleSignOut() {
    await signOut(auth);
    router.replace("/login");
  }

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div className="text-zinc-500 dark:text-zinc-400">Loading…</div>
      </div>
    );
  }

  const displayRole = roleLabel(user.role, user.superAdmin);
  const badgeColor = roleBadgeColor(user.superAdmin ? "superAdmin" : user.role);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Dashboard
          </h1>
          <div className="flex items-center gap-3">
            {user.photoURL ? (
              <Image
                src={user.photoURL}
                alt=""
                width={32}
                height={32}
                className="rounded-full"
              />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-200 text-sm font-medium text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                {(user.displayName || user.email || "?").charAt(0).toUpperCase()}
              </div>
            )}
            <span className="text-sm text-zinc-600 dark:text-zinc-400">
              {user.displayName || user.email || "Signed in"}
            </span>
            <button
              onClick={handleSignOut}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-8">
        <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-base font-medium text-zinc-900 dark:text-zinc-100">
            Welcome, {user.displayName || user.email}
          </h2>

          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-zinc-500 dark:text-zinc-400">Email:</span>
              <span className="text-zinc-900 dark:text-zinc-100">
                {user.email}
              </span>
            </div>

            <div className="flex items-center gap-2 text-sm">
              <span className="text-zinc-500 dark:text-zinc-400">Role:</span>
              <span
                className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeColor}`}
              >
                {displayRole}
              </span>
            </div>

            {!user.superAdmin && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-zinc-500 dark:text-zinc-400">
                  Organization:
                </span>
                <span className="text-zinc-900 dark:text-zinc-100">
                  {orgLoading
                    ? "Loading…"
                    : orgName || (user.orgId ? user.orgId : "None")}
                </span>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
