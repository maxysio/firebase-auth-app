"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onUserCreated = exports.validateOnSignIn = exports.checkInviteOnCreate = void 0;
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const identity_1 = require("firebase-functions/v2/identity");
const auth_1 = require("firebase-functions/v1/auth");
(0, app_1.initializeApp)();
const db = (0, firestore_1.getFirestore)();
/**
 * Blocking function: runs when a new user account is created.
 * Checks for a valid invite (or superAdmin status) before allowing sign-up.
 */
exports.checkInviteOnCreate = (0, identity_1.beforeUserCreated)(async (event) => {
    const email = event.data?.email;
    if (!email) {
        throw new identity_1.HttpsError("invalid-argument", "Email is required.");
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
        throw new identity_1.HttpsError("permission-denied", "No valid invitation found for this email.");
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
exports.validateOnSignIn = (0, identity_1.beforeUserSignedIn)(async (event) => {
    const uid = event.data?.uid;
    const email = event.data?.email;
    if (!uid || !email) {
        throw new identity_1.HttpsError("invalid-argument", "Email is required.");
    }
    // Check if user document exists in Firestore
    const userDoc = await db.collection("users").doc(uid).get();
    if (userDoc.exists) {
        const userData = userDoc.data();
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
        throw new identity_1.HttpsError("permission-denied", "Your account has been deactivated. Contact an administrator.");
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
exports.onUserCreated = (0, auth_1.user)().onCreate(async (userRecord) => {
    const { uid, email, displayName, photoURL } = userRecord;
    if (!email)
        return;
    // Check if user doc already exists (e.g. superAdmin bootstrapped)
    const existingDoc = await db.collection("users").doc(uid).get();
    if (existingDoc.exists)
        return;
    // Find the matching invite
    const inviteQuery = await db
        .collection("invites")
        .where("email", "==", email)
        .where("status", "==", "pending")
        .limit(1)
        .get();
    if (inviteQuery.empty)
        return;
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
        createdAt: firestore_1.FieldValue.serverTimestamp(),
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    });
    // Mark invite as accepted
    batch.update(inviteDoc.ref, { status: "accepted" });
    // Increment org member count
    batch.update(db.collection("orgs").doc(invite.orgId), {
        memberCount: firestore_1.FieldValue.increment(1),
    });
    await batch.commit();
});
//# sourceMappingURL=index.js.map