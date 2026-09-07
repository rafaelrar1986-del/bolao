// The API helpers already include the /api prefix in each route.
// Keep workspace previews same-origin; published frontend deployments use
// the production API because the frontend and backend are hosted separately.
const hostname = globalThis.location?.hostname || "";
const isWorkspacePreview =
  hostname === "localhost" ||
  hostname === "127.0.0.1" ||
  hostname === "::1" ||
  hostname.endsWith(".replit.dev");

export const API_BASE_URL =
  globalThis.__BOLAO_API_BASE_URL__ ||
  (isWorkspacePreview ? "" : "https://bolao-62rz.onrender.com");
export const PAGE_SIZE = 5;
