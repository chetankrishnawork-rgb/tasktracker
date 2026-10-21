import type { User } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import {
  normalizeEmail,
  type Household,
  type HouseholdInvite,
  type HouseholdMember,
} from "./household-types";

const memberFields = (user: User, email: string) => ({
  email,
  displayName: user.displayName ?? "",
  photoURL: user.photoURL ?? "",
  joinedAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});

// The household this user belongs to, or null. The pointer lives on the
// user's own document, which only they can read.
export async function getUserHouseholdId(
  db: Firestore,
  userId: string,
): Promise<string | null> {
  const snapshot = await getDoc(doc(db, "users", userId));
  const value = snapshot.exists() ? snapshot.data().householdId : null;
  return typeof value === "string" && value ? value : null;
}

// Looks up an invite addressed to the signed-in user's email. Invites are
// keyed by lowercased email, so this is a single get by id.
export async function findPendingInvite(
  db: Firestore,
  user: User,
): Promise<HouseholdInvite | null> {
  const email = user.email ? normalizeEmail(user.email) : "";
  if (!email) return null;
  const snapshot = await getDoc(doc(db, "householdInvites", email));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  const householdId = String(data.householdId ?? "");
  if (!householdId) return null;
  return {
    email,
    householdId,
    householdName: String(data.householdName ?? ""),
    invitedBy: String(data.invitedBy ?? ""),
  };
}

// Creates the household, the owner's member record, one invite per address,
// and the owner's pointer to the household, all in one batch. inviteEmails
// must already be normalized (see parseInviteEmails).
export async function createHousehold(
  db: Firestore,
  user: User,
  name: string,
  inviteEmails: string[],
): Promise<string> {
  const ownerEmail = user.email ? normalizeEmail(user.email) : "";
  const householdName = name.trim();
  const householdRef = doc(collection(db, "households"));

  const batch = writeBatch(db);
  batch.set(householdRef, {
    name: householdName,
    ownerId: user.uid,
    invitedEmails: inviteEmails,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(
    doc(db, "households", householdRef.id, "members", user.uid),
    memberFields(user, ownerEmail),
  );
  inviteEmails.forEach((email) => {
    batch.set(doc(db, "householdInvites", email), {
      householdId: householdRef.id,
      householdName,
      invitedBy: user.uid,
      createdAt: serverTimestamp(),
    });
  });
  batch.set(
    doc(db, "users", user.uid),
    { householdId: householdRef.id, updatedAt: serverTimestamp() },
    { merge: true },
  );
  await batch.commit();
  return householdRef.id;
}

// Joins the household named by an invite, points the user at it, and
// consumes the invite.
export async function acceptHouseholdInvite(
  db: Firestore,
  user: User,
  invite: HouseholdInvite,
) {
  const batch = writeBatch(db);
  batch.set(
    doc(db, "households", invite.householdId, "members", user.uid),
    memberFields(user, invite.email),
  );
  batch.set(
    doc(db, "users", user.uid),
    { householdId: invite.householdId, updatedAt: serverTimestamp() },
    { merge: true },
  );
  batch.delete(doc(db, "householdInvites", invite.email));
  await batch.commit();
}

export function subscribeToHousehold(
  db: Firestore,
  householdId: string,
  handlers: {
    onHousehold: (household: Household | null) => void;
    onMembers: (members: HouseholdMember[]) => void;
    onError: (error: Error) => void;
  },
) {
  const unsubscribeHousehold = onSnapshot(
    doc(db, "households", householdId),
    (snapshot) => {
      if (!snapshot.exists()) {
        handlers.onHousehold(null);
        return;
      }
      const data = snapshot.data();
      handlers.onHousehold({
        id: snapshot.id,
        name: String(data.name ?? "Household"),
        ownerId: String(data.ownerId ?? ""),
        invitedEmails: Array.isArray(data.invitedEmails)
          ? data.invitedEmails.map((email: unknown) => String(email))
          : [],
      });
    },
    handlers.onError,
  );

  const unsubscribeMembers = onSnapshot(
    collection(db, "households", householdId, "members"),
    (snapshot) =>
      handlers.onMembers(
        snapshot.docs.map((item) => ({
          uid: item.id,
          email: String(item.data().email ?? ""),
          displayName: String(item.data().displayName ?? ""),
          photoURL: String(item.data().photoURL ?? ""),
        })),
      ),
    handlers.onError,
  );

  return () => {
    unsubscribeHousehold();
    unsubscribeMembers();
  };
}

// Invites more people into an existing household. Only the owner can do this
// (enforced by the rules); addresses already invited are skipped.
export async function inviteToHousehold(
  db: Firestore,
  user: User,
  household: Household,
  emails: string[],
) {
  const fresh = emails.filter((email) => !household.invitedEmails.includes(email));
  if (!fresh.length) return;

  const batch = writeBatch(db);
  batch.update(doc(db, "households", household.id), {
    invitedEmails: [...household.invitedEmails, ...fresh],
    updatedAt: serverTimestamp(),
  });
  fresh.forEach((email) => {
    batch.set(doc(db, "householdInvites", email), {
      householdId: household.id,
      householdName: household.name,
      invitedBy: user.uid,
      createdAt: serverTimestamp(),
    });
  });
  await batch.commit();
}
