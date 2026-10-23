import { describe, expect, it } from "vitest";

import { myBookTarget } from "./MePage.js";

/**
 * **「我的」页的「我的账本」打开当前账本的详情（S16-A）。**
 *
 * 以前这一行固定通往账本空间，所有者要求它直接打开"现在这本账"。规则是纯函数，钉在这里：
 * 不写死任何账本 id；没有当前账本、或当前账本已经不在可访问列表里时，回到账本空间去选，
 * 而不是打开一个注定读不到的详情页。
 */
describe("myBookTarget", () => {
  const books = [{ id: "book-a" }, { id: "book-b" }];

  it("opens the current book's detail page", () => {
    expect(myBookTarget("book-b", books)).toBe("/books/book-b");
  });

  it("sends somebody without a current book to the book space", () => {
    expect(myBookTarget(null, books)).toBe("/start");
    expect(myBookTarget(null, undefined)).toBe("/start");
  });

  it("does not open a book the reader can no longer reach", () => {
    expect(myBookTarget("book-gone", books)).toBe("/start");
    expect(myBookTarget("book-gone", [])).toBe("/start");
  });

  it("trusts the current book while the list is still loading or offline", () => {
    // The detail page itself explains a book it cannot read; guessing "gone" here would bounce
    // an offline reader away from the book they are in.
    expect(myBookTarget("book-a", undefined)).toBe("/books/book-a");
  });
});
