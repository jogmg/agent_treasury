import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Fuel,
  Info,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { decodeFunctionData, keccak256, zeroHash } from "viem";
import {
  useAccount,
  useBalance,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { useDepositShares } from "../hooks/useDepositShares";
import { useMinDeposit } from "../hooks/useMinDeposit";
import {
  ARC_CCTP_DOMAIN,
  CCTP_DESTINATIONS,
  getCctpDestination,
  getCctpMessageMintRecipient,
  getCctpMessageNonce,
  MESSAGE_TRANSMITTER_V2,
  MESSAGE_TRANSMITTER_V2_ABI,
  TOKEN_MESSENGER_V2,
  TOKEN_MESSENGER_V2_ABI,
  waitForCctpAttestation,
} from "../lib/cctp";
import {
  ADDRESSES,
  ARC_CHAIN_ID,
  ARC_EXPLORER,
  CCTP_RECEIVER_ABI,
  ERC20_ABI,
  IS_ARC_MAINNET,
  TREASURY_ABI,
  VAULT_ABI,
} from "../lib/contracts";
import {
  addrToBytes32,
  formatUsdc,
  formatUsdcDollar,
  parseUsdc,
  shortAddr,
} from "../lib/decimals";
import { parseOnchainError } from "../lib/errors";
import {
  BRIDGE_STATUS_LABEL,
  useBridgeDepositStore,
} from "../stores/bridgeDeposit";
import { NetworkLabel } from "./ArcMark";

const ARC_GAS_SYMBOL = "USDC";
// Keep enough native USDC for the Arc mint, approval, and treasury deposit.
// Arc gas is paid from the same native USDC balance, so depositing the entire
// minted amount without a buffer can make the final deposit fail.
const ARC_GAS_RESERVE = 100_000_000_000_000_000n; // 0.1 USDC in 18-dec native units
const SOURCES = Object.values(CCTP_DESTINATIONS);

// Receivers that were once wired but can no longer credit inbound burns: the
// original v1 (never on the app path) and the first V2, which rejected real
// cross-chain messages because it compared the source-chain `burnToken` to
// Arc USDC. A burn bound to one of these cannot be re-routed; start a new burn.
const SUPERSEDED_RECEIVERS = new Set([
  "0x8066bcf8e6b17e2d84082179a89f0972cc6e31c1", // v1 testnet
  "0x91f1eb97a40fdab05d150c10566cf9aa3546a375", // v1 mainnet
  "0xa0d233e24b7b2280bc4f9a2447f59860050acb4d", // V2 testnet (burnToken bug)
  "0x54776bc9551b0dc8c1c83c21f81f11ef3a59da98", // V2 mainnet (burnToken bug)
]);

function rawAmount(value: string): bigint {
  try {
    return value ? BigInt(value) : 0n;
  } catch {
    return 0n;
  }
}

/**
 * Inbound CCTP: burn USDC on a source chain with the Arc receiver as both
 * mintRecipient and destinationCaller, wait for Circle's attestation, then call
 * CCTPReceiverV2.receiveAndProcess on Arc. The receiver mints to itself,
 * forwards the USDC to the treasury, and records the real source domain in one
 * transaction. The old wallet-mint + approve + deposit path is kept only as a
 * fallback for burns created before the receiver upgrade.
 */
export function CrossChainDepositCard() {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();

  const [selectedSourceDomain, setSelectedSourceDomain] = useState(0);
  const [enteredAmount, setEnteredAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [resumeTx, setResumeTx] = useState("");
  const [resuming, setResuming] = useState(false);

  const {
    status,
    owner,
    sourceDomain: activeSourceDomain,
    amount: activeAmount,
    approveHash,
    burnHash,
    mintHash,
    arcApproveHash,
    depositHash,
    message,
    attestation,
    error,
    recent,
    setBridgeDeposit,
    resetBridgeDeposit,
    // discardBridgeDeposit,
    restoreBridgeDeposit,
    clearBridgeHistory,
  } = useBridgeDepositStore();

  const sourceDomain = selectedSourceDomain;
  const amount = enteredAmount;

  const source = getCctpDestination(sourceDomain) ?? CCTP_DESTINATIONS[0];
  const activeSource =
    getCctpDestination(activeSourceDomain) ?? CCTP_DESTINATIONS[0];

  const sourceClient = usePublicClient({ chainId: source.chain.id });
  const arcClient = usePublicClient({ chainId: ARC_CHAIN_ID });

  const { data: sourceBalance, refetch: refetchSourceBalance } =
    useReadContract({
      address: source.usdc,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: address ? [address] : undefined,
      chainId: source.chain.id,
      query: { enabled: Boolean(address) },
    });

  const { data: sourceAllowance, refetch: refetchSourceAllowance } =
    useReadContract({
      address: source.usdc,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: address ? [address, TOKEN_MESSENGER_V2] : undefined,
      chainId: source.chain.id,
      query: { enabled: Boolean(address) },
    });

  const { data: sourceGas } = useBalance({
    address,
    chainId: source.chain.id,
    query: { enabled: Boolean(address) },
  });

  const { data: arcGas, refetch: refetchArcGas } = useBalance({
    address,
    chainId: ARC_CHAIN_ID,
    query: { enabled: Boolean(address) },
  });

  const parsedAmount = amount ? parseUsdc(amount) : 0n;
  const needsApprove =
    parsedAmount > 0n && (sourceAllowance ?? 0n) < parsedAmount;
  // The treasury enforces the adapter's on-chain minimum; mirror it exactly.
  const minDeposit = useMinDeposit();
  // Block burns whose bridged amount would mint zero vault shares.
  const { zeroShares, oneShareAssets } = useDepositShares(parsedAmount);
  const ownerMatches = Boolean(
    address && owner && address.toLowerCase() === owner.toLowerCase()
  );
  const isActive = status !== "idle";
  const myRecent = address
    ? recent.filter(
        (record) => record.owner.toLowerCase() === address.toLowerCase()
      )
    : [];

  let validation: string | null = null;
  if (!address) validation = "Connect wallet";
  else if (minDeposit === undefined)
    validation = "Reading vault minimum. Try again in a moment";
  else if (parsedAmount === 0n) validation = "Enter amount";
  else if (parsedAmount < minDeposit)
    validation = `Minimum cross-chain deposit is ${formatUsdcDollar(
      minDeposit
    )}`;
  else if (zeroShares) {
    validation = oneShareAssets
      ? `Amount too small for the vault's share price — deposit at least ${formatUsdcDollar(
          oneShareAssets
        )}`
      : "Amount too small to mint vault shares";
  } else if (sourceBalance !== undefined && parsedAmount > sourceBalance) {
    validation = `Insufficient USDC on ${source.name}`;
  }

  const activeRaw = rawAmount(activeAmount);
  const activeAmountLabel =
    activeRaw > 0n ? formatUsdcDollar(activeRaw) : "USDC";
  const activeGas = arcGas;
  const needsArcGas = Boolean(activeGas && activeGas.value < ARC_GAS_RESERVE);

  // Resume the attestation poll after a tab switch. The burn is already safely
  // on the source chain, so only the destination mint is left.
  useEffect(() => {
    if (
      status !== "waiting" ||
      !address ||
      !owner ||
      owner.toLowerCase() !== address.toLowerCase() ||
      !burnHash ||
      !Number.isInteger(activeSourceDomain)
    ) {
      return;
    }

    const controller = new AbortController();
    let active = true;

    void (async () => {
      try {
        const result = await waitForCctpAttestation(burnHash, {
          sourceDomain: activeSourceDomain,
          timeoutMs: 60 * 60_000,
          signal: controller.signal,
        });
        if (!active) return;
        if (result.destinationDomain !== ARC_CCTP_DOMAIN) {
          throw new Error(
            `This attestation targets CCTP domain ${result.destinationDomain}, not Arc (${ARC_CCTP_DOMAIN}).`
          );
        }

        setBridgeDeposit({
          status: "ready",
          amount:
            result.amount > 0n
              ? result.amount.toString()
              : useBridgeDepositStore.getState().amount,
          message: result.message,
          attestation: result.attestation,
          error: "",
        });
      } catch (e) {
        if (!active || controller.signal.aborted) return;
        setBridgeDeposit({
          status: "error",
          error:
            e instanceof Error
              ? e.message
              : "Could not fetch the Circle attestation.",
        });
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [status, address, owner, burnHash, activeSourceDomain, setBridgeDeposit]);

  async function handleBridge() {
    if (!address || !sourceClient) return;
    if (validation) {
      toast.error(validation);
      return;
    }

    setBusy(true);
    setBridgeDeposit({
      status: needsApprove ? "approving" : "burning",
      owner: address,
      sourceDomain: source.domain,
      amount: parsedAmount.toString(),
      approveHash: "",
      burnHash: "",
      mintHash: "",
      arcApproveHash: "",
      depositHash: "",
      message: "",
      attestation: "",
      error: "",
      chatActionId: "",
    });

    try {
      if (chainId !== source.chain.id) {
        await switchChainAsync({ chainId: source.chain.id });
      }

      if (needsApprove) {
        const approveTx = await writeContractAsync({
          address: source.usdc,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [TOKEN_MESSENGER_V2, parsedAmount],
          chainId: source.chain.id,
        });
        setBridgeDeposit({ approveHash: approveTx });

        const approveReceipt = await sourceClient.waitForTransactionReceipt({
          hash: approveTx,
        });
        if (approveReceipt.status !== "success")
          throw new Error("Approval transaction reverted");
        toast.success(`USDC approved on ${source.name}`);
        void refetchSourceAllowance();
      }

      setBridgeDeposit({ status: "burning", error: "" });

      // mintRecipient + destinationCaller are the receiver: CCTP mints to it and
      // only it can call receiveMessage. hookData is abi.encode(agent), i.e. the
      // connected wallet as one 32-byte word at body byte 228.
      const burnTx = await writeContractAsync({
        address: TOKEN_MESSENGER_V2,
        abi: TOKEN_MESSENGER_V2_ABI,
        functionName: "depositForBurnWithHook",
        args: [
          parsedAmount,
          ARC_CCTP_DOMAIN,
          addrToBytes32(ADDRESSES.receiver),
          source.usdc,
          addrToBytes32(ADDRESSES.receiver),
          0n,
          2000, // standard finality; 1000 would require a fast-transfer fee
          addrToBytes32(address),
        ],
        chainId: source.chain.id,
      });
      setBridgeDeposit({ burnHash: burnTx });

      const burnReceipt = await sourceClient.waitForTransactionReceipt({
        hash: burnTx,
      });
      if (burnReceipt.status !== "success")
        throw new Error("CCTP burn transaction reverted");

      setBridgeDeposit({ status: "waiting", error: "" });
      setEnteredAmount("");
      void refetchSourceBalance();
      void refetchSourceAllowance();
      await queryClient.invalidateQueries();
      toast.success(
        "Source-chain burn confirmed. Waiting for Circle attestation…"
      );
    } catch (e) {
      const messageText = parseOnchainError(e);
      setBridgeDeposit({ status: "error", error: messageText });
      if (messageText !== "Transaction cancelled.") toast.error(messageText);
    } finally {
      setBusy(false);
    }
  }

  async function handleResume() {
    if (!address || !sourceClient) return;
    const hash = resumeTx.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      toast.error("Enter a valid source-chain transaction hash.");
      return;
    }

    setResuming(true);
    try {
      const transaction = await sourceClient.getTransaction({
        hash: hash as `0x${string}`,
      });
      if (!transaction)
        throw new Error(`No transaction found on ${source.name}.`);
      if (
        !transaction.to ||
        transaction.to.toLowerCase() !== TOKEN_MESSENGER_V2.toLowerCase()
      ) {
        throw new Error(
          `That transaction did not call CCTP TokenMessenger on ${source.name}.`
        );
      }

      const decoded = decodeFunctionData({
        abi: TOKEN_MESSENGER_V2_ABI,
        data: transaction.input,
      });

      if (decoded.functionName === "depositForBurnWithHook") {
        const args = decoded.args;
        if (!args || args.length < 8)
          throw new Error("Could not decode the CCTP burn arguments.");

        const domain = Number(args[1]);
        if (domain !== ARC_CCTP_DOMAIN) {
          throw new Error(
            `That burn targets CCTP domain ${domain}, not Arc (${ARC_CCTP_DOMAIN}).`
          );
        }

        const mintRecipient = `0x${args[2].slice(-40)}`;
        if (mintRecipient.toLowerCase() !== ADDRESSES.receiver.toLowerCase()) {
          throw new Error(
            `That burn mints to ${shortAddr(
              mintRecipient
            )}, not the Arc receiver ${shortAddr(ADDRESSES.receiver)}.`
          );
        }

        if (
          args[4].toLowerCase() !==
          addrToBytes32(ADDRESSES.receiver).toLowerCase()
        ) {
          throw new Error(
            "That burn does not restrict the destination caller to the Arc receiver."
          );
        }

        const hookAgent = args[7].length >= 66 ? `0x${args[7].slice(-40)}` : "";
        if (hookAgent.toLowerCase() !== address.toLowerCase()) {
          throw new Error(
            `That burn credits ${
              hookAgent ? shortAddr(hookAgent) : "an unknown agent"
            }, not the connected wallet ${shortAddr(address)}.`
          );
        }

        setBridgeDeposit({
          status: "waiting",
          owner: address,
          sourceDomain: source.domain,
          amount: args[0].toString(),
          approveHash: "",
          burnHash: hash,
          mintHash: "",
          arcApproveHash: "",
          depositHash: "",
          message: "",
          attestation: "",
          error: "",
        });
        setResumeTx("");
        toast.success("Source burn loaded. Waiting for Circle attestation…");
      } else if (decoded.functionName === "depositForBurn") {
        // Legacy burns minted to the wallet and set destinationCaller = 0. Keep
        // recovery working for any in-flight burn created before the receiver
        // upgrade; completion branches on the message's mintRecipient.
        const args = decoded.args;
        if (!args || args.length < 7)
          throw new Error("Could not decode the CCTP burn arguments.");

        const domain = Number(args[1]);
        if (domain !== ARC_CCTP_DOMAIN) {
          throw new Error(
            `That burn targets CCTP domain ${domain}, not Arc (${ARC_CCTP_DOMAIN}).`
          );
        }

        if (args[4].toLowerCase() !== zeroHash) {
          throw new Error(
            "That burn restricts the destination caller, so this wallet cannot mint it."
          );
        }

        const mintRecipient = `0x${args[2].slice(-40)}`;
        if (mintRecipient.toLowerCase() !== address.toLowerCase()) {
          throw new Error(
            `That burn mints to ${shortAddr(
              mintRecipient
            )}, not the connected wallet ${shortAddr(address)}.`
          );
        }

        setBridgeDeposit({
          status: "waiting",
          owner: address,
          sourceDomain: source.domain,
          amount: args[0].toString(),
          approveHash: "",
          burnHash: hash,
          mintHash: "",
          arcApproveHash: "",
          depositHash: "",
          message: "",
          attestation: "",
          error: "",
        });
        setResumeTx("");
        toast.success(
          "Legacy source burn loaded. Waiting for Circle attestation…"
        );
      } else {
        throw new Error("That transaction is not a CCTP burn.");
      }
    } catch (e) {
      toast.error(
        e instanceof Error
          ? e.message
          : "Could not load that source transaction."
      );
    } finally {
      setResuming(false);
    }
  }

  async function handleCompleteDeposit() {
    if (!address || !arcClient || !message || !attestation) return;
    if (owner && owner.toLowerCase() !== address.toLowerCase()) {
      toast.error("Switch to the wallet that started this deposit.");
      return;
    }

    const amountToDeposit =
      activeRaw > 0n
        ? activeRaw
        : rawAmount(useBridgeDepositStore.getState().amount);
    if (amountToDeposit === 0n) {
      toast.error(
        "The attested amount is not available yet. Retry the attestation."
      );
      return;
    }

    // New burns mint to the receiver; legacy burns mint to the wallet. Branch
    // on the attested message, not on a client-side flag, so a pasted burn hash
    // always takes the correct path.
    let mintRecipient: `0x${string}`;
    try {
      mintRecipient = getCctpMessageMintRecipient(message);
    } catch {
      toast.error("The attested CCTP message could not be decoded.");
      return;
    }

    const receiverRoute =
      mintRecipient.toLowerCase() === ADDRESSES.receiver.toLowerCase();
    const legacyRoute = mintRecipient.toLowerCase() === address.toLowerCase();

    if (SUPERSEDED_RECEIVERS.has(mintRecipient.toLowerCase())) {
      toast.error(
        "This burn targets a superseded receiver and cannot be credited. Start a new cross-chain deposit."
      );
      return;
    }

    if (!receiverRoute && !legacyRoute) {
      toast.error(
        `This message mints to ${shortAddr(
          mintRecipient
        )}, not the Arc receiver or the connected wallet.`
      );
      return;
    }

    if (receiverRoute) {
      await completeReceiverDeposit();
    } else {
      await completeLegacyDeposit(amountToDeposit);
    }
  }

  /**
   * New route: one Arc transaction. CCTPReceiverV2 is both mintRecipient and
   * destinationCaller, so it can deliver the message, receive the USDC, forward
   * it to the treasury, and record the real source domain atomically.
   */
  async function completeReceiverDeposit() {
    if (!address || !arcClient || !message || !attestation) return;

    setBridgeDeposit({
      status: "minting",
      error: "",
      mintHash: "",
      arcApproveHash: "",
      depositHash: "",
    });
    try {
      if (chainId !== ARC_CHAIN_ID) {
        await switchChainAsync({ chainId: ARC_CHAIN_ID });
      }

      const gasBalance = await arcClient.getBalance({ address });
      if (gasBalance < ARC_GAS_RESERVE) {
        setBridgeDeposit({
          status: "ready",
          error: `Keep at least 0.1 ${ARC_GAS_SYMBOL} on Arc for the receiver transaction. The bridge amount is credited in full, so it cannot cover the gas.`,
        });
        return;
      }

      const messageHash = keccak256(message as `0x${string}`);
      let alreadyProcessed = false;
      try {
        alreadyProcessed = await arcClient.readContract({
          address: ADDRESSES.receiver,
          abi: CCTP_RECEIVER_ABI,
          functionName: "processedMessages",
          args: [messageHash],
        });
      } catch {
        // Fall through to the receiver call.
      }

      if (alreadyProcessed) {
        setBridgeDeposit({ status: "done", error: "" });
        await queryClient.invalidateQueries();
        toast.success("This cross-chain deposit was already credited.");
        return;
      }

      // If the nonce was already used but the receiver has not processed this
      // message, a relayer delivered it (legacy destinationCaller = 0). Only the
      // owner can run processDeliveredMessage from here.
      try {
        const nonce = getCctpMessageNonce(message);
        const delivered = await arcClient.readContract({
          address: MESSAGE_TRANSMITTER_V2,
          abi: MESSAGE_TRANSMITTER_V2_ABI,
          functionName: "usedNonces",
          args: [nonce],
        });
        if (delivered > 0n && !alreadyProcessed) {
          setBridgeDeposit({
            status: "ready",
            error:
              "The message was already delivered to the receiver but not credited. Ask the owner to run processDeliveredMessage, or use the receiver rescue path.",
          });
          return;
        }
      } catch {
        // Let the receiver transaction surface the real error.
      }

      const hash = await writeContractAsync({
        address: ADDRESSES.receiver,
        abi: CCTP_RECEIVER_ABI,
        functionName: "receiveAndProcess",
        args: [message as `0x${string}`, attestation as `0x${string}`],
        chainId: ARC_CHAIN_ID,
      });
      setBridgeDeposit({ mintHash: hash });

      const receipt = await arcClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success")
        throw new Error("Arc receiver processing reverted");

      setBridgeDeposit({ status: "done", error: "" });
      await queryClient.invalidateQueries();
      void refetchArcGas();
      toast.success("Cross-chain deposit credited to your treasury");
    } catch (e) {
      const messageText = parseOnchainError(e);
      setBridgeDeposit({ status: "ready", error: messageText });
      if (messageText !== "Transaction cancelled.") toast.error(messageText);
    }
  }

  /**
   * Legacy route: the burn minted to the wallet and set destinationCaller = 0.
   * Mint to the wallet, approve the treasury, then deposit. This path records
   * the Arc domain as the source, which is why new burns use the receiver.
   */
  async function completeLegacyDeposit(amountToDeposit: bigint) {
    if (!address || !arcClient || !message || !attestation) return;

    setBridgeDeposit({
      status: "minting",
      error: "",
      mintHash: "",
      arcApproveHash: "",
      depositHash: "",
    });
    try {
      if (chainId !== ARC_CHAIN_ID) {
        await switchChainAsync({ chainId: ARC_CHAIN_ID });
      }

      const gasBalance = await arcClient.getBalance({ address });
      if (gasBalance < ARC_GAS_RESERVE) {
        setBridgeDeposit({
          status: "ready",
          error: `Keep at least 0.1 ${ARC_GAS_SYMBOL} on Arc for the mint, approval, and deposit gas. The bridge amount is deposited in full, so it cannot cover those fees.`,
        });
        return;
      }

      // A message can only be delivered once. If another wallet already
      // delivered it, the USDC is already in this wallet; skip to the deposit.
      let alreadyDelivered = false;
      try {
        const nonce = getCctpMessageNonce(message);
        const used = await arcClient.readContract({
          address: MESSAGE_TRANSMITTER_V2,
          abi: MESSAGE_TRANSMITTER_V2_ABI,
          functionName: "usedNonces",
          args: [nonce],
        });
        alreadyDelivered = used > 0n;
      } catch {
        // Fall through to the mint; the wallet will surface a real revert.
      }

      if (!alreadyDelivered) {
        const hash = await writeContractAsync({
          address: MESSAGE_TRANSMITTER_V2,
          abi: MESSAGE_TRANSMITTER_V2_ABI,
          functionName: "receiveMessage",
          args: [message as `0x${string}`, attestation as `0x${string}`],
          chainId: ARC_CHAIN_ID,
        });
        setBridgeDeposit({ mintHash: hash });

        const receipt = await arcClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success")
          throw new Error("Arc CCTP mint reverted");
      }

      // The CCTP mint delivers to this wallet. Confirm the funds are there
      // before pulling them into the treasury.
      const walletUsdc = await arcClient.readContract({
        address: ADDRESSES.usdc,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address],
      });
      if (walletUsdc < amountToDeposit) {
        if (alreadyDelivered) {
          setBridgeDeposit({ status: "done", error: "" });
          await queryClient.invalidateQueries();
          toast.success("This cross-chain deposit was already delivered.");
          return;
        }
        throw new Error(
          `The Arc mint confirmed, but the wallet holds ${formatUsdcDollar(
            walletUsdc
          )} USDC instead of ${formatUsdcDollar(
            amountToDeposit
          )}. Check the wallet before retrying.`
        );
      }

      const allowance = await arcClient.readContract({
        address: ADDRESSES.usdc,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, ADDRESSES.treasury],
      });
      if (allowance < amountToDeposit) {
        setBridgeDeposit({ status: "arc-approving", error: "" });
        const approveTx = await writeContractAsync({
          address: ADDRESSES.usdc,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [ADDRESSES.treasury, amountToDeposit],
          chainId: ARC_CHAIN_ID,
        });
        setBridgeDeposit({ arcApproveHash: approveTx });

        const approveReceipt = await arcClient.waitForTransactionReceipt({
          hash: approveTx,
        });
        if (approveReceipt.status !== "success")
          throw new Error("Arc approval reverted");
      }

      setBridgeDeposit({ status: "depositing", error: "" });

      // The bridged amount is fixed, so re-check it right before depositing:
      // a zero-share deposit would take the USDC and mint no claim.
      const previewShares = await arcClient.readContract({
        address: ADDRESSES.vault1,
        abi: VAULT_ABI,
        functionName: "previewDeposit",
        args: [amountToDeposit],
      });
      if (previewShares === 0n) {
        throw new Error(
          "This amount would mint 0 vault shares at the current share price. Contact the owner to raise the deposit or the vault minimum."
        );
      }

      const depositTx = await writeContractAsync({
        address: ADDRESSES.treasury,
        abi: TREASURY_ABI,
        functionName: "deposit",
        args: [amountToDeposit],
        chainId: ARC_CHAIN_ID,
      });
      setBridgeDeposit({ depositHash: depositTx });

      const depositReceipt = await arcClient.waitForTransactionReceipt({
        hash: depositTx,
      });
      if (depositReceipt.status !== "success")
        throw new Error("Treasury deposit reverted");

      setBridgeDeposit({ status: "done", error: "" });
      await queryClient.invalidateQueries();
      void refetchArcGas();
      toast.success("Cross-chain deposit credited to your treasury");
    } catch (e) {
      const messageText = parseOnchainError(e);
      setBridgeDeposit({ status: "ready", error: messageText });
      if (messageText !== "Transaction cancelled.") toast.error(messageText);
    }
  }

  function retryAttestation() {
    setBridgeDeposit({ status: "waiting", error: "" });
  }

  function reset() {
    setEnteredAmount("");
    resetBridgeDeposit();
  }

  // function discard() {
  //   setEnteredAmount("");
  //   discardBridgeDeposit();
  //   toast.success("Burn removed from this browser");
  // }

  async function copyBurnHash() {
    if (!burnHash) return;
    try {
      await navigator.clipboard.writeText(burnHash);
      toast.success("Source burn hash copied");
    } catch {
      toast.error(
        "Could not copy. Open the burn transaction and copy it from the explorer."
      );
    }
  }

  const isActivityView = status !== "idle";
  return (
    <details
      open={isActivityView && status !== "done" ? true : undefined}
      className="group rounded-xl border border-slate-700 bg-slate-900/60"
    >
      <summary className="flex cursor-pointer list-none select-none items-center justify-between gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
        <div>
          <h2 className="text-sm font-semibold text-white">
            Cross-Chain Deposit
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Bridge USDC from Ethereum, Base, Arbitrum, OP, Avalanche, or Polygon
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isActive && status !== "done" && (
            <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-300">
              {BRIDGE_STATUS_LABEL[status]}
            </span>
          )}
          <span className="rounded-full bg-[#083D77]/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
            CCTP
          </span>
          <ChevronDown className="h-4 w-4 text-slate-500 transition group-open:rotate-180" />
        </div>
      </summary>

      <div className="border-t border-slate-800 p-5">
        {!isActive && (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs text-slate-500">
                Source chain
              </label>
              <select
                value={sourceDomain}
                onChange={(e) => {
                  setSelectedSourceDomain(Number(e.target.value));
                  setEnteredAmount("");
                }}
                className="w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-500/50"
              >
                {SOURCES.map((option) => (
                  <option key={option.domain} value={option.domain}>
                    {option.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-500">
                Amount (USDC)
              </label>
              <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2">
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={amount}
                  onChange={(e) => {
                    setEnteredAmount(e.target.value);
                  }}
                  placeholder="0.00"
                  className="w-full bg-transparent font-mono text-lg text-white outline-none placeholder:text-slate-600 tabular-nums"
                />
                <button
                  type="button"
                  onClick={() => {
                    setEnteredAmount(formatUsdc(sourceBalance ?? 0n, 6));
                  }}
                  className="shrink-0 rounded-md border border-slate-700 px-2 py-1 text-[11px] font-medium text-slate-400 hover:border-emerald-500/40 hover:text-emerald-400"
                >
                  MAX
                </button>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                <span>
                  <NetworkLabel
                    name={source.name}
                    className="text-slate-400"
                    size={12}
                    iconOnly
                  />{" "}
                  {source.name} balance:{" "}
                  <span className="font-mono text-slate-400">
                    {sourceBalance === undefined
                      ? "—"
                      : formatUsdcDollar(sourceBalance)}
                  </span>
                </span>
                <span>
                  Gas:{" "}
                  <span
                    className={
                      sourceGas?.value === 0n
                        ? "text-amber-300"
                        : "text-slate-400"
                    }
                  >
                    {sourceGas
                      ? `${sourceGas.formatted} ${sourceGas.symbol}`
                      : "—"}
                  </span>
                </span>
              </div>
            </div>

            {sourceBalance === 0n && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-300">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {IS_ARC_MAINNET ? (
                    <>
                      No USDC on{" "}
                      <NetworkLabel
                        name={source.name}
                        className="text-amber-200"
                        size={12}
                        iconOnly
                      />{" "}
                      {source.name}. Send or bridge USDC to this wallet on that
                      chain.
                    </>
                  ) : (
                    <>
                      No USDC on{" "}
                      <NetworkLabel
                        name={source.name}
                        className="text-amber-200"
                        size={12}
                        iconOnly
                      />{" "}
                      {source.name}.{" "}
                      <a
                        href="https://faucet.circle.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 underline"
                      >
                        Get test USDC <ExternalLink className="h-3 w-3" />
                      </a>{" "}
                      (select {source.name}).
                    </>
                  )}
                </span>
              </div>
            )}

            {sourceGas?.value === 0n && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-300">
                <Fuel className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  You need {source.chain.nativeCurrency.symbol} on{" "}
                  <NetworkLabel
                    name={source.name}
                    className="text-amber-200"
                    size={12}
                    iconOnly
                  />{" "}
                  {source.name} for the approve and burn gas.{" "}
                  {source.faucet && (
                    <a
                      href={source.faucet}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 underline"
                    >
                      Open faucet <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
              <span>1. Approve</span>
              <ArrowRight className="h-3 w-3" />
              <span>
                2. Burn on{" "}
                <NetworkLabel
                  name={source.name}
                  size={12}
                  className="text-slate-300"
                />
              </span>
              <ArrowRight className="h-3 w-3" />
              <span>3. Circle attestation</span>
              <ArrowRight className="h-3 w-3" />
              <span>4. Credit &amp; deploy on Arc</span>
            </div>

            <button
              type="button"
              onClick={() => {
                void handleBridge();
              }}
              disabled={!!validation || busy}
              className="glimmer-primary-cta w-full"
            >
              {busy
                ? "Processing…"
                : chainId !== source.chain.id
                ? `Bridge to Arc`
                : needsApprove
                ? "Approve"
                : "Bridge to Arc"}
            </button>

            {validation && parsedAmount > 0n && (
              <p className="text-center text-xs text-red-400">{validation}</p>
            )}

            <p className="text-[11px] leading-relaxed text-slate-500">
              Standard CCTP, no protocol fee. The source-chain attestation can
              take 15–30 minutes. Once attested, one Arc transaction goes to the
              CCTPReceiverV2, which mints the USDC, credits your agent with the
              real source chain, and deploys it into the Morpho vault. You need
              a little Arc {ARC_GAS_SYMBOL} for that one transaction.
            </p>

            <details className="rounded-lg border border-slate-800 bg-slate-900/40">
              <summary className="cursor-pointer px-3 py-2.5 text-xs font-medium text-slate-400 hover:text-slate-200">
                Already burned? Track a source transaction
              </summary>
              <div className="space-y-2 border-t border-slate-800 p-3">
                <p className="text-[11px] leading-relaxed text-slate-500">
                  Paste the CCTP burn transaction from {source.name} to resume
                  after a reload. The app checks that the burn targets Arc and
                  credits the connected wallet's agent (receiver burns) or the
                  wallet itself (legacy burns).
                </p>
                <div className="flex gap-2">
                  <input
                    value={resumeTx}
                    onChange={(e) => setResumeTx(e.target.value)}
                    placeholder="0x source burn hash"
                    className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 font-mono text-xs text-white outline-none placeholder:text-slate-600 focus:border-emerald-500/50"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void handleResume();
                    }}
                    disabled={resuming || !resumeTx.trim()}
                    className="shrink-0 rounded-lg border border-emerald-500/40 px-3 py-2 text-xs font-medium text-emerald-400 transition hover:bg-[#083D77]/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {resuming ? "Checking…" : "Track"}
                  </button>
                </div>

                {myRecent.length > 0 && (
                  <div className="space-y-1.5 border-t border-slate-800 pt-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] uppercase tracking-wide text-slate-600">
                        Recent source burns
                      </p>
                      <div className="flex items-center gap-2">
                        <p className="text-[10px] text-slate-600">
                          Saved in this browser
                        </p>
                        <button
                          type="button"
                          onClick={clearBridgeHistory}
                          className="text-[10px] text-slate-500 underline hover:text-slate-300"
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                    {myRecent.slice(0, 5).map((record) => {
                      const recordSource = getCctpDestination(
                        record.sourceDomain
                      );
                      const recordAmount = rawAmount(record.amount);
                      return (
                        <button
                          key={record.burnHash}
                          type="button"
                          onClick={() => restoreBridgeDeposit(record)}
                          className="w-full rounded-lg border border-slate-800 bg-slate-800/40 px-3 py-2 text-left transition hover:border-emerald-500/30"
                        >
                          <span className="block text-xs text-slate-300">
                            {recordAmount > 0n
                              ? formatUsdcDollar(recordAmount)
                              : "USDC"}{" "}
                            ·{" "}
                            {recordSource?.name ??
                              `Domain ${record.sourceDomain}`}
                          </span>
                          <span
                            className="mt-0.5 block truncate font-mono text-[10px] text-slate-500"
                            title={record.burnHash}
                          >
                            {record.burnHash}
                          </span>
                          <span className="mt-0.5 block text-[10px] text-slate-600">
                            {new Date(record.createdAt).toLocaleString()}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </details>
          </div>
        )}

        {isActive && !ownerMatches && (
          <div className="space-y-3">
            <p className="flex items-start gap-2 text-xs text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              This deposit was started by{" "}
              {owner ? shortAddr(owner) : "another wallet"}. Switch back to that
              wallet to finish it, or reset this form.
            </p>
            <button
              type="button"
              onClick={reset}
              className="w-full rounded-xl border border-slate-700 py-2.5 text-xs font-medium text-slate-300 transition hover:border-emerald-500/40 hover:text-emerald-400"
            >
              Reset
            </button>
          </div>
        )}

        {isActive && ownerMatches && (
          <div className="space-y-3" aria-live="polite">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-[11px]">
              <span className="text-slate-400">
                {activeAmountLabel} from {activeSource.name}
              </span>
              {burnHash && (
                <div className="flex items-center gap-2">
                  <a
                    href={`${activeSource.explorer}/tx/${burnHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-300"
                  >
                    Burn tx <ExternalLink className="h-3 w-3" />
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      void copyBurnHash();
                    }}
                    className="text-slate-500 underline hover:text-slate-300"
                  >
                    Copy hash
                  </button>
                </div>
              )}
            </div>

            {status === "approving" && (
              <div className="flex items-start gap-3 text-sm text-slate-300">
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-emerald-400" />
                <div>
                  <p className="font-medium text-white">
                    Approve USDC on {activeSource.name}…
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Confirm the approval in your wallet. The burn comes next.
                  </p>
                  {approveHash && (
                    <a
                      href={`${activeSource.explorer}/tx/${approveHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-400 underline"
                    >
                      View approval <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            )}

            {status === "burning" && (
              <div className="flex items-start gap-3 text-sm text-slate-300">
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-emerald-400" />
                <div>
                  <p className="font-medium text-white">
                    Burn USDC on {activeSource.name}…
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Approve the CCTP burn in your wallet. The app will wait for
                    Circle's attestation.
                  </p>
                  {burnHash && (
                    <a
                      href={`${activeSource.explorer}/tx/${burnHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-400 underline"
                    >
                      View burn <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            )}

            {status === "waiting" && (
              <div className="flex items-start gap-3 text-sm text-slate-300">
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-emerald-400" />
                <div>
                  <p className="font-medium text-white">
                    Waiting for Circle attestation…
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Standard CCTP from {activeSource.name} can take 15–30
                    minutes. The source burn is confirmed; there is no Arc
                    transaction yet. You can switch tabs and come back. This
                    burn is saved in your browser, so a reload restores the
                    pending deposit automatically.
                  </p>
                  {/* <button
                    type="button"
                    onClick={discard}
                    className="mt-3 rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] font-medium text-slate-300 transition hover:border-red-500/40 hover:text-red-300"
                  >
                    Discard this burn
                  </button> */}
                </div>
              </div>
            )}

            {status === "ready" && (
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  <div>
                    <p className="text-sm font-medium text-white">
                      Attestation ready — {activeAmountLabel}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      Credit on Arc. The receiver mints the USDC, credits your
                      agent with the real source chain, and deploys it into the
                      vault in one transaction.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-2 rounded-lg border border-slate-700 bg-slate-800/50 p-3 text-xs text-slate-400">
                  <Fuel className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                  <div className="min-w-0 flex-1">
                    <p>
                      The connected wallet pays Arc {ARC_GAS_SYMBOL} gas for one
                      receiver transaction. No Arc approval or separate treasury
                      deposit is needed. The real source chain (
                      {activeSource.name}) is recorded in your deposit history.
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                      {!IS_ARC_MAINNET && (
                        <a
                          href="https://faucet.circle.com"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-emerald-400 underline hover:text-emerald-300"
                        >
                          Get Arc test USDC
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => void refetchArcGas()}
                        className="inline-flex items-center gap-1 text-slate-400 hover:text-slate-200"
                      >
                        <RefreshCw className="h-3 w-3" /> Check gas
                      </button>
                    </div>
                    {activeGas && (
                      <p
                        className={
                          needsArcGas
                            ? "mt-1 text-amber-300"
                            : "mt-1 text-slate-500"
                        }
                      >
                        Arc gas: {activeGas.formatted} {ARC_GAS_SYMBOL}
                        {needsArcGas ? " — fund Arc gas before minting." : ""}
                      </p>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    void handleCompleteDeposit();
                  }}
                  className="glimmer-primary-cta w-full"
                >
                  Credit on Arc
                </button>

                {/* <button
                  type="button"
                  onClick={discard}
                  className="w-full rounded-xl border border-slate-700 py-2.5 text-xs font-medium text-slate-300 transition hover:border-red-500/40 hover:text-red-300"
                >
                  Discard this burn and start over
                </button> */}

                {error && (
                  <p className="flex items-start gap-2 text-xs text-red-300">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {error}
                  </p>
                )}
              </div>
            )}

            {status === "minting" && (
              <div className="flex items-start gap-3 text-sm text-slate-300">
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-emerald-400" />
                <div>
                  <p className="font-medium text-white">Processing on Arc…</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Approve the network switch and the Arc receiver transaction.
                    It mints the USDC, credits your agent with the real source
                    chain, and deploys it into the vault.
                  </p>
                  {mintHash && (
                    <a
                      href={`${ARC_EXPLORER}/tx/${mintHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-400 underline"
                    >
                      View transaction <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            )}

            {status === "arc-approving" && (
              <div className="flex items-start gap-3 text-sm text-slate-300">
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-emerald-400" />
                <div>
                  <p className="font-medium text-white">
                    Approve USDC for the treasury…
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Confirm the Arc approval. The final step is the treasury
                    deposit.
                  </p>
                  {arcApproveHash && (
                    <a
                      href={`${ARC_EXPLORER}/tx/${arcApproveHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-400 underline"
                    >
                      View approval <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            )}

            {status === "depositing" && (
              <div className="flex items-start gap-3 text-sm text-slate-300">
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-emerald-400" />
                <div>
                  <p className="font-medium text-white">
                    Deposit into the treasury…
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Confirm the Arc deposit. The treasury credits your agent and
                    deploys the USDC into the Morpho vault.
                  </p>
                  {depositHash && (
                    <a
                      href={`${ARC_EXPLORER}/tx/${depositHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-400 underline"
                    >
                      View deposit <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            )}

            {status === "done" && (
              <div className="flex items-start gap-3 text-sm text-emerald-300">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">Cross-chain deposit credited</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {mintHash || depositHash
                      ? "The USDC was minted, credited to your agent with the real source chain, and deployed in the Morpho vault."
                      : "This CCTP transfer was already delivered. No further action is needed."}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    {mintHash && (
                      <a
                        href={`${ARC_EXPLORER}/tx/${mintHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-emerald-400 underline hover:text-emerald-300"
                      >
                        View Arc transaction{" "}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    {depositHash && (
                      <a
                        href={`${ARC_EXPLORER}/tx/${depositHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-emerald-400 underline hover:text-emerald-300"
                      >
                        View treasury deposit{" "}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={reset}
                    className="mt-2 block rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] font-medium text-slate-300 transition hover:border-emerald-500/40 hover:text-emerald-400"
                  >
                    Start another deposit
                  </button>
                </div>
              </div>
            )}

            {status === "error" && (
              <div className="space-y-3">
                <p className="flex items-start gap-2 text-sm text-red-300">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {error || "The cross-chain deposit could not be completed."}
                </p>
                <div className="flex gap-2">
                  {burnHash && (
                    <button
                      type="button"
                      onClick={retryAttestation}
                      className="flex-1 rounded-xl border border-slate-700 py-2.5 text-xs font-medium text-slate-300 transition hover:border-emerald-500/40 hover:text-emerald-400"
                    >
                      Retry attestation
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={reset}
                    className="flex-1 rounded-xl border border-slate-700 py-2.5 text-xs font-medium text-slate-300 transition hover:border-emerald-500/40 hover:text-emerald-400"
                  >
                    Reset
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
