export const notImplemented = () =>
  Response.json({ error: "not_implemented" }, { status: 501 });
