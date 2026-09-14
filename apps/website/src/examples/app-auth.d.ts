// Type contracts for the consuming app's helpers, not an auth implementation.
// These declarations let Astro check the displayed examples against the SDK.
export declare function getCurrentUser(
  request: Request,
): Promise<{ id: string } | null>;
