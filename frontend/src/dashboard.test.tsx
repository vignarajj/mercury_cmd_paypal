// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackendInfo, InvoiceDetail, InvoiceList, InvoiceSummary, ModelState } from "./lib/types";

const summary = (n: number, over: Partial<InvoiceSummary> = {}): InvoiceSummary => ({
  invoice_id: `INV2-AAAA-BBBB-CCCC-${String(n).padStart(4, "0")}`, number: String(n).padStart(4, "0"), status: "SENT",
  client_email: `client${n}@acme.co`, total: `${n}00.00`, currency: "USD", created_at: `2026-11-0${(n % 9) + 1}T10:00:00Z`,
  invoice_url: `https://www.sandbox.paypal.com/invoice/p/#X${n}`, ...over,
});
const list = (items: InvoiceSummary[], over: Partial<InvoiceList> = {}): InvoiceList => ({ items, page: 1, page_size: 10, total_items: items.length, total_pages: 1, ...over });
const detail = (s: InvoiceSummary, over: Partial<InvoiceDetail> = {}): InvoiceDetail => ({
  ...s, items: [{ name: `Work for ${s.client_email}`, quantity: "2", unit_amount: "50.00", amount: "100.00" }], invoice_date: "2026-11-03",
  sent_at: "2026-11-03T09:00:05Z", due_date: "2026-11-18", payment_term: "NET_15", note: null, paid_amount: "0.00", due_amount: s.total, payments: [], ...over,
});
const INFO: BackendInfo = {
  version: "0.1.0",
  paypal: { status: "ok", error: null, host: "https://api-m.sandbox.paypal.com", mode: "sandbox", merchant_email: "merchant@business.example.com" },
  llm: { provider: "ollama", model: "gemma4:e2b-it-qat", status: "ok" },
};

const MODELS: ModelState = {
  provider: "ollama", status: "ok", current: "gemma4:e2b-it-qat", default: "gemma4:e2b-it-qat", base_url: "http://localhost:11434", allow_cloud: false,
  models: [{ name: "gemma4:e2b-it-qat", size_bytes: 4_336_358_185, parameters: "4.6B", cloud: false }, { name: "qwen3:4b", size_bytes: 2_500_000_000, parameters: "4B", cloud: false }],
  unavailable: [{ name: "nomic-embed-text:latest", reason: "embedding" }, { name: "qwen3.5:cloud", reason: "cloud" }],
};
const rows = [summary(3, { status: "PAID" }), summary(2), summary(1)];
vi.mock("./lib/api", async (orig) => ({
  ...(await orig<typeof import("./lib/api")>()),
  api: { invoices: vi.fn(), invoiceDetail: vi.fn(), info: vi.fn(), models: vi.fn(), setModel: vi.fn(), allowCloud: vi.fn() },
}));
import { api, ApiError } from "./lib/api";
import Dashboard from "./components/dashboard/Dashboard";

beforeAll(() => {
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
});
beforeEach(() => {
  localStorage.clear();
  location.hash = "#/dashboard";
  vi.mocked(api.invoices).mockReset().mockResolvedValue(list(rows));
  vi.mocked(api.invoiceDetail).mockReset().mockImplementation(async (id) => detail(rows.find((r) => r.invoice_id === id) ?? rows[0]));
  vi.mocked(api.info).mockReset().mockResolvedValue(INFO);
  vi.mocked(api.models).mockReset().mockResolvedValue(MODELS);
  vi.mocked(api.setModel).mockReset();
  vi.mocked(api.allowCloud).mockReset();
});
afterEach(cleanup);

async function audit(label: string) {
  const r = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } }, runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] });
  expect(r.violations.map((v) => `${v.id}: ${v.help} -> ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), `${label}: accessibility violations`).toEqual([]);
}

describe("Invoices", () => {
  it("lists invoices from PayPal and opens the newest one", async () => {
    render(<Dashboard />);
    const list = await screen.findByRole("list", { name: "Invoice list" });
    expect(within(list).getAllByRole("button")).toHaveLength(3);
    const panel = await screen.findByRole("article", { name: "Invoice 0003" });
    expect(within(panel).getByText("Work for client3@acme.co")).toBeTruthy();
    expect(within(panel).getByText("Net 15")).toBeTruthy();
    expect(screen.getByText("1–3 of 3")).toBeTruthy();
  });

  it("shows the invoice you click", async () => {
    render(<Dashboard />);
    fireEvent.click(await screen.findByRole("button", { name: /client1@acme\.co/ }));
    expect(await screen.findByRole("article", { name: "Invoice 0001" })).toBeTruthy();
    expect(api.invoiceDetail).toHaveBeenLastCalledWith("INV2-AAAA-BBBB-CCCC-0001", expect.anything());
  });

  it("shows payments on a paid invoice, with the timeline complete", async () => {
    vi.mocked(api.invoiceDetail).mockResolvedValue(detail(rows[0], { paid_amount: "300.00", due_amount: "0.00",
      payments: [{ payment_id: "4WP26", date: "2026-11-03T23:57:07Z", method: "PAYPAL", amount: "300.00", status: "SUCCESS" }] }));
    render(<Dashboard />);
    const panel = await screen.findByRole("article", { name: "Invoice 0003" });
    expect(within(panel).getByText("4WP26")).toBeTruthy();
    expect(within(panel).getByText("SUCCESS")).toBeTruthy();
    expect(within(panel).getAllByText("Paid").length).toBeGreaterThan(0);
  });

  it("filters by status, resets to page 1 and asks the backend for those statuses", async () => {
    render(<Dashboard />);
    await screen.findByRole("list", { name: "Invoice list" });
    fireEvent.click(screen.getByRole("button", { name: "Paid" }));
    await waitFor(() => expect(api.invoices).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, statuses: ["PAID", "MARKED_AS_PAID"] }), expect.anything()));
    expect(screen.getByRole("button", { name: "Paid" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("searches after a pause in typing", async () => {
    render(<Dashboard />);
    await screen.findByRole("list", { name: "Invoice list" });
    fireEvent.change(screen.getByPlaceholderText("Search by email or number"), { target: { value: "acme" } });
    await waitFor(() => expect(api.invoices).toHaveBeenLastCalledWith(expect.objectContaining({ q: "acme", page: 1 }), expect.anything()), { timeout: 2000 });
  });

  it("pages forward and back", async () => {
    vi.mocked(api.invoices).mockResolvedValue(list(rows, { total_items: 25, total_pages: 3 }));
    render(<Dashboard />);
    await screen.findByText("1–3 of 25");
    expect((screen.getByRole("button", { name: "Previous page" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(api.invoices).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }), expect.anything()));
  });

  it("explains an empty account and an empty filter differently", async () => {
    vi.mocked(api.invoices).mockResolvedValue(list([]));
    render(<Dashboard />);
    expect(await screen.findByText("No invoices yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Paid" }));
    expect(await screen.findByText("No invoices match")).toBeTruthy();
  });

  it("tells you when the backend is down and recovers on Try again", async () => {
    vi.mocked(api.invoices).mockRejectedValueOnce(new ApiError("BACKEND_DOWN", "Mercury's backend isn't running. Start it with `make backend`.", true));
    render(<Dashboard />);
    expect((await screen.findByRole("alert")).textContent).toContain("backend isn't running");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("list", { name: "Invoice list" })).toBeTruthy();
  });

  it("has no accessibility violations", async () => {
    render(<Dashboard />);
    await screen.findByRole("article", { name: "Invoice 0003" });
    await audit("invoices");
  });
});

describe("Settings", () => {
  beforeEach(() => { location.hash = "#/dashboard/settings"; });

  it("shows live connection status and never secrets", async () => {
    render(<Dashboard />);
    expect(await screen.findByText("Connected")).toBeTruthy();
    expect(await screen.findByText("Ready")).toBeTruthy();
    expect(screen.getByText(/merchant@business\.example\.com/)).toBeTruthy();
    expect(screen.getByText(/Connected · v0\.1\.0/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/secret|password|token/i);
  });

  it("explains a PayPal credential problem", async () => {
    vi.mocked(api.info).mockResolvedValue({ ...INFO, paypal: { ...INFO.paypal, status: "error", error: "PayPal rejected the sandbox credentials." } });
    render(<Dashboard />);
    expect(await screen.findByText("PayPal rejected the sandbox credentials.")).toBeTruthy();
  });

  it("lists installed local models and switches the model", async () => {
    vi.mocked(api.setModel).mockResolvedValue({ ...MODELS, current: "qwen3:4b" });
    render(<Dashboard />);
    const select = (await screen.findByRole("combobox", { name: "AI model" })) as HTMLSelectElement;
    expect(select.value).toBe("gemma4:e2b-it-qat");
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "gemma4:e2b-it-qat (recommended) · 4.3 GB", "qwen3:4b · 2.5 GB",
    ]);
    fireEvent.change(select, { target: { value: "qwen3:4b" } });
    expect(await screen.findByText("Now using qwen3:4b.")).toBeTruthy();
    expect(api.setModel).toHaveBeenCalledWith("qwen3:4b");
    expect(await screen.findByText(/has been tested against/)).toBeTruthy();
  });

  it("says which Ollama models can't be used and why", async () => {
    render(<Dashboard />);
    expect(await screen.findByText("2 other models in Ollama can't be used here")).toBeTruthy();
    expect(screen.getByText("nomic-embed-text:latest")).toBeTruthy();
    expect(screen.getByText(/Search model; it can't read a sentence/)).toBeTruthy();
    expect(screen.getByText("qwen3.5:cloud")).toBeTruthy();
    expect(screen.getByText(/Turn on cloud models above/)).toBeTruthy();
  });

  describe("cloud models", () => {
    const CLOUD = { name: "glm-5.2:cloud", size_bytes: null, parameters: null, cloud: true };
    const ALLOWED: ModelState = { ...MODELS, allow_cloud: true, models: [...MODELS.models, CLOUD], unavailable: [MODELS.unavailable[0]] };

    it("keeps them off until you turn them on, and says what that means", async () => {
      vi.mocked(api.allowCloud).mockResolvedValue(ALLOWED);
      render(<Dashboard />);
      const toggle = await screen.findByRole("switch", { name: "Allow cloud models" });
      expect(toggle.getAttribute("aria-checked")).toBe("false");
      expect(screen.getByText(/everything you type is sent there/)).toBeTruthy();
      fireEvent.click(toggle);
      expect(await screen.findByText(/your invoice sentences go to ollama.com/)).toBeTruthy();
      expect(api.allowCloud).toHaveBeenCalledWith(true);
      expect(screen.getByRole("switch", { name: "Allow cloud models" }).getAttribute("aria-checked")).toBe("true");
      const options = within(screen.getByRole("combobox", { name: "AI model" })).getAllByRole("option").map((o) => o.textContent);
      expect(options).toContain("glm-5.2:cloud · cloud");
    });

    it("flags a cloud model as running off this computer", async () => {
      vi.mocked(api.models).mockResolvedValue({ ...ALLOWED, current: "glm-5.2:cloud" });
      render(<Dashboard />);
      expect(await screen.findByText("Cloud")).toBeTruthy();
      expect(screen.getByText(/This model runs on ollama.com, so what you type is sent there/)).toBeTruthy();
    });

    it("tells you when it falls back to a local model after turning cloud off", async () => {
      vi.mocked(api.models).mockResolvedValue({ ...ALLOWED, current: "glm-5.2:cloud" });
      vi.mocked(api.allowCloud).mockResolvedValue({ ...MODELS, allow_cloud: false });
      render(<Dashboard />);
      fireEvent.click(await screen.findByRole("switch", { name: "Allow cloud models" }));
      expect(await screen.findByText("Cloud models are off. Back to gemma4:e2b-it-qat.")).toBeTruthy();
      expect(api.allowCloud).toHaveBeenCalledWith(false);
    });

    it("says so when cloud is on but Ollama lists no cloud model", async () => {
      vi.mocked(api.models).mockResolvedValue({ ...MODELS, allow_cloud: true });
      render(<Dashboard />);
      expect(await screen.findByText(/Run ollama signin/)).toBeTruthy();
    });

    it("shows why turning it on failed", async () => {
      vi.mocked(api.allowCloud).mockRejectedValue(new ApiError("INTERNAL", "Something went wrong on the backend.", true));
      render(<Dashboard />);
      fireEvent.click(await screen.findByRole("switch", { name: "Allow cloud models" }));
      expect((await screen.findByRole("alert")).textContent).toMatch(/Something went wrong/);
    });
  });

  it("includes a four-step Ollama setup guide, closed once a model is ready", async () => {
    render(<Dashboard />);
    const summary = await screen.findByText("How to set up Ollama and a local model");
    expect((summary.closest("details") as HTMLDetailsElement).open).toBe(false);
    for (const step of ["Install Ollama", "Make sure it is running", "Download a model (one time)", "Check it worked"]) expect(screen.getByText(step)).toBeTruthy();
    for (const cmd of ["brew install ollama", "ollama serve", "ollama pull gemma4:e2b-it-qat", "ollama list"]) expect(screen.getByText(cmd)).toBeTruthy();
  });

  it("shows why a switch failed", async () => {
    vi.mocked(api.setModel).mockRejectedValue(new ApiError("MODEL_NOT_INSTALLED", "qwen3:4b isn't installed locally. Run: ollama pull qwen3:4b", false));
    render(<Dashboard />);
    fireEvent.change(await screen.findByRole("combobox", { name: "AI model" }), { target: { value: "qwen3:4b" } });
    expect((await screen.findByRole("alert")).textContent).toMatch(/isn't installed locally/);
  });

  it("walks through setup when the model is missing", async () => {
    vi.mocked(api.models).mockResolvedValue({ ...MODELS, status: "model_missing", models: [] });
    render(<Dashboard />);
    expect(await screen.findByText("Not installed")).toBeTruthy();
    expect((screen.getByText("How to set up Ollama and a local model").closest("details") as HTMLDetailsElement).open).toBe(true);
    expect(screen.getByText("Install Ollama")).toBeTruthy();
    expect(screen.getByText("ollama pull gemma4:e2b-it-qat")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy ollama pull gemma4:e2b-it-qat" })).toBeTruthy();
  });

  it("says so when Ollama is not running", async () => {
    vi.mocked(api.models).mockResolvedValue({ ...MODELS, status: "offline", models: [] });
    render(<Dashboard />);
    expect(await screen.findByText("Ollama not running")).toBeTruthy();
    expect(screen.getByText(/Start Ollama/)).toBeTruthy();
  });

  it("explains Basic mode when AI parsing is turned off", async () => {
    vi.mocked(api.models).mockResolvedValue({ ...MODELS, status: "disabled", current: null, models: [] });
    render(<Dashboard />);
    expect(await screen.findByText("AI parsing is turned off")).toBeTruthy();
  });

  it("offers a retry when the backend is down", async () => {
    vi.mocked(api.info).mockRejectedValueOnce(new ApiError("BACKEND_DOWN", "Mercury's backend isn't running.", true));
    render(<Dashboard />);
    expect(await screen.findByText(/make dev-web/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Ready")).toBeTruthy();
  });

  it("switches and remembers the theme", async () => {
    render(<Dashboard />);
    await screen.findByText("Ready");
    fireEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("mercury.theme")).toBe("light");
    fireEvent.click(screen.getByRole("radio", { name: "System" }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("clears the recent invoices kept on this device", async () => {
    localStorage.setItem("mercury.recents.v1", JSON.stringify([{ invoice_id: "INV2-1", client_email: "a@b.co", total: "1.00", currency: "USD", status: "SENT", url: "https://x", ts: Date.now() }]));
    render(<Dashboard />);
    await screen.findByText("1 saved");
    fireEvent.click(screen.getByRole("button", { name: /Clear/ }));
    expect(screen.getByText("0 saved")).toBeTruthy();
    expect(JSON.parse(localStorage.getItem("mercury.recents.v1") ?? "[]")).toEqual([]);
  });

  it("has no accessibility violations", async () => {
    render(<Dashboard />);
    await screen.findByText("Ready");
    await audit("settings");
  });
});

describe("navigation", () => {
  it("moves between sections and updates the address", async () => {
    render(<Dashboard />);
    await screen.findByRole("list", { name: "Invoice list" });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeTruthy();
    expect(location.hash).toBe("#/dashboard/settings");
    expect(screen.getByRole("button", { name: "Settings" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: "Invoices" }));
    expect(await screen.findByRole("list", { name: "Invoice list" })).toBeTruthy();
  });
});
