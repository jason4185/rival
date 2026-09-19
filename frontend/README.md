# RIVAL frontend

The frontend reads and writes the deployed RIVAL contract on GenLayer Studio development preview (chain 61997). Markets, positions, settlement state, evidence, and balances are never synthesized locally.

Routes:

- `/markets`
- `/market/:id`
- `/portfolio`
- `/create`
- `/how-it-works`

The frontend uses the Studio-dev release-candidate stack pinned in `package.json` and Transaction Kit for contract writes. Economic writes are confirmed only after the finalized execution result is successful.
