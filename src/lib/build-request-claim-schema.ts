import { z } from "zod";

export const expressInterestInputSchema = z.object({
  message: z
    .union([
      z.string().length(0),
      z.string().min(10).max(500),
    ])
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
});

export type ExpressInterestInput = z.infer<typeof expressInterestInputSchema>;
