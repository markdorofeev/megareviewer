import { type Area, areaDocument } from "./documents.ts";
import type { CaseGuidance } from "./guidance.ts";

// The rules of a company that makes field devices. Nothing in them speaks to a web service's code,
// which every other case is: what a large harness costs a review it has nothing for.

const DOCUMENTS: readonly (readonly [title: string, areas: readonly string[]])[] = [
  ["Motor control", ["Stepper drivers", "Encoders", "Torque limits", "Homing", "Brakes"]],
  ["Power", ["Battery packs", "Chargers", "Brownouts", "Fuses", "Solar input"]],
  ["Field bus", ["Frames", "Arbitration", "Termination", "Node numbers", "Gateways"]],
  ["Sensors", ["Thermocouples", "Load cells", "Flow meters", "Lidar", "Humidity probes"]],
  ["Boot", ["Boot loaders", "Partitions", "Watchdogs", "Reset causes", "Factory mode"]],
  ["Radio", ["Antennas", "Channel plans", "Pairing", "Duty cycles", "Range tests"]],
  ["Enclosures", ["Gaskets", "Vents", "Labels", "Drop tests", "Salt spray"]],
  ["Boards", ["Stackups", "Impedance", "Test points", "Silkscreen", "Panelization"]],
  ["Manufacturing", ["Solder profiles", "Fixtures", "Burn in", "Serial numbers", "Rework"]],
  ["Calibration", ["Reference loads", "Drift", "Certificates", "Temperature chambers", "Offsets"]],
  ["Displays", ["Glyphs", "Backlights", "Touch panels", "Ghosting", "Contrast in sunlight"]],
  ["Valves", ["Solenoids", "Duty ratings", "Leak tests", "Manual overrides", "Seals"]],
];

const OWNERS = ["actuation", "power", "bench", "line", "field"];

const slug = (title: string): string => title.toLowerCase().replaceAll(" ", "-");

const documents = DOCUMENTS.map(([title, names], index) => ({
  path: `docs/hardware/${slug(title)}.md`,
  content: areaDocument(
    title,
    `What the bench, the line and the field expect of ${title.toLowerCase()} on every device we ship.`,
    // Each area once per generation of device, as a company that has made three would keep them.
    ["Mark one", "Mark two", "Mark three"].flatMap((generation) =>
      names.map(
        (name, i): Area => ({
          name: `${name} ${generation.toLowerCase()}`,
          owner: OWNERS[(index + i) % OWNERS.length] ?? "bench",
        }),
      ),
    ),
    index * 15,
  ),
}));

const CLAUDE_MD = `# Field devices

Firmware and hardware of the devices we put in the field. Follow the rules below on every change to a device.

@docs/firmware-rules.md

What each part of a device expects is in its own document:

${documents.map(({ path }) => `- [${path}](${path})`).join("\n")}
`;

const FIRMWARE_RULES_MD = `# Firmware rules

- **Interrupt handlers only set a flag.** The work is the task's that waits for it.
- **No heap after boot.** A buffer is sized at compile time and lives in its task's section.
- **A register is written through its driver,** which keeps a shadow of the last value.
- **Every loop kicks the watchdog,** once, at its end.
- **A float never crosses the field bus.** It's sent in the unit and scale the node's table gives.
`;

/** One root, one file it imports and the documents it links. */
export const largeHarness: CaseGuidance = {
  preferences: [],
  guidelines: [{ path: "CLAUDE.md", content: CLAUDE_MD }],
  imported: [{ path: "docs/firmware-rules.md", content: FIRMWARE_RULES_MD }],
  linked: documents,
};
