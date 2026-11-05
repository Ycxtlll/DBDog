import { invoke } from "@tauri-apps/api/core";
import type { StructureDiffReport } from "../types";

export async function compareTableStructure(
  sourceConnectionId: string,
  sourceDatabase: string,
  targetConnectionId: string,
  targetDatabase: string,
): Promise<StructureDiffReport> {
  return invoke("compare_table_structure", {
    sourceConnectionId,
    sourceDatabase,
    targetConnectionId,
    targetDatabase,
  });
}
