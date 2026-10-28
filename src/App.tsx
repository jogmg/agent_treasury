import { useEffect } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { HermesDock } from "./components/HermesDock";
import { OverviewTab } from "./components/tabs/OverviewTab";
import { DepositTab } from "./components/tabs/DepositTab";
import { YieldTab } from "./components/tabs/YieldTab";
import { WithdrawTab } from "./components/tabs/WithdrawTab";
import { ActivityTab } from "./components/tabs/ActivityTab";
import { SettingsTab } from "./components/tabs/SettingsTab";
import { useTreasuryData, useActivityEvents } from "./hooks/useTreasuryData";
import { useUiStore, type TabId } from "./stores/ui";
import { useFlowStore } from "./stores/flow";
import { getCctpDestination } from "./lib/cctp";
import { ARC_CHAIN, ARC_CHAIN_ID } from "./lib/contracts";
import { LIVE_APP_URL, STUDIO_PREVIEW } from "./lib/studioPreview";
import { ArcMark } from "./components/ArcMark";

// ── Global data bootstrap ────────────────────────────────────────────────────
function DataBootstrap() {
  useTreasuryData();
  useActivityEvents();
  return null;
}

// ── Wrong-network banner ──────────────────────────────────────────────────────
function WrongNetworkBanner() {
  const { chainId, isConnected } = useAccount();
  const { switchChain, isPending } = useSwitchChain();
  const completionStatus = useFlowStore((s) => s.cctpCompletionStatus);
  const destinationDomain = useFlowStore((s) => s.cctpDestinationDomain);
  if (!isConnected || chainId === ARC_CHAIN_ID) return null;

  const destination = getCctpDestination(destinationDomain);
  const isCompletingMint =
    completionStatus === "ready" ||
    completionStatus === "minting" ||
    completionStatus === "done";

  if (isCompletingMint) {
    return (
      <div className="border-b border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-center text-xs text-emerald-300">
        Completing the CCTP mint on{" "}
        {destination?.name ?? "the destination chain"}.{" "}
        <button
          onClick={() => switchChain({ chainId: ARC_CHAIN_ID })}
          disabled={isPending}
          className="font-semibold underline hover:text-emerald-200"
        >
          {isPending ? (
            "Switching…"
          ) : (
            <>
              Back to <ArcMark size={14} className="mx-1 align-[-3px]" />
              {ARC_CHAIN.name}
            </>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-300">
      Wrong network.{" "}
      <button
        onClick={() => switchChain({ chainId: ARC_CHAIN_ID })}
        disabled={isPending}
        className="font-semibold underline hover:text-amber-200"
      >
        {isPending ? (
          "Switching…"
        ) : (
          <>
            Switch to <ArcMark size={14} className="mx-1 align-[-3px]" />
            {ARC_CHAIN.name}
          </>
        )}
      </button>
    </div>
  );
}

function StudioPreviewBanner() {
  if (!STUDIO_PREVIEW) return null;

  return (
    <div className="border-b border-sky-400/30 bg-sky-500/10 px-4 py-2 text-center text-xs text-sky-200">
      <span className="font-semibold">Arc Studio preview.</span> Treasury reads
      work here; chat and Hermes-authenticated actions run in the live app.{" "}
      <a
        href={LIVE_APP_URL}
        target="_blank"
        rel="noreferrer"
        className="font-semibold underline hover:text-sky-100"
      >
        Open the live app
      </a>
      .
    </div>
  );
}

const TAB_IDS = new Set<TabId>([
  "overview",
  "hermes",
  "deposit",
  "yield",
  "withdraw",
  "activity",
  "settings",
]);
const INTENT_ID_RE = /^int_[a-f0-9]{32}$/;

function applyLocationLink(
  setTab: (tab: TabId) => void,
  setReviewIntent: (id: string | null) => void,
  studioPreview: boolean
) {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get("tab");
  if (tab && TAB_IDS.has(tab as TabId)) {
    const next = tab as TabId;
    // Chat needs the BFF and is intentionally unavailable in Studio preview.
    if (!(studioPreview && next === "hermes")) setTab(next);
  }

  const intent = params.get("intent");
  setReviewIntent(intent && INTENT_ID_RE.test(intent) ? intent : null);
}

// ── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const { activeTab, setTab, setReviewIntent } = useUiStore();
  const studioPreview = STUDIO_PREVIEW;

  useEffect(() => {
    const sync = () =>
      applyLocationLink(setTab, setReviewIntent, studioPreview);
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [setReviewIntent, setTab, studioPreview]);

  useEffect(() => {
    if (studioPreview && activeTab === "hermes") setTab("overview");
  }, [activeTab, setTab, studioPreview]);

  const displayTab =
    studioPreview && activeTab === "hermes" ? "overview" : activeTab;

  const TAB_CONTENT: Record<string, JSX.Element> = {
    overview: <OverviewTab />,
    hermes: <HermesDock />,
    deposit: <DepositTab />,
    yield: <YieldTab />,
    withdraw: <WithdrawTab />,
    activity: <ActivityTab />,
    settings: <SettingsTab />,
  };

  return (
    <div className="glimmer-page flex min-h-dvh flex-col font-body text-white">
      <DataBootstrap />
      <Header />
      <StudioPreviewBanner />
      <WrongNetworkBanner />
      <main
        className={
          displayTab === "hermes"
            ? "flex h-[calc(100dvh-124px)] min-h-[22rem] flex-1 items-center justify-center px-3 pb-3 py-6 sm:px-6"
            : "mx-auto flex w-full max-w-6xl flex-1 px-4 py-6 sm:px-6"
        }
      >
        {displayTab === "hermes" ? (
          <div className="w-full max-w-[980px] min-h-[18rem]">
            {TAB_CONTENT[displayTab] ?? <OverviewTab />}
          </div>
        ) : (
          <div className="w-full min-h-[18rem]">
            {TAB_CONTENT[displayTab] ?? <OverviewTab />}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
