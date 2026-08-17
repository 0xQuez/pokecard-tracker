// Tests for the Guest option on the profile gate (T26.3).
// Runs under vitest (jsdom).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import ProfileGate from "./ProfileGate";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ProfileGate guest option", () => {
  it("offers a distinct Guest option alongside the two owners", () => {
    render(<ProfileGate onAuth={vi.fn()} />);
    expect(screen.getByRole("radio", { name: /quez/i })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /stevie/i })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /guest/i })).toBeTruthy();
  });

  it("logs in as guest without a password", () => {
    const onAuth = vi.fn();
    render(<ProfileGate onAuth={onAuth} />);
    fireEvent.click(screen.getByRole("radio", { name: /guest/i }));
    // Password field is hidden for guest; the submit does not require it.
    expect(screen.queryByLabelText(/shared password/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /explore/i }));
    expect(onAuth).toHaveBeenCalledWith("guest", "");
  });

  it("still requires the password for an owner profile", () => {
    const onAuth = vi.fn();
    render(<ProfileGate onAuth={onAuth} />);
    // Default selection is Quez; a wrong password must not auth.
    fireEvent.submit(screen.getByRole("button", { name: /unlock/i }).closest("form")!);
    expect(onAuth).not.toHaveBeenCalled();
    expect(screen.getByText("Wrong password.")).toBeTruthy();
  });
});
