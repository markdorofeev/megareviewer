import { z } from "zod";

// What a review signal was on: always a finding now, and a risk or a decision on one stored while
// those were points.
export const PointKind = z.enum(["finding", "risk", "decision"]);
export type PointKind = z.infer<typeof PointKind>;
