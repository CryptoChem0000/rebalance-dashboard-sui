import { Command } from "commander";

import { DatabaseQueryClient } from "../../database";
import { formatDateRange, parseDateOptions, withDatabase } from "../helpers";

export function volumeCommand(program: Command) {
  program
    .command("volume")
    .description("Show trading volume statistics")
    .option(
      "-e, --environment <env>",
      "Environment (mainnet or testnet)",
      "mainnet"
    )
    .option(
      "-t, --type <type>",
      "Volume type: archway, osmosis, bridge, or all",
      "all"
    )
    .option("--csv", "Export to CSV file in reports/ folder")
    .option("-s, --start <date>", "Start date (DD-MM-YYYY)")
    .option("-E, --end <date>", "End date (DD-MM-YYYY)")
    .action(async (options) => {
      await withDatabase(options, async (db) => {
        const { startDate, endDate } = parseDateOptions(options);

        formatDateRange(startDate, endDate);

        await displayVolumes(db, options.type, startDate, endDate);

        if (options.csv) {
          await exportVolumeToCSV(db, options.type, startDate, endDate);
        }
      });
    });
}

async function displayVolumes(
  db: DatabaseQueryClient,
  type: string,
  startDate?: Date,
  endDate?: Date
) {
  if (type === "all" || type === "archway") {
    console.log("🔄 Archway Bolt Volume:");
    console.log("─".repeat(60));
    const archwayVolume = await db.getArchwayBoltVolume(
      undefined,
      startDate,
      endDate
    );
    console.log(db.formatVolumeData(archwayVolume) || "No data");
    console.log();
  }

  if (type === "all" || type === "osmosis") {
    console.log("🌊 Osmosis Volume:");
    console.log("─".repeat(60));
    const osmosisVolume = await db.getOsmosisVolume(
      undefined,
      startDate,
      endDate
    );
    console.log(db.formatVolumeData(osmosisVolume) || "No data");
    console.log();
  }

  if (type === "all" || type === "bridge") {
    console.log("🌉 Bridge Volume:");
    console.log("─".repeat(60));
    const bridgeVolume = await db.getBridgeVolume(
      undefined,
      startDate,
      endDate
    );
    console.log(db.formatVolumeData(bridgeVolume) || "No data");
    console.log();
  }
}

async function exportVolumeToCSV(
  db: DatabaseQueryClient,
  type: string,
  startDate?: Date,
  endDate?: Date
) {
  console.log("\n📁 Exporting to CSV file(s)...");
  const files = await db.exportVolumeToCSV(
    type as "archway" | "osmosis" | "bridge" | "all",
    undefined,
    startDate,
    endDate
  );
  console.log("\n✅ CSV file(s) exported:");
  files.forEach((file) => console.log(`   - ${file}`));
}
