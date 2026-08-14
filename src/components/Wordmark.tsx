/**
 * The World's Eye View mark: a globe whose meridians double as an iris,
 * inside the almond outline of an eye. It reads as "eye" at 20px in a
 * browser tab and as "globe" at any size where the meridians resolve,
 * which is the whole idea of the name.
 */
export function EyeGlobeMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      {/* Eye outline */}
      <path
        d="M2 16c4.4-6.4 9-9.6 14-9.6S25.6 9.6 30 16c-4.4 6.4-9 9.6-14 9.6S6.4 22.4 2 16Z"
        fill="#07131c"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      {/* Globe / iris */}
      <circle cx="16" cy="16" r="6.6" fill="#0b2739" stroke="currentColor" strokeWidth="1.3" />
      {/* Meridians and equator */}
      <path
        d="M9.4 16h13.2M16 9.4c1.9 1.9 2.9 4.1 2.9 6.6s-1 4.7-2.9 6.6c-1.9-1.9-2.9-4.1-2.9-6.6s1-4.7 2.9-6.6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.85"
      />
      {/* Pupil */}
      <circle cx="16" cy="16" r="2.1" fill="currentColor" />
      {/* Catchlight — the "camera is live" glint */}
      <circle cx="14.4" cy="14.2" r="0.75" fill="#eaf7ff" opacity="0.9" />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-baseline gap-1.5 ${className}`}>
      <span className="text-[15px] font-semibold tracking-tight text-wev-text">World&rsquo;s Eye</span>
      <span className="text-[15px] font-light tracking-tight text-wev-accent">View</span>
    </span>
  );
}
