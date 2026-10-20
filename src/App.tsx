import { useAccount, useSwitchChain } from 'wagmi'
import { Header } from './components/Header'
import { TabBar } from './components/TabBar'
import { OverviewTab }  from './components/tabs/OverviewTab'
import { DepositTab }   from './components/tabs/DepositTab'
import { YieldTab }     from './components/tabs/YieldTab'
import { WithdrawTab }  from './components/tabs/WithdrawTab'
import { ActivityTab }  from './components/tabs/ActivityTab'
import { SettingsTab }  from './components/tabs/SettingsTab'
import { useTreasuryData, useActivityEvents } from './hooks/useTreasuryData'
import { useUiStore } from './stores/ui'
import { ARC_TESTNET_CHAIN_ID } from './lib/contracts'

// ── Global data bootstrap ────────────────────────────────────────────────────
function DataBootstrap() {
  useTreasuryData()
  useActivityEvents()
  return null
}

// ── Wrong-network banner ──────────────────────────────────────────────────────
function WrongNetworkBanner() {
  const { chainId, isConnected } = useAccount()
  const { switchChain, isPending } = useSwitchChain()
  if (!isConnected || chainId === ARC_TESTNET_CHAIN_ID) return null
  return (
    <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-300">
      Wrong network.{' '}
      <button
        onClick={() => switchChain({ chainId: ARC_TESTNET_CHAIN_ID })}
        disabled={isPending}
        className="font-semibold underline hover:text-amber-200"
      >
        {isPending ? 'Switching…' : 'Switch to Arc Testnet'}
      </button>
    </div>
  )
}

// ── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const { activeTab, setTab } = useUiStore()

  const TAB_CONTENT: Record<string, JSX.Element> = {
    overview:  <OverviewTab />,
    deposit:   <DepositTab />,
    yield:     <YieldTab />,
    withdraw:  <WithdrawTab />,
    activity:  <ActivityTab />,
    settings:  <SettingsTab />,
  }

  return (
    <div className="min-h-dvh bg-[#080c18] font-body text-white">
      <DataBootstrap />
      <Header />
      <WrongNetworkBanner />
      <TabBar active={activeTab} onChange={setTab} />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {TAB_CONTENT[activeTab] ?? <OverviewTab />}
      </main>
    </div>
  )
}
