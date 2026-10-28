import { describe, expect, it } from "vitest";
import {
  LIVE_APP_URL,
  isStudioPreviewContext,
  type StudioPreviewContext,
} from "./studioPreview";

function context(
  overrides: StudioPreviewContext = {}
): StudioPreviewContext {
  return {
    hostname: "8080-agqvtg5gwokf3k7e5easq4hd5e.instabox.tech",
    search: "",
    referrer: "",
    framed: false,
    envFlag: "",
    ...overrides,
  };
}

describe("Arc Studio preview detection", () => {
  it("keeps the production app out of preview mode", () => {
    expect(isStudioPreviewContext(context())).toBe(false);
  });

  it("recognizes the Studio host and its subdomains", () => {
    expect(isStudioPreviewContext(context({ hostname: "studio.arc.io" }))).toBe(
      true
    );
    expect(
      isStudioPreviewContext(context({ hostname: "preview.studio.arc.io" }))
    ).toBe(true);
  });

  it("recognizes the explicit env flag and query parameter", () => {
    expect(isStudioPreviewContext(context({ envFlag: "1" }))).toBe(true);
    expect(isStudioPreviewContext(context({ envFlag: "TRUE" }))).toBe(true);
    expect(
      isStudioPreviewContext(context({ search: "?studioPreview=1" }))
    ).toBe(true);
    expect(
      isStudioPreviewContext(context({ search: "?foo=bar&studioPreview=1" }))
    ).toBe(true);
    expect(
      isStudioPreviewContext(context({ search: "?studioPreview=0" }))
    ).toBe(false);
  });

  it("recognizes a framed Studio preview from its referrer", () => {
    expect(
      isStudioPreviewContext(
        context({
          hostname: "sandbox.example",
          framed: true,
          referrer: "https://studio.arc.io/app/123",
        })
      )
    ).toBe(true);
    expect(
      isStudioPreviewContext(
        context({
          hostname: "sandbox.example",
          framed: true,
          referrer: "https://example.com/",
        })
      )
    ).toBe(false);
    expect(
      isStudioPreviewContext(
        context({
          hostname: "sandbox.example",
          framed: false,
          referrer: "https://studio.arc.io/app/123",
        })
      )
    ).toBe(false);
  });

  it("publishes the live app URL used by the preview banner", () => {
    expect(LIVE_APP_URL).toMatch(/^https:\/\/.+/);
  });
});
