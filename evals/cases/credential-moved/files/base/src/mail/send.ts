import { createMailClient, type Mail } from "./client.ts";

const apiKey = process.env.MAIL_API_KEY;
if (apiKey === undefined || apiKey === "") throw new Error("MAIL_API_KEY isn't set");

const client = createMailClient({ apiKey, baseUrl: "https://api.mail.example.com/v2" });

export const sendMail = (mail: Mail): Promise<void> => client.send(mail);
