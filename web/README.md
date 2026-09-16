# web

The Carnage front end: the landing page, the match app, the replay, and
Carnage Labs. React and TypeScript on Vite, built as a static bundle with no
server behind it.

## Commands

```
npm install                   # dependencies
npm run dev                   # dev server
npm run build                 # typecheck and produce dist/
npx vitest run                # tests
npm run lint                  # oxlint
npm run snapshot              # regenerate src/chain/history.json
npm run snapshot:studio-next  # regenerate src/chain/history-studio-next.json
```

`BASE_PATH` sets the path the bundle is served from; it defaults to `/` for
carnageapp.xyz, and the GitHub Pages workflow sets `/carnage/`.

## The two networks

|                     | Bradbury                                | Studio Next                                |
|---------------------|-----------------------------------------|--------------------------------------------|
| contract            | `0xc60850c9...2d24337A`                 | `0xB84f059D...b72078e0`                    |
| SDK                 | genlayer-js 1.2                         | genlayer-js 2.0                            |
| live tx source      | `eth_getLogs` on the consensus contract | `sim_getTransactionsForAddress` on the node |
| committed index     | `src/chain/history.json`                | `src/chain/history-studio-next.json`       |
| proof links         | yes                                     | yes                                        |
| convergence         | yes                                     | yes                                        |
| withdrawals         | execute                                 | do not execute                             |
| contract reads      | unmetered                               | 30 a minute                                |

Every row is something measured against the live node, and every one is
declared once in `src/chain/networks.ts` next to the measurement that
established it. Screens ask that registry rather than testing for a chain id,
so a third network is a row here and not a change to a component.

## Two things worth knowing before editing

The contract address, the chain and the SDK major live in
`src/chain/networks.ts`. `src/chain/client.ts` resolves which row this page
load is for, once, at import, and every other module derives from that. The
history index a load is allowed to read is chosen by contract address, so an
index can never be served against the deployment it does not describe.

Both networks answer transaction hashes from two sources: a committed index
for the past, and a live read merged over it. Only the live half differs.

Bradbury's is a log filter. The RPC caps `eth_getLogs` at 10000 blocks and the
chain produces a block every 0.76 s, so reading the whole history at page load
grows without bound; `npm run snapshot` fixes the cost of the past at zero and
only the blocks after the snapshot are scanned live.

Studio Next has no such log. `eth_getLogs` there answers `[]` for every range,
including the whole chain with no address filter, because there is no EVM
underneath it. Its node instead answers `sim_getTransactionsForAddress` with
the contract's entire history in one reply, 164 KB on the wire, on a rate
limit bucket separate from the 30 contract reads a minute the app paces
against. `npm run snapshot:studio-next` commits that same listing, because the
chain resets by design and the file is what keeps the hashes readable when the
live listing goes empty.

Re-run either snapshot whenever the on-chain record should catch up, and
commit the result. `src/chain/txlog.ts` and `src/chain/txindex.ts` explain the
split in full, and `src/chain/provenance.ts` owns every sentence the pages say
about it, so no component describes a source in prose.
