import { z } from "zod";
import { HunkId } from "../diff/index.ts";

/** Lines of one hunk, `startLine` to `line`: new is the head side, old the base. */
export const PointLines = z
  .object({
    hunkId: HunkId,
    side: z.enum(["new", "old"]),
    startLine: z.number().int().positive(),
    line: z.number().int().positive(),
  })
  .readonly()
  .refine((lines) => lines.startLine <= lines.line, {
    message: "startLine must not come after line",
  });
export type PointLines = z.infer<typeof PointLines>;
