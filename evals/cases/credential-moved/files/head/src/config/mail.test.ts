import { expect, it } from "vitest";
import { mailConfig } from "./mail.ts";

it("reads the API key", () => {
  expect(mailConfig({ MAIL_API_KEY: "key" })).toEqual({
    apiKey: "key",
    baseUrl: "https://api.mail.example.com/v2",
  });
});

it.each([undefined, ""])("refuses to start without one (%s)", (MAIL_API_KEY) => {
  expect(() => mailConfig({ MAIL_API_KEY })).toThrow("MAIL_API_KEY isn't set");
});
