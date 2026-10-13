import "./env";
import { deleteLeftoverAccounts } from "./accounts";

/** After the run: no e2e-…@gradus.local account stays behind, even after a failed test. */
export default async function globalTeardown() {
  const removed = await deleteLeftoverAccounts();
  if (removed > 0) console.log(`Removed ${removed} leftover e2e account(s).`);
}
