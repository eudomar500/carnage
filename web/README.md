# web

The Carnage front end: the landing page, the match app, the replay, and
Carnage Labs. React and TypeScript on Vite, built as a static bundle with no
server behind it.

## Commands

```
npm install        # dependencies
npm run dev        # dev server
npm run build      # typecheck and produce dist/
npx vitest run     # tests
npm run lint       # oxlint
npm run snapshot   # regenerate src/chain/history.json from the contract
```

`BASE_PATH` sets the path the bundle is served from; it defaults to `/` for
carnageapp.xyz, and the GitHub Pages workflow sets `/carnage/`.

## Two things worth knowing before editing

The contract address and the chain live in `src/chain/client.ts`. Everything
else derives from those two constants, including which transactions the
history index is considered valid for.

`npm run snapshot` rewrites `src/chain/history.json`, the committed index of
every transaction sent to the contract up to a snapshot block. It exists
because the Bradbury RPC caps `eth_getLogs` at 10000 blocks and the chain
produces a block every 0.76 s, so reading the whole history at page load grows
without bound. Blocks after the snapshot are scanned live. Re-run it whenever
the on-chain record should catch up, and commit the result;
`src/chain/txlog.ts` explains the split in full.
