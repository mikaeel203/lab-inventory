"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="narrow panel"><h1>Something didn’t load.</h1><p className="muted">Check your connection and try again. No inventory changes are queued offline.</p><button className="button primary" onClick={reset}>Try again</button></main>;
}
