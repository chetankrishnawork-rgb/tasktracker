"use client";

import type { User } from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import { FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  acceptHouseholdInvite,
  createHousehold,
  inviteToHousehold,
} from "@/lib/household-repository";
import {
  inviteSlotsLeft,
  MAX_HOUSEHOLD_MEMBERS,
  MAX_INVITEES,
  memberLabel,
  parseInviteEmails,
} from "@/lib/household-types";
import { IconUsers, IconX } from "@/lib/icons";
import type { HouseholdState } from "./use-household";

const messageFor = (error: unknown) => {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return message
    .replace(/^Firebase:\s*/i, "")
    .replace(/\s*\(firestore\/[\w-]+\)\.?$/i, "");
};

// Sidebar button plus the household dialog: create a household and invite
// family by email, accept an invitation, or see who is in the household.
export function HouseholdPanel({
  db,
  user,
  state,
}: {
  db: Firestore;
  user: User;
  state: HouseholdState;
}) {
  const { householdId, invite, household, members, joinedHousehold } = state;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [inviteText, setInviteText] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const error = actionError || state.error;

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  const close = () => {
    setOpen(false);
    setActionError("");
  };

  const parseInvitees = () => {
    const parsed = parseInviteEmails(inviteText, user.email ?? "");
    if (parsed.invalid.length) {
      setActionError(`These don't look like email addresses: ${parsed.invalid.join(", ")}`);
      return null;
    }
    return parsed;
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setActionError("");
    const parsed = parseInvitees();
    if (!parsed) return;
    if (parsed.tooMany) {
      setActionError(
        `A household holds ${MAX_HOUSEHOLD_MEMBERS} people including you, so you can invite up to ${MAX_INVITEES}.`,
      );
      return;
    }
    setBusy(true);
    try {
      const id = await createHousehold(db, user, name, parsed.emails);
      joinedHousehold(id);
      setInviteText("");
    } catch (nextError) {
      setActionError(messageFor(nextError));
    } finally {
      setBusy(false);
    }
  };

  const inviteMore = async (event: FormEvent) => {
    event.preventDefault();
    if (!household) return;
    setActionError("");
    const parsed = parseInvitees();
    if (!parsed) return;
    const fresh = parsed.emails.filter((email) => !household.invitedEmails.includes(email));
    if (!fresh.length) {
      setActionError("Add at least one new email address.");
      return;
    }
    if (fresh.length > inviteSlotsLeft(household.invitedEmails)) {
      setActionError(`You can invite ${inviteSlotsLeft(household.invitedEmails)} more.`);
      return;
    }
    setBusy(true);
    try {
      await inviteToHousehold(db, user, household, fresh);
      setInviteText("");
    } catch (nextError) {
      setActionError(messageFor(nextError));
    } finally {
      setBusy(false);
    }
  };

  const accept = async () => {
    if (!invite) return;
    setActionError("");
    setBusy(true);
    try {
      await acceptHouseholdInvite(db, user, invite);
      joinedHousehold(invite.householdId);
    } catch (nextError) {
      setActionError(messageFor(nextError));
    } finally {
      setBusy(false);
    }
  };

  const memberEmails = new Set(members.map((member) => member.email));
  const waiting = household
    ? household.invitedEmails.filter((email) => !memberEmails.has(email))
    : [];
  const isOwner = Boolean(household && household.ownerId === user.uid);
  const slotsLeft = household ? inviteSlotsLeft(household.invitedEmails) : 0;
  const label = householdId ? "Household" : invite ? "You have an invitation" : "Set up a household";

  const dialog = (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <div className="modal small-modal" role="dialog" aria-modal="true" aria-labelledby="household-title">
        <div className="modal-head">
          <div>
            <span className="eyebrow">FAMILY</span>
            <h2 id="household-title">
              {householdId ? household?.name || "Household" : invite ? "Join a household" : "Set up a household"}
            </h2>
          </div>
          <button type="button" onClick={close} aria-label="Close"><IconX /></button>
        </div>

        {error && <p className="household-error" role="alert">{error}</p>}

        {householdId ? (
          <>
            <ul className="household-list">
              {members.map((member) => (
                <li key={member.uid}>
                  <span className="avatar">{memberLabel(member).slice(0, 1).toUpperCase()}</span>
                  <div>
                    <strong>{memberLabel(member)}{member.uid === user.uid ? " (you)" : ""}</strong>
                    <span>{member.email}</span>
                  </div>
                  {household?.ownerId === member.uid && <em className="household-badge">Owner</em>}
                </li>
              ))}
              {waiting.map((email) => (
                <li key={email} className="household-waiting">
                  <span className="avatar">?</span>
                  <div>
                    <strong>{email}</strong>
                    <span>Invited, hasn&rsquo;t joined yet</span>
                  </div>
                </li>
              ))}
            </ul>
            <p className="household-note">
              Add shared lists from the Household section of the sidebar. Lists you already have stay
              private until you choose to share them.
            </p>
            {isOwner && slotsLeft > 0 && (
              <form onSubmit={inviteMore}>
                <label>
                  Invite {slotsLeft === 1 ? "one more person" : "more people"}
                  <textarea
                    value={inviteText}
                    onChange={(event) => setInviteText(event.target.value)}
                    placeholder="their Google email address"
                    rows={2}
                  />
                </label>
                <div className="modal-actions">
                  <button className="add-button" disabled={busy || !inviteText.trim()}>
                    {busy ? "Inviting…" : "Send invite"}
                  </button>
                </div>
              </form>
            )}
          </>
        ) : invite ? (
          <>
            <p className="household-note">
              You&rsquo;ve been invited to join{invite.householdName ? ` “${invite.householdName}”` : " a household"}.
              Your own lists and tasks stay private to you.
            </p>
            <div className="modal-actions">
              <button type="button" className="quiet-button" disabled={busy} onClick={close}>Not now</button>
              <button type="button" className="add-button" disabled={busy} onClick={accept}>
                {busy ? "Joining…" : "Join household"}
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={create}>
            <p className="household-note">
              A household is a shared space for up to {MAX_HOUSEHOLD_MEMBERS} people. Each person signs in
              with their own Google account.
            </p>
            <label>
              Household name
              <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Our family"
                maxLength={80}
                required
              />
            </label>
            <label>
              Invite family (up to {MAX_INVITEES}) <span className="label-hint">optional</span>
              <textarea
                value={inviteText}
                onChange={(event) => setInviteText(event.target.value)}
                placeholder="Their Google email addresses, separated by commas"
                rows={2}
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="quiet-button" onClick={close}>Cancel</button>
              <button className="add-button" disabled={busy || !name.trim()}>
                {busy ? "Creating…" : "Create household"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );

  return (
    <>
      <button
        type="button"
        className="household-trigger"
        aria-label={label}
        title={label}
        onClick={() => setOpen(true)}
      >
        <IconUsers />
        {invite && !householdId && <i className="household-dot" aria-hidden="true" />}
      </button>
      {open && typeof document !== "undefined" && createPortal(dialog, document.body)}
    </>
  );
}
