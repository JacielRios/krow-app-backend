// Deploy over the bootstrap immediately after use. No imports or environment access.
Deno.serve(() => Response.json({ ok: false, code: 'RETIRED' }, {
  status: 410, headers: { 'Cache-Control': 'no-store' },
}));
