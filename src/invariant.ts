/**
 * Invariant companion plugin (no assertions — nothing to check at runtime).
 * The dsh invariants surface loads this export for every profile bundle;
 * providing an empty apply keeps the manager a well-behaved bundle citizen.
 */
export function apply(): void {}
