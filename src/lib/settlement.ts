import { calcTotal, Card, userCapitalize } from "./helpers";

export type Profile = "quez" | "stevie";

export type OwesDirection = "they_owe" | "you_owe" | "even";

export type SettlementBreakdown = {
  currentUserExpensesPaid: number;
  otherUserExpensesPaid: number;
  currentUserProfitCollected: number;
  otherUserProfitCollected: number;
  currentUserNet: number;
  otherUserNet: number;
  currentUserBalance: number;
  otherUserBalance: number;
  currentUserTransferAdjustment: number;
  otherUserTransferAdjustment: number;
  currentUserTransfersGiven: number;
  currentUserTransfersReceived: number;
  totalExpenses: number;
  totalProfits: number;
  totalNetSpent: number;
  fairShareEach: number;
  owesAmount: number;
  owesDirection: OwesDirection;
  activeCount: number;
};

export function getOtherUser(currentUser: Profile): Profile {
  return currentUser === "quez" ? "stevie" : "quez";
}

function getProfitAmount(card: Card, total: number): number {
  return card.sale_price || total;
}

export function calcSettlementBreakdown(cards: Card[], currentUser: Profile): SettlementBreakdown {
  const otherUser = getOtherUser(currentUser);
  const currentUserCapitalized = userCapitalize(currentUser);
  const otherUserCapitalized = userCapitalize(otherUser);

  let currentUserExpensesPaid = 0;
  let otherUserExpensesPaid = 0;
  let currentUserProfitCollected = 0;
  let otherUserProfitCollected = 0;
  let currentUserTransferAdjustment = 0;
  let otherUserTransferAdjustment = 0;
  let currentUserTransfersGiven = 0;
  let currentUserTransfersReceived = 0;
  let totalExpenses = 0;
  let totalProfits = 0;

  for (const c of cards) {
    const total = calcTotal(c);
    const isTransfer = c.type === "transfer";
    const isProfit = c.type === "profit" || Boolean(c.sale_price);

    if (isTransfer) {
      if (c.transfer_from === currentUserCapitalized) {
        currentUserTransferAdjustment += total;
        otherUserTransferAdjustment -= total;
        currentUserTransfersGiven += total;
      } else if (c.transfer_to === currentUserCapitalized) {
        currentUserTransferAdjustment -= total;
        otherUserTransferAdjustment += total;
        currentUserTransfersReceived += total;
      }
    } else if (isProfit) {
      const profit = getProfitAmount(c, total);
      if (c.paid_by === "Both") {
        currentUserProfitCollected += profit / 2;
        otherUserProfitCollected += profit / 2;
      } else if (c.paid_by === currentUserCapitalized) {
        currentUserProfitCollected += profit;
      } else {
        otherUserProfitCollected += profit;
      }
      totalProfits += profit;
    } else {
      if (c.paid_by === currentUserCapitalized) {
        currentUserExpensesPaid += total;
      } else if (c.paid_by === otherUserCapitalized) {
        otherUserExpensesPaid += total;
      } else {
        const currentUserShare = total * (c.split_percent / 100);
        const otherUserShare = total * ((100 - c.split_percent) / 100);
        currentUserExpensesPaid += currentUserShare;
        otherUserExpensesPaid += otherUserShare;
      }
      totalExpenses += total;
    }
  }

  const currentUserNet = currentUserExpensesPaid - currentUserProfitCollected;
  const otherUserNet = otherUserExpensesPaid - otherUserProfitCollected;
  const totalNetSpent = currentUserNet + otherUserNet;
  const fairShareEach = totalNetSpent / 2;

  // Positive balance means this person overpaid and is owed money.
  // A transfer is money already paid toward a debt: giving money increases
  // the sender's balance; receiving money reduces the receiver's balance.
  const currentUserBalance = currentUserNet - fairShareEach + currentUserTransferAdjustment;
  const otherUserBalance = otherUserNet - fairShareEach + otherUserTransferAdjustment;

  let owesAmount = 0;
  let owesDirection: OwesDirection = "even";

  if (currentUserBalance > 0 && otherUserBalance < 0) {
    owesAmount = Math.abs(otherUserBalance);
    owesDirection = "they_owe";
  } else if (otherUserBalance > 0 && currentUserBalance < 0) {
    owesAmount = Math.abs(currentUserBalance);
    owesDirection = "you_owe";
  }

  return {
    currentUserExpensesPaid,
    otherUserExpensesPaid,
    currentUserProfitCollected,
    otherUserProfitCollected,
    currentUserNet,
    otherUserNet,
    currentUserBalance,
    otherUserBalance,
    currentUserTransferAdjustment,
    otherUserTransferAdjustment,
    currentUserTransfersGiven,
    currentUserTransfersReceived,
    totalExpenses,
    totalProfits,
    totalNetSpent,
    fairShareEach,
    owesAmount,
    owesDirection,
    activeCount: cards.length,
  };
}
