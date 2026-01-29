# Runbooks

## Overview

This document provides step-by-step procedures for common maintenance operations. Each runbook includes prerequisites, detailed steps, verification, and rollback procedures.

**Format**: Each runbook follows the structure:
- **Purpose**: What this procedure accomplishes
- **When to Use**: Scenarios requiring this procedure
- **Prerequisites**: Required access, tools, knowledge
- **Duration**: Estimated time to complete
- **Steps**: Numbered procedure with commands
- **Verification**: How to confirm success
- **Rollback**: How to undo if needed

---

## Emergency Procedures

### EMERGENCY: Frontend Down Due to Bad Deployment

**Severity**: P0 - Critical
**Impact**: All Osmosis Zone users affected
**Response Time**: <5 minutes

#### Symptoms
- app.osmosis.zone returns errors (500, 404)
- Users cannot access assets or swap interface
- Vercel deployment shows ❌ Failed or deployed with errors

#### Immediate Actions

**Step 1: Rollback in Vercel** (Fastest - Do This First)
```
Duration: 2 minutes

1. Navigate to: https://vercel.com/osmo-labs/osmosis-frontend/deployments
2. Locate: Last successful deployment (green checkmark)
3. Click: Three dots menu → "Promote to Production"
4. Confirm: Click "Promote"
5. Wait: 1-2 minutes for deployment
6. Verify: https://app.osmosis.zone/ loads correctly
```

**Step 2: Disable Auto-Deployments** (Prevent Further Issues)
```
Duration: 3 minutes

Option A: Disable GitHub Workflow (Fastest)
1. Go to: Repository → Actions → Deploy Vercel Mainnet
2. Click: Three dots → "Disable workflow"
3. Confirm: Workflow disabled

Option B: Revoke Vercel Webhook (Most Secure)
1. Go to: Vercel Dashboard → Project Settings
2. Click: Git → Deploy Hooks
3. Locate: Production deploy hook
4. Click: Delete hook
5. Confirm: Deletion
```

**Step 3: Communicate Incident**
```
Duration: 2 minutes

1. Post in Telegram, X, Discord:
   "We're aware of an issue with app.osmosis.zone. The site has been rolled back
   to the last stable version while we investigate. Trading functionality restored."

```

#### Root Cause Investigation

```
Duration: 15-30 minutes (after immediate response)

1. Review Vercel Build Logs:
   - Go to failed deployment
   - Check "Building" and "Runtime" logs
   - Identify error message

2. Check Generated Files:
   git show HEAD:osmosis-1/generated/frontend/assetlist.json | jq .
   git show HEAD:osmosis-1/generated/frontend/chainlist.json | jq .
   # Look for invalid JSON, missing fields, malformed data

3. Review Recent Changes:
   git log --oneline -10
   git diff HEAD~1 osmosis-1/generated/frontend/

4. Identify Fix:
   - If bad generated data: Revert generation commit, regenerate
   - If frontend code issue: Notify frontend team
   - If Vercel config issue: Update Vercel settings
```

#### Resolution and Re-deployment

```
Duration: 30-60 minutes

1. Apply Fix:
   # If generation issue:
   git revert <bad-commit-hash>
   git push origin main

   # Manually trigger Generate All Files
   # Review PR carefully before merging

2. Test Deployment:
   # Deploy to preview first
   # Verify assetlist loads correctly
   # Test asset search and display
   # Test swap interface

3. Deploy to Production:
   # Re-enable workflow or recreate webhook
   # Trigger deployment
   # Monitor Vercel dashboard

4. Verify Resolution:
   # Check app.osmosis.zone
   # Test key user flows (search, swap, deposit)
   # Monitor for errors in browser console

5. Post-Mortem:
   # Document what went wrong
   # Identify prevention measures
   # Update runbooks if needed
```

---

### EMERGENCY: Endpoint Validation Blocking All Chains

**Severity**: P1 - High
**Impact**: No chains can be added/updated, frontend may show outdated endpoints
**Response Time**: <30 minutes

#### Symptoms
- Validation workflow fails with >50% chain failures
- All endpoints timing out
- Network connectivity errors across all providers

#### Diagnosis

```
Duration: 5 minutes

1. Check Validation Report:
   - Open most recent Generate All Files PR
   - Check "Endpoint Validation" section
   - Note: How many chains failed? Which providers?

2. Test External Connectivity:
   curl https://rpc.cosmos.directory/cosmoshub/status
   curl https://rest.cosmos.directory/cosmoshub/cosmos/base/tendermint/v1beta1/node_info

   # If both fail: GitHub Actions network issue
   # If both succeed: Validation script issue

3. Check GitHub Status:
   https://www.githubstatus.com/
   # Look for: "Actions" service degradation
```

#### Resolution

**If GitHub Actions Network Issue**:
```
Duration: Wait (no action possible)

1. Confirm: GitHub Status shows Actions issue
2. Wait: For GitHub to resolve (typically <2 hours)
3. Re-run: Validation workflow after resolution
4. No user impact: Frontend continues using cached chainlist
```

**If Validation Script Issue**:
```
Duration: 60 minutes

1. Review Script Logs:
   # Check validateEndpoints.mjs execution
   # Look for: Uncaught exceptions, infinite loops, API changes

2. Test Locally:
   cd .github/workflows/utility
   node validateEndpoints.mjs osmosis-1
   # Should complete in ~15 minutes
   # Identify specific failure point

3. Apply Fix:
   # Fix script bug
   # Commit and push
   # Re-run workflow

4. Temporary Workaround:
   # Skip validation step (edit workflow yaml)
   # Generate without validation
   # Uses previous state for endpoint ordering
```

---

## Routine Operations

### RB001: Review Scheduled Generation PR

**Purpose**: Verify automated asset and chain updates before they go live

**When to Use**: Every Monday and Thursday after 09:15 UTC

**Prerequisites**:
- GitHub access to repository
- Understanding of asset/chain structure

**Duration**: 5-10 minutes

#### Procedure

**Step 1: Locate PR**
```
1. Navigate to: https://github.com/osmosis-labs/assetlists/pulls
2. Look for: "[AUTO] Asset and Chain Update" with today's date
3. Status should be: Merged (purple badge) or Open (green badge)
4. If merged: Review was automatic (scheduled run)
5. If open: Manual review needed (manual trigger or auto-merge failed)
```

**Step 2: Review PR Summary**
```
1. Read PR body (generated summary)
2. Check metrics:
   - New assets added: Typically 0-5 per run
   - Verified assets: Typically 0-2 per run
   - New chains: Typically 0-3 per run
   - Endpoint failures: Should be <10
   - Backup endpoints used: Normal if 5-15

3. Red flags:
   ⚠️ >10 new assets at once (unusual spike)
   ⚠️ Unexpected verified assets (should be manual process)
   ⚠️ >15 endpoint failures (widespread issue)
   ⚠️ Testnet chains in mainnet (wrong network_type)
```

**Step 3: Spot Check New Assets**
```
1. Scroll to "New Assets" section in PR body
2. For each new asset, verify:
   ✅ Name looks legitimate (not "SCAM COIN" or imitating major assets)
   ✅ Chain is recognized Cosmos chain
   ✅ Denom format is valid (starts with u, ibc/, or factory/)

3. If suspicious:
   - Search asset on Chain Registry
   - Check chain legitimacy
   - Flag for removal if scam
```

**Step 4: Review File Changes**
```
1. Click "Files changed" tab
2. Scan changes:
   - generated/frontend/assetlist.json: New assets, metadata updates
   - generated/frontend/chainlist.json: Endpoint reordering, new chains
   - generated/state/state.json: Validation results, listing dates

3. Spot check:
   - New assets have required fields (symbol, decimals, etc.)
   - Chainlist endpoints look valid (https://, proper format)
   - State file JSON is valid (no syntax errors)
```

**Step 5: Approve or Request Changes**
```
If PR is still open:

Option A: Approve (everything looks good)
1. Click "Review changes" button
2. Select "Approve"
3. Comment: "LGTM - Automated checks passed"
4. Click "Submit review"
5. Click "Squash and merge"
6. Confirm merge

Option B: Request changes (issues found)
1. Click "Review changes" button
2. Select "Request changes"
3. Comment: Specific issues found (list them)
4. Click "Submit review"
5. Close PR without merging
6. Fix issues: Edit zone config, regenerate
7. Create new PR with fixes
```

#### Verification

```
Post-Merge Verification:
1. Wait 30 minutes (for deployment to trigger)
2. Check Vercel deployment: https://vercel.com/dashboard
3. Verify app.osmosis.zone:
   - New assets appear (if any)
   - Search for new asset by symbol
   - Verify logo loads
   - Check asset detail page
```

#### Rollback

```
If bad data deployed:
1. See: EMERGENCY: Frontend Down Due to Bad Deployment
2. Or revert PR:
   gh pr revert <pr-number>
   # Creates revert PR automatically
   # Merge revert PR
   # Regenerate from clean state
```

---

### RB002: Add New Asset to Zone

**Purpose**: Manually add an asset to Osmosis Zone (bypass automatic detection)

**When to Use**:
- Asset not auto-detected (missing IBC connection)
- Asset needs custom configuration
- Urgent asset addition requested

**Prerequisites**:
- Asset registered in Chain Registry
- Knowledge of IBC paths (if cross-chain)
- Git and GitHub access

**Duration**: 15-30 minutes

#### Procedure

**Step 1: Verify Asset in Chain Registry**
```
cd chain-registry
git pull origin master

# Search for asset
find . -name "assetlist.json" -exec grep -l "<base_denom>" {} \;

# Example: find . -name "assetlist.json" -exec grep -l "untrn" {} \;
# Should return: ./neutron/assetlist.json

# Verify asset has required fields
jq '.assets[] | select(.base == "<base_denom>")' <chain>/assetlist.json

# Check for:
# - base: Base denomination
# - symbol: Ticker symbol
# - name: Full name
# - denom_units: Decimal places
```

**Step 2: Determine IBC Path** (if cross-chain asset)
```
# Check if IBC connection exists
cd chain-registry/_IBC
ls | grep -E "(osmosis.*<chain>|<chain>.*osmosis)"

# Example: ls | grep -E "(osmosis.*neutron|neutron.*osmosis)"
# Should return: neutron-osmosis.json

# Get channel ID
jq '.channels[] | select(.chain_1.port_id == "transfer" and .chain_2.port_id == "transfer")' neutron-osmosis.json

# Note the channel_id for osmosis side (chain_2 if osmosis is chain_2)
# Example output:
# {
#   "chain_1": { "channel_id": "channel-10", "port_id": "transfer" },
#   "chain_2": { "channel_id": "channel-874", "port_id": "transfer" }
# }

# Osmosis channel: channel-874
# Path format: transfer/channel-874/<base_denom>
# Example path: transfer/channel-874/untrn
```

**Step 3: Add to zone_assets.json**
```
cd osmosis-1
nano osmosis.zone_assets.json

# Add entry (insert alphabetically by chain_name, then by comment):
{
  "base_denom": "untrn",
  "chain_name": "neutron",
  "path": "transfer/channel-874/untrn",
  "osmosis_verified": false,
  "_comment": "Neutron $NTRN"
}

# Save file (Ctrl+X, Y, Enter)

# Validate JSON syntax
jq . osmosis.zone_assets.json

# Should output formatted JSON (no errors)
```

**Step 4: Commit and Push**
```
git add osmosis-1/osmosis.zone_assets.json
git commit -m "Add Neutron $NTRN to zone assets"
git push origin main

# Or create branch and PR:
git checkout -b add-ntrn-asset
git add osmosis-1/osmosis.zone_assets.json
git commit -m "Add Neutron $NTRN to zone assets"
git push origin add-ntrn-asset
gh pr create --title "Add Neutron $NTRN" --body "Adds Neutron native token to zone assets"
```

**Step 5: Trigger Generation**
```
# Option A: Wait for next scheduled run (Mon/Thu 09:00 UTC)
# Option B: Manually trigger workflow

Navigate to: https://github.com/osmosis-labs/assetlists/actions/workflows/generate_all_files.yml
Click: "Run workflow"
Select: Branch (main)
Click: "Run workflow" button

Wait: ~20 minutes for completion
```

#### Verification

```
1. Check workflow succeeded:
   - Actions → Generate All Files → Recent run
   - Status should be ✅ Success

2. Check generated PR:
   - Pull Requests → "[AUTO] Asset and Chain Update"
   - Verify new asset in "New Assets" section
   - Review diff: osmosis-1/generated/frontend/assetlist.json

3. Search for asset in generated file:
   jq '.assets[] | select(.symbol == "NTRN")' osmosis-1/generated/frontend/assetlist.json

   # Should return asset object with all fields populated

4. After deployment, check frontend:
   - https://app.osmosis.zone/assets
   - Enable "Show Unverified Assets"
   - Search for "NTRN"
   - Verify asset appears with correct metadata
```

#### Rollback

```
If incorrect asset added:
1. Remove from zone_assets.json:
   # Edit file, delete asset entry
   git add osmosis-1/osmosis.zone_assets.json
   git commit -m "Remove incorrect asset"
   git push origin main

2. Regenerate:
   # Trigger Generate All Files workflow
   # Asset will be removed from generated files

3. Redeploy:
   # Wait for scheduled deployment or trigger manually
```

---

### RB003: Verify Asset (Upgrade to Verified Status)

**Purpose**: Review and approve asset verification request

**When to Use**: Community submits PR to verify asset

**Prerequisites**:
- Verification criteria knowledge (LISTING.md)
- Access to Osmosis Zone app
- Test wallet with small funds

**Duration**: 30-60 minutes

#### Procedure

**Step 1: Run Verification Criteria Check**
```
Duration: 5 minutes

1. Trigger workflow:
   Navigate to: Actions → Check Verification Criteria
   Click: "Run workflow"
   Input: Chain name (e.g., "osmosis-1")
   Click: "Run workflow"

2. Wait for completion (~5 minutes)

3. Download report:
   - Click completed workflow run
   - Scroll to "Artifacts" section
   - Download: verification_report_latest.json
   - Or view in repository: osmosis-1/generated/verification_reports/
```

**Step 2: Review Automated Checks**
```
Duration: 5 minutes

Open verification_report_latest.json
Search for asset by symbol or denom

Check all 8 criteria:
✅ 1. Standard Listing (Chain Registry presence)
✅ 2. Meaningful Description (≥15 chars)
✅ 3. Extended Description (≥100 chars, exemptions noted)
✅ 4. Socials (website/twitter, exemptions noted)
✅ 5. Logo (square, <250KB)
✅ 6. Pool Liquidity (≥$1,000)
✅ 7. Bid Depth ($50 at 2% slippage)
✅ 8. Chain Status (not killed)

If criteria failed apart from liquidity related: Request submitter fix issues before proceeding
If liquidity related failure, check manually by simulation a trade on the Osmosis Zone frontend - may be split over pools for example.
```

**Step 3: Visibility Checks**
```
Duration: 5 minutes

1. Price Display:
   - Check asset detail page
   - Verify price shown (not "Price unavailable")
   - If no price: Check coingecko_id exists

2. Trading Check:
   - Go to https://app.osmosis.zone/swap
   - Search for asset
   - Verify asset appears in search results
   - Verify route found (can swap to/from OSMO or USDC)

```

**Step 4: Manual Withdrawal Test**
```
Duration: 10-15 minutes

1. Navigate to: https://app.osmosis.zone/assets/<symbol>
2. Click: "Withdraw" button
3. Select destination chain
4. Verify: Destination chain RPC connects
5. Enter amount: $1-2 equivalent (May need to purchase test amount)
6. Click: "Withdraw"
7. Sign transaction
8. Monitor: Transfer status
9. Verify: Balance decreased on Osmosis Zone
10. Verify: Balance increased on destination chain
    - Check wallet on destination chain
    - May take 30-60 seconds to reflect
```

**Step 5: Manual Deposit Test**
```
Duration: 10-15 minutes

1. Navigate to: https://app.osmosis.zone/assets/<symbol>
2. Click: "Deposit" button
3. Connect wallet (Keplr or Leap)
4. Verify: Source chain appears in dropdown
5. Verify: RPC endpoint connects (no errors)
6. Enter amount: $1-2 equivalent
7. Click: "Deposit"
8. Verify: Transaction modal appears
9. Sign transaction in wallet
10. Monitor: Transfer status
    - Should show "Pending" → "Success" within 30-60 seconds
    - Or if no WSS: May stay "Pending" (refresh to check)
11. Verify: Balance increased on Osmosis Zone
    - Check asset balance in wallet
    - Should reflect deposited amount
```

**Step 6: Approve or Reject**
```
Duration: 5 minutes

If all tests passed:
1. Go to PR: Asset verification request
2. Click: "Files changed" tab
3. Review change: osmosis_verified: false → true
4. Click: "Review changes"
5. Select: "Approve"
6. Comment:
   "Verification approved! ✅

   All criteria met:
   - ✅ Automated checks passed (8/8 criteria)
   - ✅ Deposit/Withdraw functional
   - ✅ Price displayed
   - ✅ Tradeable on DEX

   Merging now. Verified badge will appear on next deployment (Mon/Thu 09:40 UTC)."
7. Click: "Submit review"
8. Click: "Squash and merge"
9. Confirm merge

If tests failed:
1. Click: "Review changes"
2. Select: "Request changes"
3. Comment: Specific failures (be detailed)
   Example:
   "Thank you for the request! Issues found:

   ❌ Deposit: CORS error prevents transfer from source chain
   ❌ Price: CoinGecko ID missing, price unavailable

   Please:
   1. Work with chain team to enable CORS for osmosis.zone
   2. Add coingecko_id to Chain Registry assetlist

   Once fixed, resubmit for verification."
4. Click: "Submit review"
5. Do not merge
```

#### Verification

```
After merging verification PR:

1. Wait for next scheduled run or trigger manually
2. Check generated assetlist:
   jq '.assets[] | select(.symbol == "<SYMBOL>") | .verified' osmosis-1/generated/frontend/assetlist.json
   # Should return: true

3. After deployment, verify on frontend:
   - Go to https://app.osmosis.zone/assets
   - Asset should appear WITHOUT enabling "Show Unverified Assets"
   - Asset should have blue verification checkmark
   - Asset detail page should show verified badge
```

#### Rollback

```
If asset verified incorrectly:

1. Create PR to revert:
   # Edit osmosis-1/osmosis.zone_assets.json
   # Change: osmosis_verified: true → false
   # Commit and push

2. Regenerate:
   # Trigger Generate All Files workflow
   # Verified flag removed from generated files

3. Communicate:
   # Comment on original verification PR
   # Explain reason for downgrade
   # Document what needs fixing
```

---

### RB004: Add Custom Chain Configuration

**Purpose**: Configure custom RPC/REST endpoints for a chain

**When to Use**:
- Chain requests custom endpoints
- Chain Registry endpoints failing validation
- Performance issues with default endpoints
- New chain without Chain Registry endpoints

**Prerequisites**:
- Working RPC and REST endpoints
- Chain information (chain_name, pretty_name)
- Git access

**Duration**: 20-30 minutes

#### Procedure

**Step 1: Test Endpoints**
```
Duration: 5 minutes

Test RPC endpoint:
curl -X POST https://rpc.example.com \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"status","params":[],"id":1}'

# Should return JSON with status info
# Check response time: Should be <2 seconds

Test REST endpoint:
curl https://rest.example.com/cosmos/base/tendermint/v1beta1/node_info

# Should return JSON with node_info
# Check response time: Should be <2 seconds

Test CORS (if needed for frontend):
curl -I -X OPTIONS https://rpc.example.com \
  -H "Origin: https://osmosis.zone" \
  -H "Access-Control-Request-Method: POST"

# Look for:
# Access-Control-Allow-Origin: *
# or
# Access-Control-Allow-Origin: https://osmosis.zone
```

**Step 2: Add to zone_chains.json**
```
Duration: 5 minutes

cd osmosis-1
nano osmosis.zone_chains.json

# Add new chain entry (alphabetically by chain_name):
{
  "chain_name": "example",
  "rpc": "https://rpc.example.com",
  "rest": "https://rest.example.com",
  "explorer_tx_url": "https://explorer.example.com/tx/{txHash}",
  "keplr_features": ["ibc-go"],
  "_comment": "Example Chain"
}

# Optional fields:
# "override_properties": {
#   "force_rpc": true,        // Lock RPC in first position
#   "force_rest": true,       // Lock REST in first position
#   "outage": false,          // Display outage warning
#   "pretty_name": "Custom Name",  // Override Chain Registry name
#   "bech32_prefix": "custom"      // Override if different from Chain Registry
# }

# Save file
jq . osmosis.zone_chains.json  # Validate JSON
```

**Step 3: Commit and Test**
```
Duration: 5 minutes

git checkout -b add-example-chain
git add osmosis-1/osmosis.zone_chains.json
git commit -m "Add custom endpoints for Example Chain"
git push origin add-example-chain
```

**Step 4: Trigger Validation**
```
Duration: 15 minutes

1. Navigate to: Actions → Full Validation
2. Click: "Run workflow"
3. Select: Branch (add-example-chain)
4. Input: Chain name (osmosis-1)
5. Click: "Run workflow"
6. Wait: ~15 minutes
7. Review: Validation report
   - Check: Example chain in validated chains list
   - Verify: RPC and REST both pass connectivity
   - Check: CORS status (warning OK, failure needs investigation)
```

**Step 5: Generate Chainlist**
```
Duration: 5 minutes

1. Navigate to: Actions → Generate Chainlist
2. Click: "Run workflow"
3. Select: Branch (add-example-chain)
4. Click: "Run workflow"
5. Wait: ~3 minutes
6. Check generated chainlist:
   git pull origin add-example-chain
   jq '.chains[] | select(.chain_name == "example")' osmosis-1/generated/frontend/chainlist.json

   # Verify:
   # - RPC endpoint appears first in apis.rpc array
   # - REST endpoint appears first in apis.rest array
   # - Chain has all required fields (chain_id, bech32_prefix, etc.)
```

**Step 6: Create PR and Merge**
```
Duration: 5 minutes

gh pr create \
  --title "Add custom endpoints for Example Chain" \
  --body "Adds custom RPC/REST endpoints for Example Chain.

**Endpoints Tested:**
- RPC: https://rpc.example.com (response time: <2s)
- REST: https://rest.example.com (response time: <2s)

**Validation:**
- [x] Endpoints pass connectivity test
- [x] Endpoints tested manually
- [x] Chainlist generated successfully

**Reason:**
Chain Registry endpoints failing validation (timeout issues). Using chain operator's dedicated endpoints."

# Review PR
# Merge if validation passed
gh pr merge --squash
```

#### Verification

```
After merge and deployment:

1. Check chainlist in production:
   curl https://app.osmosis.zone/assets  # or wherever chainlist is served
   # Verify example chain appears

2. Test on frontend:
   - Go to Osmosis Zone
   - Attempt deposit/withdraw for asset from example chain
   - Verify RPC connection successful
   - Verify balance queries work

3. Monitor validation reports:
   - Check next scheduled run (Mon/Thu)
   - Verify example chain passes validation
   - Confirm custom endpoints used
```

#### Rollback

```
If custom endpoints cause issues:

1. Remove from zone_chains.json:
   # Edit file, delete chain entry
   # Or revert force_rpc/force_rest flags

2. Regenerate:
   # Trigger Generate All Files workflow
   # System reverts to Chain Registry endpoints

3. Or update endpoints:
   # Replace with working alternatives
   # Recommit and regenerate
```

---

### RB005: Emergency Endpoint Override

**Purpose**: Quickly override failing endpoints without full regeneration

**When to Use**:
- Critical chain endpoints down
- Users reporting deposit/withdrawal failures
- Need immediate fix before next scheduled run

**Prerequisites**:
- Working replacement endpoints
- Git access
- Understanding of force override behavior

**Duration**: 10-15 minutes

#### Procedure

**Step 1: Identify Working Endpoints**
```
Duration: 5 minutes

1. Check Chain Registry for alternatives:
   cd chain-registry/<chain>
   jq '.apis.rpc[] | .address' chain.json
   jq '.apis.rest[] | .address' chain.json

2. Test each endpoint:
   for rpc in $(jq -r '.apis.rpc[] | .address' chain.json); do
     echo "Testing $rpc..."
     timeout 5 curl -X POST "$rpc/status" -H "Content-Type: application/json" \
       -d '{"jsonrpc":"2.0","method":"status","params":[],"id":1}' || echo "FAILED"
   done

3. Note working endpoints
```

**Step 2: Add Force Override**
```
Duration: 3 minutes

cd osmosis-1
nano osmosis.zone_chains.json

# If chain exists, add override:
{
  "chain_name": "example",
  "rpc": "https://working-rpc.com",
  "rest": "https://working-rest.com",
  "override_properties": {
    "force_rpc": true,
    "force_rest": true
  },
  "_comment": "Example Chain - EMERGENCY: Using backup endpoints due to primary failure"
}

# If chain doesn't exist, add full entry (see RB004)

# Validate JSON
jq . osmosis.zone_chains.json
```

**Step 3: Fast-Track Deployment**
```
Duration: 5 minutes

# Commit directly to main (emergency only)
git add osmosis-1/osmosis.zone_chains.json
git commit -m "EMERGENCY: Override endpoints for Example Chain"
git push origin main

# Trigger chainlist generation
Navigate to: Actions → Generate Chainlist
Click: "Run workflow"
Wait: ~3 minutes

# Review PR, merge immediately
# Trigger deployment
Navigate to: Actions → Deploy Vercel Mainnet
Click: "Run workflow"
Wait: ~5 minutes
```

**Step 4: Verify Fix**
```
Duration: 2 minutes

1. Check chainlist:
   jq '.chains[] | select(.chain_name == "example") | .apis.rpc[0]' \
     osmosis-1/generated/frontend/chainlist.json
   # Should show forced endpoint

2. Test on frontend:
   - Go to Osmosis Zone
   - Attempt deposit from affected chain
   - Should connect successfully now

3. Monitor:
   - Check Discord/Twitter for user reports
   - Confirm issues resolved
```

#### Post-Incident Actions

```
After emergency resolved:

1. Document incident:
   # Create GitHub issue
   Title: "INCIDENT: Example Chain endpoints failed [DATE]"
   Body:
   - What failed
   - Impact duration
   - Root cause
   - Resolution applied
   - Follow-up actions

2. Remove force override (optional):
   # After primary endpoints recover
   # Remove force_rpc/force_rest flags
   # Let state-based optimization take over

3. Communicate:
   # Post in Discord if user-facing
   # Update status if posted outage notice
```