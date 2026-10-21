import { ConnectKitButton } from 'connectkit'
import { Vault } from 'lucide-react'
import { ARC_NETWORK_LABEL } from '../lib/contracts'

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-800 bg-[#0a0f1e]/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20 ring-1 ring-emerald-500/40">
            <Vault className="h-4 w-4 text-emerald-400" />
          </div>
          <div>
            <span className="font-display text-sm font-semibold tracking-tight text-white sm:text-base">
              Agent Treasury
            </span>
          </div>
          <span className="hidden rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-400 sm:inline-block">
            {ARC_NETWORK_LABEL}
          </span>
        </div>
        <ConnectKitButton />
      </div>
    </header>
  )
}
