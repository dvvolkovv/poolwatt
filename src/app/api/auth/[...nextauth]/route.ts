// Auth.js v5 wires its endpoint(s) through the `handlers` export object.
// NextAuth() in src/lib/auth.ts produces { handlers: { GET, POST }, ... };
// Next.js mounts these at /api/auth/<everything> (sign-in, callback, session…).
import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;
