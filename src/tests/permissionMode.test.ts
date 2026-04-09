import { describe, expect, it } from "vitest";
import {
  getPermissionModeCatalog,
  getPermissionModeProfile,
  normalizePermissionMode,
  PERMISSION_MODE_CATALOG,
} from "../util/permissionMode";

describe("permission mode helpers", () => {
  it("normalizes supported permission mode aliases", () => {
    expect(normalizePermissionMode("suggest")).toBe("suggest");
    expect(normalizePermissionMode("autoedit")).toBe("auto-edit");
    expect(normalizePermissionMode("AUTO-EDIT")).toBe("auto-edit");
    expect(normalizePermissionMode("full-auto")).toBe("full-auto");
    expect(normalizePermissionMode("unknown")).toBeNull();
  });

  it("maps each permission mode to the expected sandbox profile", () => {
    expect(PERMISSION_MODE_CATALOG.map((entry) => entry.mode)).toEqual(["suggest", "auto-edit", "full-auto"]);

    expect(getPermissionModeProfile("suggest")).toMatchObject({
      mode: "suggest",
      sandboxMode: "read-only",
      approvalPolicy: "untrusted",
    });
    expect(getPermissionModeProfile("auto-edit")).toMatchObject({
      mode: "auto-edit",
      sandboxMode: "workspace-write",
      approvalPolicy: "on-failure",
    });
    expect(getPermissionModeProfile("full-auto")).toMatchObject({
      mode: "full-auto",
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
    });
  });

  it("localizes permission mode descriptions", () => {
    expect(getPermissionModeCatalog("ja")[0]?.description).toContain("読み取り専用");
    expect(getPermissionModeCatalog("en")[1]?.label).toBe("Auto Edit");
  });
});
