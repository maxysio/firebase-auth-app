import { NextResponse } from "next/server";
import { getAuth, getFirestore } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";

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

  const snapshot = await getFirestore().collection("orgs").orderBy("name").get();
  const orgs = snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));

  return NextResponse.json({ orgs });
}

export async function POST(request: Request) {
  const user = await verifySuperAdmin(request);
  if (!user) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { name, slug } = await request.json();

  if (!name || !slug) {
    return NextResponse.json(
      { error: "Name and slug are required" },
      { status: 400 }
    );
  }

  const db = getFirestore();

  // Check slug uniqueness
  const existing = await db
    .collection("orgs")
    .where("slug", "==", slug)
    .limit(1)
    .get();

  if (!existing.empty) {
    return NextResponse.json(
      { error: "An organization with this slug already exists" },
      { status: 409 }
    );
  }

  const orgRef = await db.collection("orgs").add({
    name,
    slug,
    createdBy: user.uid,
    createdAt: FieldValue.serverTimestamp(),
    memberCount: 0,
  });

  return NextResponse.json({ orgId: orgRef.id });
}
