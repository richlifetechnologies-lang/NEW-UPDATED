import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetUserDashboardQueryKey, getListInvoicesQueryKey } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const MIN_RETRY_DELAY = 3_000;
const MAX_RETRY_DELAY = 60_000;

export function usePaymentSSE() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const esRef        = useRef<EventSource | null>(null);
  const retryDelay   = useRef(MIN_RETRY_DELAY);
  const retryTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopped      = useRef(false);

  useEffect(() => {
    const token = localStorage.getItem("fullswap_token");
    if (!token) return;

    stopped.current = false;

    function connect() {
      if (stopped.current) return;

      // Don't connect while the tab is hidden — resume on visibility
      if (document.visibilityState === "hidden") {
        const onVisible = () => {
          document.removeEventListener("visibilitychange", onVisible);
          if (!stopped.current) connect();
        };
        document.addEventListener("visibilitychange", onVisible);
        return;
      }

      const url = `${BASE}/api/users/sse?token=${encodeURIComponent(token)}`;
      const es = new EventSource(url);
      esRef.current = es;

      es.addEventListener("payment_confirmed", (e) => {
        try {
          const data = JSON.parse(e.data) as {
            invoiceId: string;
            minutes: number;
            amountUsdt: number;
            txHash: string;
          };
          // Broadcast to any page listening (e.g. billing page)
          window.dispatchEvent(new CustomEvent("fullswap:payment_confirmed", { detail: data }));
          toast({
            title: "Payment Confirmed!",
            description: `${data.minutes} minutes added to your account ($${data.amountUsdt} USDT)`,
            duration: 8000,
          });
          queryClient.invalidateQueries({ queryKey: getGetUserDashboardQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
        } catch { /* malformed event */ }
      });

      es.addEventListener("ping", () => {
        // reset backoff on successful ping — connection is healthy
        retryDelay.current = MIN_RETRY_DELAY;
      });

      es.addEventListener("open", () => {
        retryDelay.current = MIN_RETRY_DELAY;
      });

      es.onerror = () => {
        es.close();
        esRef.current = null;
        if (stopped.current) return;

        // Exponential backoff with jitter
        const delay = retryDelay.current + Math.random() * 1000;
        retryDelay.current = Math.min(retryDelay.current * 2, MAX_RETRY_DELAY);

        retryTimer.current = setTimeout(() => {
          if (!stopped.current) connect();
        }, delay);
      };
    }

    connect();

    // Reconnect when tab becomes visible again (browser may have throttled it)
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && !esRef.current && !stopped.current) {
        if (retryTimer.current) clearTimeout(retryTimer.current);
        retryDelay.current = MIN_RETRY_DELAY;
        connect();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stopped.current = true;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      esRef.current?.close();
      esRef.current = null;
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);
}
