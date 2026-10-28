import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { encodeFunctionData } from "viem";
import {
  useAccount,
  usePublicClient,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { useFlowStore } from "../stores/flow";
import {
  ADDRESSES,
  ARC_CHAIN_ID,
  ERC20_ABI,
  TREASURY_ABI,
} from "../lib/contracts";
import { addrToBytes32 } from "../lib/decimals";
import { parseOnchainError } from "../lib/errors";
import {
  getHermesIntent,
  markHermesIntentSubmitted,
  type HermesIntent,
} from "../lib/hermes";

const MAX_U256 = BigInt(
  "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
);

export interface IntentExecution {
  intentId: string | null;
  step: string | null;
  error: string | null;
}

export function assertFreshHermesIntent(
  intent: HermesIntent,
  displayed: HermesIntent,
  wallet: string
) {
  if (
    intent.id !== displayed.id ||
    intent.wallet.toLowerCase() !== wallet.toLowerCase()
  ) {
    throw new Error("This draft does not belong to the connected wallet.");
  }
  if (
    intent.chainId !== ARC_CHAIN_ID ||
    intent.to.toLowerCase() !== ADDRESSES.treasury.toLowerCase()
  ) {
    throw new Error("This draft targets a different network or treasury.");
  }
  const expiresAt = Date.parse(intent.expiresAt);
  if (
    intent.status !== "draft" ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now()
  ) {
    throw new Error("This draft is no longer active. Prepare a new one.");
  }
  if (!intent.simulation.ok || intent.value !== "0") {
    throw new Error(
      intent.simulation.error ??
        "This draft is not ready for wallet submission."
    );
  }
  if (
    intent.kind !== displayed.kind ||
    intent.amount !== displayed.amount ||
    intent.isMax !== displayed.isMax ||
    intent.data.toLowerCase() !== displayed.data.toLowerCase() ||
    intent.destinationDomain !== displayed.destinationDomain ||
    intent.mintRecipient?.toLowerCase() !==
      displayed.mintRecipient?.toLowerCase()
  ) {
    throw new Error(
      "The draft changed. Review the latest response before signing."
    );
  }

  const amount = BigInt(intent.amount);
  const expectedData =
    intent.kind === "deposit"
      ? encodeFunctionData({
          abi: TREASURY_ABI,
          functionName: "deposit",
          args: [amount],
        })
      : intent.kind === "withdrawLocal"
      ? encodeFunctionData({
          abi: TREASURY_ABI,
          functionName: "withdrawLocal",
          args: [intent.isMax ? MAX_U256 : amount],
        })
      : intent.destinationDomain !== null && intent.mintRecipient
      ? encodeFunctionData({
          abi: TREASURY_ABI,
          functionName: "requestWithdrawal",
          args: [
            wallet as `0x${string}`,
            amount,
            intent.destinationDomain,
            addrToBytes32(intent.mintRecipient),
          ],
        })
      : "";
  if (
    !expectedData ||
    intent.data.toLowerCase() !== expectedData.toLowerCase()
  ) {
    throw new Error(
      "The draft transaction does not match its approved action."
    );
  }
}

export function useHermesIntentExecution() {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: ARC_CHAIN_ID });
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();
  const setCctp = useFlowStore((state) => state.setCctp);
  const [execution, setExecution] = useState<IntentExecution>({
    intentId: null,
    step: null,
    error: null,
  });

  async function execute(
    displayed: HermesIntent,
    onSubmitted?: (intent: HermesIntent) => void
  ): Promise<HermesIntent | null> {
    if (!address || !publicClient) {
      setExecution({
        intentId: displayed.id,
        step: null,
        error: "Connect a wallet before continuing.",
      });
      return null;
    }
    setExecution({
      intentId: displayed.id,
      step: "Checking draft…",
      error: null,
    });
    try {
      if (chainId !== ARC_CHAIN_ID) {
        setExecution({
          intentId: displayed.id,
          step: "Switching to Arc…",
          error: null,
        });
        await switchChainAsync({ chainId: ARC_CHAIN_ID });
      }

      const intent = await getHermesIntent(displayed.id);
      assertFreshHermesIntent(intent, displayed, address);
      const amount = BigInt(intent.amount);

      if (intent.kind === "deposit") {
        const allowance = await publicClient.readContract({
          address: ADDRESSES.usdc,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [address, ADDRESSES.treasury],
        });
        if (allowance < amount) {
          setExecution({
            intentId: intent.id,
            step: "Confirm USDC approval in your wallet…",
            error: null,
          });
          const approval = await writeContractAsync({
            address: ADDRESSES.usdc,
            abi: ERC20_ABI,
            functionName: "approve",
            args: [ADDRESSES.treasury, amount],
            account: address,
            chainId: ARC_CHAIN_ID,
          });
          setExecution({
            intentId: intent.id,
            step: "Confirming USDC approval…",
            error: null,
          });
          const approvalReceipt = await publicClient.waitForTransactionReceipt({
            hash: approval,
          });
          if (approvalReceipt.status !== "success")
            throw new Error("USDC approval reverted.");
        }
        setExecution({
          intentId: intent.id,
          step: "Confirm deposit in your wallet…",
          error: null,
        });
        await publicClient.simulateContract({
          account: address,
          address: ADDRESSES.treasury,
          abi: TREASURY_ABI,
          functionName: "deposit",
          args: [amount],
        });
        const hash = await writeContractAsync({
          address: ADDRESSES.treasury,
          abi: TREASURY_ABI,
          functionName: "deposit",
          args: [amount],
          account: address,
          chainId: ARC_CHAIN_ID,
        });
        return await confirmIntent(intent, hash, onSubmitted);
      }

      if (intent.kind === "withdrawLocal") {
        setExecution({
          intentId: intent.id,
          step: "Confirm withdrawal in your wallet…",
          error: null,
        });
        const args: [bigint] = [intent.isMax ? MAX_U256 : amount];
        await publicClient.simulateContract({
          account: address,
          address: ADDRESSES.treasury,
          abi: TREASURY_ABI,
          functionName: "withdrawLocal",
          args,
        });
        const hash = await writeContractAsync({
          address: ADDRESSES.treasury,
          abi: TREASURY_ABI,
          functionName: "withdrawLocal",
          args,
          account: address,
          chainId: ARC_CHAIN_ID,
        });
        return await confirmIntent(intent, hash, onSubmitted);
      }

      const domain = intent.destinationDomain;
      const recipient = intent.mintRecipient;
      if (domain === null || !recipient)
        throw new Error("This CCTP draft is incomplete.");
      setExecution({
        intentId: intent.id,
        step: "Confirm CCTP withdrawal in your wallet…",
        error: null,
      });
      const args = [address, amount, domain, addrToBytes32(recipient)] as const;
      await publicClient.simulateContract({
        account: address,
        address: ADDRESSES.treasury,
        abi: TREASURY_ABI,
        functionName: "requestWithdrawal",
        args,
      });
      const hash = await writeContractAsync({
        address: ADDRESSES.treasury,
        abi: TREASURY_ABI,
        functionName: "requestWithdrawal",
        args,
        account: address,
        chainId: ARC_CHAIN_ID,
      });
      const confirmed = await confirmIntent(intent, hash, onSubmitted);
      setCctp({
        cctpStep: "success",
        cctpHash: hash,
        cctpOwner: address,
        cctpError: "",
        cctpCompletionStatus: "waiting",
        cctpDestinationDomain: domain,
        cctpAmount: intent.amount,
        cctpRecipient: recipient,
        cctpMessage: "",
        cctpAttestation: "",
        cctpMintHash: "",
        cctpCompletionError: "",
      });
      return confirmed;
    } catch (cause) {
      setExecution({
        intentId: displayed.id,
        step: null,
        error: parseOnchainError(cause),
      });
      return null;
    }
  }

  async function confirmIntent(
    intent: HermesIntent,
    hash: `0x${string}`,
    onSubmitted?: (intent: HermesIntent) => void
  ): Promise<HermesIntent> {
    let submitted: HermesIntent = {
      ...intent,
      status: "submitted",
      txHash: hash,
    };
    try {
      submitted = await markHermesIntentSubmitted(intent.id, hash);
    } catch {
      console.warn("Could not update Hermes intent status");
    }
    onSubmitted?.(submitted);
    setExecution({
      intentId: intent.id,
      step: "Waiting for Arc confirmation…",
      error: null,
    });
    const receipt = await publicClient!.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success")
      throw new Error("The transaction reverted on Arc.");
    submitted = { ...submitted, status: "confirmed" };
    onSubmitted?.(submitted);
    setExecution({
      intentId: intent.id,
      step: "Transaction confirmed on Arc",
      error: null,
    });
    await queryClient.invalidateQueries();
    return submitted;
  }

  return { execution, execute };
}
