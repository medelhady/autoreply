import assert from "node:assert/strict";
import crypto from "node:crypto";
import { parseDeliveryFailures, parseMessages, verifySignature } from "../src/lib/whatsapp";

const body = JSON.stringify({ hello: "world" });
const sign = (secret: string, text: string) => `sha256=${crypto.createHmac("sha256", secret).update(text, "utf8").digest("hex")}`;

// No secret configured: fail closed.
delete process.env.META_APP_SECRET;
assert.equal(verifySignature(body, sign("s3cret", body)), false);

process.env.META_APP_SECRET = "s3cret";
assert.equal(verifySignature(body, sign("s3cret", body)), true);
assert.equal(verifySignature(body, sign("other", body)), false, "wrong secret");
assert.equal(verifySignature(body + " ", sign("s3cret", body)), false, "body changed");
assert.equal(verifySignature(body, null), false, "missing header");
assert.equal(verifySignature(body, "sha256=zz"), false, "malformed hex");

// A delivery is routed by phone_number_id, and only text-bearing messages are kept.
const payload = {
  entry: [
    {
      changes: [
        {
          value: {
            metadata: { phone_number_id: "111" },
            messages: [
              { id: "m1", from: "22234300253", type: "text", text: { body: " 1 " } },
              { id: "m2", from: "22234300253", type: "image", image: {} },
              { id: "m3", from: "22234300253", type: "interactive", interactive: { button_reply: { title: "العروض" } } }
            ],
            statuses: [
              { id: "x", status: "delivered", recipient_id: "1" },
              { id: "y", status: "failed", recipient_id: "22234300253", errors: [{ code: 131047, title: "Re-engagement message" }] }
            ]
          }
        }
      ]
    }
  ]
};

assert.deepEqual(parseMessages(payload), [
  { phoneNumberId: "111", messageId: "m1", from: "22234300253", body: "1" },
  { phoneNumberId: "111", messageId: "m3", from: "22234300253", body: "العروض" }
]);

assert.deepEqual(parseDeliveryFailures(payload), [
  { phoneNumberId: "111", recipient: "22234300253", reason: "131047 Re-engagement message" }
]);

console.log("whatsapp: all checks passed");
