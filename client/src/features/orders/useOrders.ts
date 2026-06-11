/* ============================================================
   useOrders — live Catalyst orders for any screen.

   Cache-first: paints the last ordersApi snapshot instantly, then
   revalidates (listOrders is TTL-cached + deduped, so many screens
   mounting together cost one fetch). Subscribes to cache changes so
   saves/sagas elsewhere update this screen without a manual reload.
   Replaces the static mock ORDERS import during the mock→live
   migration.
   ============================================================ */
import { useEffect, useState } from "react";
import type { Order } from "@/data";
import { cachedOrders, listOrders, subscribeOrders } from "./ordersApi";

export interface UseOrders {
  orders: Order[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useOrders(): UseOrders {
  const [orders, setOrders] = useState<Order[]>(() => cachedOrders() ?? []);
  const [loading, setLoading] = useState(() => cachedOrders() == null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Only adopt non-null snapshots — invalidate() notifies with an empty
    // cache and we don't want a flash of zero rows mid-refetch.
    const unsub = subscribeOrders(() => {
      const c = cachedOrders();
      if (c) setOrders(c);
    });
    void listOrders().then((res) => {
      setLoading(false);
      if (!res.ok) {
        setError(res.error || "Failed to load orders");
        return;
      }
      setError(null);
      setOrders(res.orders);
    });
    return unsub;
  }, []);

  const reload = () => {
    setLoading(true);
    void listOrders().then((res) => {
      setLoading(false);
      if (!res.ok) setError(res.error || "Failed to load orders");
      else {
        setError(null);
        setOrders(res.orders);
      }
    });
  };

  return { orders, loading, error, reload };
}
