#!/usr/bin/env bash
sed -i 's/if[[:space:]]\+(false[[:space:]]\+||[[:space:]]\+BC_RUST_MINER)[[:space:]]\+{/if (BC_RUST_MINER) {/g' ../lib/mining/officer.js
sed -i 's/if[[:space:]]\+(false[[:space:]]\+||[[:space:]]\+BC_RUST_MINER)[[:space:]]\+{/if (BC_RUST_MINER) {/g' ../lib/engine/index.js
