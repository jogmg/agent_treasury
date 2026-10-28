const CURRENT_YEAR = new Date().getFullYear();

export function Footer() {
  return (
    <footer className="mt-auto flex min-h-12 items-center justify-center px-4 py-3 text-center text-xs text-white/55">
      <p>&copy; {CURRENT_YEAR} Glimmerlock. All rights reserved.</p>
    </footer>
  );
}
