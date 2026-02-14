import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import {
  beforeUserCreated,
  beforeUserSignedIn,
  HttpsError,
} from "firebase-functions/v2/identity";
import { user } from "firebase-functions/v1/auth";

initializeApp();
const db = getFirestore();

/**
 * Blocking function: runs when a new user account is created.
 * Checks for a valid invite (or superAdmin status) before allowing sign-up.
 */
export const checkInviteOnCreate = beforeUserCreated(async (event) => {
  const email = event.data?.email;
  if (!email) {
    throw new HttpsError("invalid-argument", "Email is required.");
  }

  // Allow superAdmin (bootstrapped via Admin SDK)
  const superAdminQuery = await db
    .collection("users")
    .where("email", "==", email)
    .where("role", "==", "superAdmin")
    .limit(1)
    .get();

  if (!superAdminQuery.empty) {
    return { customClaims: { superAdmin: true } };
  }

  // Check for a valid pending invite
  const inviteQuery = await db
    .collection("invites")
    .where("email", "==", email)
    .where("status", "==", "pending")
    .where("expiresAt", ">", new Date())
    .limit(1)
    .get();

  if (inviteQuery.empty) {
    throw new HttpsError(
      "permission-denied",
      "No valid invitation found for this email."
    );
  }

  const invite = inviteQuery.docs[0].data();

  return {
    customClaims: {
      role: invite.role,
      orgId: invite.orgId,
    },
  };
});

/**
 * Blocking function: runs on every sign-in attempt.
 * Re-validates the user and refreshes custom claims from Firestore.
 */
export const validateOnSignIn = beforeUserSignedIn(async (event) => {
  const uid = event.data?.uid;
  const email = event.data?.email;

  if (!uid || !email) {
    throw new HttpsError("invalid-argument", "Email is required.");
  }

  // Check if user document exists in Firestore
  const userDoc = await db.collection("users").doc(uid).get();

  if (userDoc.exists) {
    const userData = userDoc.data()!;

    // SuperAdmin — always allow
    if (userData.role === "superAdmin") {
      return { customClaims: { superAdmin: true } };
    }

    // Regular user with a valid role and org — refresh claims
    if (userData.role && userData.orgId) {
      return {
        customClaims: {
          role: userData.role,
          orgId: userData.orgId,
        },
      };
    }

    // User doc exists but has no valid role — block
    throw new HttpsError(
      "permission-denied",
      "Your account has been deactivated. Contact an administrator."
    );
  }

  // No user doc — this is a brand new sign-up, the beforeUserCreated
  // function already validated the invite. Allow sign-in to proceed.
  // The onCreate trigger will create the user doc shortly after.
  return {};
});

/**
 * Auth trigger (v1): runs after a new user is successfully created.
 * Creates the user document, marks the invite as accepted,
 * and increments the org member count.
 */
export const onUserCreated = user().onCreate(async (userRecord) => {
  const { uid, email, displayName, photoURL } = userRecord;

  if (!email) return;

  // Check if user doc already exists (e.g. superAdmin bootstrapped)
  const existingDoc = await db.collection("users").doc(uid).get();
  if (existingDoc.exists) return;

  // Find the matching invite
  const inviteQuery = await db
    .collection("invites")
    .where("email", "==", email)
    .where("status", "==", "pending")
    .limit(1)
    .get();

  if (inviteQuery.empty) return;

  const inviteDoc = inviteQuery.docs[0];
  const invite = inviteDoc.data();

  const batch = db.batch();

  // Create user document
  batch.set(db.collection("users").doc(uid), {
    email,
    displayName: displayName || "",
    photoURL: photoURL || "",
    orgId: invite.orgId,
    role: invite.role,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Mark invite as accepted
  batch.update(inviteDoc.ref, { status: "accepted" });

  // Increment org member count
  batch.update(db.collection("orgs").doc(invite.orgId), {
    memberCount: FieldValue.increment(1),
  });

  await batch.commit();
});
