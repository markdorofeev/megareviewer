// Long documents for the harness cases, the same text every time. Written by rule rather than kept
// as files, so a case can be read in a minute and still weigh what a real repository's does.

/** A part of a service, as a document's section names it. */
export interface Area {
  readonly name: string;
  readonly owner: string;
}

const slugOf = (name: string): string => name.toLowerCase().replaceAll(" ", "_");

/** A number in [from, to] that differs from one area and paragraph to the next. */
const pick = (seed: number, from: number, to: number): number =>
  from + ((seed * 37 + 11) % (to - from + 1));

/** Rules about where an area's own code, jobs and data are: nothing a change elsewhere can break. */
export const areaSection = ({ name, owner }: Area, index: number): string => {
  const slug = slugOf(name);
  const n = (paragraph: number, from: number, to: number) => pick(index * 8 + paragraph, from, to);
  return [
    `## ${name}`,
    "",
    `The ${owner} team owns this part. Its code is in \`src/${slug}/\`, with a \`repository.ts\` of its own and tests beside each file, and nothing outside that folder reads the \`${slug}\` table: code elsewhere that needs a row asks for a function in \`src/${slug}/index.ts\`, which the ${owner} team reviews.`,
    "",
    `- **Its numbers change behind a flag.** A change to how ${name.toLowerCase()} are worked out ships behind \`${slug}_v${n(1, 2, 9)}\` and stays there for ${n(2, 14, 60)} days, while a nightly job compares both ways on the last ${n(3, 2, 12)} months and posts what differs to the team's channel.`,
    `- **Its jobs hold a lock.** They run from \`jobs/${slug}.ts\` at ${String(n(4, 0, 23)).padStart(2, "0")}:${String(n(5, 0, 59)).padStart(2, "0")} UTC, take the \`${slug}\` lock and give it up after ${n(6, 5, 55)} minutes. A job that loses it stops at the row it was on and goes on from there the next night.`,
    `- **Its fixtures are shared.** They're in \`test/fixtures/${slug}/\`, made by \`pnpm fixtures ${slug}\` from the ${n(7, 3, 40)} accounts the ${owner} team keeps for it, and a test that needs another account adds it there first.`,
    `- **Its dashboard reads a view.** The numbers come from \`${slug}_daily\`, refreshed every ${n(8, 10, 50)} minutes, and an alert on one of them says which chart to open and who was paged for it last time.`,
    `- **Its columns leave in two releases.** The first stops writing one and says so in the changelog; the second, at least ${n(9, 2, 8)} weeks later, drops it, with the query that shows nobody reads it in the pull request.`,
    `- **Its settings are read at start.** They're in \`config/${slug}.yaml\`, checked against a schema before the process takes its first request, and a setting that fails the check stops the deploy with the name of the file and the line. A value that has to change while the service runs is a flag instead, and the ${owner} team decides which of the two it is.`,
    `- **Its table is split by month.** A query names the month it wants, and one over more than ${pick(index * 8 + 11, 3, 18)} months goes to the replica, where it can take ${pick(index * 8 + 12, 2, 30)} minutes before it's stopped. The oldest month is moved to the archive on the first Monday after the ${owner} team signs it off.`,
    `- **Its releases are rehearsed.** The team plays the last ${pick(index * 8 + 13, 2, 14)} days of traffic against a copy, reads what changed with the person who asked for it, and writes down what would make them roll it back before it goes out. What was written down is what the on-call reads first.`,
    `- **Its questions have a channel.** Support asks in \`#${slug}-help\`, where someone answers within ${pick(index * 8 + 14, 1, 6)} hours of a working day, and an answer given twice goes into this section the same week.`,
    `- **Its logs carry \`${slug}_id\`,** and nothing a customer typed. Support searches them for ${n(10, 7, 90)} days and then asks the ${owner} team for a copy from the archive.`,
    "",
  ].join("\n");
};

/** A document of one section an area, under a title. */
export const areaDocument = (title: string, intro: string, areas: readonly Area[], from = 0) =>
  [`# ${title}`, "", intro, "", ...areas.map((area, i) => areaSection(area, from + i))].join("\n");
