import { jsPDF } from "jspdf";

export interface ReceiptData {
  invoiceId: string;
  minutes: number;
  amountUsd: number;
  amountUsdt: number;
  walletAddress: string;
  txHash?: string | null;
  network?: string;
  createdAt: string;
  paidAt?: string | null;
  username?: string;
  email?: string;
  status?: "pending" | "paid" | "expired";
  type?: "payment" | "credit";
  note?: string | null;
}

function fmt(date: string | null | undefined): string {
  if (!date) return "—";
  return new Date(date).toLocaleString("en-US", {
    year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });
}

function fmtShort(date: string | null | undefined): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });
}

export function generateReceiptPdf(data: ReceiptData): void {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const W = 210;
  const margin = 18;
  const contentW = W - margin * 2;

  // ── Colour palette ──────────────────────────────────────────────────────────
  const teal: [number, number, number]  = [0, 210, 211];    // primary brand
  const dark: [number, number, number]  = [15, 23, 42];     // near-black
  const mid:  [number, number, number]  = [100, 116, 139];  // gray-500
  const lite: [number, number, number]  = [241, 245, 249];  // gray-100
  const white: [number, number, number] = [255, 255, 255];
  const green: [number, number, number] = [34, 197, 94];

  // ── Header bar ──────────────────────────────────────────────────────────────
  doc.setFillColor(...teal);
  doc.rect(0, 0, W, 28, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...white);
  doc.text("FULL SWAP BY RICH", margin, 13);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.text("LIVE STREAMING STUDIO", margin, 19);

  const isCredit = data.type === "credit";

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...white);
  doc.text(isCredit ? "ACCOUNT CREDIT RECEIPT" : "PAYMENT RECEIPT", W - margin, 11, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(200, 248, 248);
  doc.text(`Invoice #${data.invoiceId.slice(0, 8).toUpperCase()}`, W - margin, 17, { align: "right" });
  doc.text(`Issued: ${fmtShort(data.createdAt)}`, W - margin, 22, { align: "right" });

  // ── Status badge ────────────────────────────────────────────────────────────
  let y = 38;
  const isPaid = !data.status || data.status === "paid";
  const badgeX = W - margin - (isCredit ? 34 : 28);
  const badgeColor: [number, number, number] = isCredit ? [20, 184, 166] : (isPaid ? green : [234, 179, 8]);
  doc.setFillColor(...badgeColor);
  doc.roundedRect(badgeX, y - 5, isCredit ? 34 : 28, 7, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(...white);
  doc.text(isCredit ? "✓ CREDITED" : (isPaid ? "✓ PAID" : "⧗ PENDING"), badgeX + (isCredit ? 17 : 14), y - 0.5, { align: "center" });

  // Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...dark);
  doc.text(isCredit ? "Account Credit Receipt" : "Payment Receipt", margin, y);

  y += 7;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...mid);
  if (isCredit) {
    doc.text(`This receipt confirms that your account has been credited with session time by the FULL SWAP BY RICH team.`, margin, y);
  } else {
    doc.text(`Thank you for your payment. This receipt confirms your FULL SWAP BY RICH session time purchase.`, margin, y);
  }

  // ── Divider ─────────────────────────────────────────────────────────────────
  y += 7;
  doc.setDrawColor(...teal);
  doc.setLineWidth(0.5);
  doc.line(margin, y, W - margin, y);

  // ── Customer / Invoice meta ──────────────────────────────────────────────────
  y += 8;
  const col2X = margin + contentW / 2 + 4;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...mid);
  doc.text("BILLED TO", margin, y);
  doc.text("INVOICE DETAILS", col2X, y);

  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...dark);

  if (data.username) doc.text(data.username, margin, y);
  if (data.email) { doc.text(data.email, margin, data.username ? y + 5 : y); }
  if (!data.username && !data.email) doc.text("—", margin, y);

  doc.text(`Invoice ID:`, col2X, y);
  doc.setFont("helvetica", "bold");
  doc.text(`${data.invoiceId.slice(0, 16)}...`, col2X + 24, y);

  doc.setFont("helvetica", "normal");
  doc.text(`Date Issued:`, col2X, y + 5);
  doc.setFont("helvetica", "bold");
  doc.text(fmtShort(data.createdAt), col2X + 24, y + 5);

  doc.setFont("helvetica", "normal");
  doc.text(`Date Paid:`, col2X, y + 10);
  doc.setFont("helvetica", "bold");
  doc.text(fmtShort(data.paidAt), col2X + 24, y + 10);

  // ── Items table ──────────────────────────────────────────────────────────────
  y += 22;

  // Table header
  doc.setFillColor(...dark);
  doc.rect(margin, y, contentW, 8, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...white);
  doc.text("DESCRIPTION", margin + 3, y + 5.5);
  doc.text("DURATION", margin + contentW * 0.52, y + 5.5);
  doc.text("USD", margin + contentW * 0.68, y + 5.5);
  doc.text("USDT", margin + contentW * 0.82, y + 5.5);

  y += 8;

  // Table row
  doc.setFillColor(...lite);
  doc.rect(margin, y, contentW, 10, "F");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...dark);
  doc.text("Real Time Video Transformation — Session Time", margin + 3, y + 6.5);
  doc.text(`${data.minutes} min`, margin + contentW * 0.52, y + 6.5);
  doc.setFont("helvetica", "bold");
  doc.text(`$${data.amountUsd.toFixed(2)}`, margin + contentW * 0.68, y + 6.5);
  doc.text(`${data.amountUsdt.toFixed(6)}`, margin + contentW * 0.82, y + 6.5);

  y += 10;
  doc.setDrawColor(...lite);
  doc.setLineWidth(0.2);
  doc.line(margin, y, W - margin, y);

  // Totals
  y += 6;
  const totX = margin + contentW * 0.6;
  const totValX = W - margin;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...mid);
  doc.text("Subtotal", totX, y);
  doc.setTextColor(...dark);
  doc.text(`$${data.amountUsd.toFixed(2)}`, totValX, y, { align: "right" });

  y += 5;
  doc.setTextColor(...mid);
  doc.text("Tax / Fees", totX, y);
  doc.setTextColor(...dark);
  doc.text("$0.00", totValX, y, { align: "right" });

  y += 2;
  doc.setDrawColor(...mid);
  doc.setLineWidth(0.3);
  doc.line(totX, y, W - margin, y);

  y += 5;
  doc.setFillColor(...teal);
  doc.roundedRect(totX - 2, y - 4, W - margin - totX + 4, 9, 1.5, 1.5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...white);
  doc.text("TOTAL PAID", totX, y + 1.5);
  doc.text(`$${data.amountUsd.toFixed(2)} USD`, totValX, y + 1.5, { align: "right" });

  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...mid);
  doc.text(`= ${data.amountUsdt.toFixed(6)} USDT (at rate when invoice was created)`, totValX, y + 3, { align: "right" });

  // ── Transaction / Credit details ────────────────────────────────────────────
  y += 14;
  const labelX = margin + 4;
  const valX = margin + 42;

  if (isCredit) {
    doc.setFillColor(224, 253, 252);
    doc.roundedRect(margin, y, contentW, data.note ? 30 : 20, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(13, 148, 136);
    doc.text("ADMIN CREDIT DETAILS", margin + 4, y + 7);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...dark);
    doc.text("Credited By:", labelX, y + 15);
    doc.setFont("helvetica", "normal");
    doc.text("FULL SWAP BY RICH Administration", valX, y + 15);

    if (data.note) {
      doc.setFont("helvetica", "bold");
      doc.text("Note:", labelX, y + 22);
      doc.setFont("helvetica", "normal");
      const noteLines = doc.splitTextToSize(data.note, contentW - 46);
      doc.text(noteLines, valX, y + 22);
    }

    y += data.note ? 38 : 28;
  } else {
    doc.setFillColor(...lite);
    doc.roundedRect(margin, y, contentW, data.txHash ? 36 : 26, 2, 2, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...mid);
    doc.text("TRANSACTION DETAILS", margin + 4, y + 7);

    const detailY = y + 14;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...dark);

    doc.setFont("helvetica", "bold");
    doc.text("Network:", labelX, detailY);
    doc.setFont("helvetica", "normal");
    doc.text(data.network ?? "ERC-20 (Ethereum)", valX, detailY);

    doc.setFont("helvetica", "bold");
    doc.text("Wallet:", labelX, detailY + 7);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text(data.walletAddress, valX, detailY + 7);

    if (data.txHash) {
      doc.setFontSize(8.5);
      doc.setFont("helvetica", "bold");
      doc.text("TX Hash:", labelX, detailY + 14);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      const txLines = doc.splitTextToSize(data.txHash, contentW - 46);
      doc.text(txLines, valX, detailY + 14);
    }

    y += data.txHash ? 44 : 34;
  }

  // ── Paid / credited timestamp footer strip ───────────────────────────────────
  if (isCredit) {
    doc.setFillColor(224, 253, 252);
    doc.roundedRect(margin, y, contentW, 10, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(13, 148, 136);
    doc.text("✓ Credit applied on", margin + 4, y + 6.5);
    doc.setFont("helvetica", "normal");
    doc.text(fmt(data.paidAt), margin + 44, y + 6.5);
  } else {
    doc.setFillColor(220, 252, 231);
    doc.roundedRect(margin, y, contentW, 10, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(21, 128, 61);
    doc.text("✓ Payment confirmed on", margin + 4, y + 6.5);
    doc.setFont("helvetica", "normal");
    doc.text(fmt(data.paidAt), margin + 50, y + 6.5);
  }

  // ── Footer ──────────────────────────────────────────────────────────────────
  const footerY = 280;
  doc.setDrawColor(...lite);
  doc.setLineWidth(0.4);
  doc.line(margin, footerY - 3, W - margin, footerY - 3);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...mid);
  doc.text("FULL SWAP BY RICH · Live Streaming Studio · fullswap.app", margin, footerY + 2);
  doc.text("This is an automatically generated receipt. Please keep it for your records.", margin, footerY + 7);
  doc.text(`Receipt generated: ${fmt(new Date().toISOString())}`, W - margin, footerY + 2, { align: "right" });

  // ── Save ────────────────────────────────────────────────────────────────────
  const filename = `fullswap-receipt-${data.invoiceId.slice(0, 8).toUpperCase()}.pdf`;
  doc.save(filename);
}
