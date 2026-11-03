import { describe, expect, it } from "vitest";
import { maskEmail, maskPhone, contactRef } from "./pii";

describe("pii masks", () => {
    it("masks emails but keeps the domain", () => expect(maskEmail("ravi.kumar@gmail.com")).toBe("r***r@gmail.com"));
    it("masks Indian mobiles", () => expect(maskPhone("+91 98765 43210")).toBe("+91 98xxxx3210"));
    it("is stable and case-insensitive", () => expect(contactRef("A@b.co")).toBe(contactRef(" a@b.co ")));
});
