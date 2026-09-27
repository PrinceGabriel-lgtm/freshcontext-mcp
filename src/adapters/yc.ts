import { AdapterResult, ExtractOptions } from "../types.js";

// Withdrawn in 0.5.3 pending review of source terms. The tool name stays registered so
// existing clients get a clear answer instead of an unknown-tool error.
export const YC_WITHDRAWN = "YC source withdrawn in 0.5.3 pending review of source terms.";

export async function ycAdapter(_options: ExtractOptions): Promise<AdapterResult> {
  throw new Error(YC_WITHDRAWN);
}
