import { NextResponse } from "next/server";
import { getAuth, getFirestore } from "@/lib/firebase/admin";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const decoded = await getAuth().verifyIdToken(token);
    const orgId = decoded.orgId as string | undefined;

    if (!orgId) {
      return NextResponse.json({ org: null });
    }

    const orgDoc = await getFirestore().collection("orgs").doc(orgId).get();

    if (!orgDoc.exists) {
      return NextResponse.json({ org: null });
    }

    const orgData = orgDoc.data()!;
    return NextResponse.json({
      org: {
        id: orgDoc.id,
        name: orgData.name,
        slug: orgData.slug,
      },
    });
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }
}
