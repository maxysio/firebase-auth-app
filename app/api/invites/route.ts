import { NextResponse } from "next/server";
import { getAuth, getFirestore } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";

const VALID_ROLES = ["viewer", "user", "admin"];
const INVITE_EXPIRY_DAYS = 7;

async function verifySuperAdmin(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;

  try {
    const decoded = await getAuth().verifyIdToken(token);
    if (!decoded.superAdmin) return null;
    return decoded;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const user = await verifySuperAdmin(request);
  if (!user) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const snapshot = await getFirestore()
      .collection("invites")
      .where("status", "==", "pending")
      .get();

    const invites = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return NextResponse.json({ invites });
  } catch (err) {
    console.error("Failed to fetch invites:", err);
    return NextResponse.json({ error: "Failed to fetch invites" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await verifySuperAdmin(request);
  if (!user) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { email, orgId, role } = await request.json();

  if (!email || !orgId || !role) {
    return NextResponse.json(
      { error: "Email, orgId, and role are required" },
      { status: 400 }
    );
  }

  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json(
      { error: `Role must be one of: ${VALID_ROLES.join(", ")}` },
      { status: 400 }
    );
  }

  const db = getFirestore();

  // Verify org exists
  const orgDoc = await db.collection("orgs").doc(orgId).get();
  if (!orgDoc.exists) {
    return NextResponse.json(
      { error: "Organization not found" },
      { status: 404 }
    );
  }

  // Check for existing pending invite
  const existingInvite = await db
    .collection("invites")
    .where("email", "==", email)
    .where("status", "==", "pending")
    .limit(1)
    .get();

  if (!existingInvite.empty) {
    return NextResponse.json(
      { error: "A pending invite already exists for this email" },
      { status: 409 }
    );
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + INVITE_EXPIRY_DAYS);

  const inviteRef = await db.collection("invites").add({
    email,
    orgId,
    role,
    invitedBy: user.uid,
    status: "pending",
    expiresAt,
    createdAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ inviteId: inviteRef.id });
}
