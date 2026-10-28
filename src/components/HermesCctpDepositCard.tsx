import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Loader2, Wallet } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { keccak256 } from "viem";
import {
  useAccount,
  usePublicClient,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import {
  ARC_CCTP_DOMAIN,
  CCTP_DESTINATIONS,
  getCctpDestination,
  getCctpMessageDestinationDomain,
  getCctpMessageMintRecipient,
  getCctpMessageNonce,
  MESSAGE_TRANSMITTER_V2,
  MESSAGE_TRANSMITTER_V2_ABI,
  TOKEN_MESSENGER_V2,
  TOKEN_MESSENGER_V2_ABI,
  waitForCctpAttestation,
} from "../lib/cctp";
import {
  ADAPTER_ABI,
  ADDRESSES,
  ARC_CHAIN_ID,
  CCTP_RECEIVER_ABI,
  ERC20_ABI,
  TREASURY_ABI,
  VAULT_ABI,
} from "../lib/contracts";
import { addrToBytes32, parseUsdc } from "../lib/decimals";
import { parseOnchainError } from "../lib/errors";
import type { CctpDepositHandoff } from "../lib/hermes";
import {
  isBridgeDepositActionCompleted,
  isBridgeDepositInProgress,
  useBridgeDepositStore,
} from "../stores/bridgeDeposit";

const ARC_GAS_RESERVE = 100_000_000_000_000_000n;
const PREFLIGHT_TIMEOUT_MS = 20_000;
const SWITCH_TIMEOUT_MS = 45_000;

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function HermesCctpDepositCard({
  handoff,
  actionId,
}: {
  handoff: CctpDepositHandoff;
  actionId: string;
}) {
  const { address, chainId } = useAccount();
  const source = getCctpDestination(handoff.sourceDomain);
  const sourceClient = usePublicClient({
    chainId: source?.chain.id ?? CCTP_DESTINATIONS[6].chain.id,
  });
  const arcClient = usePublicClient({ chainId: ARC_CHAIN_ID });
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();
  const [working, setWorking] = useState(false);
  const [workingLabel, setWorkingLabel] = useState(
    "Waiting for wallet and network confirmation…"
  );
  const [localError, setLocalError] = useState("");
  const bridge = useBridgeDepositStore();
  const amount = (() => {
    try {
      return parseUsdc(handoff.amount);
    } catch {
      return 0n;
    }
  })();
  const activeMatches = Boolean(
    address &&
      bridge.status !== "idle" &&
      bridge.owner.toLowerCase() === address.toLowerCase() &&
      bridge.sourceDomain === handoff.sourceDomain &&
      bridge.amount === amount.toString() &&
      bridge.chatActionId === actionId
  );
  const status = activeMatches ? bridge.status : "idle";
  const completedFromHistory = isBridgeDepositActionCompleted(
    bridge.recent,
    actionId
  );
  const completed = status === "done" || completedFromHistory;
  const isOtherDepositActive =
    !completed && isBridgeDepositInProgress(bridge.status) && !activeMatches;

  useEffect(() => {
    if (
      !activeMatches ||
      status !== "waiting" ||
      !bridge.burnHash ||
      !address ||
      !source
    ) {
      return;
    }
    const controller = new AbortController();
    let active = true;
    void waitForCctpAttestation(bridge.burnHash, {
      sourceDomain: source.domain,
      timeoutMs: 60 * 60_000,
      signal: controller.signal,
    })
      .then((result) => {
        if (!active) return;
        if (result.destinationDomain !== ARC_CCTP_DOMAIN) {
          throw new Error(
            `This attestation targets domain ${result.destinationDomain}, not Arc.`
          );
        }
        useBridgeDepositStore.getState().setBridgeDeposit({
          status: "ready",
          amount: result.amount > 0n ? result.amount.toString() : bridge.amount,
          message: result.message,
          attestation: result.attestation,
          error: "",
        });
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return;
        useBridgeDepositStore.getState().setBridgeDeposit({
          status: "error",
          error:
            error instanceof Error
              ? error.message
              : "Could not fetch the Circle attestation.",
        });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [activeMatches, status, bridge.burnHash, bridge.amount, address, source]);

  async function startDeposit() {
    if (!address || !source || !sourceClient || !arcClient) {
      setLocalError("Connect a wallet and choose a supported source chain.");
      return;
    }
    if (isOtherDepositActive) {
      setLocalError("Another cross-chain deposit is already in progress.");
      return;
    }
    if (amount <= 0n) {
      setLocalError("The CCTP deposit amount is invalid.");
      return;
    }

    setWorking(true);
    setWorkingLabel("Checking balances and network…");
    setLocalError("");
    const setBridgeDeposit = useBridgeDepositStore.getState().setBridgeDeposit;
    try {
      const { sourceAllowance } = await withTimeout(
        (async () => {
          const [sourceBalance, allowance, paused, vaultId, arcGas] =
            await Promise.all([
              sourceClient.readContract({
                address: source.usdc,
                abi: ERC20_ABI,
                functionName: "balanceOf",
                args: [address],
              }),
              sourceClient.readContract({
                address: source.usdc,
                abi: ERC20_ABI,
                functionName: "allowance",
                args: [address, TOKEN_MESSENGER_V2],
              }),
              arcClient.readContract({
                address: ADDRESSES.treasury,
                abi: TREASURY_ABI,
                functionName: "paused",
              }),
              arcClient.readContract({
                address: ADDRESSES.treasury,
                abi: TREASURY_ABI,
                functionName: "defaultVaultId",
              }),
              arcClient.getBalance({ address }),
            ]);
          if (paused) throw new Error("The treasury is paused.");
          if (sourceBalance < amount)
            throw new Error(`Not enough USDC on ${source.name}.`);
          if (arcGas < ARC_GAS_RESERVE) {
            throw new Error(
              "Keep at least 0.1 USDC on Arc for the receiver transaction."
            );
          }
          const vault = await arcClient.readContract({
            address: ADDRESSES.adapter,
            abi: ADAPTER_ABI,
            functionName: "getVaultConfig",
            args: [vaultId],
          });
          if (amount < vault.minDeposit) {
            throw new Error(
              `The live vault minimum is ${vault.minDeposit / 1_000_000n} USDC.`
            );
          }
          const shares = await arcClient.readContract({
            address: ADDRESSES.vault1,
            abi: VAULT_ABI,
            functionName: "previewDeposit",
            args: [amount],
          });
          if (shares === 0n)
            throw new Error("This amount would mint zero vault shares.");
          return { sourceAllowance: allowance };
        })(),
        PREFLIGHT_TIMEOUT_MS,
        "Timed out reading the source and Arc networks. Check your connection and try again."
      );

      setBridgeDeposit({
        status: sourceAllowance < amount ? "approving" : "burning",
        owner: address,
        sourceDomain: source.domain,
        amount: amount.toString(),
        approveHash: "",
        burnHash: "",
        mintHash: "",
        arcApproveHash: "",
        depositHash: "",
        message: "",
        attestation: "",
        error: "",
        chatActionId: actionId,
      });

      if (chainId !== source.chain.id) {
        setWorkingLabel("Switching network in your wallet…");
        await withTimeout(
          switchChainAsync({ chainId: source.chain.id }),
          SWITCH_TIMEOUT_MS,
          "The wallet did not complete the network switch. Open your wallet, confirm the switch, and try again."
        );
      }
      setWorkingLabel("Waiting for wallet and network confirmation…");
      if (sourceAllowance < amount) {
        const approval = await writeContractAsync({
          address: source.usdc,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [TOKEN_MESSENGER_V2, amount],
          account: address,
          chainId: source.chain.id,
        });
        setBridgeDeposit({ approveHash: approval });
        const receipt = await sourceClient.waitForTransactionReceipt({
          hash: approval,
        });
        if (receipt.status !== "success")
          throw new Error("Source USDC approval reverted.");
      }

      setBridgeDeposit({ status: "burning" });
      const burnArgs = [
        amount,
        ARC_CCTP_DOMAIN,
        addrToBytes32(ADDRESSES.receiver),
        source.usdc,
        addrToBytes32(ADDRESSES.receiver),
        0n,
        2000,
        addrToBytes32(address),
      ] as const;
      // Do not block the wallet prompt on a separate source-chain simulation.
      // The wallet performs its own simulation, and a slow public RPC here used
      // to leave the card waiting without ever opening the wallet.
      const burnHash = await writeContractAsync({
        address: TOKEN_MESSENGER_V2,
        abi: TOKEN_MESSENGER_V2_ABI,
        functionName: "depositForBurnWithHook",
        args: burnArgs,
        account: address,
        chainId: source.chain.id,
      });
      setBridgeDeposit({ burnHash });
      const receipt = await sourceClient.waitForTransactionReceipt({
        hash: burnHash,
      });
      if (receipt.status !== "success")
        throw new Error("CCTP source burn reverted.");
      setBridgeDeposit({ status: "waiting", error: "" });
      await queryClient.invalidateQueries();
    } catch (error) {
      const message = parseOnchainError(error);
      const state = useBridgeDepositStore.getState();
      if (state.chatActionId === actionId) {
        setBridgeDeposit({ status: "error", error: message });
      }
      // Always show the failure on the card that initiated it. A stale bridge
      // record from an earlier deposit must not swallow a preflight error.
      setLocalError(message);
    } finally {
      setWorking(false);
    }
  }

  async function completeDeposit() {
    if (!address || !arcClient || !bridge.message || !bridge.attestation)
      return;
    setWorking(true);
    setWorkingLabel("Waiting for wallet and network confirmation…");
    setLocalError("");
    const setBridgeDeposit = useBridgeDepositStore.getState().setBridgeDeposit;
    try {
      if (getCctpMessageDestinationDomain(bridge.message) !== ARC_CCTP_DOMAIN) {
        throw new Error("The attested message does not target Arc.");
      }
      if (
        getCctpMessageMintRecipient(bridge.message).toLowerCase() !==
        ADDRESSES.receiver.toLowerCase()
      ) {
        throw new Error(
          "The attested message does not target the configured Arc receiver."
        );
      }
      if (chainId !== ARC_CHAIN_ID)
        await switchChainAsync({ chainId: ARC_CHAIN_ID });
      const alreadyProcessed = await arcClient.readContract({
        address: ADDRESSES.receiver,
        abi: CCTP_RECEIVER_ABI,
        functionName: "processedMessages",
        args: [keccak256(bridge.message as `0x${string}`)],
      });
      if (alreadyProcessed) {
        setBridgeDeposit({ status: "done", error: "" });
        await queryClient.invalidateQueries();
        return;
      }
      const nonce = getCctpMessageNonce(bridge.message);
      const used = await arcClient.readContract({
        address: MESSAGE_TRANSMITTER_V2,
        abi: MESSAGE_TRANSMITTER_V2_ABI,
        functionName: "usedNonces",
        args: [nonce],
      });
      if (used > 0n)
        throw new Error(
          "This message was already delivered but not credited. Contact support before retrying."
        );
      const call = {
        account: address,
        address: ADDRESSES.receiver,
        abi: CCTP_RECEIVER_ABI,
        functionName: "receiveAndProcess" as const,
        args: [
          bridge.message as `0x${string}`,
          bridge.attestation as `0x${string}`,
        ] as const,
      };
      await arcClient.simulateContract(call);
      setBridgeDeposit({ status: "minting", error: "" });
      const hash = await writeContractAsync({ ...call, chainId: ARC_CHAIN_ID });
      setBridgeDeposit({ mintHash: hash });
      const receipt = await arcClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success")
        throw new Error("Arc receiver transaction reverted.");
      setBridgeDeposit({ status: "done", error: "" });
      await queryClient.invalidateQueries();
    } catch (error) {
      setBridgeDeposit({
        status: "ready",
        error: parseOnchainError(error),
      });
    } finally {
      setWorking(false);
    }
  }

  function retryAttestation() {
    setLocalError("");
    useBridgeDepositStore
      .getState()
      .setBridgeDeposit({ status: "waiting", error: "" });
  }

  return (
    <div className="mt-3 border border-emerald-500/30 bg-emerald-500/[0.04] p-4 text-left">
      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-200">
        CCTP deposit
      </p>
      <p className="mt-1.5 text-sm text-white">
        {handoff.amount} USDC from{" "}
        {source?.name ?? `domain ${handoff.sourceDomain}`} into the Arc vault
      </p>
      {status === "waiting" && (
        <StatusLine>
          Waiting for Circle attestation. This can take 15–30 minutes.
        </StatusLine>
      )}
      {status === "approving" && (
        <StatusLine>Approve USDC on {source?.name} in your wallet…</StatusLine>
      )}
      {status === "burning" && (
        <StatusLine>
          Confirm the CCTP burn on {source?.name} in your wallet…
        </StatusLine>
      )}
      {status === "minting" && (
        <StatusLine>
          Confirm the Arc receiver transaction in your wallet…
        </StatusLine>
      )}
      {completed && (
        <StatusLine complete>Credited to your treasury and vault.</StatusLine>
      )}
      {(localError || (activeMatches && bridge.error)) && (
        <p
          className="mt-3 flex items-start gap-2 text-xs text-amber-200"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {localError || bridge.error}
        </p>
      )}
      {status === "ready" && (
        <button
          type="button"
          onClick={() => void completeDeposit()}
          disabled={working || !address}
          className="glimmer-primary-cta mt-4 inline-flex items-center gap-2"
        >
          <Wallet className="h-4 w-4" />
          Continue on Arc
        </button>
      )}
      {!completed && (status === "idle" || status === "error") && (
        <button
          type="button"
          onClick={() =>
            void (status === "error" && activeMatches && bridge.burnHash
              ? retryAttestation()
              : startDeposit())
          }
          disabled={working || !address || isOtherDepositActive}
          className="glimmer-primary-cta mt-4 inline-flex items-center gap-2"
        >
          <Wallet className="h-4 w-4" />
          {status === "error" && activeMatches && bridge.burnHash
            ? "Retry attestation"
            : "Continue in wallet"}
        </button>
      )}
      {working && !completed && <StatusLine>{workingLabel}</StatusLine>}
      {isOtherDepositActive && (
        <p className="mt-3 text-xs text-slate-400">
          Another inbound CCTP deposit is already in progress.
        </p>
      )}
    </div>
  );
}

function StatusLine({
  children,
  complete = false,
}: {
  children: ReactNode;
  complete?: boolean;
}) {
  return (
    <p
      className={`mt-3 flex w-full flex-col items-start gap-1.5 text-xs ${
        complete ? "text-emerald-300" : "text-sky-200"
      }`}
      role="status"
    >
      {complete ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      )}
      {children}
    </p>
  );
}
