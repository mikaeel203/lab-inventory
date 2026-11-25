"use client";

import { Modal } from "./modal";
import { useRef } from "react";

export type Confirmation = { title: string; message: string; label: string; action: () => Promise<boolean> };

export function ConfirmationDialog({ confirmation, busy, error, onClose, onConfirm }: {
  confirmation: Confirmation; busy: boolean; error: string; onClose: () => void; onConfirm: () => void;
}) {
  const cancelButton = useRef<HTMLButtonElement>(null);
  return <Modal title={confirmation.title} initialFocus={cancelButton} onClose={() => { if (!busy) onClose(); }}>
    <div className="form-stack">
      <p>{confirmation.message}</p>
      {error && <p className="message error" role="alert">{error}</p>}
      <div className="decision-actions">
        <button ref={cancelButton} className="button secondary" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="button destructive" disabled={busy} onClick={onConfirm}>{busy ? "Working…" : confirmation.label}</button>
      </div>
    </div>
  </Modal>;
}
