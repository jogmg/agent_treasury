export function ArcMark({
  size = 18,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src="/arc_network.svg"
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={`inline-block shrink-0 rounded-full ${className}`}
    />
  );
}

function normalizeNetworkName(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, "");
}

export function getNetworkLogoPath(name?: string | null): string | undefined {
  if (!name) return undefined;

  const normalized = normalizeNetworkName(name);

  if (normalized.includes("ethereum")) return "/eth-diamond-(purple).svg";
  if (normalized.includes("avalanche")) return "/avalanche-avax-logo.svg";
  if (normalized.includes("arbitrum")) return "/arbitrum-arb-logo.svg";
  if (normalized.includes("base")) return "/Base_square_blue.svg";
  if (normalized.includes("optimism") || normalized.includes("op"))
    return "/optimism-ethereum-op-logo.svg";
  if (normalized.includes("polygon")) return "/polygon-matic-logo.svg";

  return undefined;
}

export function NetworkMark({
  name,
  size = 14,
  className = "",
}: {
  name?: string | null;
  size?: number;
  className?: string;
}) {
  const src = getNetworkLogoPath(name);
  if (!src) return null;

  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={`inline-block shrink-0 rounded-full ${className}`}
    />
  );
}

export function NetworkLabel({
  name,
  size = 12,
  className = "",
  iconOnly = false,
}: {
  name?: string | null;
  size?: number;
  className?: string;
  iconOnly?: boolean;
}) {
  if (!name) return null;

  if (iconOnly) {
    return (
      <span className={`inline-flex align-middle items-center ${className}`}>
        <NetworkMark name={name} size={size} />
      </span>
    );
  }

  return (
    <span
      className={`inline-flex align-middle items-center gap-1 ${className}`}
    >
      <NetworkMark name={name} size={size} />
      <span>{name}</span>
    </span>
  );
}
