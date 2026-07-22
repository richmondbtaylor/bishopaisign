import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import SignDocument from "@/pages/SignDocument";

// Mock react-pdf to avoid worker/pdf loading in jsdom.
vi.mock("react-pdf", () => ({
  Document: ({ children }: any) => <div data-testid="pdf">{children}</div>,
  Page: () => <div data-testid="pdf-page" />,
  pdfjs: { GlobalWorkerOptions: {}, version: "0.0.0" },
}));

const invokeMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...args: any[]) => invokeMock(...args) },
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, session: null, loading: false, signOut: async () => {} }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const DOC_ID = "11111111-1111-1111-1111-111111111111";
const TOKEN = "22222222-2222-2222-2222-222222222222";

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/sign/:documentId" element={<SignDocument />} />
      </Routes>
    </MemoryRouter>
  );

describe("SignDocument deep-link E2E", () => {
  beforeEach(() => { invokeMock.mockReset(); });

  it("correct link: renders the signing document", async () => {
    invokeMock.mockResolvedValueOnce({
      data: {
        signer: { id: "s1", email: "a@b.com", status: "sent", name: "Alice" },
        document: { id: DOC_ID, title: "Contract", file_path: "x.pdf" },
        fields: [],
        pdfUrl: "https://example.com/x.pdf",
      },
      error: null,
    });
    renderAt(`/sign/${DOC_ID}?token=${TOKEN}`);
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("signing-session", {
        body: { token: TOKEN, documentId: DOC_ID },
      });
    });
  });

  it("expired link: shows expiration screen with reissue form", async () => {
    invokeMock.mockResolvedValueOnce({
      data: null,
      error: {
        message: "Link expired",
        context: {
          status: 410,
          json: async () => ({ error: "Link expired", reason: "expired", documentId: DOC_ID }),
        },
      },
    });
    renderAt(`/sign/${DOC_ID}?token=${TOKEN}`);
    expect(await screen.findByText(/Link expired/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/you@company.com/i)).toBeInTheDocument();
    expect(screen.getByText(/Quick check/i)).toBeInTheDocument();
  });

  it("mismatched documentId: shows mismatch screen", async () => {
    invokeMock.mockResolvedValueOnce({
      data: null,
      error: {
        message: "Mismatch",
        context: {
          status: 409,
          json: async () => ({ error: "Mismatch", reason: "mismatch", documentId: "other-doc-id" }),
        },
      },
    });
    renderAt(`/sign/${DOC_ID}?token=${TOKEN}`);
    expect(await screen.findByText(/doesn't match this document/i)).toBeInTheDocument();
  });

  it("reissue submit sends reason + challenge + honeypot payload", async () => {
    invokeMock.mockResolvedValueOnce({
      data: null,
      error: {
        message: "Link expired",
        context: {
          status: 410,
          json: async () => ({ error: "Link expired", reason: "expired", documentId: DOC_ID }),
        },
      },
    });
    renderAt(`/sign/${DOC_ID}?token=${TOKEN}`);
    await screen.findByText(/Link expired/i);

    const emailInput = screen.getByPlaceholderText(/you@company.com/i) as HTMLInputElement;
    fireEvent.change(emailInput, { target: { value: "user@example.com" } });

    // Read the challenge shown "what is A + B?"
    const challengeLabel = screen.getByText(/what is \d+ \+ \d+\?/i).textContent!;
    const [, a, b] = challengeLabel.match(/(\d+)\s*\+\s*(\d+)/)!;
    const answer = Number(a) + Number(b);
    const numberInput = screen.getByPlaceholderText(/Answer/i);
    fireEvent.change(numberInput, { target: { value: String(answer) } });

    invokeMock.mockResolvedValueOnce({ data: { success: true }, error: null });
    fireEvent.click(screen.getByRole("button", { name: /Send me a new signing link/i }));

    await waitFor(() => {
      const call = invokeMock.mock.calls.find((c) => c[0] === "request-new-link");
      expect(call).toBeTruthy();
      const body = call![1].body;
      expect(body.email).toBe("user@example.com");
      expect(body.documentId).toBe(DOC_ID);
      expect(body.reason).toBe("expired");
      expect(body.hp_field).toBe("");
      expect(body.challenge.answer).toBe(answer);
    });
  });
});
