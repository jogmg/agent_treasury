import { useState } from "react";
import { createPortal } from "react-dom";
import { ConnectKitButton } from "connectkit";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  BarChart3,
  Check,
  ChevronRight,
  Copy,
  LayoutDashboard,
  Menu,
  Settings2,
  Sparkles,
  X,
  Wallet,
} from "lucide-react";
import { useAccount, useDisconnect, useSwitchChain } from "wagmi";
import { toast } from "sonner";
import { useUiStore, type TabId } from "../stores/ui";
import { useTreasuryStore } from "../stores/treasury";
import { ARC_CHAIN_ID } from "../lib/contracts";
import { formatUsdcDollar } from "../lib/decimals";
import { STUDIO_PREVIEW } from "../lib/studioPreview";
import { config } from "../config";
import { ArcMark, NetworkMark } from "./ArcMark";
import { GlimmerlockLogo } from "./GlimmerlockLogo";

const VIEWS: { id: TabId; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "deposit", label: "Deposit", icon: ArrowDownToLine },
  { id: "yield", label: "Yield", icon: BarChart3 },
  { id: "withdraw", label: "Withdraw", icon: ArrowUpFromLine },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "settings", label: "Settings", icon: Settings2 },
];

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const activeTab = useUiStore((state) => state.activeTab);
  const setTab = useUiStore((state) => state.setTab);
  const { address, chainId, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const usdcBalance = useTreasuryStore((state) => state.usdcBalance);
  const usdcBalanceLoaded = useTreasuryStore(
    (state) => state.usdcBalanceLoaded
  );

  const shortAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : "";

  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      toast.success("Wallet address copied");
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Could not copy wallet address");
    }
  }

  return (
    <>
      <header className="relative z-40 flex h-[76px] items-center justify-between px-5 sm:px-10">
        <button
          type="button"
          onClick={() => setTab(STUDIO_PREVIEW ? "overview" : "hermes")}
          aria-label="Glimmerlock home"
          className="flex shrink-0 items-center"
        >
          <GlimmerlockLogo />
        </button>
        <div className="flex items-center gap-2 sm:gap-3">
          {isConnected && address ? (
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setWalletOpen(true);
              }}
              aria-label={`Wallet ${shortAddress}`}
              title={shortAddress}
              className="glimmer-avatar h-11 w-11 rounded-full border border-white/40 p-[2px] shadow-[0_0_24px_rgba(79,117,160,0.3)] transition hover:scale-[1.04]"
            >
              <span className="flex h-full w-full items-center justify-center rounded-full border border-white/30 bg-[#0A0E11]/55 text-white">
                <Wallet className="h-[18px] w-[18px]" />
              </span>
            </button>
          ) : (
            <ConnectKitButton.Custom>
              {({ show }) => (
                <button
                  type="button"
                  onClick={show}
                  aria-label="Connect wallet"
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/[0.08] text-white/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-xl transition hover:bg-white/[0.14] sm:h-auto sm:w-auto sm:gap-2 sm:px-4 sm:py-2.5"
                >
                  <Wallet className="h-[18px] w-[18px]" />
                  <span className="hidden text-sm font-medium sm:inline">
                    Connect wallet
                  </span>
                </button>
              )}
            </ConnectKitButton.Custom>
          )}
          <button
            type="button"
            onClick={() => {
              setWalletOpen(false);
              setMenuOpen(true);
            }}
            aria-label="Open menu"
            title="Menu"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-white/[0.08] text-white/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-xl transition hover:bg-white/[0.14]"
          >
            <Menu className="h-[18px] w-[18px]" />
          </button>
        </div>
      </header>
      {walletOpen &&
        address &&
        createPortal(
          <div
            className="fixed inset-0 z-[10000] flex items-start justify-end bg-[#07111d]/55 p-3 pt-[84px] backdrop-blur-sm sm:p-8 sm:pt-24"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setWalletOpen(false);
            }}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="wallet-title"
              className="glimmer-glass max-h-[calc(100dvh-100px)] w-full max-w-sm overflow-y-auto rounded-2xl p-4 sm:p-5"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#96ADC8]">
                    Wallet
                  </p>
                  <h2
                    id="wallet-title"
                    className="mt-1 text-lg font-semibold text-white"
                  >
                    Account
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setWalletOpen(false)}
                  aria-label="Close wallet details"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-5 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.045] p-3">
                <span className="glimmer-avatar flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-white/35 text-white shadow-[0_0_24px_rgba(79,117,160,0.25)]">
                  <Wallet className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm text-white">
                    {shortAddress}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-white/45">
                    {chainId === ARC_CHAIN_ID ? (
                      <ArcMark size={12} className="mr-1 align-[-2px]" />
                    ) : (
                      <NetworkMark
                        name={
                          config.chains.find((chain) => chain.id === chainId)
                            ?.name
                        }
                        size={12}
                        className="mr-1 align-[-2px]"
                      />
                    )}
                    {config.chains.find((chain) => chain.id === chainId)
                      ?.name ?? `Network ${chainId ?? "unknown"}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void copyAddress()}
                  aria-label="Copy wallet address"
                  title="Copy address"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/55 transition hover:bg-white/10 hover:text-white"
                >
                  {copied ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>

              <div className="mt-3 flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.045] px-4 py-3">
                <span className="flex items-center gap-1.5 text-sm text-white/55">
                  <ArcMark size={14} />
                  USDC on Arc
                </span>
                <span className="font-mono text-sm tabular-nums text-white">
                  {usdcBalanceLoaded
                    ? `${formatUsdcDollar(usdcBalance).replace("$", "")} USDC`
                    : "Loading…"}
                </span>
              </div>

              <div className="mt-5">
                <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">
                  Switch network
                </p>
                <div className="scrollbar-none max-h-48 space-y-1 overflow-y-auto">
                  {config.chains.map((chain) => (
                    <button
                      key={chain.id}
                      type="button"
                      onClick={() => {
                        if (chainId !== chain.id)
                          switchChain({ chainId: chain.id });
                      }}
                      disabled={switching || chainId === chain.id}
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm text-white/75 transition hover:bg-white/[0.07] hover:text-white disabled:cursor-default disabled:text-white"
                    >
                      <span className="flex items-center gap-2">
                        {chain.id === ARC_CHAIN_ID ? (
                          <ArcMark size={16} />
                        ) : (
                          <NetworkMark name={chain.name} size={16} />
                        )}
                        {chain.name}
                      </span>
                      {chainId === chain.id ? (
                        <Check className="h-4 w-4 text-[#96ADC8]" />
                      ) : (
                        <span className="text-xs text-white/35">
                          {chain.id}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                {chainId !== ARC_CHAIN_ID && (
                  <button
                    type="button"
                    onClick={() => switchChain({ chainId: ARC_CHAIN_ID })}
                    disabled={switching}
                    className="mt-2 w-full rounded-lg border border-[#96ADC8]/25 bg-[#4F75A0]/15 px-3 py-2.5 text-sm font-medium text-[#dce7f3] transition hover:bg-[#4F75A0]/25 disabled:opacity-50"
                  >
                    {switching ? "Switching…" : "Return to Arc"}
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  disconnect();
                  setWalletOpen(false);
                }}
                className="mt-5 w-full rounded-lg border border-white/10 px-3 py-2.5 text-sm font-medium text-white/65 transition hover:border-red-300/25 hover:bg-red-400/10 hover:text-red-200"
              >
                Disconnect wallet
              </button>
            </section>
          </div>,
          document.body
        )}
      {menuOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[10000] flex items-start justify-end bg-[#07111d]/55 p-3 pt-[84px] backdrop-blur-sm sm:p-8 sm:pt-24"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setMenuOpen(false);
            }}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="views-title"
              className="glimmer-glass w-full max-w-sm rounded-2xl p-3 sm:p-4"
            >
              <div className="flex items-center justify-between pl-3 pb-3 pt-2">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#96ADC8]">
                    Glimmerlock
                  </p>
                  <h2
                    id="views-title"
                    className="mt-1 text-lg font-semibold text-white"
                  >
                    Menu
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  aria-label="Close views menu"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <nav aria-label="App views" className="space-y-1">
                {!STUDIO_PREVIEW && (
                  <button
                    type="button"
                    onClick={() => {
                      setTab("hermes");
                      setMenuOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${
                      activeTab === "hermes"
                        ? "bg-[#4F75A0]/25 text-white"
                        : "text-white/70 hover:bg-white/[0.07] hover:text-white"
                    }`}
                  >
                    <Sparkles className="h-[18px] w-[18px] text-[#96ADC8]" />
                    <span className="flex-1 text-sm font-medium">Chat</span>
                    {activeTab === "hermes" && (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </button>
                )}
                {VIEWS.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setTab(id);
                      setMenuOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${
                      activeTab === id
                        ? "bg-[#4F75A0]/25 text-white"
                        : "text-white/70 hover:bg-white/[0.07] hover:text-white"
                    }`}
                  >
                    <Icon className="h-[18px] w-[18px] text-[#96ADC8]" />
                    <span className="flex-1 text-sm font-medium">{label}</span>
                    {activeTab === id && <ChevronRight className="h-4 w-4" />}
                  </button>
                ))}
              </nav>
            </section>
          </div>,
          document.body
        )}
    </>
  );
}
