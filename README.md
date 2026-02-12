# Firebase Auth + RBAC Implementation Plan

A phased approach to implementing authentication and role-based access control in a Next.js application using Firebase.

---

## Project Overview

### Goals
- Next.js app with Google social login (invite-only access)
- Multi-tenant architecture (users belong to organizations)
- Role-based access: `viewer`, `user`, `admin`, `superAdmin`
- Super Admin creates orgs and assigns org admins
- Org admins invite users to their org only
- No self-registration—users must be invited

### Tech Stack
- **Frontend**: Next.js 14+ (App Router)
- **Auth**: Firebase Authentication with Identity Platform (required for blocking functions)
- **Database**: Firestore
- **RBAC**: Firebase Custom Claims + Firestore Security Rules
- **Email**: Firebase Extensions or third-party (SendGrid, Resend, etc.)

---

## Access Control Hierarchy

```
Super Admin (bootstrapped manually)
    │
    ├── Creates Organizations
    │
    └── Invites Org Admins
            │
            └── Org Admins invite Users/Viewers to their org
```

**Key Rule**: No one can sign up without an invitation. A Firebase Blocking Function enforces this at the authentication layer.

---

## Phase 1: Project Setup & Firebase Configuration

**Duration**: 1-2 days

### Objectives
- Initialize Next.js project with Firebase
- Configure Firebase Auth with Identity Platform (required for blocking functions)
- Bootstrap Super Admin user

### Tasks

#### 1.1 Project Initialization
- [x] Create Next.js app with TypeScript
- [x] Install dependencies: `firebase`, `firebase-admin`, `firebase-functions`
- [x] Set up environment variables for Firebase config

#### 1.2 Firebase Project Setup
- [ ] Create Firebase project in console
- [ ] **Upgrade to Firebase Auth with Identity Platform** (required for blocking functions)
- [ ] Enable Google as auth provider
- [ ] Create Firestore database (start in test mode)
- [ ] Generate service account key for Admin SDK

#### 1.3 Firebase Client Integration
- [ ] Create `lib/firebase/client.ts` - initialize Firebase app
- [ ] Create `lib/firebase/admin.ts` - initialize Admin SDK (server-only)
- [ ] Create auth context/provider for React

#### 1.4 Bootstrap Super Admin
- [ ] Create one-time setup script (`scripts/bootstrap-super-admin.ts`)
- [ ] Script creates Firebase Auth user with `superAdmin: true` custom claim
- [ ] Script creates corresponding Firestore user document
- [ ] Run locally with Admin SDK credentials
- [ ] Document the bootstrap process

```typescript
// scripts/bootstrap-super-admin.ts (run once)
// 1. Create user in Firebase Auth (or use existing Google account UID)
// 2. Set custom claims: { superAdmin: true }
// 3. Create /users/{uid} doc with role: 'superAdmin'
```

#### 1.5 Basic Login Page
- [ ] Build login page with Google sign-in button
- [ ] Show appropriate error if user is not invited
- [ ] Redirect to dashboard on successful login

### Deliverables
- Firebase project configured with Identity Platform
- Super Admin bootstrapped and able to log in
- Login page ready (blocks uninvited users)

---

## Phase 2: Data Model & Blocking Function

**Duration**: 2-3 days

### Objectives
- Design and implement Firestore schema with invites
- Deploy blocking function to enforce invite-only access
- Set up invitation email sending

### Tasks

#### 2.1 Firestore Schema Design

```
/users/{uid}
  - email: string
  - displayName: string
  - photoURL: string
  - orgId: string | null          # null for superAdmin
  - role: 'viewer' | 'user' | 'admin' | 'superAdmin'
  - createdAt: timestamp
  - updatedAt: timestamp

/orgs/{orgId}
  - name: string
  - slug: string (unique)
  - createdBy: string (uid)       # superAdmin who created it
  - createdAt: timestamp
  - memberCount: number

/invites/{inviteId}
  - email: string (indexed)
  - orgId: string
  - role: 'viewer' | 'user' | 'admin'
  - invitedBy: string (uid)
  - status: 'pending' | 'accepted'
  - createdAt: timestamp
  - expiresAt: timestamp
  - token: string (unique, for email link)
```

#### 2.2 Firebase Blocking Function

Deploy a `beforeUserCreated` blocking function that:
1. Queries `/invites` collection for matching email
2. If no valid invite exists → throw error, block sign-in
3. If invite exists → allow sign-in, return custom claims

```typescript
// functions/src/auth.ts
import { beforeUserCreated } from "firebase-functions/v2/identity";
import { getFirestore } from "firebase-admin/firestore";

export const checkInvite = beforeUserCreated(async (event) => {
  const email = event.data.email;
  if (!email) throw new HttpsError("invalid-argument", "Email required");

  const db = getFirestore();
  
  // Check if superAdmin (bypass invite check)
  const superAdminQuery = await db.collection("users")
    .where("email", "==", email)
    .where("role", "==", "superAdmin")
    .limit(1).get();
  
  if (!superAdminQuery.empty) {
    return { customClaims: { superAdmin: true } };
  }

  // Check for valid invite
  const inviteQuery = await db.collection("invites")
    .where("email", "==", email)
    .where("status", "==", "pending")
    .where("expiresAt", ">", new Date())
    .limit(1).get();

  if (inviteQuery.empty) {
    throw new HttpsError("permission-denied", "No valid invitation found");
  }

  const invite = inviteQuery.docs[0].data();
  
  return {
    customClaims: {
      role: invite.role,
      orgId: invite.orgId
    }
  };
});
```

#### 2.3 Post-Sign-In Handling
- [ ] Create Cloud Function `onUserCreated` to:
  - Create user document in `/users/{uid}`
  - Mark invite as `accepted`
  - Increment org `memberCount`

#### 2.4 Invite Email System
- [ ] Choose email provider (Firebase Extensions: Trigger Email, or SendGrid/Resend)
- [ ] Create email template with invite link
- [ ] Invite link format: `https://yourapp.com/login?token={inviteToken}`

#### 2.5 Dashboard
- [ ] Create dashboard page showing:
  - User name, email, profile photo
  - Organization name
  - Role

### Deliverables
- Firestore schema implemented
- Blocking function deployed and tested
- Uninvited users cannot sign in
- Basic dashboard for authenticated users

---

## Phase 3: Custom Claims & RBAC Utilities

**Duration**: 2-3 days

### Objectives
- Build role-checking utilities for server and client
- Protect routes and API endpoints
- Handle token refresh after role changes

### Tasks

#### 3.1 Claim Structure

Claims are set by the blocking function on first sign-in:

```typescript
// Regular users
interface UserClaims {
  role: 'viewer' | 'user' | 'admin';
  orgId: string;
}

// Super admin (no org)
interface SuperAdminClaims {
  superAdmin: true;
}
```

#### 3.2 Server-Side Auth Utilities

```typescript
// lib/auth/verify-token.ts
export async function verifyAuth(request: Request) {
  const token = extractBearerToken(request);
  if (!token) return null;
  
  const decoded = await adminAuth.verifyIdToken(token);
  return {
    uid: decoded.uid,
    email: decoded.email,
    role: decoded.role,
    orgId: decoded.orgId,
    superAdmin: decoded.superAdmin || false
  };
}

// lib/auth/require-role.ts
export function canAccessOrg(user: AuthUser, orgId: string): boolean {
  if (user.superAdmin) return true;
  return user.orgId === orgId;
}

export function hasMinRole(user: AuthUser, minRole: Role): boolean {
  const hierarchy = { viewer: 1, user: 2, admin: 3 };
  if (user.superAdmin) return true;
  return hierarchy[user.role] >= hierarchy[minRole];
}
```

#### 3.3 Client-Side Auth Utilities
- [ ] Create hook: `useAuth()` - returns user + claims from ID token
- [ ] Create hook: `useRequireAuth(minRole?)` - redirects if unauthorized
- [ ] Create component: `<RoleGate role="admin">` - conditional rendering

```typescript
// lib/auth/hooks.ts
export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  
  useEffect(() => {
    return onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const tokenResult = await firebaseUser.getIdTokenResult();
        setUser({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName,
          role: tokenResult.claims.role,
          orgId: tokenResult.claims.orgId,
          superAdmin: tokenResult.claims.superAdmin || false
        });
      } else {
        setUser(null);
      }
    });
  }, []);
  
  return user;
}
```

#### 3.4 Protected API Routes Pattern

```typescript
// app/api/orgs/[orgId]/members/route.ts
export async function GET(request: Request, { params }) {
  const user = await verifyAuth(request);
  
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  if (!canAccessOrg(user, params.orgId)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  
  // Proceed with fetching members
}
```

#### 3.5 Middleware for Route Protection
- [ ] Create Next.js middleware to protect `/dashboard/*`, `/admin/*`
- [ ] Redirect unauthenticated users to `/login`
- [ ] Check claims for role-specific routes

### Deliverables
- Server-side role verification utilities
- Client-side hooks for auth state and role checking
- Protected API route pattern established
- Route-level middleware protection

---

## Phase 4: Super Admin - Org & Admin Management

**Duration**: 2-3 days

### Objectives
- Super Admin can create organizations
- Super Admin can invite admins to organizations
- Build Super Admin dashboard

### Tasks

#### 4.1 Super Admin Dashboard
- [ ] Create `/super-admin` route (protected, superAdmin only)
- [ ] List all organizations with member counts
- [ ] Create new organization form

#### 4.2 Organization Creation

**API Route**: `POST /api/orgs`

```typescript
export async function POST(request: Request) {
  const user = await verifyAuth(request);
  
  if (!user?.superAdmin) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  
  const { name, slug } = await request.json();
  
  // Create org document
  const orgRef = await db.collection("orgs").add({
    name,
    slug,
    createdBy: user.uid,
    createdAt: FieldValue.serverTimestamp(),
    memberCount: 0
  });
  
  return Response.json({ orgId: orgRef.id });
}
```

#### 4.3 Invite Org Admin

**API Route**: `POST /api/invites`

```typescript
export async function POST(request: Request) {
  const user = await verifyAuth(request);
  const { email, orgId, role } = await request.json();
  
  // Super Admin can invite anyone to any org
  // Org Admin can only invite to their own org (handled in Phase 5)
  if (!user?.superAdmin && user?.orgId !== orgId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  
  // Super Admin can assign 'admin' role; Org Admin cannot
  if (role === "admin" && !user?.superAdmin) {
    return Response.json({ error: "Cannot assign admin role" }, { status: 403 });
  }
  
  const token = generateSecureToken(); // crypto.randomUUID() or similar
  
  const inviteRef = await db.collection("invites").add({
    email,
    orgId,
    role,
    invitedBy: user.uid,
    status: "pending",
    token,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
  });
  
  // Trigger email (via Firestore trigger or direct API call)
  await sendInviteEmail(email, token, orgId);
  
  return Response.json({ inviteId: inviteRef.id });
}
```

#### 4.4 Invite Email Flow
- [ ] Email contains link: `https://app.com/login?token={token}`
- [ ] Login page extracts token, stores in session/state
- [ ] After Google sign-in, blocking function validates invite
- [ ] User lands on dashboard with correct org and role

#### 4.5 View Pending Invites
- [ ] `GET /api/orgs/:orgId/invites` - List pending invites for an org
- [ ] `DELETE /api/invites/:id` - Revoke invite (Super Admin or inviter)

#### 4.6 Super Admin UI Components
- [ ] Organization list with create button
- [ ] Org detail view with member list
- [ ] Invite admin form (email + select org)
- [ ] Pending invites table

### Deliverables
- Super Admin can create organizations
- Super Admin can invite admins to any org
- Invite emails sent with secure tokens
- Invited admins can sign in and access their org

---

## Phase 5: Org Admin - User Management

**Duration**: 2-3 days

### Objectives
- Org admins can invite users to their organization
- Org admins can manage users within their org
- Build org admin dashboard

### Tasks

#### 5.1 Org Admin Dashboard
- [ ] Create `/admin` route (protected, admin role required)
- [ ] List all users in admin's org
- [ ] Show user details: name, email, role, joined date
- [ ] Invite user form

#### 5.2 Invite Users (Org-Scoped)

Org admins use the same `POST /api/invites` endpoint but:
- Can only invite to their own org (`user.orgId`)
- Can only assign `viewer` or `user` roles (not `admin`)

```typescript
// Permission check in POST /api/invites
if (!user.superAdmin) {
  // Org admin can only invite to their own org
  if (user.orgId !== orgId) {
    return Response.json({ error: "Can only invite to your org" }, { status: 403 });
  }
  // Org admin cannot assign admin role
  if (role === "admin") {
    return Response.json({ error: "Cannot assign admin role" }, { status: 403 });
  }
}
```

#### 5.3 View Org Members
- [ ] `GET /api/orgs/:orgId/members` - List all members
- [ ] Filter by role
- [ ] Search by name/email

#### 5.4 Role Management (Within Org)
- [ ] `PATCH /api/users/:uid/role` - Change user role
- [ ] Org admins can change between: `viewer` ↔ `user`
- [ ] Cannot promote to `admin` (only Super Admin can)
- [ ] Cannot demote other admins
- [ ] Must update custom claims after role change

```typescript
export async function PATCH(request: Request, { params }) {
  const user = await verifyAuth(request);
  const { role: newRole } = await request.json();
  const targetUid = params.uid;
  
  // Fetch target user
  const targetDoc = await db.collection("users").doc(targetUid).get();
  const targetUser = targetDoc.data();
  
  // Org admin restrictions
  if (!user.superAdmin) {
    if (targetUser.orgId !== user.orgId) {
      return Response.json({ error: "Not in your org" }, { status: 403 });
    }
    if (targetUser.role === "admin") {
      return Response.json({ error: "Cannot modify admin" }, { status: 403 });
    }
    if (newRole === "admin") {
      return Response.json({ error: "Cannot promote to admin" }, { status: 403 });
    }
  }
  
  // Update Firestore
  await targetDoc.ref.update({ role: newRole });
  
  // Update custom claims
  await adminAuth.setCustomUserClaims(targetUid, {
    role: newRole,
    orgId: targetUser.orgId
  });
  
  return Response.json({ success: true });
}
```

#### 5.5 Remove User from Org
- [ ] `DELETE /api/orgs/:orgId/members/:uid`
- [ ] Clear user's custom claims
- [ ] Delete or update user document
- [ ] Decrement org `memberCount`

#### 5.6 Permission Matrix

| Action | Viewer | User | Admin | SuperAdmin |
|--------|--------|------|-------|------------|
| View own profile | ✓ | ✓ | ✓ | ✓ |
| View org members | ✗ | ✓ | ✓ | ✓ |
| Invite viewers/users | ✗ | ✗ | ✓ | ✓ |
| Invite admins | ✗ | ✗ | ✗ | ✓ |
| Change viewer↔user | ✗ | ✗ | ✓ | ✓ |
| Promote to admin | ✗ | ✗ | ✗ | ✓ |
| Remove users | ✗ | ✗ | ✓ | ✓ |
| Create orgs | ✗ | ✗ | ✗ | ✓ |
| Access other orgs | ✗ | ✗ | ✗ | ✓ |

### Deliverables
- Org admin dashboard with member list
- Org admins can invite viewers/users
- Role changes within permitted bounds
- User removal from org

---

## Phase 6: Firestore Security Rules

**Duration**: 1-2 days

### Objectives
- Lock down Firestore with security rules
- Ensure defense in depth (rules + server validation)
- Test with Firebase Emulator

### Tasks

#### 6.1 Security Rules

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // ============ Helper Functions ============
    
    function isSignedIn() {
      return request.auth != null;
    }
    
    function isSuperAdmin() {
      return request.auth.token.superAdmin == true;
    }
    
    function getUserRole() {
      return request.auth.token.role;
    }
    
    function getUserOrgId() {
      return request.auth.token.orgId;
    }
    
    function belongsToOrg(orgId) {
      return getUserOrgId() == orgId;
    }
    
    function isOrgAdmin(orgId) {
      return belongsToOrg(orgId) && getUserRole() == 'admin';
    }
    
    function canViewOrg(orgId) {
      return isSuperAdmin() || belongsToOrg(orgId);
    }
    
    // ============ Users Collection ============
    
    match /users/{uid} {
      // Users can read their own profile
      // Org members can read profiles of same org
      // Super Admin can read all
      allow read: if isSignedIn() && (
        request.auth.uid == uid ||
        (resource.data.orgId != null && belongsToOrg(resource.data.orgId)) ||
        isSuperAdmin()
      );
      
      // All writes go through server (Admin SDK)
      allow write: if false;
    }
    
    // ============ Orgs Collection ============
    
    match /orgs/{orgId} {
      // Org members and Super Admin can read
      allow read: if isSignedIn() && canViewOrg(orgId);
      
      // Only server can write
      allow write: if false;
    }
    
    // ============ Invites Collection ============
    
    match /invites/{inviteId} {
      // Invitee can read their own invite (by email)
      // Org admins can read invites for their org
      // Super Admin can read all
      allow read: if isSignedIn() && (
        resource.data.email == request.auth.token.email ||
        isOrgAdmin(resource.data.orgId) ||
        isSuperAdmin()
      );
      
      // Only server can write
      allow write: if false;
    }
  }
}
```

#### 6.2 Why Server-Only Writes?

For an invite-only system, all mutations should go through API routes:
- Validates permissions with full context
- Sets custom claims atomically
- Sends emails on invite creation
- Maintains referential integrity

Client SDK is read-only for data; writes go through Next.js API routes using Admin SDK.

#### 6.3 Testing Rules
- [ ] Set up Firebase Emulator Suite
- [ ] Write unit tests for security rules
- [ ] Test cases:
  - Uninvited user cannot read anything
  - User can only read own org's data
  - Super Admin can read all orgs
  - Direct writes are blocked

```bash
# Install emulator
firebase init emulators

# Run tests
firebase emulators:exec "npm test"
```

#### 6.4 Deploy Rules
- [ ] Review rules in Firebase Console
- [ ] Deploy via CLI: `firebase deploy --only firestore:rules`
- [ ] Monitor rule evaluations in console

### Deliverables
- Comprehensive security rules deployed
- Rules tested with emulator
- Defense in depth achieved (client rules + server validation)

---

## Phase 7: Polish & Production Readiness

**Duration**: 2-3 days

### Objectives
- Error handling and edge cases
- Token refresh handling
- Production deployment

### Tasks

#### 7.1 Error Handling
- [ ] User-friendly error when not invited ("No invitation found. Contact your administrator.")
- [ ] Handle expired invites gracefully
- [ ] Retry logic for transient failures
- [ ] Error boundaries in React

#### 7.2 Token Refresh After Role Changes
When an admin changes a user's role, the user's ID token still has old claims until refreshed.

Options:
1. **Force refresh**: After role change API, notify user to re-login
2. **Periodic refresh**: Refresh token every N minutes client-side
3. **Claim versioning**: Store version in Firestore, check on each request

```typescript
// Client-side: force token refresh
await auth.currentUser?.getIdToken(true); // force refresh
```

#### 7.3 Session Management
- [ ] Handle sign-out properly (clear local state)
- [ ] Sign out from all tabs (BroadcastChannel API)
- [ ] Session timeout handling (optional)

#### 7.4 Security Hardening
- [ ] Audit all API routes for auth checks
- [ ] Rate limiting on invite creation
- [ ] CORS configuration for API routes
- [ ] Validate email format before creating invites

#### 7.5 Email Deliverability
- [ ] Set up SPF/DKIM/DMARC for email domain
- [ ] Test invite emails don't go to spam
- [ ] Add unsubscribe link if required

#### 7.6 Deployment
- [ ] Configure production Firebase project (separate from dev)
- [ ] Set up environment variables in Vercel/hosting
- [ ] Deploy Cloud Functions: `firebase deploy --only functions`
- [ ] Deploy Firestore rules: `firebase deploy --only firestore:rules`
- [ ] Deploy Next.js app
- [ ] Run bootstrap script for production Super Admin
- [ ] Monitor auth events in Firebase Console

### Deliverables
- Production-ready application
- Robust error handling
- Proper token refresh strategy
- Deployed and monitored

---

## Complete User Flows

### Flow 1: Super Admin Bootstrap (One-time)

```
1. Run bootstrap script locally with Admin SDK credentials
2. Script creates Super Admin user in Firebase Auth
3. Script sets { superAdmin: true } custom claim
4. Script creates /users/{uid} document
5. Super Admin logs in via Google → blocking function allows (superAdmin check)
6. Super Admin sees Super Admin dashboard
```

### Flow 2: Super Admin Creates Org + Invites Admin

```
1. Super Admin creates new organization (POST /api/orgs)
2. Super Admin invites admin: enters email, selects org, role=admin
3. System creates /invites/{id} document with token
4. System sends email with link: app.com/login?token=xyz
5. Invited admin clicks link → lands on login page
6. Admin signs in with Google
7. Blocking function checks /invites for email → finds match
8. Blocking function returns { role: 'admin', orgId: 'org_123' }
9. onUserCreated trigger:
   - Creates /users/{uid} document
   - Marks invite as accepted
   - Increments org memberCount
10. Admin sees Org Admin dashboard
```

### Flow 3: Org Admin Invites User

```
1. Org Admin clicks "Invite User" in dashboard
2. Enters email, selects role (viewer or user)
3. System creates /invites/{id} document
4. System sends email with invite link
5. User clicks link → logs in with Google
6. Blocking function validates invite
7. User account created with { role: 'user', orgId: 'org_123' }
8. User sees regular dashboard
```

### Flow 4: Uninvited User Attempts Login

```
1. Random person visits app.com/login
2. Clicks "Sign in with Google"
3. Google auth succeeds, returns to Firebase
4. Blocking function runs:
   - Checks if email is superAdmin → No
   - Checks /invites for pending invite → None found
   - Throws HttpsError("permission-denied")
5. User sees error: "No invitation found"
6. Firebase Auth user is NOT created
```

---

## File Structure

```
/app
  /(auth)
    /login/page.tsx              # Google sign-in + invite token handling
  /(dashboard)
    /dashboard/page.tsx          # Regular user dashboard
    /admin/page.tsx              # Org admin dashboard
    /super-admin/page.tsx        # Super admin dashboard
  /api
    /orgs/route.ts               # Create org (Super Admin)
    /orgs/[orgId]/members/route.ts
    /invites/route.ts            # Create invite
    /invites/[id]/route.ts       # Delete invite
    /users/[uid]/role/route.ts   # Change role
  /layout.tsx
  /page.tsx

/lib
  /firebase
    client.ts                    # Client SDK init
    admin.ts                     # Admin SDK init (server only)
  /auth
    context.tsx                  # Auth provider
    hooks.ts                     # useAuth, useRequireAuth
    verify-token.ts              # Server-side token verification
    permissions.ts               # canAccessOrg, hasMinRole

/functions
  /src
    index.ts                     # Export all functions
    auth.ts                      # beforeUserCreated blocking function
    triggers.ts                  # onUserCreated trigger

/scripts
  bootstrap-super-admin.ts       # One-time setup script

/components
  /auth
    SignInButton.tsx
    SignOutButton.tsx
    RoleGate.tsx
  /admin
    UserList.tsx
    InviteForm.tsx
    OrgList.tsx
```

---

## Environment Variables

```bash
# .env.local

# Firebase Client SDK (public)
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=

# Firebase Admin SDK (server-only, never expose)
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=

# Email (choose one)
SENDGRID_API_KEY=
# or
RESEND_API_KEY=

# App
NEXT_PUBLIC_APP_URL=https://yourapp.com
```

---

## Key Decisions & Trade-offs

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Invite-only access | Blocking function | Enforced at auth layer; users can't bypass |
| Identity Platform | Required | Blocking functions need Identity Platform upgrade |
| Server-only writes | Yes | Simpler security rules, consistent validation |
| Claims vs DB | Hybrid | Claims for fast auth; DB for detailed queries |
| Email system | Third-party | More reliable than Firebase Extensions |

---

## Estimated Timeline

| Phase | Duration | Cumulative |
|-------|----------|------------|
| 1. Setup & Bootstrap | 1-2 days | 2 days |
| 2. Data Model & Blocking Function | 2-3 days | 5 days |
| 3. RBAC Utilities | 2-3 days | 8 days |
| 4. Super Admin Features | 2-3 days | 11 days |
| 5. Org Admin Features | 2-3 days | 14 days |
| 6. Security Rules | 1-2 days | 16 days |
| 7. Production Ready | 2-3 days | 19 days |

**Total: ~3-4 weeks** for full implementation

---

## Prerequisites Checklist

Before starting:
- [ ] Firebase project created
- [ ] Upgraded to Firebase Auth with Identity Platform
- [ ] Google Cloud billing enabled (required for Identity Platform)
- [ ] Service account key generated
- [ ] Email provider account (SendGrid/Resend)
- [ ] Domain configured for email sending

---

## Next Steps

1. Review this plan and adjust scope as needed
2. Create Firebase project and upgrade to Identity Platform
3. Set up local development environment with emulators
4. Run bootstrap script to create Super Admin
5. Start Phase 1 implementation
