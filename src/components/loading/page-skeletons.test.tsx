import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  LoadingState,
  PageHeaderSkeleton,
  TableSkeleton,
} from "@/components/loading/page-skeletons";

describe("page-skeletons", () => {
  test("LoadingState renders label and aria-busy", () => {
    const html = renderToStaticMarkup(<LoadingState label="加载中" />);
    expect(html).toContain("加载中");
    expect(html).toContain('aria-busy="true"');
  });

  test("PageHeaderSkeleton renders skeleton elements", () => {
    const html = renderToStaticMarkup(<PageHeaderSkeleton />);
    expect(html).toContain('data-slot="skeleton"');
  });

  test("TableSkeleton renders expected skeleton count", () => {
    const html = renderToStaticMarkup(<TableSkeleton rows={2} columns={3} />);
    const skeletonCount = (html.match(/data-slot="skeleton"/g) || []).length;
    expect(skeletonCount).toBe(3 + 2 * 3);
  });
});
