import { describe, expect, it } from "vitest";
import { Emitter } from "../src/emitter.js";

describe("Emitter", () => {
  it("delivers events to all listeners", () => {
    const e = new Emitter<number>();
    const a: number[] = [];
    const b: number[] = [];
    e.on((n) => a.push(n));
    e.on((n) => b.push(n));
    e.emit(1);
    e.emit(2);
    expect(a).toEqual([1, 2]);
    expect(b).toEqual([1, 2]);
  });

  it("stops delivering after unsubscribe", () => {
    const e = new Emitter<string>();
    const seen: string[] = [];
    const off = e.on((s) => seen.push(s));
    e.emit("x");
    off();
    e.emit("y");
    expect(seen).toEqual(["x"]);
  });
});
