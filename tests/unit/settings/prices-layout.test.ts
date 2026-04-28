import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

function readProjectFile(...segments: string[]) {
  return fs.readFileSync(path.join(process.cwd(), ...segments), "utf8");
}

describe("settings prices layout constraints", () => {
  test("settings content column can shrink inside the centered page container", () => {
    const source = readProjectFile("src/app/[locale]/settings/layout.tsx");

    expect(source).toContain('className="mx-auto w-full max-w-7xl');
    expect(source).toContain('className="min-w-0 space-y-6"');
  });

  test("price table scrolls horizontally inside its settings section", () => {
    const source = readProjectFile("src/app/[locale]/settings/prices/_components/price-list.tsx");

    expect(source).toMatch(/<div className="[^"]*overflow-x-auto[^"]*overflow-y-hidden[^"]*"/);
    expect(source).toMatch(/<table className="[^"]*min-w-\[[^\]]+\][^"]*table-fixed[^"]*"/);
  });
});
