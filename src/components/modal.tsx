"use client";

import { useEffect, useRef, type RefObject } from "react";
import { X } from "lucide-react";

export function Modal({ title, onClose, children, initialFocus }: { title: string; onClose: () => void; children: React.ReactNode; initialFocus?: RefObject<HTMLElement | null> }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    initialFocus?.current?.focus();
    return () => { dialog?.close(); };
  }, [initialFocus]);
  return <dialog ref={ref} className="modal" onCancel={event => { event.preventDefault(); onClose(); }} aria-label={title}>
    <header className="modal-header"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X /></button></header>
    {children}
  </dialog>;
}
