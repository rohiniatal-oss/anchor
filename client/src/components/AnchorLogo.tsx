export function AnchorLogo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-label="Anchor logo">
      <circle cx="12" cy="5" r="2.4" />
      <line x1="12" y1="7.4" x2="12" y2="21" />
      <line x1="7" y1="12" x2="17" y2="12" />
      <path d="M4 14a8 8 0 0 0 16 0" />
    </svg>
  );
}
