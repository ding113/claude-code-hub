import { describe, expect, it } from "vitest";
import { splitSetCookieHeader } from "../../e2e/_helpers/auth";

describe("splitSetCookieHeader", () => {
  it("returns empty array for empty input", () => {
    expect(splitSetCookieHeader("")).toEqual([]);
    expect(splitSetCookieHeader("   ")).toEqual([]);
  });

  it("splits cookies on comma separators", () => {
    expect(splitSetCookieHeader("a=1; Path=/, b=2; Path=/")).toEqual([
      "a=1; Path=/",
      "b=2; Path=/",
    ]);
  });

  it("does not split RFC 1123 Expires commas", () => {
    expect(
      splitSetCookieHeader("a=1; Expires=Wed, 21 Oct 2015 07:28:00 GMT; Path=/, b=2; Path=/")
    ).toEqual(["a=1; Expires=Wed, 21 Oct 2015 07:28:00 GMT; Path=/", "b=2; Path=/"]);
  });

  it("splits when Expires is the last attribute", () => {
    expect(splitSetCookieHeader("a=1; Expires=Wed, 21 Oct 2015 07:28:00 GMT, b=2; Path=/")).toEqual(
      ["a=1; Expires=Wed, 21 Oct 2015 07:28:00 GMT", "b=2; Path=/"]
    );
  });

  it("does not split commas inside quoted cookie values", () => {
    expect(splitSetCookieHeader('a="x, y=z"; Path=/, b=2; Path=/')).toEqual([
      'a="x, y=z"; Path=/',
      "b=2; Path=/",
    ]);
  });
});
