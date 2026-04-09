import { describe, expect, it } from "vitest";
import { allowsVaultWrite } from "../util/vaultEdit";

describe("vault edit policy", () => {
  it("allows explicit edit requests", () => {
    expect(allowsVaultWrite("このノートを更新して")).toBe(true);
    expect(allowsVaultWrite("Implement the plan")).toBe(true);
    expect(allowsVaultWrite("Please edit this file")).toBe(true);
  });

  it("blocks read-only style requests", () => {
    expect(allowsVaultWrite("このノートを要約して")).toBe(false);
    expect(allowsVaultWrite("What changed in this file?")).toBe(false);
  });
});
