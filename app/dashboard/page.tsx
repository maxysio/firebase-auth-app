"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/context";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase/client";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";

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

interface Org {
  id: string;
  name: string;
  slug: string;
  memberCount: number;
}

interface Invite {
  id: string;
  email: string;
  orgId: string;
  role: string;
  status: string;
}

async function getToken() {
  return auth.currentUser?.getIdToken() ?? null;
}

async function apiFetch(path: string, options?: RequestInit) {
  const token = await getToken();
  if (!token) throw new Error("Not authenticated");
  return fetch(path, {
    ...options,
    headers: {
      ...options?.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
}

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [orgName, setOrgName] = useState<string | null>(null);
  const [orgLoading, setOrgLoading] = useState(false);

  // Admin state
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgSlug, setNewOrgSlug] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteOrgId, setInviteOrgId] = useState("");
  const [inviteRole, setInviteRole] = useState("user");
  const [adminMessage, setAdminMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [user, loading, router]);

  // Fetch org name for non-superAdmin users
  useEffect(() => {
    if (!user || user.superAdmin) return;
    if (!user.orgId) return;

    setOrgLoading(true);
    apiFetch("/api/user/org")
      .then((res) => res.json())
      .then((data) => {
        if (data?.org?.name) setOrgName(data.org.name);
      })
      .finally(() => setOrgLoading(false));
  }, [user]);

  const loadOrgs = useCallback(async () => {
    try {
      const res = await apiFetch("/api/orgs");
      if (!res.ok) return;
      const data = await res.json();
      if (data.orgs) setOrgs(data.orgs);
    } catch { /* ignore */ }
  }, []);

  const loadInvites = useCallback(async () => {
    try {
      const res = await apiFetch("/api/invites");
      if (!res.ok) return;
      const data = await res.json();
      if (data.invites) setInvites(data.invites);
    } catch { /* ignore */ }
  }, []);

  // Fetch orgs and invites for superAdmin
  useEffect(() => {
    if (!user?.superAdmin) return;
    loadOrgs();
    loadInvites();
  }, [user, loadOrgs, loadInvites]);

  async function handleSignOut() {
    await signOut(auth);
    router.replace("/login");
  }

  async function handleCreateOrg(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setAdminMessage(null);
    try {
      const res = await apiFetch("/api/orgs", {
        method: "POST",
        body: JSON.stringify({ name: newOrgName, slug: newOrgSlug }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAdminMessage({ type: "error", text: data.error });
      } else {
        setAdminMessage({ type: "success", text: `Organization created (${data.orgId})` });
        setNewOrgName("");
        setNewOrgSlug("");
        await loadOrgs();
      }
    } catch {
      setAdminMessage({ type: "error", text: "Failed to create organization" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateInvite(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setAdminMessage(null);
    try {
      const res = await apiFetch("/api/invites", {
        method: "POST",
        body: JSON.stringify({ email: inviteEmail, orgId: inviteOrgId, role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAdminMessage({ type: "error", text: data.error });
      } else {
        setAdminMessage({ type: "success", text: `Invite sent to ${inviteEmail}` });
        setInviteEmail("");
        await loadInvites();
      }
    } catch {
      setAdminMessage({ type: "error", text: "Failed to create invite" });
    } finally {
      setSubmitting(false);
    }
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
      <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
        {/* Welcome card */}
        <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-base font-medium text-zinc-900 dark:text-zinc-100">
            Welcome, {user.displayName || user.email}
          </h2>
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-zinc-500 dark:text-zinc-400">Email:</span>
              <span className="text-zinc-900 dark:text-zinc-100">{user.email}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-zinc-500 dark:text-zinc-400">Role:</span>
              <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeColor}`}>
                {displayRole}
              </span>
            </div>
            {!user.superAdmin && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-zinc-500 dark:text-zinc-400">Organization:</span>
                <span className="text-zinc-900 dark:text-zinc-100">
                  {orgLoading ? "Loading…" : orgName || (user.orgId ? user.orgId : "None")}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Admin message */}
        {adminMessage && (
          <div
            className={`rounded-lg border px-4 py-3 text-sm ${
              adminMessage.type === "success"
                ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950/50 dark:text-green-200"
                : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200"
            }`}
          >
            {adminMessage.text}
          </div>
        )}

        {/* Super Admin: Organizations */}
        {user.superAdmin && (
          <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <h3 className="text-base font-medium text-zinc-900 dark:text-zinc-100">
              Organizations
            </h3>

            {orgs.length > 0 && (
              <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 dark:bg-zinc-800">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-zinc-600 dark:text-zinc-300">Name</th>
                      <th className="px-4 py-2 text-left font-medium text-zinc-600 dark:text-zinc-300">Slug</th>
                      <th className="px-4 py-2 text-left font-medium text-zinc-600 dark:text-zinc-300">Members</th>
                      <th className="px-4 py-2 text-left font-medium text-zinc-600 dark:text-zinc-300">ID</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                    {orgs.map((org) => (
                      <tr key={org.id}>
                        <td className="px-4 py-2 text-zinc-900 dark:text-zinc-100">{org.name}</td>
                        <td className="px-4 py-2 text-zinc-500 dark:text-zinc-400">{org.slug}</td>
                        <td className="px-4 py-2 text-zinc-500 dark:text-zinc-400">{org.memberCount ?? 0}</td>
                        <td className="px-4 py-2 font-mono text-xs text-zinc-400 dark:text-zinc-500">{org.id}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <form onSubmit={handleCreateOrg} className="mt-4 flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">Name</label>
                <input
                  type="text"
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  placeholder="Acme Corp"
                  required
                  className="mt-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">Slug</label>
                <input
                  type="text"
                  value={newOrgSlug}
                  onChange={(e) => setNewOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                  placeholder="acme-corp"
                  required
                  className="mt-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Create Org
              </button>
            </form>
          </div>
        )}

        {/* Super Admin: Invite Users */}
        {user.superAdmin && (
          <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <h3 className="text-base font-medium text-zinc-900 dark:text-zinc-100">
              Invite User
            </h3>

            <form onSubmit={handleCreateInvite} className="mt-4 flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">Email</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="user@example.com"
                  required
                  className="mt-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">Organization</label>
                <select
                  value={inviteOrgId}
                  onChange={(e) => setInviteOrgId(e.target.value)}
                  required
                  className="mt-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                >
                  <option value="">Select org…</option>
                  {orgs.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">Role</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="mt-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                >
                  <option value="viewer">Viewer</option>
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={submitting || !inviteOrgId}
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Send Invite
              </button>
            </form>

            {invites.length > 0 && (
              <>
                <h4 className="mt-6 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Pending Invites
                </h4>
                <div className="mt-2 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
                  <table className="w-full text-sm">
                    <thead className="bg-zinc-50 dark:bg-zinc-800">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium text-zinc-600 dark:text-zinc-300">Email</th>
                        <th className="px-4 py-2 text-left font-medium text-zinc-600 dark:text-zinc-300">Org</th>
                        <th className="px-4 py-2 text-left font-medium text-zinc-600 dark:text-zinc-300">Role</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                      {invites.map((invite) => (
                        <tr key={invite.id}>
                          <td className="px-4 py-2 text-zinc-900 dark:text-zinc-100">{invite.email}</td>
                          <td className="px-4 py-2 text-zinc-500 dark:text-zinc-400">
                            {orgs.find((o) => o.id === invite.orgId)?.name || invite.orgId}
                          </td>
                          <td className="px-4 py-2">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${roleBadgeColor(invite.role)}`}>
                              {invite.role}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
