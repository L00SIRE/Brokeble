import { describe, expect, it } from "vitest";
import { qrSvg, safeQrSvg, webOrigin } from "./qr";

describe("qrSvg", () => {
  it("renders an https URL as an SVG that passes its own safety check", async () => {
    const svg = await qrSvg("https://tab-web-ten.vercel.app/");
    expect(svg.trim().startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('width="200"');
    expect(safeQrSvg(svg)).not.toBeNull();
  });

  it("draws ink modules on paper, quiet zone included (design-system 6.3), never on a white box", async () => {
    const svg = await qrSvg("https://tab-web-ten.vercel.app/");
    expect(svg).toContain('fill="#f6f1e6"');
    expect(svg).toContain('stroke="#100e0a"');
    expect(svg).not.toMatch(/#fff(fff)?/i);
  });

  it("refuses to encode anything but https (a QR never carries sms:)", async () => {
    await expect(qrSvg("sms:+12135550147&body=hi")).rejects.toThrow();
    await expect(qrSvg("http://tab-web-ten.vercel.app/")).rejects.toThrow();
  });
});

describe("safeQrSvg", () => {
  const ok = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29"><path stroke="#000" d="M0 0h7"/></svg>';

  it("accepts qrcode's exact path-only shape", () => {
    expect(safeQrSvg(ok)).toBe(ok);
    expect(safeQrSvg(`${ok}\n`)).toBe(ok);
  });

  it.each([
    ["a script element", '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
    ["an event handler on the root", '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><path d="M0 0"/></svg>'],
    ["an event handler on a path", '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0" onclick="x()"/></svg>'],
    ["a link", '<svg xmlns="http://www.w3.org/2000/svg"><a href="#x"><path d="M0 0"/></a></svg>'],
    ["a CSS url()", '<svg xmlns="http://www.w3.org/2000/svg"><path style="fill:url(#x)" d="M0 0"/></svg>'],
    ["not an svg", '<img src="x" alt="">'],
    ["empty", ""],
  ])("rejects %s", (_name, svg) => {
    expect(safeQrSvg(svg)).toBeNull();
  });

  it("rejects missing values", () => {
    expect(safeQrSvg(null)).toBeNull();
    expect(safeQrSvg(undefined)).toBeNull();
  });
});

describe("webOrigin", () => {
  it("prefers the explicit origin, then Vercel's production host, then the known URL", () => {
    expect(webOrigin({ NEXT_PUBLIC_WEB_ORIGIN: "https://squadtab.example/path" })).toBe("https://squadtab.example");
    expect(webOrigin({ VERCEL_PROJECT_PRODUCTION_URL: "tab-web-ten.vercel.app" })).toBe("https://tab-web-ten.vercel.app");
    expect(webOrigin({})).toBe("https://tab-web-ten.vercel.app");
  });
});
