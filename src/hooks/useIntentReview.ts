import { useCallback, useEffect, useRef, useState } from "react";
import {
  getHermesIntent,
  isHermesApiError,
  type HermesIntent,
  type IntentKind,
} from "../lib/hermes";
import { useUiStore } from "../stores/ui";

function reviewError(error: unknown): string {
  if (isHermesApiError(error)) {
    if (error.status === 401) {
      return "Sign in with your wallet in chat, then reopen this draft.";
    }
    if (error.status === 404) {
      return "This draft expired or was not found. Prepare a new one.";
    }
    return error.message;
  }
  return "Could not load the draft from Hermes.";
}

function removeIntentFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("intent");
  window.history.replaceState({}, "", url);
}

interface LoadedIntent {
  id: string;
  intent: HermesIntent | null;
  error: string | null;
}

/**
 * Load the intent named by the `?intent=` deep link. The BFF binds every read
 * to the SIWE wallet, so this cannot expose another user's draft.
 *
 * `onLoaded` runs inside the fetch callback (not synchronously in an effect),
 * which lets the review form prefill without cascading renders.
 */
export function useIntentReview(
  expected?: IntentKind,
  onLoaded?: (intent: HermesIntent) => void
) {
  const reviewIntentId = useUiStore((state) => state.reviewIntentId);
  const setReviewIntent = useUiStore((state) => state.setReviewIntent);
  const [loaded, setLoaded] = useState<LoadedIntent | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const onLoadedRef = useRef(onLoaded);

  useEffect(() => {
    onLoadedRef.current = onLoaded;
  }, [onLoaded]);

  useEffect(() => {
    if (!reviewIntentId) return;

    let cancelled = false;
    getHermesIntent(reviewIntentId)
      .then((intent) => {
        if (cancelled) return;
        setLoaded({ id: reviewIntentId, intent, error: null });
        if (!expected || intent.kind === expected)
          onLoadedRef.current?.(intent);
      })
      .catch((cause) => {
        if (cancelled) return;
        setLoaded({
          id: reviewIntentId,
          intent: null,
          error: reviewError(cause),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [expected, reloadToken, reviewIntentId]);

  const dismiss = useCallback(() => {
    setReviewIntent(null);
    removeIntentFromUrl();
  }, [setReviewIntent]);

  const retry = useCallback(() => {
    setLoaded(null);
    setReloadToken((value) => value + 1);
  }, []);

  const current = loaded?.id === reviewIntentId ? loaded : null;
  const intent =
    current?.intent && (!expected || current.intent.kind === expected)
      ? current.intent
      : null;
  const loading = Boolean(reviewIntentId) && !current;
  const error = current?.error ?? null;

  return { intent, loading, error, dismiss, retry };
}
