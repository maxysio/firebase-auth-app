/**
 * One-time bootstrap script: create or promote a Super Admin user.
 *
 * Run from project root with env loaded (e.g. from .env.local):
 *   npx tsx scripts/bootstrap-super-admin.ts --email admin@example.com --password "secure-password"
 *   npx tsx scripts/bootstrap-super-admin.ts --uid <existing-firebase-auth-uid>
 *
 * Option 1: Create new email/password user, set superAdmin claim, create Firestore user doc.
 * Option 2: Use existing UID (e.g. after first Google sign-in), set claim and create/update Firestore doc.
 */

import dotenv from "dotenv";
import path from "path";

// Load .env.local before any Firebase Admin imports (run from project root)
dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const SUPER_ADMIN_CLAIMS = { superAdmin: true } as const;

async function main() {
  const { getAuth, getFirestore } = await import("../lib/firebase/admin");
  const { Timestamp } = await import("firebase-admin/firestore");
  const auth = getAuth();
  const db = getFirestore();

  const args = process.argv.slice(2);
  const emailIdx = args.indexOf("--email");
  const passwordIdx = args.indexOf("--password");
  const uidIdx = args.indexOf("--uid");

  const email = emailIdx >= 0 ? args[emailIdx + 1] : undefined;
  const password = passwordIdx >= 0 ? args[passwordIdx + 1] : undefined;
  const uidArg = uidIdx >= 0 ? args[uidIdx + 1] : undefined;

  let uid: string;
  let emailForDoc: string;
  let displayName = "";
  let photoURL = "";

  if (uidArg) {
    // Mode 2: Use existing user by UID
    const user = await auth.getUser(uidArg);
    uid = user.uid;
    emailForDoc = user.email ?? "";
    displayName = user.displayName ?? "";
    photoURL = user.photoURL ?? "";
    console.log("Using existing user:", uid, emailForDoc);
  } else if (email && password) {
    // Mode 1: Create new email/password user
    const created = await auth.createUser({
      email,
      password,
      emailVerified: true,
    });
    uid = created.uid;
    emailForDoc = created.email ?? email;
    displayName = created.displayName ?? "";
    photoURL = created.photoURL ?? "";
    console.log("Created new Auth user:", uid, emailForDoc);
  } else {
    console.error(
      "Usage:\n" +
        "  Create new user:  npx tsx scripts/bootstrap-super-admin.ts --email <email> --password <password>\n" +
        "  Use existing UID: npx tsx scripts/bootstrap-super-admin.ts --uid <firebase-auth-uid>"
    );
    process.exit(1);
  }

  // Set custom claims
  await auth.setCustomUserClaims(uid, SUPER_ADMIN_CLAIMS);
  console.log("Set custom claims: superAdmin = true");

  const now = Timestamp.now();
  const userRef = db.collection("users").doc(uid);
  const userDoc = {
    email: emailForDoc,
    displayName,
    photoURL,
    orgId: null as string | null,
    role: "superAdmin" as const,
    createdAt: now,
    updatedAt: now,
  };

  await userRef.set(userDoc, { merge: true });
  console.log("Created/updated Firestore document: /users/" + uid);

  console.log("\nDone. Super Admin bootstrapped:", emailForDoc || uid);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
