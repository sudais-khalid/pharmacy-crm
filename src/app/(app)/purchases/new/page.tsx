import { redirect } from "next/navigation";

/** Purchases are now entered as stock entries (typed, photographed or imported), task 4.6. */
export default function NewPurchase() {
  redirect("/stock-entry?new=PURCHASE_BILL");
}
