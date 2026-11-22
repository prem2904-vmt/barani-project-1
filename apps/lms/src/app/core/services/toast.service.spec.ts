import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastService } from "./toast.service";

describe("ToastService hold / release", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("dismisses after its timeout", () => {
    const s = new ToastService();
    s.show("a", "info", 1000);
    vi.advanceTimersByTime(999);
    expect(s.toasts().length).toBe(1);
    vi.advanceTimersByTime(2);
    expect(s.toasts().length).toBe(0);
  });

  it("a held toast stays however long; release gives a short grace then dismisses", () => {
    const s = new ToastService();
    const id = s.withAction("Merged", { label: "Undo", run: () => undefined });
    s.hold(id);
    vi.advanceTimersByTime(60_000);
    expect(s.toasts().length).toBe(1);
    s.release(id);
    vi.advanceTimersByTime(2900);
    expect(s.toasts().length).toBe(1);
    vi.advanceTimersByTime(200);
    expect(s.toasts().length).toBe(0);
  });

  it("dismiss clears the timer; hold / release on a gone toast do nothing", () => {
    const s = new ToastService();
    const id = s.show("a");
    s.dismiss(id);
    expect(() => { s.hold(id); s.release(id); }).not.toThrow();
    vi.advanceTimersByTime(10_000);
    expect(s.toasts().length).toBe(0);
  });
});
