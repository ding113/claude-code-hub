import { describe, expect, it } from "vitest";
import { deepEquals } from "@/app/[locale]/settings/providers/_components/batch-edit/deep-equals";

describe("deepEquals", () => {
  describe("基本类型", () => {
    it("应该正确比较相同的基本类型", () => {
      expect(deepEquals(1, 1)).toBe(true);
      expect(deepEquals("test", "test")).toBe(true);
      expect(deepEquals(true, true)).toBe(true);
      expect(deepEquals(null, null)).toBe(true);
      expect(deepEquals(undefined, undefined)).toBe(true);
    });

    it("应该正确比较不同的基本类型", () => {
      expect(deepEquals(1, 2)).toBe(false);
      expect(deepEquals("test", "other")).toBe(false);
      expect(deepEquals(true, false)).toBe(false);
      expect(deepEquals(null, undefined)).toBe(false);
    });

    it("应该正确处理 NaN", () => {
      expect(deepEquals(Number.NaN, Number.NaN)).toBe(true);
    });

    it("应该正确处理 +0 和 -0", () => {
      expect(deepEquals(0, -0)).toBe(false);
      expect(deepEquals(+0, -0)).toBe(false);
    });
  });

  describe("数组", () => {
    it("应该正确比较相同的数组", () => {
      expect(deepEquals([1, 2, 3], [1, 2, 3])).toBe(true);
      expect(deepEquals(["a", "b"], ["a", "b"])).toBe(true);
      expect(deepEquals([], [])).toBe(true);
    });

    it("应该正确比较不同的数组", () => {
      expect(deepEquals([1, 2, 3], [1, 2, 4])).toBe(false);
      expect(deepEquals([1, 2], [1, 2, 3])).toBe(false);
      expect(deepEquals(["a"], ["b"])).toBe(false);
    });

    it("应该正确比较嵌套数组", () => {
      expect(
        deepEquals(
          [
            [1, 2],
            [3, 4],
          ],
          [
            [1, 2],
            [3, 4],
          ]
        )
      ).toBe(true);
      expect(
        deepEquals(
          [
            [1, 2],
            [3, 4],
          ],
          [
            [1, 2],
            [3, 5],
          ]
        )
      ).toBe(false);
    });
  });

  describe("对象", () => {
    it("应该正确比较相同的对象", () => {
      expect(deepEquals({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
      expect(deepEquals({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true); // 键顺序不同
      expect(deepEquals({}, {})).toBe(true);
    });

    it("应该正确比较不同的对象", () => {
      expect(deepEquals({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
      expect(deepEquals({ a: 1 }, { a: 1, b: 2 })).toBe(false);
      expect(deepEquals({ a: 1 }, { b: 1 })).toBe(false);
    });

    it("应该正确比较嵌套对象", () => {
      expect(deepEquals({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true);
      expect(deepEquals({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
    });

    it("应该正确比较包含数组的对象", () => {
      expect(deepEquals({ a: [1, 2] }, { a: [1, 2] })).toBe(true);
      expect(deepEquals({ a: [1, 2] }, { a: [1, 3] })).toBe(false);
    });
  });

  describe("混合类型", () => {
    it("应该正确比较不同类型", () => {
      expect(deepEquals(1, "1")).toBe(false);
      expect(deepEquals([], {})).toBe(false);
      expect(deepEquals(null, {})).toBe(false);
      expect(deepEquals(undefined, null)).toBe(false);
    });

    it("应该正确比较复杂嵌套结构", () => {
      const obj1 = {
        a: 1,
        b: [2, 3, { c: 4 }],
        d: { e: [5, 6], f: { g: 7 } },
      };
      const obj2 = {
        a: 1,
        b: [2, 3, { c: 4 }],
        d: { e: [5, 6], f: { g: 7 } },
      };
      const obj3 = {
        a: 1,
        b: [2, 3, { c: 4 }],
        d: { e: [5, 6], f: { g: 8 } }, // 不同
      };

      expect(deepEquals(obj1, obj2)).toBe(true);
      expect(deepEquals(obj1, obj3)).toBe(false);
    });
  });
});
