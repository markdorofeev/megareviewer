import type { ReviewActivity } from "../../../src/domain/review/index.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A reviewer who has posted nothing yet. */
export const newReviewerActivity: ReviewActivity = { reviews: [], comments: [] };

/**
 * An active reviewer's last 26 weeks up to `nowMs`: most weekdays a few PRs, quieter weekends,
 * and one busy day. Seeded, so the same day always shows the same squares.
 */
export const activeReviewerActivity = (nowMs: number): ReviewActivity => {
  let seed = 54;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const reviews: { at: string; pullRequest: ReviewActivity["reviews"][number]["pullRequest"] }[] =
    [];
  const comments: string[] = [];
  let number = 3000;
  for (let daysAgo = 26 * 7; daysAgo >= 0; daysAgo -= 1) {
    const day = nowMs - daysAgo * DAY_MS;
    const weekend = [0, 6].includes(new Date(day).getDay());
    const roll = random();
    const pullRequests =
      daysAgo === 9 ? 7 : weekend ? (roll < 0.8 ? 0 : 1) : roll < 0.25 ? 0 : Math.floor(roll * 5);
    for (let index = 0; index < pullRequests; index += 1) {
      number += 1;
      // Earlier in the day than now, so today's posts aren't in the future.
      const at = new Date(day - (index + 1) * 20 * 60 * 1000).toISOString();
      reviews.push({
        at,
        pullRequest: {
          repo: { host: index % 3 === 2 ? "bitbucket" : "github", owner: "acme", repo: "web" },
          number,
        },
      });
      const count = Math.floor(random() * 5);
      for (let comment = 0; comment < count; comment += 1) comments.push(at);
    }
  }
  return { reviews, comments };
};
