// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const status = vi.fn();
vi.mock("../lib/api", () => ({ api: { status: (id: string) => status(id) } }));

import { FAST_MS, FAST_WINDOW_MS, SLOW_MS, useInvoiceStatus } from "./useInvoiceStatus";

const ID = "INV2-AAAA-BBBB-CCCC-DDDD";
const reply = (s: string) => ({ invoice_id: ID, status: s, paid_at: null });
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => { vi.useFakeTimers(); status.mockReset(); });
afterEach(() => vi.useRealTimers());

describe("useInvoiceStatus", () => {
  it("polls every 4 seconds and flips to PAID, then stops", async () => {
    status.mockResolvedValue(reply("SENT"));
    const { result } = renderHook(() => useInvoiceStatus(ID, "SENT"));
    await advance(FAST_MS * 3 + 100);
    expect(status).toHaveBeenCalledTimes(3);
    status.mockResolvedValue(reply("PAID"));
    await advance(FAST_MS);
    expect(result.current).toBe("PAID");
    const calls = status.mock.calls.length;
    await advance(60_000);
    expect(status.mock.calls.length).toBe(calls); // a final status ends polling
  });

  // Regression: polling used to stop after 5 minutes, so a payment made later was never shown.
  it("is still polling well past five minutes and catches a late payment", async () => {
    status.mockResolvedValue(reply("SENT"));
    const { result } = renderHook(() => useInvoiceStatus(ID, "SENT"));
    await advance(6 * 60_000);
    const before = status.mock.calls.length;
    await advance(SLOW_MS * 2 + 100);
    expect(status.mock.calls.length).toBeGreaterThan(before);
    status.mockResolvedValue(reply("PAID"));
    await advance(SLOW_MS + 100);
    expect(result.current).toBe("PAID");
  });

  it("slows down after the fast window", async () => {
    status.mockResolvedValue(reply("SENT"));
    renderHook(() => useInvoiceStatus(ID, "SENT"));
    await advance(FAST_WINDOW_MS + 100);
    const atSwitch = status.mock.calls.length;
    await advance(60_000);
    expect(status.mock.calls.length - atSwitch).toBeLessThanOrEqual(Math.ceil(60_000 / SLOW_MS) + 1);
  });

  it("re-checks immediately when the window regains focus", async () => {
    status.mockResolvedValue(reply("SENT"));
    const { result } = renderHook(() => useInvoiceStatus(ID, "SENT"));
    await advance(1000); // before the first scheduled poll
    expect(status).not.toHaveBeenCalled();
    status.mockResolvedValue(reply("PAID"));
    act(() => { window.dispatchEvent(new Event("focus")); });
    await advance(10);
    expect(result.current).toBe("PAID");
  });

  it("keeps going through a failed request", async () => {
    status.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(reply("PAID"));
    const { result } = renderHook(() => useInvoiceStatus(ID, "SENT"));
    await advance(FAST_MS * 2 + 100);
    expect(result.current).toBe("PAID");
  });

  it("does not poll after unmount", async () => {
    status.mockResolvedValue(reply("SENT"));
    const { unmount } = renderHook(() => useInvoiceStatus(ID, "SENT"));
    unmount();
    await advance(60_000);
    expect(status).not.toHaveBeenCalled();
  });
});
