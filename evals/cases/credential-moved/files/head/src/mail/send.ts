import { mailConfig } from "../config/mail.ts";
import { createMailClient, type Mail } from "./client.ts";

const client = createMailClient(mailConfig(process.env));

export const sendMail = (mail: Mail): Promise<void> => client.send(mail);
