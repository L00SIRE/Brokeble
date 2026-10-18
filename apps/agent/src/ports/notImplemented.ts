/** Real adapters start as stubs so a premature mode flip fails loudly at the first call. */
export const notImplemented = (where: string, owner: "A" | "B" | "C"): never => {
  throw new Error(`${where}: not implemented yet (owner ${owner})`);
};
