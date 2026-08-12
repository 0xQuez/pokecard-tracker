export type Card = {
  id: number;
  created_at: string;
  card_name: string;
  card_id?: string;
  purchase_price: number;
  grading_fee: number;
  shipping_to_grader: number;
  shipping_from_grader: number;
  insurance: number;
  other_costs: number;
  notes?: string;
  paid_by: string;
  split_percent: number;
  date_acquired?: string;
  grade_received?: string;
  sale_price?: number;
  date_sold?: string;
  type?: "expense" | "profit" | "transfer";
  settled_at?: string;
  transfer_from?: string;
  transfer_to?: string;
  transfer_amount?: number;
  condition?: string;
  image_url?: string;
  card_grade?: string;
  cert_number?: string;
  purchased_date?: string;
};

export const CARD_CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"] as const;

export const CARD_IMAGE_BUCKET = "card-images";

/** Common grading options, shown as suggestions; users can type any value. */
export const GRADING_OPTIONS = [
  "PSA 6",
  "PSA 7",
  "PSA 8",
  "PSA 9",
  "PSA 10",
];

/** Build the public URL for a stored card image path. */
export function publicCardImageUrl(path: string): string {
  if (!path) return "";
  if (/^https?:\/\//.test(path)) return path;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  return `${url}/storage/v1/object/public/${CARD_IMAGE_BUCKET}/${path}`;
}

export function calcTotal(c: Card): number {
  if (c.type === "transfer") {
    return c.transfer_amount || 0;
  }
  return (
    c.purchase_price +
    c.grading_fee +
    c.shipping_to_grader +
    c.shipping_from_grader +
    c.insurance +
    c.other_costs
  );
}

/**
 * A card purchase that has been recorded as sold (sale_price set) and is NOT a
 * standalone profit entry. Standalone profit entries (type === "profit") are the
 * legacy debt-ledger sales and have no purchase cost basis, so they don't count
 * as "marked sold" for per-card PnL.
 */
export function isCardSold(c: Card): boolean {
  return c.type !== "profit" && c.sale_price != null && c.sale_price > 0;
}

/**
 * Whether this entry is eligible for the "Mark as sold" action: a real goods
 * purchase (positive purchase_price) that hasn't been sold or settled yet.
 */
export function canMarkSold(c: Card): boolean {
  return (
    c.type === "expense" &&
    !c.settled_at &&
    !isCardSold(c) &&
    (c.purchase_price || 0) > 0
  );
}

/** Realized per-card profit = sale price minus total cost basis. 0 when not sold. */
export function calcCardPnl(c: Card): number {
  if (!isCardSold(c)) return 0;
  return (c.sale_price || 0) - calcTotal(c);
}

/** Profit margin percentage (null when not sold or cost basis is zero). */
export function calcCardPnlMargin(c: Card): number | null {
  const cost = calcTotal(c);
  if (!isCardSold(c) || cost <= 0) return null;
  return (calcCardPnl(c) / cost) * 100;
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";

  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function getDayLabel(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";

  return date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

export function userCapitalize(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function getTimeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
