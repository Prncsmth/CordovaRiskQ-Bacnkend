import assert from "node:assert/strict";
import { test } from "node:test";

import { passwordResetHashing } from "@/services/passwordReset.service";

test("the real reset wiring stores bcrypt hashes, never the plain password or code", async () => {
    const hash = await passwordResetHashing.hash("NewPass1!");

    assert.match(hash, /^\$2[aby]\$10\$/, "bcrypt with cost 10, like registration");
    assert.notEqual(hash, "NewPass1!");
    assert.ok(!hash.includes("NewPass1!"));
    assert.equal(await passwordResetHashing.compareHash("NewPass1!", hash), true);
    assert.equal(await passwordResetHashing.compareHash("WrongPass1!", hash), false);
});
