interface GlimmerlockLogoProps {
  className?: string;
}

export function GlimmerlockLogo({
  className = "h-9 w-36 sm:h-11 sm:w-44",
}: GlimmerlockLogoProps) {
  return (
    <span className={`block overflow-hidden ${className}`}>
      <img
        src="/glimmerlock-white.svg"
        alt="Glimmerlock"
        className="block size-full object-cover object-center"
      />
    </span>
  );
}
