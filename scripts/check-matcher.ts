import assert from "node:assert/strict";
import { matchRule, parseKeywords } from "../src/lib/matcher";

const rules = [
  { id: "menu", keywords: parseKeywords("1, المنيو, menu"), active: true },
  { id: "offers", keywords: parseKeywords("2، عروض"), active: true },
  { id: "price", keywords: parseKeywords("سعر الاشتراك, الاسعار"), active: true },
  { id: "paused", keywords: parseKeywords("وقف"), active: false }
];

const pick = (body: string) => matchRule(body, rules)?.id;

// Numbers are menu choices, but only as the whole message.
assert.equal(pick("1"), "menu");
assert.equal(pick(" 2 "), "offers");
assert.equal(pick("٢"), "offers", "Arabic-Indic digits read as digits");
assert.equal(pick("اريد 2 غرف"), undefined, "a number inside a sentence is not a menu choice");

// Words: loose spelling, whole words, one typo on words of four letters or more.
assert.equal(pick("المنيو"), "menu");
assert.equal(pick("ابغى المنيو لو سمحت"), "menu");
assert.equal(pick("عروضً"), "offers", "diacritics ignored");
assert.equal(pick("الاسعار"), "price");
assert.equal(pick("الأسعار"), "price", "hamza ignored");
assert.equal(pick("الاسعر"), "price", "one typo forgiven");
assert.equal(pick("menus"), "menu", "one typo forgiven");

// Phrases are matched as phrases.
assert.equal(pick("كم سعر الاشتراك عندكم"), "price");

// Nothing matches, paused rules stay silent, empty input is safe.
assert.equal(pick("مرحبا"), undefined);
assert.equal(pick("وقف"), undefined);
assert.equal(pick(""), undefined);

// Short word triggers are refused; numbers of any length are kept.
assert.deepEqual(parseKeywords("ab, 7, abc"), ["7", "abc"]);

console.log("matcher: all checks passed");
