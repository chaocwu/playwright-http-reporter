import { expect, test } from "@playwright/test";

test("example passes", () => {
  expect(1 + 1).toBe(2);
});

test("example fails on purpose", () => {
  expect(1).toBe(2);
});
