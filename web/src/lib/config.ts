export const config = {
  url: process.env.APP_URL ?? "http://localhost:3000",
  server: process.env.SQL_SERVER ?? "sql-ofek324-osalzberg-fc.database.windows.net",
  database: process.env.SQL_DATABASE ?? "ofek-jobs-poc",
  storage: process.env.AZURE_STORAGE_ACCOUNT ?? "stofek324osalzbergdev",
  subscription: "5edb3519-a630-43b6-82ac-cf92b84ec378",
  tenant: "ea40c3b0-b791-4369-b99a-3c4e9f570512",
};
export const secureCookies = config.url.startsWith("https://");
export const sessionCookie = `${secureCookies ? "__Host-" : ""}ofek_session`;
export const challengeCookie = `${secureCookies ? "__Host-" : ""}ofek_challenge`;
export const googleCookie = `${secureCookies ? "__Host-" : ""}ofek_google`;
export const cookieOptions = { httpOnly: true, secure: secureCookies, sameSite: "lax" as const, path: "/" };
