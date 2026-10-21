"use client";

import type { User } from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import { useCallback, useEffect, useState } from "react";
import {
  findPendingInvite,
  getUserHouseholdId,
  subscribeToHousehold,
} from "@/lib/household-repository";
import type {
  Household,
  HouseholdInvite,
  HouseholdMember,
} from "@/lib/household-types";

type Membership = {
  uid: string;
  householdId: string | null;
  invite: HouseholdInvite | null;
};

const messageFor = (error: unknown) => {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return message
    .replace(/^Firebase:\s*/i, "")
    .replace(/\s*\(firestore\/[\w-]+\)\.?$/i, "");
};

// Which household (if any) the signed-in person belongs to, any invitation
// waiting for them, and the live household and member details. State is
// keyed to the user so nothing carries over when someone else signs in.
export function useHousehold(db: Firestore | null, user: User | null) {
  const [membership, setMembership] = useState<Membership | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [error, setError] = useState("");

  const current = user && membership?.uid === user.uid ? membership : null;
  const householdId = current?.householdId ?? null;
  const invite = current?.invite ?? null;

  useEffect(() => {
    if (!db || !user) return;
    let active = true;
    const load = async () => {
      try {
        const id = await getUserHouseholdId(db, user.uid);
        const pending = id ? null : await findPendingInvite(db, user);
        if (active) setMembership({ uid: user.uid, householdId: id, invite: pending });
      } catch {
        // Offline or not reachable yet; the person keeps their private lists.
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [db, user]);

  useEffect(() => {
    if (!db || !householdId) return;
    return subscribeToHousehold(db, householdId, {
      onHousehold: setHousehold,
      onMembers: setMembers,
      onError: (nextError) => setError(messageFor(nextError)),
    });
  }, [db, householdId]);

  // Called after creating or joining a household.
  const joinedHousehold = useCallback(
    (id: string) => {
      if (user) setMembership({ uid: user.uid, householdId: id, invite: null });
    },
    [user],
  );

  return {
    householdId,
    invite,
    household: household && household.id === householdId ? household : null,
    members: householdId ? members : [],
    error,
    joinedHousehold,
  };
}

export type HouseholdState = ReturnType<typeof useHousehold>;
