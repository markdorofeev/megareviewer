export interface MailConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
}

export const mailConfig = (env: Readonly<Record<string, string | undefined>>): MailConfig => {
  const apiKey = env.MAIL_API_KEY;
  if (apiKey === undefined || apiKey === "") throw new Error("MAIL_API_KEY isn't set");
  return { apiKey, baseUrl: "https://api.mail.example.com/v2" };
};
