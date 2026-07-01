import { MultiAIHub } from "../src/hub.js";
import { runSeatPlain } from "../src/council.js";
import { SEATS, seatConfigured, type SeatId } from "../src/seats.js";

const cloudSeats = (Object.keys(SEATS) as SeatId[]).filter((id) => SEATS[id].locality === "cloud");
const configured = cloudSeats.filter((id) => seatConfigured(id));
const hub = new MultiAIHub();

console.log(
  JSON.stringify(
    {
      configured: Object.fromEntries(cloudSeats.map((id) => [id, seatConfigured(id)])),
      note: "Only configured cloud seats are called. No private prompt content is sent.",
    },
    null,
    2,
  ),
);

if (configured.length === 0) {
  console.log("No cloud council seats configured; smoke skipped.");
  process.exit(0);
}

let failures = 0;
for (const seat of configured) {
  try {
    const text = await runSeatPlain(hub, seat, "Connection smoke test. Reply with exactly: OK");
    const reply = text.trim().slice(0, 80);
    console.log(`${seat}: ${reply}`);
    if (!/^OK\b/i.test(reply)) failures += 1;
  } catch (error) {
    failures += 1;
    console.error(`${seat}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures > 0) process.exit(1);
