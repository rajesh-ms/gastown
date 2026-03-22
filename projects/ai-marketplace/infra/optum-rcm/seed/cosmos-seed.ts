/**
 * Optum RCM MVP — Cosmos DB Template Seeder
 *
 * Loads the 4 production workflow templates into the `templates` container.
 * Run once after initial deployment:
 *
 *   npx tsx infra/optum-rcm/seed/cosmos-seed.ts
 *
 * Requires:
 *   COSMOS_ENDPOINT and COSMOS_KEY environment variables
 *   (or use the local emulator defaults).
 */

import { CosmosClient } from "@azure/cosmos";
import { v4 as uuidv4 } from "uuid";
import { OPTUM_RCM_TEMPLATES } from "./rcm-templates.js";

const endpoint = process.env.COSMOS_ENDPOINT ?? "https://localhost:8081";
const key =
  process.env.COSMOS_KEY ??
  "C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==";

const DATABASE = "optum-rcm";
const CONTAINER = "templates";

async function seed() {
  const client = new CosmosClient({ endpoint, key });

  const { database } = await client.databases.createIfNotExists({ id: DATABASE });
  const { container } = await database.containers.createIfNotExists({
    id: CONTAINER,
    partitionKey: { paths: ["/tenantId"] },
  });

  console.log(`Seeding ${OPTUM_RCM_TEMPLATES.length} templates into ${DATABASE}/${CONTAINER}...`);

  for (const tmpl of OPTUM_RCM_TEMPLATES) {
    const doc = { id: uuidv4(), ...tmpl };

    // Check if a template with the same name already exists for this tenant
    const { resources: existing } = await container.items
      .query({
        query: "SELECT c.id FROM c WHERE c.tenantId = @tid AND c.name = @name",
        parameters: [
          { name: "@tid", value: tmpl.tenantId },
          { name: "@name", value: tmpl.name },
        ],
      })
      .fetchAll();

    if (existing.length > 0) {
      console.log(`  ✓ "${tmpl.name}" already exists — skipping`);
      continue;
    }

    await container.items.create(doc);
    console.log(`  + "${tmpl.name}" (${doc.id})`);
  }

  console.log("Done.");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
