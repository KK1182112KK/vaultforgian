import { describe, expect, it } from "vitest";
import { buildGeneratedDiagramAssetPath, sanitizeGeneratedSvg } from "../util/generatedDiagrams";

const SAFE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect x="24" y="24" width="592" height="312" fill="#fff" stroke="#111"/><text x="80" y="120">Average power</text></svg>';

describe("generated diagram utilities", () => {
  it("accepts simple self-contained SVG diagrams", () => {
    expect(sanitizeGeneratedSvg(SAFE_SVG)).toEqual({
      ok: true,
      svg: SAFE_SVG,
    });
  });

  it.each([
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><script>alert(1)</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><foreignObject><div>HTML</div></foreignObject></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10" onload="alert(1)"></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><image href="https://example.com/x.png"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><use href="data:image/svg+xml;base64,abc"/></svg>',
  ])("rejects unsafe SVG content: %s", (svg) => {
    expect(sanitizeGeneratedSvg(svg)).toMatchObject({ ok: false });
  });

  it("derives deterministic managed asset paths from titles", () => {
    expect(buildGeneratedDiagramAssetPath("Average Load Power")).toBe("assets/vaultforgian/diagrams/average-load-power.svg");
    expect(buildGeneratedDiagramAssetPath("\u5e73\u5747\u8ca0\u8377\u96fb\u529b")).toBe("assets/vaultforgian/diagrams/study-diagram.svg");
  });
});
