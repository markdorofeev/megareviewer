import { z } from "zod";

// Apart from point.ts, which reads guidance from preference.ts, which names a signal's point kind.
export const PointKind = z.enum(["finding", "risk", "decision"]);
export type PointKind = z.infer<typeof PointKind>;
